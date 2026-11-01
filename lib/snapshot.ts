import { CATEGORIES, type Asset, type Category } from "./types";
import { dayKey } from "./utils";

// Build today's snapshot from the persisted store blob using the rates that were
// last active in the app — identical math to the Edge Function, so a frontend
// POST and a cron run produce the same numbers for the same day.
export function buildSnapshot(
  assets: Asset[],
  base: string,
  rates: Record<string, number>
) {
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
  return {
    snap_date: dayKey(),
    base_currency: base,
    total_net_worth: total,
    by_category: byCategory,
    assets: lines,
  };
}
