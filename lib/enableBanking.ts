import "server-only";
import crypto from "crypto";
import type { Asset, Transaction } from "./types";

// ---------------------------------------------------------------------------
// Enable Banking (enablebanking.com) client. Personal Revolut accounts have no
// public API; Open Banking through a licensed provider is the only legal way
// to read them, and Enable Banking's "Restricted Production" tier is free for
// accounts the app owner links himself. Auth is an RS256 JWT signed with the
// private key whose certificate was uploaded when the application was
// registered in their control panel.
//
// Env: ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY (PEM, either raw with
// literal "\n" or base64 of the whole file), APP_URL (public origin, for the
// consent redirect).
// ---------------------------------------------------------------------------

const API = "https://api.enablebanking.com";

function privateKey(): string {
  const raw = process.env.ENABLE_BANKING_PRIVATE_KEY?.trim();
  if (!raw) throw new Error("ENABLE_BANKING_PRIVATE_KEY not set");
  if (raw.includes("-----BEGIN")) return raw.replace(/\\n/g, "\n");
  // Base64 of the PEM file: the safest way to get a multi-line secret through
  // a hosting dashboard without something eating the newlines.
  return Buffer.from(raw, "base64").toString("utf8");
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function isConfigured(): boolean {
  return !!(process.env.ENABLE_BANKING_APP_ID && process.env.ENABLE_BANKING_PRIVATE_KEY);
}

function jwt(): string {
  const appId = process.env.ENABLE_BANKING_APP_ID?.trim();
  if (!appId) throw new Error("ENABLE_BANKING_APP_ID not set");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const payload = b64url(
    JSON.stringify({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: now,
      exp: now + 3600,
    })
  );
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: privateKey(),
    padding: crypto.constants.RSA_PKCS1_PADDING,
  });
  return `${header}.${payload}.${b64url(sig)}`;
}

export async function eb<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${jwt()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error body: surface the raw text below
  }
  if (!res.ok) {
    const o = json as { message?: string; error?: string } | null;
    throw new Error(
      `Enable Banking ${path} -> HTTP ${res.status}: ${o?.message ?? o?.error ?? text.slice(0, 200)}`
    );
  }
  return json as T;
}

// --- shapes we read (subset of the API) ------------------------------------

export interface EbAccount {
  uid: string;
  name?: string | null;
  currency: string;
  account_id?: { iban?: string | null } | null;
  product?: string | null;
  cash_account_type?: string | null;
}

export interface EbSession {
  session_id: string;
  accounts: EbAccount[];
  access?: { valid_until?: string };
}

interface EbBalance {
  balance_amount: { amount: string; currency: string };
  balance_type: string;
  reference_date?: string;
}

interface EbTransaction {
  transaction_id?: string | null;
  entry_reference?: string | null;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  status?: string;
  remittance_information?: string[] | null;
  creditor?: { name?: string | null } | null;
  debtor?: { name?: string | null } | null;
  merchant_category_code?: string | null;
  note?: string | null;
}

// Balance types in order of preference. CLAV (closing available) is what the
// Revolut app shows; the rest are fallbacks for banks that report differently.
const BALANCE_PREF = ["CLAV", "XPCD", "ITAV", "CLBD", "ITBD", "OTHR"];

export async function balance(uid: string): Promise<{ amount: number; currency: string }> {
  const j = await eb<{ balances: EbBalance[] }>(`/accounts/${uid}/balances`);
  const list = j.balances ?? [];
  if (list.length === 0) throw new Error("no balances returned");
  const pick =
    BALANCE_PREF.map((t) => list.find((b) => b.balance_type === t)).find(Boolean) ?? list[0];
  return { amount: Number(pick.balance_amount.amount), currency: pick.balance_amount.currency };
}

export async function transactions(
  uid: string,
  dateFrom: string,
  dateTo: string
): Promise<EbTransaction[]> {
  const out: EbTransaction[] = [];
  let key: string | undefined;
  // Follow the continuation key until the bank stops handing one back. Capped
  // so a misbehaving bank cannot spin this forever.
  for (let page = 0; page < 40; page++) {
    const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (key) q.set("continuation_key", key);
    const j = await eb<{ transactions: EbTransaction[]; continuation_key?: string | null }>(
      `/accounts/${uid}/transactions?${q}`
    );
    out.push(...(j.transactions ?? []));
    if (!j.continuation_key) break;
    key = j.continuation_key;
  }
  return out;
}

// --- mapping to the app's shapes -------------------------------------------

export const REVOLUT_ASSET_PREFIX = "revolut-";

export function assetId(account: EbAccount): string {
  return `${REVOLUT_ASSET_PREFIX}${account.uid}`;
}

export function toAsset(account: EbAccount, bal: { amount: number; currency: string }): Asset {
  const label = account.name?.trim() || account.product?.trim() || "Revolut";
  return {
    id: assetId(account),
    name: label.toLowerCase().includes("revolut")
      ? `${label} (${bal.currency})`
      : `Revolut ${label} (${bal.currency})`,
    category: "bank",
    currency: bal.currency,
    amount: bal.amount,
    source: "revolut",
    updatedAt: new Date().toISOString(),
  };
}

function describe(t: EbTransaction): string | undefined {
  const who =
    t.credit_debit_indicator === "CRDT" ? t.debtor?.name?.trim() : t.creditor?.name?.trim();
  const memo = (t.remittance_information ?? []).map((s) => s.trim()).filter(Boolean).join(" ");
  const note = t.note?.trim();
  const parts = [who, memo && memo !== who ? memo : "", note && note !== memo ? note : ""].filter(
    Boolean
  );
  return parts.length ? parts.join(" · ") : undefined;
}

export function toTransaction(account: EbAccount, t: EbTransaction): Transaction | null {
  const amount = Math.abs(Number(t.transaction_amount.amount));
  if (!Number.isFinite(amount) || amount === 0) return null;
  const day = t.booking_date || t.value_date || t.transaction_date;
  if (!day) return null;
  // Banks do not always send a transaction id; fall back to a hash of the
  // fields that identify the movement so the id is stable across syncs.
  const key =
    t.transaction_id ||
    t.entry_reference ||
    crypto
      .createHash("sha1")
      .update(`${account.uid}|${day}|${t.transaction_amount.amount}|${describe(t) ?? ""}`)
      .digest("hex")
      .slice(0, 16);
  return {
    id: `rev-${key}`,
    assetId: assetId(account),
    type: t.credit_debit_indicator === "CRDT" ? "earned" : "spent",
    amount,
    currency: t.transaction_amount.currency,
    note: describe(t),
    // Noon UTC so the calendar day survives any local timezone shift.
    date: `${day}T12:00:00.000Z`,
    source: "revolut",
  };
}
