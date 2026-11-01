"use client";

import { useCallback, useMemo, useState } from "react";
import AllocationChart from "@/components/AllocationChart";
import NetWorthChart from "@/components/NetWorthChart";
import RecentTransactions from "@/components/RecentTransactions";
import SolcardCard from "@/components/SolcardCard";
import SpendingOverviewCard from "@/components/SpendingOverviewCard";
import { HeroArt } from "@/components/skin/Backdrop";
import { Ticker, useFlash, useNarrow } from "@/components/term/hooks";
import { BlockBar, Cg, Seg, Sparkline } from "@/components/term/viz";
import { CardHeader } from "@/components/ui/Headings";
import { filterByRange } from "@/lib/dateRange";
import { CHART_RANGES, chartRangeToDates, DEFAULT_CHART_RANGE, rangeView, type ChartRange } from "@/lib/chartRange";
import { useCurtainUp } from "@/lib/curtain";
import { allocation, currentNetWorth, milestoneProgress, savingsRate, trendSeries, withToday } from "@/lib/metrics";
import type { Section } from "@/lib/sections";
import { useSkin } from "@/lib/skin";
import { useStore } from "@/lib/store";
import { CATEGORY_COLORS, type Category } from "@/lib/types";
import { formatMoney, formatPct, MONEY_MASK } from "@/lib/utils";

// The overview: a hero with the live total and its change over the chosen
// window, a rail of headline figures, then the condensed cards that each link
// through to their own section. One window (picked under the chart) drives it all.

const SHORT: Record<Category, string> = { cash: "cash", bank: "bank", stocks: "stocks", crypto: "crypto", other: "other" };

export default function DashboardSection({ onNavigate }: { onNavigate: (s: Section) => void }) {
  const assets = useStore((s) => s.assets);
  const snapshots = useStore((s) => s.snapshots);
  const transactions = useStore((s) => s.transactions);
  const milestones = useStore((s) => s.milestones);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const chartMode = useStore((s) => s.chartMode);
  const privacy = useStore((s) => s.privacy);
  const hydrated = useStore((s) => s._hydrated);

  const netWorth = useMemo(() => currentNetWorth(assets, fx), [assets, fx]);
  const alloc = useMemo(() => allocation(assets, fx), [assets, fx]);
  // Today comes from live assets; every earlier day is the stored snapshot.
  const trend = useMemo(() => withToday(trendSeries(snapshots, fx), assets, fx, hydrated), [snapshots, assets, fx, hydrated]);
  const goals = useMemo(() => milestoneProgress(milestones, netWorth), [milestones, netWorth]);

  const [range, setRange] = useState<ChartRange>(DEFAULT_CHART_RANGE);
  const dates = useMemo(() => chartRangeToDates(range, trend), [range, trend]);
  const view = useMemo(() => rangeView(trend, range), [trend, range]);
  const flows = useMemo(() => savingsRate(transactions, fx, dates), [transactions, fx, dates]);
  const windowLabel = CHART_RANGES.find((r) => r.id === range)?.label ?? dates.label;

  const curtainUp = useCurtainUp();
  const plain = useSkin((s) => s.skin) !== "terminal";
  const narrow = useNarrow();
  const hot = useFlash(Math.round(netWorth * 100));
  const money = (v: number) => formatMoney(v, baseCurrency, privacy);
  const total = useCallback((v: number) => (privacy ? MONEY_MASK : formatMoney(v, baseCurrency, false)), [privacy, baseCurrency]);
  const up = view.delta >= 0;
  const holdings = assets.length;
  const nextGoal = goals.find((g) => !g.reached) ?? goals[0];
  const txnsInWindow = filterByRange(transactions, dates).length;
  const maxCat = Math.max(1, ...alloc.map((a) => a.value));

  return (
    <div className="dash">
      <section className="hero">
        <HeroArt />
        <div className="hero-in">
          <div className="hero-text min-w-0">
            <div className="eyebrow">
              <span className="n">{"00"}</span>
              <span className="sep">{" · "}</span>
              {plain ? `Net worth · ${baseCurrency} · ${hydrated ? "live" : "loading"}` : `net worth · ${baseCurrency} · ${hydrated ? "live" : "loading"}`}
            </div>
            <div className="display">
              <Ticker value={netWorth} format={total} hold={!curtainUp} />
              <span className={`o ${up ? "up" : "down"}`}>
                {view.pct === null ? `${up ? "+" : ""}${money(view.delta)}` : `${formatPct(view.pct)} · ${windowLabel.toLowerCase()}`}
              </span>
            </div>
            <dl className="defs">
              {alloc.map((a) => (
                <div key={a.category} className="contents">
                  <dt style={{ color: CATEGORY_COLORS[a.category] }}>{SHORT[a.category]}</dt>
                  <dd className="flex items-center gap-2">
                    <Cg frac={a.value / maxCat} cells={14} tone="dim" />
                    <span className="faint">{`${a.pct.toFixed(1)}%`}</span>
                  </dd>
                  <dd className="v">{money(a.value)}</dd>
                </div>
              ))}
              {alloc.length === 0 && (
                <>
                  <dt>{"empty"}</dt>
                  <dd>{hydrated ? "no assets yet — add one under assets" : "reading /api/state…"}</dd>
                  <dd className="v" />
                </>
              )}
            </dl>
            <div className="hero-acts mt-5 flex flex-wrap gap-2">
              <button className="btn pri" onClick={() => onNavigate("networth")}>
                {plain ? "Net worth over time" : "plot net worth →"}
                {plain && <i className="go" aria-hidden>{"→"}</i>}
              </button>
              <button className="btn" onClick={() => onNavigate("assets")}>
                {plain ? "Assets" : "ls -l assets"}
              </button>
              <button className="btn" onClick={() => onNavigate("transactions")}>
                {plain ? "Transactions" : "tail -f txns"}
              </button>
            </div>
          </div>
          <section className="card hero-chart flex min-h-0 flex-col p-3">
            <CardHeader title="net worth over time" subtitle="the window here sets the whole dashboard" />
            <div className="min-h-0 flex-1">
              {/* Bands are unreadable at phone width, so a phone gets the line. */}
              <NetWorthChart data={trend} currency={baseCurrency} mode={narrow ? "line" : chartMode} alloc={alloc} fill range={range} onRangeChange={setRange} />
            </div>
          </section>
        </div>
      </section>

      <div className="rail" aria-label="headline figures">
        <Rg k="net worth" hot={hot} v={<Ticker className="acc" value={netWorth} format={total} hold={!curtainUp} />} d={<>{`Σ ${holdings} holdings · ${snapshots.length} days`}</>}>
          <BlockBar frac={nextGoal ? nextGoal.pct / 100 : 1} tone="acc" />
        </Rg>
        <Rg k={`change · ${windowLabel}`} v={<span className={up ? "ok" : "err"}>{`${up ? "+" : ""}${money(view.delta)}`}</span>} d={view.pct === null ? "not enough history" : `${formatPct(view.pct)} over the window`}>
          <Sparkline data={view.points.map((p) => p.total)} color={up ? "var(--ok)" : "var(--err)"} height={18} label="net worth over the window" />
        </Rg>
        <Rg k={`income · ${windowLabel}`} v={<span className="ok">{money(flows.income)}</span>} d={`earned · ${txnsInWindow} txns in window`}>
          <Cg frac={flows.income / Math.max(1, flows.income + flows.expense)} cells={18} tone="ok" />
        </Rg>
        <Rg k={`expenses · ${windowLabel}`} v={<span className="err">{money(flows.expense)}</span>} d="spent">
          <Cg frac={flows.expense / Math.max(1, flows.income + flows.expense)} cells={18} tone="err" delay={120} />
        </Rg>
        <Rg k="kept" v={<span className={flows.saved >= 0 ? "ok" : "err"}>{flows.hasIncome ? `${flows.pct.toFixed(0)}%` : "—"}</span>} d={`${money(flows.saved)} net`}>
          <BlockBar frac={flows.hasIncome ? Math.max(0, flows.pct) / 100 : 0} />
        </Rg>
        <Rg
          k={nextGoal ? `goal · ${nextGoal.milestone.name}` : "goal"}
          v={nextGoal ? <span className={nextGoal.reached ? "ok" : "partial"}>{`${nextGoal.pct.toFixed(1)}%`}</span> : <span className="faint">{"none"}</span>}
          d={nextGoal ? (nextGoal.reached ? "reached" : `${money(nextGoal.remaining)} to go`) : "set one under goals"}
        >
          <Seg frac={nextGoal ? nextGoal.pct / 100 : 0} />
        </Rg>
      </div>

      <div className="dash-solcard mb-3">
        <SolcardCard />
      </div>

      <div className="dash-grid grid grid-cols-1 gap-3 xl:grid-cols-12">
        <div className="min-h-0 xl:col-span-7" style={{ height: 360 }}>
          <RecentTransactions onOpen={() => onNavigate("transactions")} fill />
        </div>
        <div className="min-h-0 xl:col-span-5" style={{ height: 360 }}>
          <SpendingOverviewCard onOpen={() => onNavigate("spending")} fill range={dates} />
        </div>
        <Panel className="xl:col-span-5" height={320}>
          <CardHeader title="allocation" subtitle="what the money is in" action={<Jump label="manage" onClick={() => onNavigate("assets")} />} />
          <div className="min-h-0 flex-1">
            <AllocationChart data={alloc} currency={baseCurrency} fill />
          </div>
        </Panel>
        <Panel className="xl:col-span-7" height={320}>
          <CardHeader title="goals" subtitle={goals.length > 0 ? "targets you have set" : undefined} action={<Jump label="view" onClick={() => onNavigate("goals")} />} />
          {goals.length === 0 ? (
            <p className="flex flex-1 items-center justify-center text-sm text-muted">{"no goals set yet."}</p>
          ) : (
            <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              {goals.map((g) => (
                <li key={g.milestone.id}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">{g.milestone.name}</span>
                    <span className={`shrink-0 tabular-nums ${g.reached ? "ok" : "partial"}`}>{`${g.pct.toFixed(1)}%`}</span>
                  </div>
                  <BlockBar frac={g.pct / 100} cells={40} tone={g.reached ? "ok" : "acc"} />
                  <div className="mt-1 text-[11px] text-muted">
                    {money(g.current)} {"of "}
                    {formatMoney(g.milestone.target, g.milestone.currency, privacy)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Rg({ k, v, d, hot, children }: { k: string; v: React.ReactNode; d: React.ReactNode; hot?: boolean; children: React.ReactNode }) {
  return (
    <div className={`rg${hot ? " hot" : ""}`}>
      <div className="rg-k">{k}</div>
      <div className="rg-v">{v}</div>
      <div className="rg-viz">{children}</div>
      <div className="rg-d">
        <span className="eq">{"= "}</span>
        {d}
      </div>
    </div>
  );
}

function Panel({ className, height, children }: { className?: string; height: number; children: React.ReactNode }) {
  return (
    <section className={`card flex min-h-0 flex-col p-4 ${className ?? ""}`} style={{ height }}>
      {children}
    </section>
  );
}

function Jump({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn ghost">
      {`${label} →`}
    </button>
  );
}
