"use client";

import { useMemo } from "react";
import { Printer } from "lucide-react";
import { convertToBase } from "@/lib/fx";
import { allocation, currentNetWorth } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { CATEGORY_LABELS } from "@/lib/types";
import { OWNER_NAME, formatCurrency } from "@/lib/utils";

// A plain net worth statement, the kind a broker or lender asks for. Printing
// this page to PDF is the export: a real PDF with no PDF library shipped to the
// browser. Amounts are always shown in full here, bare mode included, because a
// statement with the numbers hidden is not a statement.
export default function StatementPage() {
  const assets = useStore((s) => s.assets);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const snapshots = useStore((s) => s.snapshots);
  const hydrated = useStore((s) => s._hydrated);

  const netWorth = useMemo(() => currentNetWorth(assets, fx), [assets, fx]);
  const alloc = useMemo(() => allocation(assets, fx), [assets, fx]);
  const sorted = useMemo(
    () =>
      [...assets]
        .map((a) => ({
          ...a,
          baseValue: convertToBase(a.amount, a.currency, fx),
        }))
        .sort((a, b) => b.baseValue - a.baseValue),
    [assets, fx]
  );

  const asOf = new Date().toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const firstSnapshot = snapshots.length > 0 ? snapshots[0].date.slice(0, 10) : null;

  // The store hydrates from Supabase on the client, so the first paint has no
  // data. Rendering an empty statement would read as a net worth of zero.
  if (!hydrated) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-16 text-center text-sm text-muted">
        Loading your figures…
      </main>
    );
  }

  return (
    <main className="statement mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Statement of Net Worth</h1>
          <p className="mt-1 text-sm text-muted">
            {OWNER_NAME} · as at {asOf}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="input no-print flex w-auto items-center gap-1.5 px-3 text-sm"
        >
          <Printer size={14} />
          Print / save as PDF
        </button>
      </div>

      <section className="mb-6 rounded-xl border border-border p-4">
        <div className="text-xs uppercase tracking-wide text-muted">
          Total net worth
        </div>
        <div className="mt-1 text-3xl font-semibold tabular-nums">
          {formatCurrency(netWorth, baseCurrency)}
        </div>
        <p className="mt-1 text-xs text-muted">
          All values converted to {baseCurrency} at rates
          {fx.fetchedAt
            ? ` retrieved ${new Date(fx.fetchedAt).toLocaleString()}`
            : " last held locally"}
          .
        </p>
      </section>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
        Assets by category
      </h2>
      <table className="mb-6 w-full text-sm">
        <tbody>
          {alloc.map((s) => (
            <tr key={s.category} className="border-b border-border">
              <td className="py-2">{s.label}</td>
              <td className="py-2 text-right tabular-nums text-muted">
                {s.pct.toFixed(1)}%
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatCurrency(s.value, baseCurrency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
        Holdings
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="py-2 font-medium">Account</th>
            <th className="py-2 font-medium">Category</th>
            <th className="py-2 text-right font-medium">Held</th>
            <th className="py-2 text-right font-medium">Value ({baseCurrency})</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => (
            <tr key={a.id} className="border-b border-border">
              <td className="py-2">{a.name}</td>
              <td className="py-2 text-muted">{CATEGORY_LABELS[a.category]}</td>
              <td className="py-2 text-right tabular-nums text-muted">
                {formatCurrency(a.amount, a.currency)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatCurrency(a.baseValue, baseCurrency)}
              </td>
            </tr>
          ))}
          <tr>
            <td className="py-2 font-semibold" colSpan={3}>
              Total
            </td>
            <td className="py-2 text-right font-semibold tabular-nums">
              {formatCurrency(netWorth, baseCurrency)}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-8 text-xs leading-relaxed text-muted">
        Self-prepared from records held in Net Worth Tracker
        {firstSnapshot ? `, with daily history from ${firstSnapshot}` : ""}. Values
        are unaudited and reflect balances and market prices at the time of
        printing.
      </p>
    </main>
  );
}
