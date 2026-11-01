import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { PRICE_KEYS } from "@/lib/chains";
import { fetchPrices } from "@/lib/wallets";

export const dynamic = "force-dynamic";

// Re-prices balances that have already been read, without touching a single
// RPC. Chain balances move when a transaction lands; prices move every second,
// so the two are refreshed on different clocks: the chains every few minutes,
// this every minute.
//
// Keys are restricted to the registry. They land in a URL the server fetches,
// so accepting arbitrary input would turn this into an open proxy, the same
// reason /api/benchmark has a symbol allowlist.
export async function POST(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  let keys: string[];
  try {
    const body = await request.json();
    keys = Array.isArray(body?.keys) ? body.keys.filter((k: unknown) => typeof k === "string") : [];
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Solana tokens are priced by mint; the pattern keeps the value a bare
  // base58 mint, so it cannot steer the server anywhere but DexScreener.
  const known = keys.filter((k) => PRICE_KEYS.has(k) || /^ds:solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(k));
  if (known.length === 0) return NextResponse.json({ prices: {}, missing: [] });

  try {
    const { prices, missing } = await fetchPrices(known);
    return NextResponse.json({ prices, missing });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
