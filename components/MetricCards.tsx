"use client";

import { useMemo } from "react";
import RollingNumber from "@/components/RollingNumber";
import type { ResolvedRange } from "@/lib/dateRange";
import { savingsRate } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { formatMoney, formatPct } from "@/lib/utils";

// The four headline figures, in the order the dashboard reads: what you have,
// what came in, what went out, and what is left. All three flow figures cover
// the window picked under the net worth chart, so the whole page reads one span.
export default function MetricCards({
  netWorth,
  currency,
  range,
  change,
}: {
  netWorth: number;
  currency: string;
  range: ResolvedRange;
  // Return over the same window, as the chart already computes it.
  change: { pct: number | null; delta: number };
}) {
  const transactions = useStore((s) => s.transactions);
  const fx = useStore((s) => s.fx);
  const privacy = useStore((s) => s.privacy);

  const flows = useMemo(
    () => savingsRate(transactions, fx, range),
    [transactions, fx, range]
  );
  const window = range.label.toLowerCase();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        label="Net worth"
        note={
          change.pct === null ? window : `${formatPct(change.pct)} · ${window}`
        }
        tone={change.delta >= 0 ? "up" : "down"}
      >
        <RollingNumber
          value={netWorth}
          currency={currency}
          className="text-2xl font-semibold"
          style={{ textShadow: "0 0 22px var(--glow)" }}
        />
      </Stat>

      <Stat label="Income" note={window} tone="up">
        <span className="text-2xl font-semibold text-emerald-400">
          {formatMoney(flows.income, currency, privacy)}
        </span>
      </Stat>

      <Stat label="Expenses" note={window} tone="down">
        <span className="text-2xl font-semibold text-rose-400">
          {formatMoney(flows.expense, currency, privacy)}
        </span>
      </Stat>

      <Stat
        label="Net"
        note={flows.hasIncome ? `${flows.pct.toFixed(0)}% kept` : window}
        tone={flows.saved >= 0 ? "up" : "down"}
      >
        <span
          className={`text-2xl font-semibold ${
            flows.saved >= 0 ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {formatMoney(flows.saved, currency, privacy)}
        </span>
      </Stat>
    </div>
  );
}

function Stat({
  label,
  note,
  tone,
  children,
}: {
  label: string;
  note?: string;
  tone: "up" | "down";
  children: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted">
        {label}
      </div>
      {children}
      {note && (
        <div
          className={`mt-1 text-xs ${
            tone === "up" ? "text-emerald-400/80" : "text-rose-400/80"
          }`}
        >
          {note}
        </div>
      )}
    </div>
  );
}
