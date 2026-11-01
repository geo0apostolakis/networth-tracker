"use client";

import { useMemo } from "react";
import { Gauge } from "lucide-react";
import { earningsRate } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { formatMoney, formatRate } from "@/lib/utils";

// Income broken down to a per-second trickle. The point is not precision, it is
// making a lumpy freelance income legible as a rate.
export default function EarningsRateCard() {
  const transactions = useStore((s) => s.transactions);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const privacy = useStore((s) => s.privacy);

  const rate = useMemo(() => earningsRate(transactions, fx), [transactions, fx]);

  if (!rate.hasData) {
    return (
      <section className="card p-4">
        <Title />
        <p className="py-6 text-center text-sm text-muted">
          Log some income and this fills in.
        </p>
      </section>
    );
  }

  const tiles: { label: string; value: number }[] = [
    { label: "Per second", value: rate.perSecond },
    { label: "Per minute", value: rate.perMinute },
    { label: "Per hour", value: rate.perHour },
    { label: "Per day", value: rate.perDay },
    { label: "Per year", value: rate.perYear },
  ];

  return (
    <section className="card p-4">
      <Title />

      <div className="mb-1 mt-3 text-xs uppercase tracking-wide text-muted">
        Income to date
      </div>
      <div className="text-2xl font-semibold tabular-nums">
        {formatMoney(rate.total, baseCurrency, privacy)}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-border bg-surface-2 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted">
              {t.label}
            </div>
            <div className="mt-1 truncate text-sm font-medium tabular-nums">
              {formatRate(t.value, baseCurrency, privacy)}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted">
        Based on {formatMoney(rate.total, baseCurrency, privacy)} received over
        the last {rate.days} {rate.days === 1 ? "day" : "days"} (all the income
        history there is so far). This is a trailing average, not a forecast.
        Lumpy income moves it as new payments land.
      </p>
    </section>
  );
}

function Title() {
  return (
    <h2 className="flex items-center gap-2 font-semibold">
      <Gauge size={16} className="text-cyan-400" />
      Earnings rate
    </h2>
  );
}
