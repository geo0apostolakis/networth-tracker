import { convertToBase } from "./fx";
import { filterByRange, type ResolvedRange } from "./dateRange";
import {
  type Asset,
  type Category,
  type FxState,
  type Milestone,
  type Snapshot,
  type Transaction,
  type TransactionType,
  type TxnCategory,
  CATEGORIES,
  CATEGORY_LABELS,
} from "./types";
import { dayKey, daysBetween } from "./utils";

export function currentNetWorth(assets: Asset[], fx: FxState): number {
  return assets.reduce(
    (sum, a) => sum + convertToBase(a.amount, a.currency, fx),
    0
  );
}

export function totalsByCategory(
  assets: Asset[],
  fx: FxState
): Record<Category, number> {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<
    Category,
    number
  >;
  for (const a of assets) {
    out[a.category] += convertToBase(a.amount, a.currency, fx);
  }
  return out;
}

export interface AllocationSlice {
  category: Category;
  label: string;
  value: number;
  pct: number;
}

export function allocation(assets: Asset[], fx: FxState): AllocationSlice[] {
  const totals = totalsByCategory(assets, fx);
  const grand = Object.values(totals).reduce((s, v) => s + v, 0);
  return CATEGORIES.map((c) => ({
    category: c,
    label: CATEGORY_LABELS[c],
    value: totals[c],
    pct: grand > 0 ? (totals[c] / grand) * 100 : 0,
  })).filter((s) => s.value > 0);
}


// A snapshot stores its totals in whatever base currency was active when it was
// taken. Convert into the currently selected base using live rates so history
// reads exactly in today's currency.
function snapTotal(s: Snapshot, fx: FxState): number {
  return convertToBase(s.totalNetWorth, s.baseCurrency, fx);
}
function snapCategory(s: Snapshot, c: Category, fx: FxState): number {
  // Defaulted, not assumed present: an older row written before a category
  // existed has no key for it, and undefined * rate is NaN. One NaN makes
  // recharts drop that band from there on, which reads as a hole in history.
  return convertToBase(s.byCategory[c] ?? 0, s.baseCurrency, fx);
}

export interface TrendPoint {
  date: string;
  total: number;
  cash: number;
  bank: number;
  stocks: number;
  crypto: number;
  other: number;
  // True for the point built from live assets rather than a stored snapshot.
  live?: boolean;
}

export function trendSeries(snapshots: Snapshot[], fx: FxState): TrendPoint[] {
  return [...snapshots]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({
      date: s.date.slice(0, 10),
      total: snapTotal(s, fx),
      cash: snapCategory(s, "cash", fx),
      bank: snapCategory(s, "bank", fx),
      stocks: snapCategory(s, "stocks", fx),
      crypto: snapCategory(s, "crypto", fx),
      other: snapCategory(s, "other", fx),
    }));
}

// Today's stored snapshot is written once and never rewritten, so by the
// evening it is whatever the balances happened to be that morning. The card at
// the top of the dashboard meanwhile reads live assets, and the two numbers
// drifted apart on screen: the chart ended at 564.66 while the headline said
// 839.04.
//
// This replaces today's point (or adds it) with what the assets say right now,
// so the right-hand edge of every chart is the same number as the headline, and
// the stacked legend describes the band it sits next to. History is untouched:
// only the current day is ever overwritten.
export function withToday(
  points: TrendPoint[],
  assets: Asset[],
  fx: FxState,
  ready: boolean
): TrendPoint[] {
  // Before the saved state has loaded, assets is [] and a zero point on the
  // right edge would be a worse chart than a stale one.
  if (!ready || assets.length === 0) return points;
  const totals = totalsByCategory(assets, fx);
  const today: TrendPoint = {
    // The Athens day, matching how snapshot rows are keyed. A UTC key would
    // land on the wrong row for a couple of hours each evening and draw two
    // points for the same day.
    date: dayKey(),
    total: currentNetWorth(assets, fx),
    cash: totals.cash,
    bank: totals.bank,
    stocks: totals.stocks,
    crypto: totals.crypto,
    other: totals.other,
    live: true,
  };
  const rest = points.filter((p) => p.date < today.date);
  return [...rest, today];
}

export interface Performer {
  category: Category;
  label: string;
  delta: number;
  pct: number;
}

// Best/worst category between the two most recent snapshots.
export function bestWorstPerformer(
  snapshots: Snapshot[],
  fx: FxState
): {
  best?: Performer;
  worst?: Performer;
} {
  if (snapshots.length < 2) return {};
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const performers: Performer[] = CATEGORIES.map((c) => {
    const delta = snapCategory(latest, c, fx) - snapCategory(prev, c, fx);
    const base = snapCategory(prev, c, fx);
    return {
      category: c,
      label: CATEGORY_LABELS[c],
      delta,
      pct: base !== 0 ? (delta / base) * 100 : 0,
    };
  }).filter((p) => p.delta !== 0);
  if (performers.length === 0) return {};
  const sortedByDelta = [...performers].sort((a, b) => b.delta - a.delta);
  return {
    best: sortedByDelta[0],
    worst: sortedByDelta[sortedByDelta.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Earnings rate — income normalised down to a per-second trickle.
// ---------------------------------------------------------------------------

export interface EarningsRate {
  total: number; // income in base over the window
  days: number; // window length, from the first income logged to now
  perSecond: number;
  perMinute: number;
  perHour: number;
  perDay: number;
  perYear: number;
  hasData: boolean;
}

// A trailing average, not a forecast: total income divided by the days since
// the first income landed. Lumpy freelance payments move this a lot early on,
// which is exactly why the card says how long the window is.
export function earningsRate(
  transactions: Transaction[],
  fx: FxState,
  now: Date = new Date()
): EarningsRate {
  const earned = transactions.filter((t) => t.type === "earned" && !t.transfer);
  if (earned.length === 0) {
    return {
      total: 0,
      days: 0,
      perSecond: 0,
      perMinute: 0,
      perHour: 0,
      perDay: 0,
      perYear: 0,
      hasData: false,
    };
  }
  const total = earned.reduce(
    (s, t) => s + convertToBase(t.amount, t.currency, fx),
    0
  );
  const first = earned.reduce(
    (min, t) => (t.date < min ? t.date : min),
    earned[0].date
  );
  const days = daysBetween(first, now);
  const perDay = total / days;
  return {
    total,
    days,
    perSecond: perDay / 86_400,
    perMinute: perDay / 1_440,
    perHour: perDay / 24,
    perDay,
    perYear: perDay * 365,
    hasData: true,
  };
}

// ---------------------------------------------------------------------------
// Savings rate — the share of income that survives the month.
// ---------------------------------------------------------------------------

export interface SavingsRate {
  income: number;
  expense: number;
  saved: number;
  pct: number; // (income - expense) / income, as a percentage
  hasIncome: boolean;
}

export function savingsRate(
  transactions: Transaction[],
  fx: FxState,
  range?: ResolvedRange
): SavingsRate {
  const list = range ? filterByRange(transactions, range) : transactions;
  let income = 0;
  let expense = 0;
  for (const t of list) {
    if (t.transfer) continue; // moving your own money is neither income nor spending
    const v = convertToBase(t.amount, t.currency, fx);
    if (t.type === "earned") income += v;
    else expense += v;
  }
  const saved = income - expense;
  return {
    income,
    expense,
    saved,
    pct: income > 0 ? (saved / income) * 100 : 0,
    hasIncome: income > 0,
  };
}

// Money grouped by the user's own transaction categories, biggest first. Shared
// by the Spending breakdowns and the dashboard's overview donut so the two can
// never disagree about what a category is worth.
export interface CategorySlice {
  id: string;
  name: string;
  color: string;
  value: number;
  pct: number;
}

export function categorySlices(
  transactions: Transaction[],
  categories: TxnCategory[],
  fx: FxState,
  kind: TransactionType,
  range?: ResolvedRange
): CategorySlice[] {
  const list = range ? filterByRange(transactions, range) : transactions;
  const totals = new Map<string, number>();
  for (const t of list) {
    if (t.type !== kind || t.transfer) continue;
    // A category that was deleted leaves its id behind on old entries; those
    // belong with the uncategorized ones, not in a second "Uncategorized" slice.
    const key = t.categoryId && categories.some((c) => c.id === t.categoryId) ? t.categoryId : "__uncat__";
    totals.set(key, (totals.get(key) ?? 0) + convertToBase(t.amount, t.currency, fx));
  }
  const grand = [...totals.values()].reduce((a, b) => a + b, 0);
  const slices: CategorySlice[] = [];
  for (const [key, value] of totals) {
    const cat = categories.find((c) => c.id === key);
    slices.push({
      id: key,
      name: cat?.name ?? "Uncategorized",
      color: cat?.color ?? "#64748b",
      value: Math.round(value * 100) / 100,
      pct: grand > 0 ? (value / grand) * 100 : 0,
    });
  }
  return slices.sort((a, b) => b.value - a.value);
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export interface MilestoneProgress {
  milestone: Milestone;
  current: number;
  pct: number; // clamped 0..100 for the bar
  reached: boolean;
  remaining: number;
}

export function milestoneProgress(
  milestones: Milestone[],
  netWorth: number
): MilestoneProgress[] {
  return milestones
    .map((m) => {
      const pct = m.target > 0 ? (netWorth / m.target) * 100 : 0;
      return {
        milestone: m,
        current: netWorth,
        pct: Math.max(0, Math.min(100, pct)),
        reached: m.target > 0 && netWorth >= m.target,
        remaining: Math.max(0, m.target - netWorth),
      };
    })
    .sort((a, b) => {
      // Unreached targets first, nearest to completion at the top.
      if (a.reached !== b.reached) return a.reached ? 1 : -1;
      return b.pct - a.pct;
    });
}

// ---------------------------------------------------------------------------
// Benchmark comparison
// ---------------------------------------------------------------------------

const INVESTED: Category[] = ["stocks", "crypto"];

function investedValue(s: Snapshot, fx: FxState): number {
  return INVESTED.reduce((sum, c) => sum + snapCategory(s, c, fx), 0);
}

export interface PortfolioReturn {
  startValue: number;
  endValue: number;
  contributions: number; // net money moved in during the window
  gain: number; // value change with contributions stripped out
  pct: number;
  startDate: string;
  endDate: string;
  hasData: boolean;
  // True when some invested holding is broker-synced. Those balances move on
  // their own and a deposit straight into the broker is never logged as a
  // transaction, so there is nothing to net out and the return is overstated by
  // whatever was paid in. The UI has to say so rather than imply precision.
  hasSyncedHoldings: boolean;
}

// Raw snapshot change counts deposits as if they were growth, which makes any
// comparison against an index meaningless (adding 100 to a 25 account is not a
// 400% return). So contributions are netted out: gain = end - start - net money
// added, measured against the capital that was actually at work.
export function portfolioReturn(
  snapshots: Snapshot[],
  transactions: Transaction[],
  assets: Asset[],
  fx: FxState,
  range?: ResolvedRange
): PortfolioReturn {
  const empty: PortfolioReturn = {
    startValue: 0,
    endValue: 0,
    contributions: 0,
    gain: 0,
    pct: 0,
    startDate: "",
    endDate: "",
    hasData: false,
    hasSyncedHoldings: false,
  };
  // Broker-synced assets are replaced wholesale on every sync and get a fresh
  // id each time, so a transaction tagged to one orphans within the minute.
  // Contribution matching only ever holds for manually tracked holdings.
  const hasSyncedHoldings = assets.some(
    (a) => INVESTED.includes(a.category) && a.source === "freedom24"
  );
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const inWindow = range ? filterByRange(sorted, range) : sorted;
  if (inWindow.length < 2) return { ...empty, hasSyncedHoldings };

  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const startValue = investedValue(first, fx);
  const endValue = investedValue(last, fx);

  // Only transactions against stock/crypto balances count as contributions.
  const investedIds = new Set(
    assets.filter((a) => INVESTED.includes(a.category)).map((a) => a.id)
  );
  let contributions = 0;
  for (const t of transactions) {
    if (!investedIds.has(t.assetId) || t.transfer) continue;
    if (t.date < first.date || t.date > last.date) continue;
    const v = convertToBase(t.amount, t.currency, fx);
    contributions += t.type === "earned" ? v : -v;
  }

  const gain = endValue - startValue - contributions;
  const base = startValue + Math.max(0, contributions);
  return {
    startValue,
    endValue,
    contributions,
    gain,
    pct: base > 0 ? (gain / base) * 100 : 0,
    startDate: first.date.slice(0, 10),
    endDate: last.date.slice(0, 10),
    hasData: base > 0,
    hasSyncedHoldings,
  };
}

// ---------------------------------------------------------------------------
// Monthly digest — derived, not stored.
// ---------------------------------------------------------------------------

export interface Digest {
  id: string; // "2026-03"
  month: string; // "2026-03"
  title: string; // "March 2026"
  delta: number;
  pct: number;
  startValue: number;
  endValue: number;
  income: number;
  expense: number;
  savingsPct: number;
  movers: { category: Category; label: string; delta: number }[];
  date: string; // ISO of the closing snapshot, for sorting
}

function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

// Digests are recomputed from snapshot history + transactions on every read
// rather than being written anywhere. That keeps them out of the app_state blob
// (which an open tab rewrites every 60s) with no extra table to maintain, and
// means a corrected snapshot instantly corrects its digest.
export function monthlyDigests(
  snapshots: Snapshot[],
  transactions: Transaction[],
  fx: FxState
): Digest[] {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return [];

  const byMonth = new Map<string, Snapshot[]>();
  for (const s of sorted) {
    const key = s.date.slice(0, 7);
    const list = byMonth.get(key);
    if (list) list.push(s);
    else byMonth.set(key, [s]);
  }

  const out: Digest[] = [];
  for (const [month, snaps] of byMonth) {
    const close = snaps[snaps.length - 1];
    // Compare against the last snapshot before this month so the delta covers
    // the whole month, not just the days that happen to have points.
    const priorIndex = sorted.findIndex((s) => s.id === snaps[0].id) - 1;
    const open = priorIndex >= 0 ? sorted[priorIndex] : snaps[0];
    if (open.id === close.id) continue;

    const startValue = snapTotal(open, fx);
    const endValue = snapTotal(close, fx);
    const delta = endValue - startValue;

    const movers = CATEGORIES.map((c) => ({
      category: c,
      label: CATEGORY_LABELS[c],
      delta: snapCategory(close, c, fx) - snapCategory(open, c, fx),
    }))
      .filter((m) => Math.abs(m.delta) > 0.005)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    let income = 0;
    let expense = 0;
    for (const t of transactions) {
      if (t.date.slice(0, 7) !== month || t.transfer) continue;
      const v = convertToBase(t.amount, t.currency, fx);
      if (t.type === "earned") income += v;
      else expense += v;
    }

    out.push({
      id: month,
      month,
      title: monthTitle(month),
      delta,
      pct: startValue !== 0 ? (delta / startValue) * 100 : 0,
      startValue,
      endValue,
      income,
      expense,
      savingsPct: income > 0 ? ((income - expense) / income) * 100 : 0,
      movers: movers.slice(0, 3),
      date: close.date,
    });
  }

  return out.sort((a, b) => b.month.localeCompare(a.month));
}
