// Shared date-range filtering for the Spending and Transactions sections.
// One implementation, one set of presets, so the two sections can never drift
// apart on what "this month" means.

export type RangePreset =
  | "all"
  | "week"
  | "week-prev"
  | "month"
  | "month-prev"
  | "quarter"
  | "year"
  | "year-prev"
  | "d30"
  | "d90"
  | "custom";

export interface DateRange {
  preset: RangePreset;
  // Only used when preset === "custom". YYYY-MM-DD, inclusive on both ends.
  start?: string;
  end?: string;
}

export interface ResolvedRange {
  // null on either side means unbounded (the "all time" case).
  start: Date | null;
  end: Date | null;
  label: string;
}

export const DEFAULT_RANGE: DateRange = { preset: "all" };

export const PRESET_LABELS: Record<RangePreset, string> = {
  all: "All time",
  week: "This week",
  "week-prev": "Last week",
  month: "This month",
  "month-prev": "Last month",
  quarter: "This quarter",
  year: "This year",
  "year-prev": "Last year",
  d30: "Last 30 days",
  d90: "Last 90 days",
  custom: "Custom",
};

// The presets offered in the picker, in display order. "custom" is handled
// separately by the picker because it needs two date inputs.
export const PRESET_ORDER: RangePreset[] = [
  "all",
  "week",
  "week-prev",
  "month",
  "month-prev",
  "quarter",
  "year",
  "year-prev",
  "d30",
  "d90",
];

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

// Monday-based week start, matching how weeks are read in Europe.
function startOfWeek(d: Date): Date {
  const out = startOfDay(d);
  const shift = (out.getDay() + 6) % 7; // Sun=0 becomes 6
  out.setDate(out.getDate() - shift);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function resolveRange(
  range: DateRange,
  now: Date = new Date()
): ResolvedRange {
  const label = PRESET_LABELS[range.preset];

  switch (range.preset) {
    case "week": {
      const s = startOfWeek(now);
      return { start: s, end: endOfDay(addDays(s, 6)), label };
    }
    case "week-prev": {
      const s = addDays(startOfWeek(now), -7);
      return { start: s, end: endOfDay(addDays(s, 6)), label };
    }
    case "month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start: startOfDay(s), end: endOfDay(e), label };
    }
    case "month-prev": {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: startOfDay(s), end: endOfDay(e), label };
    }
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3);
      const s = new Date(now.getFullYear(), q * 3, 1);
      const e = new Date(now.getFullYear(), q * 3 + 3, 0);
      return { start: startOfDay(s), end: endOfDay(e), label };
    }
    case "year": {
      const s = new Date(now.getFullYear(), 0, 1);
      const e = new Date(now.getFullYear(), 11, 31);
      return { start: startOfDay(s), end: endOfDay(e), label };
    }
    case "year-prev": {
      const s = new Date(now.getFullYear() - 1, 0, 1);
      const e = new Date(now.getFullYear() - 1, 11, 31);
      return { start: startOfDay(s), end: endOfDay(e), label };
    }
    case "d30":
      return { start: startOfDay(addDays(now, -29)), end: endOfDay(now), label };
    case "d90":
      return { start: startOfDay(addDays(now, -89)), end: endOfDay(now), label };
    case "custom": {
      // A half-filled custom range stays open on the missing side rather than
      // silently filtering everything out.
      const s = range.start ? startOfDay(new Date(`${range.start}T00:00:00`)) : null;
      const e = range.end ? endOfDay(new Date(`${range.end}T00:00:00`)) : null;
      return {
        start: s && !isNaN(s.getTime()) ? s : null,
        end: e && !isNaN(e.getTime()) ? e : null,
        label,
      };
    }
    default:
      return { start: null, end: null, label };
  }
}

export function inRange(iso: string, r: ResolvedRange): boolean {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return false;
  if (r.start && t < r.start.getTime()) return false;
  if (r.end && t > r.end.getTime()) return false;
  return true;
}

export function filterByRange<T extends { date: string }>(
  items: T[],
  r: ResolvedRange
): T[] {
  if (!r.start && !r.end) return items;
  return items.filter((i) => inRange(i.date, r));
}

// Human-readable span for the active range, e.g. "1 Jul - 28 Jul 2026".
export function describeRange(r: ResolvedRange): string {
  if (!r.start && !r.end) return "everything logged so far";
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  if (r.start && r.end) return `${fmt(r.start)} to ${fmt(r.end)}`;
  if (r.start) return `since ${fmt(r.start)}`;
  return `up to ${fmt(r.end as Date)}`;
}
