"use client";

import { useMemo, useRef, useState } from "react";
import DateRangePicker from "@/components/DateRangePicker";
import EditTransactionDialog from "@/components/EditTransactionDialog";
import { CardHeader, GroupHeading } from "@/components/ui/Headings";
import {
  DEFAULT_RANGE,
  filterByRange,
  resolveRange,
  type DateRange,
} from "@/lib/dateRange";
import { convertToBase } from "@/lib/fx";
import { useStore } from "@/lib/store";
import { type TransactionType } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

type Filter = "all" | TransactionType;

const LONGPRESS_MS = 500;

export default function TransactionsSection() {
  const transactions = useStore((s) => s.transactions);
  const txnCategories = useStore((s) => s.txnCategories);
  const assets = useStore((s) => s.assets);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const removeTransactions = useStore((s) => s.removeTransactions);
  const privacy = useStore((s) => s.privacy);

  const [filter, setFilter] = useState<Filter>("all");
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const pressTimer = useRef<number | null>(null);
  const longFired = useRef(false);

  const catById = useMemo(
    () => new Map(txnCategories.map((c) => [c.id, c])),
    [txnCategories]
  );
  const assetName = (id: string) =>
    assets.find((a) => a.id === id)?.name ?? "deleted balance";

  // The summary totals read from the same range-scoped set as the list below,
  // so the headline figures always describe exactly what is on screen.
  const scoped = useMemo(
    // Copied before sorting: an unbounded range hands back the store's own array.
    () => [...filterByRange(transactions, resolveRange(range))].sort((a, b) => b.date.localeCompare(a.date)),
    [transactions, range]
  );

  const { income, expense } = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of scoped) {
      if (t.transfer) continue;
      const base = convertToBase(t.amount, t.currency, fx);
      if (t.type === "earned") income += base;
      else expense += base;
    }
    return { income, expense };
  }, [scoped, fx]);

  const list = useMemo(
    () => scoped.filter((t) => filter === "all" || t.type === filter),
    [scoped, filter]
  );

  // --- selection helpers ---
  function startPress(id: string) {
    longFired.current = false;
    pressTimer.current = window.setTimeout(() => {
      longFired.current = true;
      setSelecting(true);
      setSelected(new Set([id]));
      navigator.vibrate?.(15);
    }, LONGPRESS_MS);
  }
  function cancelPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function onRowClick(id: string) {
    if (longFired.current) {
      longFired.current = false;
      return; // the long-press already handled this press
    }
    if (selecting) toggle(id);
    else setEditing(id);
  }
  function exitSelect() {
    setSelecting(false);
    setSelected(new Set());
  }
  function deleteSelected() {
    if (selected.size === 0) return exitSelect();
    if (
      window.confirm(
        `Delete ${selected.size} transaction${selected.size > 1 ? "s" : ""}? This can't be undone.`
      )
    ) {
      removeTransactions([...selected]);
      exitSelect();
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <GroupHeading
          title="Summary"
          subtitle="Totals for the range you have picked"
        />
        <div className="card mb-4 p-3">
          <DateRangePicker value={range} onChange={setRange} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Summary label="Income" value={income} currency={baseCurrency} tone="up" hidden={privacy} />
          <Summary label="Expenses" value={expense} currency={baseCurrency} tone="down" hidden={privacy} />
          <Summary
            label="Net"
            value={income - expense}
            currency={baseCurrency}
            tone={income - expense >= 0 ? "up" : "down"}
            hidden={privacy}
          />
        </div>
      </section>

      <section>
        <GroupHeading
          title="History"
          subtitle="Every transaction logged in this range"
        />
        <div className="card p-4">
          {selecting ? (
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{selected.size} selected</span>
              <div className="flex items-center gap-3 text-sm">
                <button
                  onClick={() => setSelected(new Set(list.map((t) => t.id)))}
                  className="text-muted hover:text-foreground"
                >
                  Select all
                </button>
                <button
                  onClick={exitSelect}
                  className="text-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteSelected}
                  disabled={selected.size === 0}
                  className="font-medium text-rose-400 hover:text-rose-300 disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <>
              <CardHeader
                title="All transactions"
                subtitle="Track all your income and expenses"
                action={
                  list.length > 0 && (
                    <button
                      onClick={() => setSelecting(true)}
                      className="input w-auto px-2.5 py-1 text-xs text-muted hover:text-foreground"
                    >
                      Select
                    </button>
                  )
                }
              />
              <div className="mb-3 flex w-fit gap-1 rounded-lg bg-surface-2 p-1 text-xs">
                {(["all", "earned", "spent"] as Filter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                      filter === f
                        ? "bg-surface text-foreground"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {f === "all" ? "All" : f === "earned" ? "Income" : "Expense"}
                  </button>
                ))}
              </div>
            </>
          )}

          {selecting && (
            <p className="mb-2 text-xs text-muted">
              Tap rows to select · or long-press any row to start. Rows imported
              from Revolut are skipped: the next sync would bring them back.
            </p>
          )}

          {list.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">
              {transactions.length === 0
                ? "No transactions yet. Use “+ Add transaction” to log income or spend."
                : "Nothing matches this range and filter."}
            </p>
          ) : (
            <>
            {/* Six columns do not survive a phone, so the table starts at md
                and the stacked rows below carry the same data and the same
                long-press selection. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Description</th>
                    <th className="py-2 pr-3 font-medium">Category</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pl-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.map((t) => {
                    const cat = t.categoryId
                      ? catById.get(t.categoryId)
                      : undefined;
                    const up = t.type === "earned";
                    const isSel = selected.has(t.id);
                    return (
                      <tr
                        key={t.id}
                        onPointerDown={() => startPress(t.id)}
                        onPointerUp={cancelPress}
                        onPointerLeave={cancelPress}
                        onPointerCancel={cancelPress}
                        onClick={() => onRowClick(t.id)}
                        onContextMenu={(e) => e.preventDefault()}
                        className={`select-none transition-colors ${
                          selecting ? "cursor-pointer" : ""
                        } ${isSel ? "bg-rose-500/10" : "hover:bg-white/3"}`}
                      >
                        <td className="whitespace-nowrap py-2.5 pr-3 text-muted">
                          <span className="flex items-center gap-2">
                            {selecting && (
                              <span
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                                  isSel
                                    ? "border-rose-400 bg-rose-400 text-white"
                                    : "border-border text-transparent"
                                }`}
                              >
                                ✓
                              </span>
                            )}
                            {new Date(t.date).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="max-w-[18rem] truncate py-2.5 pr-3">
                          {t.note || assetName(t.assetId)}
                          {t.source && t.source !== "manual" && (
                            <span className="ml-2 bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                              {t.source === "solcard" ? "Solcard" : t.source === "bitrefill" ? "Bitrefill" : "Revolut"}
                            </span>
                          )}
                          {t.transfer && (
                            <span className="ml-1 bg-surface-2 px-1.5 py-0.5 text-[10px] text-cyan-400">
                              transfer
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className="flex items-center gap-2">
                            <span
                              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ background: cat?.color ?? "#64748b" }}
                            />
                            <span className="truncate">
                              {cat?.name ?? "Uncategorized"}
                            </span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-muted">
                          {t.transfer ? "Transfer" : up ? "Income" : "Expense"}
                        </td>
                        <td
                          className={`whitespace-nowrap py-2.5 pl-3 text-right font-medium tabular-nums ${
                            up ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {up ? "+" : "−"}
                          {formatMoney(t.amount, t.currency, privacy)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-border md:hidden">
              {list.map((t) => {
                const cat = t.categoryId ? catById.get(t.categoryId) : undefined;
                const up = t.type === "earned";
                const isSel = selected.has(t.id);
                return (
                  <li
                    key={t.id}
                    onPointerDown={() => startPress(t.id)}
                    onPointerUp={cancelPress}
                    onPointerLeave={cancelPress}
                    onPointerCancel={cancelPress}
                    onClick={() => onRowClick(t.id)}
                    onContextMenu={(e) => e.preventDefault()}
                    className={`flex select-none items-center justify-between gap-3 rounded-lg py-2.5 transition-colors ${
                      selecting ? "cursor-pointer px-2" : ""
                    } ${isSel ? "bg-rose-500/10" : ""}`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {selecting && (
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                            isSel
                              ? "border-rose-400 bg-rose-400 text-white"
                              : "border-border text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      )}
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: cat?.color ?? "#64748b" }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium">
                            {cat?.name ?? "Uncategorized"}
                          </span>
                          <span className="truncate text-xs text-muted">
                            {assetName(t.assetId)}
                          </span>
                        </div>
                        <div className="text-xs text-muted">
                          {new Date(t.date).toLocaleDateString()}
                          {t.note ? ` · ${t.note}` : ""}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-medium ${
                        up ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {up ? "+" : "−"}
                      {formatMoney(t.amount, t.currency, privacy)}
                    </span>
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </div>
      </section>
      {editing && <EditTransactionDialog id={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Summary({
  label,
  value,
  currency,
  tone,
  hidden,
}: {
  label: string;
  value: number;
  currency: string;
  tone: "up" | "down";
  hidden: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted">
        {label}
      </div>
      <div
        className={`text-2xl font-semibold ${
          tone === "up" ? "text-emerald-400" : "text-rose-400"
        }`}
      >
        {formatMoney(value, currency, hidden)}
      </div>
    </div>
  );
}
