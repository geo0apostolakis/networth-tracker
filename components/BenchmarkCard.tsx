"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChart } from "lucide-react";
import DateRangePicker from "@/components/DateRangePicker";
import { CardHeader } from "@/components/ui/Headings";
import { Select } from "@/components/ui/Select";
import {
  DEFAULT_RANGE,
  resolveRange,
  type DateRange,
  type RangePreset,
} from "@/lib/dateRange";
import {
  BENCHMARKS,
  benchmarkReturn,
  type BenchmarkSeries,
} from "@/lib/benchmarks";
import { portfolioReturn } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { formatMoney, formatPct } from "@/lib/utils";

// "Am I actually doing well, or just riding a bull market?" Answering that
// honestly means stripping deposits out of the portfolio side first: money
// added is not performance, and on a small balance it dwarfs it.
export default function BenchmarkCard() {
  const snapshots = useStore((s) => s.snapshots);
  const transactions = useStore((s) => s.transactions);
  const assets = useStore((s) => s.assets);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const privacy = useStore((s) => s.privacy);
  const benchmark = useStore((s) => s.benchmark);
  const setBenchmark = useStore((s) => s.setBenchmark);

  // The fetched symbol is stored alongside its result, so switching benchmarks
  // reads as "loading" from the next render rather than briefly showing the
  // previous index's numbers under the new index's name.
  const [loaded, setLoaded] = useState<{
    symbol: string;
    series: BenchmarkSeries | null;
    error: string | null;
  } | null>(null);

  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);

  // Both sides are measured over the same window: the benchmark return is taken
  // between the exact snapshot dates the portfolio return used.
  const resolved = useMemo(() => resolveRange(range), [range]);
  const mine = useMemo(
    () => portfolioReturn(snapshots, transactions, assets, fx, resolved),
    [snapshots, transactions, assets, fx, resolved]
  );

  // A preset can ask for a span the snapshots do not cover: "this year" runs to
  // 31 December, and the history may only start in June. Both sides are then
  // measured over what actually exists, so say that outright instead of leaving
  // the picker's span implying the index was measured over the whole year.
  const clipped =
    mine.hasData &&
    ((resolved.start !== null && mine.startDate > isoDay(resolved.start)) ||
      (resolved.end !== null && mine.endDate < isoDay(resolved.end)));

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/benchmark?symbol=${encodeURIComponent(benchmark)}`)
      .then((r) => r.json())
      .then((data: BenchmarkSeries & { error?: string }) => {
        if (cancelled) return;
        setLoaded({
          symbol: benchmark,
          series: data.error ? null : data,
          error: data.error ?? null,
        });
      })
      .catch(() => {
        if (!cancelled)
          setLoaded({
            symbol: benchmark,
            series: null,
            error: "could not load index prices",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [benchmark]);

  const current = loaded?.symbol === benchmark ? loaded : null;
  const series = current?.series ?? null;
  const error = current?.error ?? null;

  const theirs =
    series && mine.hasData
      ? benchmarkReturn(series, mine.startDate, mine.endDate)
      : null;

  // The index over the whole span the picker names, regardless of how much
  // snapshot history exists. Not comparable to your return, which is exactly
  // why it is shown separately: it is the number you would read on a market
  // site, and seeing it here stops the like-for-like figure looking wrong.
  const theirsFull =
    series && (resolved.start || resolved.end)
      ? benchmarkReturn(
          series,
          resolved.start ? isoDay(resolved.start) : series.points[0]?.date ?? "",
          isoDay(resolved.end && resolved.end < new Date() ? resolved.end : new Date())
        )
      : null;

  const options = BENCHMARKS.map((b) => ({ value: b.symbol, label: b.label }));

  return (
    <section className="card p-4">
      <CardHeader
        title="Versus the market"
        subtitle="Your investments against an index, over the same window"
        icon={<LineChart size={16} className="text-purple-400" />}
        action={
          <Select
            value={benchmark}
            onChange={setBenchmark}
            options={options}
            ariaLabel="Benchmark index"
            className="w-40"
          />
        }
      />

      <DateRangePicker value={range} onChange={setRange} className="mb-2" />

      {mine.hasData && (
        <p className="mb-3 text-xs text-muted">
          Both sides measured{" "}
          <span className="text-foreground">
            {prettyDay(mine.startDate)} to {prettyDay(mine.endDate)}
          </span>
          {clipped && (
            <>
              , which is the part of {SPAN_PHRASE[range.preset]} your snapshots
              actually cover
            </>
          )}
          .
        </p>
      )}

      {!mine.hasData ? (
        <p className="py-6 text-center text-sm text-muted">
          Needs at least two snapshots with money in stocks or crypto inside this
          range before a return means anything.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Figure
              label="Your investments"
              pct={mine.pct}
              sub="deposits stripped out"
            />
            <Figure
              label={series?.label ?? "Benchmark"}
              pct={theirs}
              sub={
                error
                  ? "unavailable"
                  : theirs === null
                    ? "loading…"
                    : `same window, in ${series?.currency}`
              }
            />
          </div>

          {theirsFull !== null && clipped && (
            <p className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
              Over the whole of {SPAN_PHRASE[range.preset]}, {series?.label} did{" "}
              <span
                className={
                  theirsFull >= 0 ? "text-emerald-400" : "text-rose-400"
                }
              >
                {formatPct(theirsFull)}
              </span>
              . That is the figure a market site would show you. It is not
              comparable to your return, because you were not invested for all
              of it.
            </p>
          )}

          {theirs !== null && (
            <p className="mt-3 text-sm">
              {mine.pct >= theirs ? (
                <>
                  You are{" "}
                  <span className="font-medium text-emerald-400">
                    {formatPct(mine.pct - theirs).replace("+", "")} ahead
                  </span>{" "}
                  of {series?.label}.
                </>
              ) : (
                <>
                  You are{" "}
                  <span className="font-medium text-rose-400">
                    {formatPct(theirs - mine.pct).replace("+", "")} behind
                  </span>{" "}
                  {series?.label}.
                </>
              )}
            </p>
          )}

          <p className="mt-3 text-xs leading-relaxed text-muted">
            Your figure strips out deposits:{" "}
            {formatMoney(mine.contributions, baseCurrency, privacy)} was added
            over this window and is not counted as growth. The index is measured
            in {series?.currency ?? "its own currency"}, so currency moves
            against {baseCurrency} are not included on its side.
            {mine.hasSyncedHoldings && (
              <>
                {" "}
                Some holdings are synced from your broker: money moved straight
                in or out of that account is never logged as a transaction here,
                so it cannot be stripped out. A deposit would show up as growth
                and a withdrawal as a loss.
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}

// The preset names read fine in a dropdown but not mid-sentence: lowercasing
// "Custom" gives "the part of custom", and "Last 30 days" wants an article.
const SPAN_PHRASE: Record<RangePreset, string> = {
  all: "all time",
  week: "this week",
  "week-prev": "last week",
  month: "this month",
  "month-prev": "last month",
  quarter: "this quarter",
  year: "this year",
  "year-prev": "last year",
  d30: "the last 30 days",
  d90: "the last 90 days",
  custom: "the range you picked",
};

// Local calendar day, so a range boundary compares cleanly against snapshot
// dates (plain YYYY-MM-DD) without a timezone shifting it by one.
function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function prettyDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Figure({
  label,
  pct,
  sub,
}: {
  label: string;
  pct: number | null;
  sub: string;
}) {
  const tone =
    pct === null ? "" : pct >= 0 ? "text-emerald-400" : "text-rose-400";
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <div className="truncate text-[10px] uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>
        {pct === null ? "—" : formatPct(pct)}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-muted">{sub}</div>
    </div>
  );
}
