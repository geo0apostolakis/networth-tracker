import crypto from "crypto";
import type { Asset, Category } from "./types";
import { uid } from "./utils";

// ---------------------------------------------------------------------------
// Server-only Tradernet (Freedom24) public API client.
// Faithful port of the V2 signing from the official-ish Python SDK
// (kazanzhy/tradernet -> src/PublicApiClient.py): preSign + httpencode + HMAC.
//
// NOTE: host + the exact portfolio field names must be confirmed against a real
// Freedom24 account response. Override the host with FREEDOM24_API_URL if needed.
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.FREEDOM24_API_URL?.replace(/\/$/, "") || "https://tradernet.com/api";

type ReqValue = string | number | Record<string, unknown>;
type ReqDict = Record<string, ReqValue>;

// preSign: sorted "key=value" joined by "&"; nested dicts recurse.
function preSign(d: Record<string, unknown>): string {
  return Object.keys(d)
    .sort()
    .map((k) => {
      const v = d[k];
      if (v && typeof v === "object")
        return `${k}=${preSign(v as Record<string, unknown>)}`;
      return `${k}=${String(v)}`;
    })
    .join("&");
}

// httpencode: http_build_query analogue with bracket notation for nested dicts.
function httpencode(d: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of Object.keys(d).sort()) {
    const v = d[k];
    if (v && typeof v === "object") {
      const inner = v as Record<string, unknown>;
      for (const into of Object.keys(inner)) {
        const iv = inner[into];
        if (iv && typeof iv === "object") {
          const sub = iv as Record<string, unknown>;
          for (const subInto of Object.keys(sub)) {
            const sv = sub[subInto];
            if (sv && typeof sv === "object") {
              parts.push(httpencode(sv as Record<string, unknown>));
            } else {
              parts.push(`${k}[${into}][${subInto}]=${String(sv)}`);
            }
          }
        } else {
          parts.push(`${k}[${into}]=${String(iv)}`);
        }
      }
    } else {
      parts.push(`${k}=${String(v)}`);
    }
  }
  return parts.join("&");
}

export async function callTradernet(
  method: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  // trim: env vars pasted into a host dashboard often carry a trailing
  // newline/space, which would corrupt the HMAC secret -> "Invalid signature".
  const apiKey = process.env.FREEDOM24_PUBLIC_KEY?.trim();
  const apiSecret = process.env.FREEDOM24_PRIVATE_KEY?.trim();
  if (!apiKey || !apiSecret) {
    throw new Error("FREEDOM24_PUBLIC_KEY / FREEDOM24_PRIVATE_KEY not set");
  }

  const aReq: ReqDict = { cmd: method };
  if (Object.keys(params).length) aReq.params = params as Record<string, unknown>;
  aReq.apiKey = apiKey;
  aReq.nonce = Date.now() * 10; // int(time*10000); ms*10 keeps it monotonic

  const sig = crypto
    .createHmac("sha256", apiSecret)
    .update(preSign(aReq), "utf8")
    .digest("hex");
  const body = httpencode(aReq);

  const res = await fetch(`${API_BASE}/v2/cmd/${method}`, {
    method: "POST",
    headers: {
      "X-NtApi-Sig": sig,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`Tradernet ${method} -> HTTP ${res.status}`);
  const json = await res.json();

  // Tradernet reports failures (expired key, bad signature) as HTTP 200 with an
  // error payload. Left unthrown these look like an empty portfolio, which wipes
  // every synced holding from the store — so treat them as the errors they are.
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const o = json as Record<string, unknown>;
    const message = o.errMsg ?? o.error;
    if (typeof message === "string" && message) {
      throw new Error(`Tradernet ${method} -> ${message}`);
    }
  }
  return json;
}

// True when the payload carries the portfolio container we know how to read.
// A response we can't parse must not be mistaken for "you own nothing".
export function isPortfolioResponse(raw: unknown): boolean {
  const ps = (raw as PositionResponse | null)?.result?.ps;
  return !!ps && typeof ps === "object";
}

// Map a getPositionJson response -> our Asset shape.
// Response shape (per SDK): { result: { ps: { acc: [...cash], pos: [...positions] } } }
// Field names are defensive: exact keys to be confirmed against a live response.
interface RawPosition {
  i?: string; // instrument / ticker
  name?: string;
  q?: number; // quantity
  mkt_price?: number; // last market price
  market_value?: number;
  curr?: string; // currency
  s?: number; // (sometimes used for value)
}
interface RawCash {
  curr?: string;
  s?: number; // balance
}
interface PositionResponse {
  result?: { ps?: { acc?: RawCash[]; pos?: RawPosition[] } };
}

export function mapPortfolioToAssets(raw: unknown): Asset[] {
  const data = raw as PositionResponse;
  const ps = data?.result?.ps;
  const now = new Date().toISOString();
  const assets: Asset[] = [];

  for (const p of ps?.pos ?? []) {
    const qty = Number(p.q ?? 0);
    const price = Number(p.mkt_price ?? 0);
    // Value from quantity x price. Tradernet's own market_value can't be
    // trusted: for OSIS it reports 362.16 on 2 shares priced at 225.60, a fifth
    // under the tape, while mkt_price matches the close to the cent. Fall back
    // to market_value only when there's no quantity or price to multiply —
    // that's also the case where it matters (bonds quote as % of face value).
    const value =
      qty && price
        ? qty * price
        : p.market_value != null
          ? Number(p.market_value)
          : p.s != null
            ? Number(p.s)
            : 0;
    if (!value) continue;
    assets.push({
      id: uid(),
      name: p.name || p.i || "Position",
      category: "stocks" as Category,
      currency: (p.curr || "USD").toUpperCase(),
      amount: value,
      quantity: qty || undefined,
      source: "freedom24",
      updatedAt: now,
    });
  }

  for (const c of ps?.acc ?? []) {
    const bal = Number(c.s ?? 0);
    if (!bal) continue;
    assets.push({
      id: uid(),
      name: `Freedom24 cash (${(c.curr || "").toUpperCase()})`,
      category: "stocks" as Category,
      currency: (c.curr || "USD").toUpperCase(),
      amount: bal,
      source: "freedom24",
      updatedAt: now,
    });
  }

  return assets;
}
