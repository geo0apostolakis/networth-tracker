import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";

// Solcard has no API, so its top-ups are read from the chain: every native ETH
// transfer into the personal deposit address (from the funding wallet or any
// other), priced in EUR and USD at the minute it happened. The statement PDFs
// later say what the card actually credited for each one.
//
// Only native value counts. Address-poisoning spam (fake "ETH" tokens sent to
// lookalike addresses) shows up as token transfers and is ignored here; the
// number of them is returned so the UI can warn about it.
//
// The answer is the same for every viewer and only changes when a new top-up
// lands, so the CDN keeps it for 10 minutes: polling tabs cost one function
// call per window, not one per tab.

const EXPLORER = "https://eth.blockscout.com/api/v2";
const ADDR = /^0x[0-9a-fA-F]{40}$/;

interface BsTx {
  hash: string;
  timestamp: string;
  value: string;
  status: string;
  from: { hash: string };
  to: { hash: string } | null;
}
interface BsTokenTransfer {
  to: { hash: string };
  from: { hash: string };
  token: { symbol: string | null; type: string };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "networth-tracker/2" } });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return (await res.json()) as T;
}

async function allPages<T>(path: string, max = 5): Promise<T[]> {
  const out: T[] = [];
  let params = "";
  for (let i = 0; i < max; i++) {
    const page = await getJson<{ items: T[]; next_page_params: Record<string, string | number> | null }>(`${EXPLORER}${path}${params}`);
    out.push(...page.items);
    if (!page.next_page_params) break;
    params = "?" + new URLSearchParams(Object.entries(page.next_page_params).map(([k, v]) => [k, String(v)])).toString();
  }
  return out;
}

// Hourly ETH price for the span covering every top-up (CoinGecko returns
// hourly points for ranges under 90 days).
async function ethPrices(vs: "eur" | "usd", from: number, to: number) {
  const j = await getJson<{ prices: [number, number][] }>(
    `https://api.coingecko.com/api/v3/coins/ethereum/market_chart/range?vs_currency=${vs}&from=${from - 7200}&to=${to + 7200}`
  );
  return j.prices;
}
const priceAt = (series: [number, number][], tMs: number) =>
  series.reduce((best, p) => (Math.abs(p[0] - tMs) < Math.abs(best[0] - tMs) ? p : best), series[0])?.[1] ?? 0;

// Same first and last four hex characters as the real address, but not it.
const lookalike = (a: string, real: string) =>
  a.toLowerCase() !== real.toLowerCase() &&
  a.slice(2, 6).toLowerCase() === real.slice(2, 6).toLowerCase() &&
  a.slice(-4).toLowerCase() === real.slice(-4).toLowerCase();

export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  const q = new URL(request.url).searchParams;
  const funding = q.get("funding") ?? "";
  const deposit = q.get("deposit") ?? "";
  if (!ADDR.test(funding) || !ADDR.test(deposit)) {
    return NextResponse.json({ error: "funding and deposit must be 0x addresses" }, { status: 400 });
  }
  try {
    const [txs, tokens] = await Promise.all([
      allPages<BsTx>(`/addresses/${deposit}/transactions`),
      allPages<BsTokenTransfer>(`/addresses/${funding}/token-transfers`, 2).catch(() => [] as BsTokenTransfer[]),
    ]);
    const raw = txs.filter(
      (t) =>
        t.status === "ok" &&
        t.from.hash.toLowerCase() !== deposit.toLowerCase() &&
        t.to?.hash.toLowerCase() === deposit.toLowerCase() &&
        // Dust is how address poisoners get into a history; no top-up is this small.
        BigInt(t.value) >= BigInt("500000000000000")
    );
    const poisoned = tokens.filter(
      (t) => t.from.hash.toLowerCase() === funding.toLowerCase() && (lookalike(t.to.hash, deposit) || /[^\x20-\x7e]/.test(t.token.symbol ?? ""))
    ).length;

    let topups: { hash: string; from: string; date: string; eth: number; eur: number; usd: number; url: string }[] = [];
    if (raw.length) {
      const times = raw.map((t) => Math.floor(new Date(t.timestamp).getTime() / 1000));
      const [eur, usd] = await Promise.all([ethPrices("eur", Math.min(...times), Math.max(...times)), ethPrices("usd", Math.min(...times), Math.max(...times))]);
      topups = raw
        .map((t) => {
          const eth = Number(BigInt(t.value)) / 1e18;
          const ms = new Date(t.timestamp).getTime();
          return {
            hash: t.hash,
            from: t.from.hash,
            date: new Date(ms).toISOString(),
            eth,
            eur: eth * priceAt(eur, ms),
            usd: eth * priceAt(usd, ms),
            url: `https://etherscan.io/tx/${t.hash}`,
          };
        })
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    return NextResponse.json(
      { topups, poisoned, fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "solcard read failed" }, { status: 502 });
  }
}
