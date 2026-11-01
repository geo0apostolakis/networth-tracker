"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CardHeader } from "@/components/ui/Headings";
import type { ResolvedRange } from "@/lib/dateRange";
import { categorySlices } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { formatMoney } from "@/lib/utils";

// The dashboard's condensed view of where the money went over the window picked
// under the net worth chart. The full breakdown, with both directions and its
// own range picker, lives under Spending.
export default function SpendingOverviewCard({
  onOpen,
  fill = false,
  range,
}: {
  onOpen: () => void;
  fill?: boolean;
  range: ResolvedRange;
}) {
  const transactions = useStore((s) => s.transactions);
  const txnCategories = useStore((s) => s.txnCategories);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const privacy = useStore((s) => s.privacy);

  const slices = useMemo(
    () =>
      categorySlices(
        transactions,
        txnCategories,
        fx,
        "spent",
        range
      ),
    [transactions, txnCategories, fx, range]
  );
  const window = range.label.toLowerCase();

  return (
    <section
      className={`card p-4 ${fill ? "flex h-full min-h-0 flex-col" : ""}`}
    >
      <CardHeader
        title="Spending overview"
        subtitle={`Expenses · ${window}`}
        action={
          <button
            onClick={onOpen}
            className="input w-auto px-2.5 py-1 text-xs text-muted hover:text-foreground"
          >
            View all
          </button>
        }
      />

      {slices.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-10 text-center text-sm text-muted">
          Nothing spent in this window.
        </p>
      ) : (
        <div
          className={`flex flex-col items-center gap-4 lg:flex-row ${
            fill ? "min-h-0 flex-1" : ""
          }`}
        >
          <div
            className={`w-full max-w-[180px] shrink-0 ${
              fill ? "h-full min-h-[120px]" : "h-[180px]"
            }`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <defs>
                  <filter
                    id="overviewGlow"
                    x="-30%"
                    y="-30%"
                    width="160%"
                    height="160%"
                  >
                    <feGaussianBlur stdDeviation="3.5" result="b" />
                    <feMerge>
                      <feMergeNode in="b" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="58%"
                  outerRadius="92%"
                  paddingAngle={1}
                  stroke="none"
                  filter="url(#overviewGlow)"
                  isAnimationActive={false}
                >
                  {slices.map((s) => (
                    <Cell key={s.id} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) =>
                    formatMoney(Number(v), baseCurrency, privacy)
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <ul className="w-full min-w-0 flex-1 space-y-1.5 self-center overflow-y-auto text-sm">
            {slices.slice(0, fill ? 8 : 6).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: s.color }}
                  />
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-muted">
                  {formatMoney(s.value, baseCurrency, privacy)}{" "}
                  <span className="text-foreground">{s.pct.toFixed(0)}%</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const tooltipStyle = {
  background: "var(--panel)",
  border: "1px solid #2c2c30",
  borderRadius: 0,
  color: "var(--text)",
} as const;
