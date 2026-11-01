import { NextResponse } from "next/server";
import { callTradernet, isPortfolioResponse, mapPortfolioToAssets } from "@/lib/freedom24";
import { buildSnapshot } from "@/lib/snapshot";
import { supabaseAdmin, STATE_ID } from "@/lib/supabaseServer";
import type { Asset, Wallet } from "@/lib/types";
import { SUPPORTED_CURRENCIES } from "@/lib/utils";
import { fetchWalletAssets } from "@/lib/wallets";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The nightly point on the chart, taken with fresh prices.
//
// pg_cron records each day from the saved app_state, which only moves while a
// tab is open. On days nobody opened the app the chart went flat (Aug 13 to
// Sep 5 never moved, though the stocks did). This runs from Vercel Cron just
// after midnight Athens: it re-reads the wallets and the broker, takes current
// FX, and overwrites the day's row. Balances that only change with an event
// (bank, cash, Solcard, Bitrefill) are taken as saved. It never writes
// app_state, so it cannot fight an open tab.

async function rates(base: string): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(`https://api.coinbase.com/v2/exchange-rates?currency=${base}`, { cache: "no-store" });
    if (res.ok) {
      const raw = ((await res.json()) as { data?: { rates?: Record<string, string> } }).data?.rates;
      if (raw) {
        const out: Record<string, number> = { [base]: 1 };
        for (const c of SUPPORTED_CURRENCIES) if (Number(raw[c]) > 0) out[c] = Number(raw[c]);
        return out;
      }
    }
  } catch {}
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?base=${base}`, { cache: "no-store" });
    if (res.ok) return { ...((await res.json()) as { rates: Record<string, number> }).rates, [base]: 1 };
  } catch {}
  return null;
}

export async function GET(request: Request) {
  // Vercel Cron sends this header when CRON_SECRET is set; nobody else can.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { data: row, error } = await supabaseAdmin().from("app_state").select("data").eq("id", STATE_ID).maybeSingle();
    if (error) throw error;
    const state = (row?.data?.state ?? {}) as { assets?: Asset[]; wallets?: Wallet[]; baseCurrency?: string; fx?: { rates?: Record<string, number> } };
    let assets = state.assets ?? [];
    if (assets.length === 0) return NextResponse.json({ ok: true, skipped: "no assets" });
    const base = state.baseCurrency ?? "EUR";
    const notes: string[] = [];

    // Wallets: a chain that answered replaces what was saved; one that did not
    // keeps its saved figure (same rule as the in-app sync).
    const wallets = state.wallets ?? [];
    if (wallets.length) {
      try {
        const sync = await fetchWalletAssets(wallets);
        const kept = assets.filter(
          (a) => a.source === "wallet" && a.walletId && (sync.errors[a.walletId] || (a.chain && (sync.stale[a.walletId] ?? []).includes(a.chain)))
        );
        const merged = new Map<string, Asset>();
        for (const a of kept) merged.set(a.id, a);
        for (const a of sync.assets) merged.set(a.id, a);
        assets = [...assets.filter((a) => a.source !== "wallet"), ...merged.values()];
        if (Object.keys(sync.errors).length) notes.push(`wallets kept: ${Object.keys(sync.errors).length}`);
      } catch (e) {
        notes.push(`wallets: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    // Broker: only a recognised portfolio replaces the saved holdings.
    try {
      const raw = await callTradernet("getPositionJson");
      if (isPortfolioResponse(raw)) assets = [...assets.filter((a) => a.source !== "freedom24"), ...mapPortfolioToAssets(raw)];
      else notes.push("freedom24: unexpected response, kept saved");
    } catch (e) {
      notes.push(`freedom24: ${e instanceof Error ? e.message : "failed"}, kept saved`);
    }

    const fx = (await rates(base)) ?? state.fx?.rates ?? { [base]: 1 };
    const snapshot = buildSnapshot(assets, base, fx);
    // ?dry=1 shows what would be written, for checking by hand.
    if (new URL(request.url).searchParams.get("dry") === "1") return NextResponse.json({ dry: true, ...snapshot, notes });
    const { error: upErr } = await supabaseAdmin().from("networth_snapshots").upsert(snapshot, { onConflict: "snap_date" });
    if (upErr) throw upErr;
    return NextResponse.json({ ok: true, snap_date: snapshot.snap_date, total: Math.round(snapshot.total_net_worth * 100) / 100, notes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "snapshot failed" }, { status: 502 });
  }
}
