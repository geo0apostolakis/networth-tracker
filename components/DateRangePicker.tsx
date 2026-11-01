"use client";

import { CalendarRange } from "lucide-react";
import { Select } from "@/components/ui/Select";
import {
  PRESET_LABELS,
  PRESET_ORDER,
  describeRange,
  resolveRange,
  type DateRange,
} from "@/lib/dateRange";

// One picker, shared by Spending and Transactions, so "this month" can never
// mean two different things in two places.
export default function DateRangePicker({
  value,
  onChange,
  className,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  className?: string;
}) {
  const options = [...PRESET_ORDER, "custom" as const].map((p) => ({
    value: p,
    label: PRESET_LABELS[p],
  }));

  const resolved = resolveRange(value);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <CalendarRange size={15} className="shrink-0 text-muted" />
      <Select
        value={value.preset}
        onChange={(p) =>
          onChange(
            p === "custom"
              ? { preset: "custom", start: value.start, end: value.end }
              : { preset: p as DateRange["preset"] }
          )
        }
        options={options}
        ariaLabel="Date range"
        className="w-36"
      />

      {value.preset === "custom" && (
        <>
          <input
            type="date"
            value={value.start ?? ""}
            max={value.end || undefined}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
            aria-label="Range start"
            className="input w-auto text-sm"
          />
          <span className="text-xs text-muted">to</span>
          <input
            type="date"
            value={value.end ?? ""}
            min={value.start || undefined}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
            aria-label="Range end"
            className="input w-auto text-sm"
          />
        </>
      )}

      <span className="text-xs text-muted">{describeRange(resolved)}</span>
    </div>
  );
}
