"use client";

import { useMemo, useState } from "react";
import AnnotationsCard from "@/components/AnnotationsCard";
import CategoryTrendChart from "@/components/CategoryTrendChart";
import NetWorthChart from "@/components/NetWorthChart";
import { CardHeader } from "@/components/ui/Headings";
import {
  CHART_RANGES,
  DEFAULT_CHART_RANGE,
  rangeView,
  type ChartRange,
} from "@/lib/chartRange";
import { allocation, trendSeries, withToday } from "@/lib/metrics";
import { useStore } from "@/lib/store";

// The full net worth view. The dashboard shows the same chart in miniature;
// this is where it gets the room, alongside what drove it.
export default function NetWorthSection() {
  const assets = useStore((s) => s.assets);
  const snapshots = useStore((s) => s.snapshots);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const chartMode = useStore((s) => s.chartMode);
  const setChartMode = useStore((s) => s.setChartMode);

  const hydrated = useStore((s) => s._hydrated);
  const [range, setRange] = useState<ChartRange>(DEFAULT_CHART_RANGE);

  const alloc = useMemo(() => allocation(assets, fx), [assets, fx]);
  // Today's point comes from live assets, not from the row stored this
  // morning, so the end of the chart is the same number as the headline.
  const trend = useMemo(
    () => withToday(trendSeries(snapshots, fx), assets, fx, hydrated),
    [snapshots, assets, fx, hydrated]
  );
  // Both charts read the same window. The category trends chart used to get
  // the whole history while the chart above it was scoped to a month, so the
  // two sat one above the other showing different spans of time.
  const windowed = useMemo(() => rangeView(trend, range).points, [trend, range]);
  const rangeLabel =
    CHART_RANGES.find((r) => r.id === range)?.label ?? "";

  return (
    // The two-row frame only holds once the cards sit side by side. Below xl
    // they stack into three rows, so forcing a two-row template there squeezed
    // the third card out of the viewport.
    <div className="grid grid-cols-1 gap-3 xl:h-full xl:grid-cols-3 xl:grid-rows-[1.5fr_1fr]">
      <div className="card flex min-h-0 flex-col p-4 xl:col-span-3">
        <CardHeader
          title="Net worth over time"
          subtitle={range === "all" ? "Every snapshot taken so far" : `Window: ${rangeLabel}`}
          action={
            <div className="flex rounded-lg bg-white/5 p-0.5 text-xs">
              {(["stacked", "line"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setChartMode(m)}
                  aria-pressed={chartMode === m}
                  className={`rounded-md px-2.5 py-1 capitalize transition ${
                    chartMode === m
                      ? "bg-white/10 text-white"
                      : "text-muted hover:text-white"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          }
        />
        <div className="min-h-0 flex-1">
          <NetWorthChart
            data={trend}
            currency={baseCurrency}
            mode={chartMode}
            range={range}
            onRangeChange={setRange}
            alloc={alloc}
            fill
          />
        </div>
      </div>

      <div className="card flex min-h-0 flex-col p-4 xl:col-span-2">
        <CardHeader
          title="Category trends"
          subtitle={`Each category tracked separately · ${rangeLabel.toLowerCase()}`}
        />
        <div className="min-h-0 flex-1">
          <CategoryTrendChart data={windowed} currency={baseCurrency} fill />
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto">
        <AnnotationsCard />
      </div>
    </div>
  );
}
