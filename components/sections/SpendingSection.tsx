"use client";

import { useId, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import DateRangePicker from "@/components/DateRangePicker";
import { CardHeader, GroupHeading } from "@/components/ui/Headings";
import { DEFAULT_RANGE, resolveRange, type DateRange } from "@/lib/dateRange";
import { categorySlices, type CategorySlice } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { type TransactionType } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

export default function SpendingSection() {
  const transactions = useStore((s) => s.transactions);
  const txnCategories = useStore((s) => s.txnCategories);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const renameTxnCategory = useStore((s) => s.renameTxnCategory);
  const removeTxnCategory = useStore((s) => s.removeTxnCategory);
  const privacy = useStore((s) => s.privacy);

  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);

  // Every figure below is scoped to the active range, charts and totals alike,
  // so the breakdown can never describe a different window than the picker says.
  const build = useMemo(() => {
    const r = resolveRange(range);
    return {
      expenses: categorySlices(transactions, txnCategories, fx, "spent", r),
      income: categorySlices(transactions, txnCategories, fx, "earned", r),
    };
  }, [transactions, txnCategories, fx, range]);

  const hasData = build.expenses.length > 0 || build.income.length > 0;

  return (
    <div className="space-y-8">
      <section>
        <GroupHeading
          title="Breakdown"
          subtitle="Where the money goes, and where it comes from"
        />
        <div className="card mb-4 p-3">
          <DateRangePicker value={range} onChange={setRange} />
        </div>

        {!hasData ? (
          <div className="card p-10 text-center text-sm text-muted">
            {transactions.length === 0
              ? "No transactions yet. Log some income and spending to see where your money goes."
              : "Nothing logged in this range. Try a wider one."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Breakdown
              title="Where money goes"
              subtitle="Expenses by type"
              data={build.expenses}
              currency={baseCurrency}
              hidden={privacy}
            />
            <Breakdown
              title="Where money comes from"
              subtitle="Income by source"
              data={build.income}
              currency={baseCurrency}
              hidden={privacy}
            />
          </div>
        )}
      </section>

      <section>
        <GroupHeading
          title="Categories"
          subtitle="The labels every transaction is filed under"
        />
        <CategoryManager
          categories={txnCategories}
          onRename={renameTxnCategory}
          onRemove={removeTxnCategory}
        />
      </section>
    </div>
  );
}

function Breakdown({
  title,
  subtitle,
  data,
  currency,
  hidden,
}: {
  title: string;
  subtitle: string;
  data: CategorySlice[];
  currency: string;
  hidden: boolean;
}) {
  // Both breakdown cards render at once, so a hardcoded filter id would put two
  // elements with the same id in the document and url(#…) would resolve to
  // whichever came first. useId's own value carries punctuation that is not
  // valid in a bare url(#…) reference, so it is stripped down to a safe id
  // here rather than escaped (CSS.escape does not exist during SSR).
  const glowId = `spendGlow${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  if (data.length === 0) {
    return (
      <section className="card p-4">
        <CardHeader title={title} subtitle={subtitle} />
        <p className="py-8 text-center text-sm text-muted">Nothing logged yet.</p>
      </section>
    );
  }
  return (
    <section className="card p-4">
      <CardHeader title={title} subtitle={subtitle} />

      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="h-[200px] w-[200px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <defs>
                <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="3.5" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={52}
                outerRadius={88}
                paddingAngle={1}
                stroke="none"
                filter={`url(#${glowId})`}
                isAnimationActive={false}
              >
                {data.map((s) => (
                  <Cell key={s.id} fill={s.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => formatMoney(Number(v), currency, hidden)}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <ul className="flex-1 space-y-1.5 self-stretch text-sm">
          {data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-sm"
                  style={{ background: s.color }}
                />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="shrink-0 text-muted">
                {formatMoney(s.value, currency, hidden)}{" "}
                <span className="text-foreground">{s.pct.toFixed(0)}%</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={96}
              tick={{ fontSize: 11, fill: "var(--faint)" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(148,163,184,0.08)" }}
              contentStyle={tooltipStyle}
              formatter={(v) => formatMoney(Number(v), currency, hidden)}
            />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} isAnimationActive={false}>
              {data.map((s) => (
                <Cell key={s.id} fill={s.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function CategoryManager({
  categories,
  onRename,
  onRemove,
}: {
  categories: { id: string; name: string; kind: TransactionType; color: string }[];
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const income = categories.filter((c) => c.kind === "earned");
  const expense = categories.filter((c) => c.kind === "spent");
  return (
    <div className="card p-4">
      <CardHeader
        title="Manage categories"
        subtitle="Rename or delete. Add new ones from the “+ Add transaction” dialog."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Column label="Income sources" cats={income} onRename={onRename} onRemove={onRemove} />
        <Column label="Expense types" cats={expense} onRename={onRename} onRemove={onRemove} />
      </div>
    </div>
  );
}

function Column({
  label,
  cats,
  onRename,
  onRemove,
}: {
  label: string;
  cats: { id: string; name: string; color: string }[];
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wide text-muted">{label}</div>
      <ul className="space-y-1.5">
        {cats.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-sm"
              style={{ background: c.color }}
            />
            <input
              defaultValue={c.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== c.name) onRename(c.id, v);
              }}
              className="input py-1 text-sm"
            />
            <button
              onClick={() => onRemove(c.id)}
              title="Delete category"
              className="shrink-0 text-muted hover:text-rose-400"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const tooltipStyle = {
  background: "var(--panel)",
  border: "1px solid #2c2c30",
  borderRadius: 0,
  color: "var(--text)",
} as const;
