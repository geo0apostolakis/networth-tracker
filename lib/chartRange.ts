// Range presets for the net worth chart, in the shape a market chart uses:
// pick a window, see the return over it. Separate from lib/dateRange because
// the presets are different (1D / 5D / 1M ... rather than "this month") and
// they are anchored to the latest snapshot, not to today.

import type { ResolvedRange } from "./dateRange";
import type { TrendPoint } from "./metrics";

export type ChartRange = "d1" | "d5" | "m1" | "m6" | "ytd" | "y1" | "all";

export const CHART_RANGES: { id: ChartRange; label: string; short: string }[] = [
  { id: "d1", label: "1 day", short: "1D" },
  { id: "d5", label: "5 days", short: "5D" },
  { id: "m1", label: "1 month", short: "1M" },
  { id: "m6", label: "6 months", short: "6M" },
  { id: "ytd", label: "Year to date", short: "YTD" },
  { id: "y1", label: "1 year", short: "1Y" },
  { id: "all", label: "All time", short: "ALL" },
];

export const DEFAULT_CHART_RANGE: ChartRange = "m1";

// Earliest date the range covers, given the last point in the series. Null
// means unbounded. Anchoring to the last snapshot rather than to today keeps
// "1 month" meaningful when the app has not been opened for a while.
function cutoff(range: ChartRange, last: string): string | null {
  const d = new Date(`${last}T00:00:00Z`);
  switch (range) {
    case "d1":
      d.setUTCDate(d.getUTCDate() - 1);
      break;
    case "d5":
      d.setUTCDate(d.getUTCDate() - 5);
      break;
    case "m1":
      d.setUTCMonth(d.getUTCMonth() - 1);
      break;
    case "m6":
      d.setUTCMonth(d.getUTCMonth() - 6);
      break;
    case "y1":
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      break;
    case "ytd":
      return `${last.slice(0, 4)}-01-01`;
    case "all":
      return null;
  }
  return d.toISOString().slice(0, 10);
}

// The window the chart is showing, expressed as dates so the transaction-backed
// cards can filter by the same span. Left open at the top end: anything logged
// after the last snapshot still belongs to the window being looked at.
export function chartRangeToDates(
  range: ChartRange,
  data: TrendPoint[]
): ResolvedRange {
  const label = CHART_RANGES.find((r) => r.id === range)?.label ?? "";
  const unbounded: ResolvedRange = { start: null, end: null, label };
  if (range === "all" || data.length === 0) return unbounded;

  const from = cutoff(range, data[data.length - 1].date.slice(0, 10));
  if (!from) return unbounded;
  return { start: new Date(`${from}T00:00:00`), end: null, label };
}

export interface RangeView {
  points: TrendPoint[];
  // Return across the window. Null when there is nothing to compare against,
  // which is the honest answer while the history is still short.
  pct: number | null;
  delta: number;
  up: boolean;
  // True when the window asked for more history than exists, so the chart is
  // really showing everything rather than the period on the label.
  truncated: boolean;
}

export function rangeView(data: TrendPoint[], range: ChartRange): RangeView {
  const empty: RangeView = {
    points: [],
    pct: null,
    delta: 0,
    up: true,
    truncated: false,
  };
  if (data.length === 0) return empty;

  const last = data[data.length - 1].date.slice(0, 10);
  const from = cutoff(range, last);
  const points = from ? data.filter((p) => p.date.slice(0, 10) >= from) : data;

  // One point cannot describe a change, so fall back to the two most recent.
  // Better a short honest window than an empty chart.
  const used = points.length >= 2 ? points : data.slice(-2);
  if (used.length < 2) return { ...empty, points: used };

  const start = used[0].total;
  const end = used[used.length - 1].total;
  const delta = end - start;
  return {
    points: used,
    pct: start !== 0 ? (delta / start) * 100 : null,
    delta,
    up: delta >= 0,
    truncated: from !== null && data[0].date.slice(0, 10) > from,
  };
}
