import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabaseAdmin, STATE_ID } from "@/lib/supabaseServer";
import { buildSnapshot } from "@/lib/snapshot";
import type { Category, Asset, Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

// Daily net-worth snapshots live in their own table (`networth_snapshots`), NOT
// in the app_state blob. The blob is rewritten wholesale every 60s by the FX
// ticker, so keeping snapshots there would let an open tab clobber points the
// backend cron wrote. Disjoint rows = no race. This route is the frontend's
// read/write path; the Supabase Edge Function writes the same table on cron.

interface SnapshotRow {
  id: string;
  snap_date: string;
  base_currency: string;
  total_net_worth: number;
  by_category: Record<Category, number>;
  assets: { name: string; category: Category; baseValue: number }[];
}

function toSnapshot(r: SnapshotRow): Snapshot {
  return {
    id: r.id,
    // Midnight-UTC stamp so chart code that does date.slice(0,10) reads the
    // Athens calendar day back out unchanged.
    date: `${r.snap_date}T00:00:00.000Z`,
    baseCurrency: r.base_currency,
    totalNetWorth: r.total_net_worth,
    byCategory: r.by_category,
    assets: r.assets ?? [],
  };
}

function errMessage(e: unknown): string {
  return e instanceof Error
    ? e.message
    : typeof e === "object" && e
      ? JSON.stringify(e)
      : "unknown error";
}

// List the full snapshot history (oldest → newest). Graceful: if the table is
// missing or errors, return an empty list so the dashboard still renders.
export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  try {
    const { data, error } = await supabaseAdmin()
      .from("networth_snapshots")
      .select("*")
      .order("snap_date", { ascending: true });
    if (error) throw error;
    return NextResponse.json({
      snapshots: (data ?? []).map((r) => toSnapshot(r as SnapshotRow)),
    });
  } catch (e) {
    return NextResponse.json({ snapshots: [], error: errMessage(e) });
  }
}

// Record today's snapshot. Idempotent per Athens day: if today already exists
// (e.g. the cron beat us to it), the insert is a no-op — we never overwrite an
// existing point.
export async function POST(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  try {
    const { data: row, error } = await supabaseAdmin()
      .from("app_state")
      .select("data")
      .eq("id", STATE_ID)
      .maybeSingle();
    if (error) throw error;
    const state = (row?.data?.state ?? {}) as {
      assets?: Asset[];
      baseCurrency?: string;
      fx?: { rates?: Record<string, number> };
    };
    const assets = state.assets ?? [];
    if (assets.length === 0) {
      return NextResponse.json({ ok: true, skipped: "no assets" });
    }
    const base = state.baseCurrency ?? "EUR";
    const rates = state.fx?.rates ?? { [base]: 1 };
    const snapshot = buildSnapshot(assets, base, rates);
    const { error: upErr } = await supabaseAdmin()
      .from("networth_snapshots")
      .upsert(snapshot, { onConflict: "snap_date", ignoreDuplicates: true });
    if (upErr) throw upErr;
    return NextResponse.json({ ok: true, snap_date: snapshot.snap_date });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 502 });
  }
}

// Delete one snapshot by id.
export async function DELETE(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const { error } = await supabaseAdmin()
      .from("networth_snapshots")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 502 });
  }
}
