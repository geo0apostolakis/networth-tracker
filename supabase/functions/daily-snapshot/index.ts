// Supabase Edge Function: daily-snapshot
//
// Runs on a pg_cron schedule (hourly). Records ONE net-worth snapshot per
// Europe/Athens calendar day into `networth_snapshots`, so the chart fills in
// 24/7 even when no browser tab is open. Idempotent: the unique `snap_date`
// column + ON CONFLICT DO NOTHING means only the first run of each day inserts.
//
// It reads assets + last-known FX rates from the single `app_state` blob
// (read-only) and computes totals with the same math as /api/snapshots, so a
// frontend POST and a cron run produce identical numbers for the same day.
//
// Deploy:  npx supabase functions deploy daily-snapshot
// Env (auto-injected by Supabase runtime): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CATEGORIES = ["cash", "bank", "stocks", "crypto", "other"] as const;
type Category = (typeof CATEGORIES)[number];

interface Asset {
  name: string;
  category: Category;
  currency: string;
  amount: number;
}

// YYYY-MM-DD in the app's timezone — must match lib/utils.ts#dayKey, so change
// both together (set APP_TZ as a function secret if you moved NEXT_PUBLIC_APP_TZ).
function dayKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: Deno.env.get("APP_TZ") ?? "Europe/Athens",
  }).format(date);
}

Deno.serve(async () => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return Response.json(
      { ok: false, error: "missing SUPABASE_URL / SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }
  const supa = createClient(url, key, { auth: { persistSession: false } });
  const today = dayKey();

  // Idempotency short-circuit (cheap): skip if today already recorded.
  const { data: existing } = await supa
    .from("networth_snapshots")
    .select("snap_date")
    .eq("snap_date", today)
    .maybeSingle();
  if (existing) {
    return Response.json({ ok: true, skipped: "exists", date: today });
  }

  // Read the single store blob (read-only — never write it back here).
  const { data: row, error } = await supa
    .from("app_state")
    .select("data")
    .eq("id", "default")
    .maybeSingle();
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const state = (row?.data?.state ?? {}) as {
    assets?: Asset[];
    baseCurrency?: string;
    fx?: { rates?: Record<string, number> };
  };
  const assets = state.assets ?? [];
  if (assets.length === 0) {
    return Response.json({ ok: true, skipped: "no assets", date: today });
  }
  const base = state.baseCurrency ?? "EUR";
  const rates = state.fx?.rates ?? { [base]: 1 };

  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, 0])
  ) as Record<Category, number>;
  let total = 0;
  const lines: { name: string; category: Category; baseValue: number }[] = [];
  for (const a of assets) {
    const v =
      a.currency === base
        ? a.amount
        : rates[a.currency]
          ? a.amount / rates[a.currency]
          : a.amount;
    byCategory[a.category] += v;
    total += v;
    lines.push({ name: a.name, category: a.category, baseValue: v });
  }

  const { error: insErr } = await supa.from("networth_snapshots").insert({
    snap_date: today,
    base_currency: base,
    total_net_worth: total,
    by_category: byCategory,
    assets: lines,
  });
  // A concurrent run may have inserted first — that's fine, not an error.
  if (insErr && !/duplicate|unique/i.test(insErr.message)) {
    return Response.json({ ok: false, error: insErr.message }, { status: 500 });
  }

  return Response.json({ ok: true, date: today, total });
});
