import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  balance,
  isConfigured,
  toAsset,
  toTransaction,
  transactions as fetchTransactions,
} from "@/lib/enableBanking";
import { readRevolut, writeRevolut, type RevolutRow } from "@/lib/revolutStore";
import type { Transaction } from "@/lib/types";

export const dynamic = "force-dynamic";

// How long a read is served from the stored copy before the bank is asked
// again. Open Banking providers throttle to a handful of calls per account per
// day, so a 60s ticker like the FX one would burn the allowance by breakfast.
const FRESH_MS = 4 * 60 * 60 * 1000;
// First sync pulls this much history. Revolut allows up to two years; a year
// is plenty for the digests and keeps the first call short.
const FIRST_HISTORY_DAYS = 365;
// Incremental syncs re-read this many days back, so late-booked movements
// (weekend card payments settle on Monday) are picked up.
const OVERLAP_DAYS = 7;

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface Status {
  configured: boolean;
  connected: boolean;
  accounts: { name: string; currency: string }[];
  connectedAt: string | null;
  validUntil: string | null;
  fetchedAt: string | null;
  error: string | null;
}

function status(row: RevolutRow): Status {
  return {
    configured: isConfigured(),
    connected: !!row.session,
    accounts: (row.session?.accounts ?? []).map((a) => ({
      name: a.name?.trim() || a.product?.trim() || "Revolut",
      currency: a.currency,
    })),
    connectedAt: row.session?.connectedAt ?? null,
    validUntil: row.session?.validUntil ?? null,
    fetchedAt: row.cache?.fetchedAt ?? null,
    error: row.lastError ?? null,
  };
}

// GET: the connection status plus the latest balances and transactions.
// Served from the stored copy while it is fresh; ?force=1 asks the bank now.
export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  const force = new URL(request.url).searchParams.get("force") === "1";
  let row: RevolutRow;
  try {
    row = await readRevolut();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 502 }
    );
  }

  if (!row.session) {
    return NextResponse.json({ ...status(row), assets: [], transactions: [] });
  }

  const age = row.cache ? Date.now() - new Date(row.cache.fetchedAt).getTime() : Infinity;
  if (row.cache && !force && age < FRESH_MS) {
    return NextResponse.json({
      ...status(row),
      assets: row.cache.assets,
      transactions: row.cache.transactions,
    });
  }

  try {
    const now = new Date();
    const to = day(now);
    const historyFrom =
      row.cache?.historyFrom ?? day(new Date(now.getTime() - FIRST_HISTORY_DAYS * 86_400_000));
    const from = row.cache
      ? day(new Date(now.getTime() - OVERLAP_DAYS * 86_400_000))
      : historyFrom;

    const assets = [];
    const fresh = new Map<string, Transaction>();
    for (const account of row.session.accounts) {
      const bal = await balance(account.uid);
      assets.push(toAsset(account, bal));
      for (const t of await fetchTransactions(account.uid, from, to)) {
        const mapped = toTransaction(account, t);
        if (mapped) fresh.set(mapped.id, mapped);
      }
    }

    // Keep everything older than the re-read window from the previous copy and
    // let the fresh rows win inside it, so a movement that settled with a new
    // id replaces its pending version rather than sitting next to it.
    const kept = (row.cache?.transactions ?? []).filter(
      (t) => t.date.slice(0, 10) < from && !fresh.has(t.id)
    );
    const merged = [...fresh.values(), ...kept].sort((a, b) => b.date.localeCompare(a.date));

    const next: RevolutRow = {
      ...row,
      cache: { assets, transactions: merged, fetchedAt: now.toISOString(), historyFrom },
      lastError: null,
    };
    await writeRevolut(next);
    return NextResponse.json({ ...status(next), assets, transactions: merged });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    // Consent expiry and revocation come back as 4xx from the provider. Keep
    // the last good copy on screen and tell the card why it is stale.
    const next: RevolutRow = { ...row, lastError: message };
    try {
      await writeRevolut(next);
    } catch {
      // the status below still carries the message
    }
    return NextResponse.json(
      {
        ...status(next),
        assets: row.cache?.assets ?? [],
        transactions: row.cache?.transactions ?? [],
        stale: true,
      },
      { status: row.cache ? 200 : 502 }
    );
  }
}

// POST {action: "disconnect"}: forget the session and the stored copy. The
// consent itself is revoked from the Revolut app (Settings -> Privacy ->
// Connected apps); this only stops the tracker reading it.
export async function POST(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  let action: string | undefined;
  try {
    action = (await request.json())?.action;
  } catch {
    // no body
  }
  if (action !== "disconnect") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  try {
    await writeRevolut({ lastError: null });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 502 }
    );
  }
}
