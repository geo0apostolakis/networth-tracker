import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { extractText, getDocumentProxy } from "unpdf";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { parseSolcardStatement } from "@/lib/solcardStatement";
import type { SolcardStatement } from "@/lib/types";

export const dynamic = "force-dynamic";

// Solcard statements, uploaded as the PDF the Solcard app exports. They are
// kept in their own app_state row, not in the main blob: the browser rewrites
// the blob every minute and an old tab would drop whatever it did not know
// about. Every tab reads this row and rebuilds the card ledger from it.

const ROW = "solcard-statements";
const MAX_BYTES = 2_000_000;
const COINGECKO: Record<string, string> = { ETH: "ethereum", SOL: "solana", BTC: "bitcoin" };
const STABLE = new Set(["USDC", "USDT", "DAI", "PYUSD"]);

async function load(): Promise<SolcardStatement[]> {
  const { data, error } = await supabaseAdmin().from("app_state").select("data").eq("id", ROW).maybeSingle();
  if (error) throw error;
  return (data?.data as { statements?: SolcardStatement[] } | null)?.statements ?? [];
}

const message = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e ? JSON.stringify(e) : "unknown error");

export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ statements: await load() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: message(e) }, { status: 502 });
  }
}

// The day's average price, for a top-up the statement dates but the chain
// sync did not see (sent from another wallet or deposit address). Good enough
// to show roughly what the conversion cost; never blocks the import.
async function dayPriceUsd(symbol: string, day: string): Promise<number | null> {
  if (STABLE.has(symbol)) return 1;
  const id = COINGECKO[symbol];
  if (!id) return null;
  const from = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=usd&from=${from}&to=${from + 86400}`);
    if (!res.ok) return null;
    const { prices } = (await res.json()) as { prices: [number, number][] };
    return prices?.length ? prices.reduce((a, p) => a + p[1], 0) / prices.length : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "attach the statement PDF as 'file'" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "that file is too big for a statement" }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return NextResponse.json({ error: "that is not a PDF" }, { status: 415 });

    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const statement = parseSolcardStatement(Array.isArray(text) ? text.join("\n") : text);
    if (!statement || !/Card Statement/i.test(Array.isArray(text) ? text[0] : text)) {
      return NextResponse.json({ error: "this does not look like a Solcard card statement" }, { status: 422 });
    }

    for (const l of statement.lines) {
      if (l.crypto) {
        const p = await dayPriceUsd(l.crypto.symbol, l.date);
        if (p) l.crypto.marketUsd = Math.round(l.crypto.amount * p * 100) / 100;
      }
    }

    // Same statement uploaded again replaces itself.
    const statements = [...(await load()).filter((s) => s.id !== statement.id), statement].sort((a, b) => a.generated.localeCompare(b.generated));
    const { error } = await supabaseAdmin()
      .from("app_state")
      .upsert({ id: ROW, data: { statements }, updated_at: new Date().toISOString() });
    if (error) throw error;

    const { lines, ...meta } = statement;
    return NextResponse.json({ ok: true, statement: { ...meta, count: lines.length } });
  } catch (e) {
    return NextResponse.json({ error: message(e) }, { status: 502 });
  }
}
