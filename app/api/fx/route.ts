import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { SUPPORTED_CURRENCIES } from "@/lib/utils";

// Server-side proxy for real-time FX rates.
// Primary: Coinbase exchange-rates — near real-time (intraday), keyless, and
// returns rates[X] = units of X per 1 base, matching convertToBase semantics.
// Fallback: frankfurter.app (ECB daily reference rates) if Coinbase is down.
// Revalidated every 60s so values track the market through the day.
export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const asked = (searchParams.get("base") || "EUR").toUpperCase();
  // The value lands inside a URL this server fetches, so it is checked against
  // the currencies the app actually offers rather than passed through.
  if (!SUPPORTED_CURRENCIES.includes(asked)) {
    return NextResponse.json({ error: "unsupported currency" }, { status: 400 });
  }
  const base = asked;

  // --- primary: Coinbase (real-time) ---
  try {
    const res = await fetch(
      `https://api.coinbase.com/v2/exchange-rates?currency=${base}`,
      { next: { revalidate: 60 } }
    );
    if (res.ok) {
      const json: { data?: { currency: string; rates: Record<string, string> } } =
        await res.json();
      const raw = json.data?.rates;
      if (raw) {
        // Coinbase returns hundreds of pairs (incl. crypto); keep only the
        // fiat currencies the app uses so the persisted fx stays small.
        const rates: Record<string, number> = {};
        for (const c of SUPPORTED_CURRENCIES) {
          const n = Number(raw[c]);
          if (Number.isFinite(n) && n > 0) rates[c] = n;
        }
        return NextResponse.json({ base: json.data!.currency, rates });
      }
    }
  } catch {
    // fall through to frankfurter
  }

  // --- fallback: frankfurter (daily ECB) ---
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?base=${base}`, {
      next: { revalidate: 60 * 60 * 6 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `upstream ${res.status}` },
        { status: 502 }
      );
    }
    const data: { base: string; rates: Record<string, number> } =
      await res.json();
    return NextResponse.json({ base: data.base, rates: data.rates });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
