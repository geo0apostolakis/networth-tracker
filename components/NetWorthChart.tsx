"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useNarrow, useReducedMotion } from "@/components/term/hooks";
import {
  CHART_RANGES,
  DEFAULT_CHART_RANGE,
  rangeView,
  type ChartRange,
} from "@/lib/chartRange";
import { useCurtainUp } from "@/lib/curtain";
import type { AllocationSlice, TrendPoint } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import {
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type Annotation,
  type Category,
} from "@/lib/types";
import { formatCurrency, formatMoney, formatPct } from "@/lib/utils";

// Direction colours, shared by the line, its gradient and the reveal edge.
const UP = "var(--ok)";
const DOWN = "var(--err)";

// A pinned life event only renders if its x value matches a real category tick,
// so each one is snapped to the nearest snapshot on the chart. Events before the
// first snapshot or after the last are dropped rather than clamped to an edge,
// where they would imply a date the chart does not cover.
interface PinnedEvent {
  key: string;
  date: string;
  total: number;
  labels: string[];
}

function pinEvents(data: TrendPoint[], annotations: Annotation[]): PinnedEvent[] {
  if (data.length === 0 || annotations.length === 0) return [];
  const first = data[0].date;
  const last = data[data.length - 1].date;
  const byDate = new Map<string, PinnedEvent>();

  for (const a of annotations) {
    const day = a.date.slice(0, 10);
    if (day < first || day > last) continue;
    let nearest = data[0];
    let best = Infinity;
    for (const p of data) {
      const gap = Math.abs(new Date(p.date).getTime() - new Date(day).getTime());
      if (gap < best) {
        best = gap;
        nearest = p;
      }
    }
    const existing = byDate.get(nearest.date);
    if (existing) existing.labels.push(a.label);
    else byDate.set(nearest.date, { key: nearest.date, date: nearest.date, total: nearest.total, labels: [a.label] });
  }
  return [...byDate.values()];
}

// Shared by both chart modes so a pinned event never shows in one view and
// vanishes in the other.
function EventPins({ events }: { events: PinnedEvent[] }) {
  return (
    <>
      {events.map((e) => (
        <ReferenceDot
          key={e.key}
          x={e.date}
          y={e.total}
          r={4.5}
          fill="var(--text)"
          stroke="var(--bg)"
          strokeWidth={2}
          label={{
            value: e.labels.length > 1 ? `${e.labels[0]} +${e.labels.length - 1}` : e.labels[0],
            position: "top",
            fill: "var(--dim)",
            fontSize: 10,
          }}
        />
      ))}
    </>
  );
}

// The chart draws itself in once per page load. It used to do that through
// recharts' own animation, which re-renders every band of the SVG on every
// frame, restarted whenever fresh data landed mid-draw (snapshots, prices,
// FX all arrive in the first seconds), and ran behind the boot screen. Now the
// chart renders once, finished, and a panel-coloured cover slides off it to
// the right: one transform on one layer, which the GPU does on its own. It
// waits until the history has loaded and nothing covers the screen.
let revealed = false;

function Reveal({ go, glow, left, right, children }: { go: boolean; glow: string; left: number; right: number; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const [done, setDone] = useState(revealed);
  const show = !done && !reduce;
  return (
    <div className="nw-plot">
      {children}
      {show && (
        <span className={`nw-reveal${go ? " go" : ""}`} style={{ left, right } as React.CSSProperties} aria-hidden>
          <span
            className="nw-reveal__cover"
            style={{ "--glow": glow } as React.CSSProperties}
            onAnimationStart={() => {
              revealed = true;
            }}
            onAnimationEnd={() => setDone(true)}
          />
        </span>
      )}
    </div>
  );
}

export default function NetWorthChart({
  data,
  currency,
  mode,
  alloc,
  fill = false,
  range: controlledRange,
  onRangeChange,
}: {
  data: TrendPoint[];
  currency: string;
  mode: "stacked" | "line";
  alloc: AllocationSlice[];
  // When true the chart grows to whatever height its parent gives it.
  // Otherwise it keeps a fixed height.
  fill?: boolean;
  // Pass both to hoist the window out of the chart: the dashboard does this so
  // one selector drives every card on the page. Omit both and the chart owns it.
  range?: ChartRange;
  onRangeChange?: (r: ChartRange) => void;
}) {
  const privacy = useStore((s) => s.privacy);
  const annotations = useStore((s) => s.annotations);
  const loaded = useStore((s) => s.snapshotsLoaded && s._hydrated);
  const curtainUp = useCurtainUp();
  const narrow = useNarrow();
  const [ownRange, setOwnRange] = useState<ChartRange>(DEFAULT_CHART_RANGE);
  const range = controlledRange ?? ownRange;
  const setRange = onRangeChange ?? setOwnRange;

  const view = useMemo(() => rangeView(data, range), [data, range]);
  const events = useMemo(() => pinEvents(view.points, annotations), [view.points, annotations]);

  if (!loaded) {
    return <Empty fill={fill}>{"reading history…"}</Empty>;
  }
  if (data.length === 0) {
    return <Empty fill={fill}>{"Save a snapshot to start tracking net worth over time."}</Empty>;
  }

  const plot = { narrow, privacy, currency, events, fill, go: curtainUp };
  return (
    <div className={fill ? "flex h-full min-h-0 flex-col" : ""}>
      <div className={fill ? "flex min-h-0 flex-1 flex-col" : ""}>
        {mode === "line" ? (
          <LineView data={view.points} up={view.up} start={view.points[0]?.total ?? 0} {...plot} />
        ) : (
          <StackedView data={view.points} alloc={alloc} {...plot} />
        )}
      </div>
      <RangeBar data={data} active={range} onChange={setRange} truncated={view.truncated} narrow={narrow} />
    </div>
  );
}

// The row under the chart: pick a window, and read what it returned. On a
// phone it is one row of short labels (1D 5D 1M ...), each a full-height tap
// target, with the return shown for the picked one only.
function RangeBar({
  data,
  active,
  onChange,
  truncated,
  narrow,
}: {
  data: TrendPoint[];
  active: ChartRange;
  onChange: (r: ChartRange) => void;
  truncated: boolean;
  narrow: boolean;
}) {
  const returns = useMemo(() => CHART_RANGES.map((r) => ({ ...r, view: rangeView(data, r.id) })), [data]);
  const picked = returns.find((r) => r.id === active);

  return (
    <div className="mt-2 shrink-0">
      <div className="nw-ranges" role="tablist" aria-label="Chart window">
        {returns.map(({ id, label, short, view }) => (
          <button key={id} role="tab" onClick={() => onChange(id)} aria-selected={active === id} className={active === id ? "on" : ""} title={label}>
            <span className="l">{narrow ? short : label}</span>
            {!narrow && (
              <span className={`p ${view.pct === null ? "faint" : view.up ? "ok" : "err"}`}>{view.pct === null ? "·" : formatPct(view.pct)}</span>
            )}
          </button>
        ))}
      </div>
      {narrow && picked && (
        <p className="mt-1.5 text-[11px] text-muted">
          {picked.label.toLowerCase()}
          {" · "}
          <span className={picked.view.pct === null ? "faint" : picked.view.up ? "ok" : "err"}>
            {picked.view.pct === null ? "not enough history" : formatPct(picked.view.pct)}
          </span>
          {truncated ? " · all history so far" : ""}
        </p>
      )}
      {!narrow && truncated && <p className="mt-1 text-[11px] text-muted">{"Showing everything logged so far. The history is shorter than this window."}</p>}
    </div>
  );
}

interface PlotProps {
  narrow: boolean;
  privacy: boolean;
  currency: string;
  events: PinnedEvent[];
  fill: boolean;
  go: boolean;
}

const axisTick = (narrow: boolean) => ({ fontSize: narrow ? 10 : 11 });
const yWidth = (narrow: boolean) => (narrow ? 44 : 58);

// Styled after a market chart: a thin stroke, a gradient wash under it and no
// grid. The colour follows the direction of the selected window. Touching or
// hovering it reads a day off in the top left corner, the way a broker app
// does, instead of a box that follows the finger and hides what it points at.
function LineView({ data, up, start, narrow, privacy, currency, events, fill, go }: PlotProps & { data: TrendPoint[]; up: boolean; start: number }) {
  const tone = up ? UP : DOWN;
  const h = fill ? "100%" : narrow ? 220 : 260;
  return (
    <div className={`nw-touch ${fill ? "min-h-[200px] flex-1 xl:min-h-0" : ""}`}>
      <Reveal go={go} glow={tone} left={4} right={yWidth(narrow) + 4}>
        <ResponsiveContainer width="100%" height={h}>
          <AreaChart data={data} margin={{ top: narrow ? 34 : 10, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={`nwFill-${up ? "up" : "down"}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={tone} stopOpacity={0.32} />
                <stop offset="100%" stopColor={tone} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" stroke="var(--faint)" tick={axisTick(narrow)} tickLine={false} axisLine={false} minTickGap={narrow ? 44 : 28} tickFormatter={chartDate} />
            <YAxis
              orientation="right"
              stroke="var(--faint)"
              tick={axisTick(narrow)}
              tickLine={false}
              axisLine={false}
              tickCount={narrow ? 3 : 5}
              tickFormatter={(v) => (privacy ? "" : formatCurrency(v, currency, { compact: true }))}
              width={yWidth(narrow)}
              // A little air top and bottom, so the highest and lowest points
              // are not pinned to the plot edges with half the stroke clipped.
              domain={[(min: number) => min - Math.abs(min) * 0.04, (max: number) => max + Math.abs(max) * 0.04]}
            />
            <Tooltip
              cursor={{ stroke: "var(--dim)", strokeWidth: 1, strokeDasharray: "2 3" }}
              position={{ x: 8, y: 0 }}
              isAnimationActive={false}
              wrapperStyle={{ pointerEvents: "none", zIndex: 2 }}
              content={<Readout currency={currency} privacy={privacy} start={start} />}
            />
            <Area
              type="monotone"
              dataKey="total"
              stroke={tone}
              strokeWidth={1.5}
              fill={`url(#nwFill-${up ? "up" : "down"})`}
              name="Net worth"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--panel)", fill: tone }}
              isAnimationActive={false}
            />
            <EventPins events={events} />
          </AreaChart>
        </ResponsiveContainer>
      </Reveal>
    </div>
  );
}

// The day under the finger or cursor: date, value, and how far it is from the
// start of the window.
function Readout({ active, payload, currency, privacy, start }: { active?: boolean; payload?: { payload: TrendPoint }[]; currency: string; privacy: boolean; start: number }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const d = p.total - start;
  return (
    <div className="nw-readout">
      <b>{formatMoney(p.total, currency, privacy)}</b>
      <span className="faint">
        {new Date(`${p.date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
        {p.live ? " · live" : ""}
      </span>
      {start !== 0 && <span className={d >= 0 ? "ok" : "err"}>{`${d >= 0 ? "+" : "−"}${formatMoney(Math.abs(d), currency, privacy)} · ${formatPct((d / start) * 100)}`}</span>}
    </div>
  );
}

// Net worth split into stacked category bands, with a % legend.
function StackedView({ data, alloc, narrow, privacy, currency, events, fill, go }: PlotProps & { data: TrendPoint[]; alloc: AllocationSlice[] }) {
  // Only show bands for categories that actually hold money.
  const active = CATEGORIES.filter((c) => data.some((d) => (d[c as keyof TrendPoint] as number) > 0));
  const shares = alloc.filter((s) => s.pct > 0);
  const h = fill ? "100%" : narrow ? 220 : 232;

  return (
    <div className={fill ? "flex h-full min-h-0 flex-col" : ""}>
      <div className={`nw-touch ${fill ? "min-h-[200px] flex-1 xl:min-h-0" : ""}`}>
        <Reveal go={go} glow="var(--text)" left={0} right={yWidth(narrow) + 10}>
          <ResponsiveContainer width="100%" height={h}>
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" stroke="var(--faint)" tick={axisTick(narrow)} tickLine={false} axisLine={false} minTickGap={narrow ? 44 : 28} tickFormatter={chartDate} />
              <YAxis
                orientation="right"
                stroke="var(--faint)"
                tick={axisTick(narrow)}
                tickLine={false}
                axisLine={false}
                tickCount={narrow ? 3 : 5}
                tickFormatter={(v) => (privacy ? "" : formatCurrency(v, currency, { compact: true }))}
                width={yWidth(narrow)}
              />
              <Tooltip
                cursor={{ stroke: "var(--line-2)", strokeWidth: 1 }}
                isAnimationActive={false}
                // On a phone the breakdown sits in the corner rather than
                // under the finger.
                {...(narrow ? { position: { x: 4, y: 0 } } : {})}
                wrapperStyle={{ pointerEvents: "none", zIndex: 2 }}
                content={<StackTooltip currency={currency} privacy={privacy} order={active} />}
              />
              {/* No stroke on the bands. A category worth nothing still has a
                  top edge, so recharts drew its colour as a line along the top
                  of the whole stack. Fills only, and one outline on the total. */}
              {active.map((c) => (
                <Area key={c} type="monotone" dataKey={c} stackId="1" stroke="none" fill={CATEGORY_COLORS[c]} fillOpacity={0.62} name={c} isAnimationActive={false} />
              ))}
              <Area type="monotone" dataKey="total" stroke="var(--foreground)" strokeOpacity={0.5} strokeWidth={1.25} fill="none" legendType="none" isAnimationActive={false} activeDot={false} />
              <EventPins events={events} />
            </AreaChart>
          </ResponsiveContainer>
        </Reveal>
      </div>

      <ul className="mt-3 flex shrink-0 flex-wrap gap-x-4 gap-y-1.5 text-xs sm:text-sm">
        {shares.map((s) => (
          <li key={s.category} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5" style={{ background: CATEGORY_COLORS[s.category] }} />
            <span className="text-muted">{s.label}</span>
            <span className="font-medium tabular-nums">{formatPct(s.pct).replace("+", "")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// One date format for every chart on the page, so the net worth chart and the
// category trends below it never label the same day differently.
export function chartDate(v: string): string {
  return new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// The stacked tooltip lists the total first, then only the categories that
// hold money, ordered top-down to match the bands.
function StackTooltip({ active, payload, currency, privacy, order }: { active?: boolean; payload?: { payload: TrendPoint }[]; currency: string; privacy: boolean; order: Category[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const rows = [...order].reverse().filter((c) => (point[c] as number) > 0);
  return (
    <div style={tooltipStyle} className="px-3 py-2 text-xs">
      <div className="mb-1 flex items-baseline justify-between gap-6">
        <span className="font-medium">
          {new Date(`${point.date}T00:00:00`).toLocaleDateString()}
          {point.live && <span className="ml-1.5 text-[10px] text-muted">live</span>}
        </span>
        <span className="font-semibold tabular-nums">{formatMoney(point.total, currency, privacy)}</span>
      </div>
      {rows.map((c) => (
        <div key={c} className="flex items-baseline justify-between gap-6">
          <span className="flex items-center gap-1.5" style={{ color: CATEGORY_COLORS[c] }}>
            <span className="inline-block h-2 w-2" style={{ background: CATEGORY_COLORS[c] }} />
            {CATEGORY_LABELS[c]}
          </span>
          <span className="tabular-nums">{formatMoney(point[c] as number, currency, privacy)}</span>
        </div>
      ))}
    </div>
  );
}

const tooltipStyle = {
  background: "var(--panel)",
  border: "1px solid #2c2c30",
  borderRadius: 0,
  color: "var(--text)",
};

function Empty({ children, fill = false }: { children: React.ReactNode; fill?: boolean }) {
  return <div className={`flex items-center justify-center text-sm text-muted ${fill ? "h-full min-h-[200px]" : "h-[220px] sm:h-[260px]"}`}>{children}</div>;
}
