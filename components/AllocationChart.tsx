"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { AllocationSlice } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { CATEGORY_COLORS } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

export default function AllocationChart({
  data,
  currency,
  fill = false,
}: {
  data: AllocationSlice[];
  currency: string;
  fill?: boolean;
}) {
  const privacy = useStore((s) => s.privacy);
  if (data.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-sm text-muted ${
          fill ? "h-full" : "h-[260px]"
        }`}
      >
        Add assets to see your allocation.
      </div>
    );
  }
  return (
    // Stacked until there is real width to put the legend beside the donut.
    // Side by side in a narrow column is what made the labels collide with the
    // amounts, so the legend only moves across at lg.
    <div
      className={`flex flex-col items-center gap-3 lg:flex-row ${
        fill ? "h-full min-h-0" : ""
      }`}
    >
      <div
        className={`w-full max-w-[180px] shrink-0 ${fill ? "h-full min-h-[120px]" : "h-[170px]"}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              <filter id="sliceGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="4" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              startAngle={90}
              endAngle={-270}
              innerRadius="58%"
              outerRadius="92%"
              paddingAngle={1}
              stroke="none"
              filter="url(#sliceGlow)"
              isAnimationActive={false}
            >
              {data.map((s) => (
                <Cell key={s.category} fill={CATEGORY_COLORS[s.category]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--panel)",
                border: "1px solid #2c2c30",
                borderRadius: 0,
                color: "var(--text)",
              }}
              formatter={(v) => formatMoney(Number(v), currency, privacy)}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-1.5 self-center overflow-y-auto text-sm">
        {data.map((s) => (
          <li
            key={s.category}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: CATEGORY_COLORS[s.category] }}
              />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="shrink-0 whitespace-nowrap text-muted">
              {formatMoney(s.value, currency, privacy)}{" "}
              <span className="text-foreground">{s.pct.toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
