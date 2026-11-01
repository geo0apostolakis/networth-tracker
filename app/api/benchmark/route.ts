import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { BENCHMARKS } from "@/lib/benchmarks";

// Server-side proxy for benchmark index history (Yahoo Finance chart API,
// keyless). Proxied rather than called from the browser for the same reason as
// /api/fx: no CORS headers upstream, and it keeps the outbound call on one host.
// Symbols are restricted to the BENCHMARKS allowlist.

interface YahooChart {
  chart?: {
    result?: {
      meta: { currency?: string; shortName?: string };
      timestamp?: number[];
      indicators: { quote: { close?: (number | null)[] }[] };
    }[];
    error?: { description?: string } | null;
  };
}

export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") || "URTH";
  const known = BENCHMARKS.find((b) => b.symbol === symbol);
  if (!known) {
    return NextResponse.json({ error: "unknown symbol" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol
      )}?range=5y&interval=1d`,
      {
        // Yahoo serves an empty body to clients with no UA.
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 60 * 60 * 6 },
      }
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `upstream ${res.status}` },
        { status: 502 }
      );
    }
    const json: YahooChart = await res.json();
    const result = json.chart?.result?.[0];
    const stamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!result || !stamps || !closes) {
      return NextResponse.json({ error: "no data" }, { status: 502 });
    }

    // Holidays and halted sessions come back as nulls; drop them so callers
    // never interpolate against a missing close.
    const points: { date: string; close: number }[] = [];
    for (let i = 0; i < stamps.length; i++) {
      const c = closes[i];
      if (typeof c !== "number" || !Number.isFinite(c)) continue;
      points.push({
        date: new Date(stamps[i] * 1000).toISOString().slice(0, 10),
        close: c,
      });
    }

    return NextResponse.json({
      symbol,
      label: known.label,
      currency: result.meta?.currency ?? known.currency,
      points,
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
