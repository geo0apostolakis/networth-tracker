"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartDate } from "@/components/NetWorthChart";
import type { TrendPoint } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { CATEGORIES, CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/types";
import { formatCurrency, formatMoney } from "@/lib/utils";

export default function CategoryTrendChart({
  data,
  currency,
  fill = false,
}: {
  data: TrendPoint[];
  currency: string;
  // Take the height the parent gives instead of a fixed 260px, which overran
  // its card once the desktop layout started sizing rows to the viewport.
  fill?: boolean;
}) {
  const privacy = useStore((s) => s.privacy);
  // Only the categories that hold money in this window. Drawing all five put a
  // flat line at zero on the chart and an entry in the legend for a category
  // that has never held anything.
  const active = CATEGORIES.filter((c) => data.some((d) => (d[c] as number) > 0));
  if (data.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-sm text-muted ${
          fill ? "h-full" : "h-[260px]"
        }`}
      >
        Save snapshots over time to see each category trend.
      </div>
    );
  }
  return (
    // minHeight, not just height "100%": below xl the card is auto-sized, so the
    // parent measures zero and the lines never draw.
    <ResponsiveContainer
      width="100%"
      height={fill ? "100%" : 260}
      minHeight={fill ? 240 : undefined}
    >
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line-2)" />
        {/* Same formatter as the net worth chart above. Unformatted, these
            were full ISO dates and every label overlapped its neighbour. */}
        <XAxis
          dataKey="date"
          stroke="var(--faint)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
          tickFormatter={chartDate}
        />
        <YAxis
          stroke="var(--faint)"
          fontSize={12}
          tickFormatter={(v) =>
            privacy ? "" : formatCurrency(v, currency, { compact: true })
          }
          width={70}
        />
        <Tooltip
          contentStyle={{
            background: "var(--panel)",
            border: "1px solid #2c2c30",
            borderRadius: 0,
            color: "var(--text)",
          }}
          formatter={(v) => formatMoney(Number(v), currency, privacy)}
          labelFormatter={(v) => new Date(`${String(v)}T00:00:00`).toLocaleDateString()}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {active.map((c) => (
          <Line
            key={c}
            type="monotone"
            dataKey={c}
            name={CATEGORY_LABELS[c]}
            stroke={CATEGORY_COLORS[c]}
            strokeWidth={2.25}
            dot={false}
            filter="url(#lineGlow)"
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
