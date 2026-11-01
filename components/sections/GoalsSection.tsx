"use client";

import { useMemo } from "react";
import BenchmarkCard from "@/components/BenchmarkCard";
import EarningsRateCard from "@/components/EarningsRateCard";
import GoalsCard from "@/components/GoalsCard";
import { currentNetWorth } from "@/lib/metrics";
import { useStore } from "@/lib/store";

export default function GoalsSection() {
  const assets = useStore((s) => s.assets);
  const fx = useStore((s) => s.fx);

  const netWorth = useMemo(() => currentNetWorth(assets, fx), [assets, fx]);

  return (
    <div className="grid grid-cols-1 gap-3 lg:h-full lg:grid-rows-[auto_1fr] lg:overflow-y-auto xl:grid-cols-2">
      <GoalsCard netWorth={netWorth} />
      <EarningsRateCard />
      <div className="xl:col-span-2">
        <BenchmarkCard />
      </div>
    </div>
  );
}
