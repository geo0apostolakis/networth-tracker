"use client";

import { useMemo } from "react";
import AllocationChart from "@/components/AllocationChart";
import AssetTable from "@/components/AssetTable";
import RevolutCard from "@/components/RevolutCard";
import SolcardCard from "@/components/SolcardCard";
import WalletsCard from "@/components/WalletsCard";
import { CardHeader } from "@/components/ui/Headings";
import { allocation } from "@/lib/metrics";
import { useStore } from "@/lib/store";

export default function AssetsSection() {
  const assets = useStore((s) => s.assets);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);

  const alloc = useMemo(() => allocation(assets, fx), [assets, fx]);

  return (
    // Connections sit under the table; the page scrolls as a whole because
    // the connection cards grow with what they hold.
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      <div className="xl:col-span-3">
        <SolcardCard />
      </div>
      <div className="xl:col-span-2">
        <AssetTable />
      </div>

      <div className="card flex flex-col p-4">
        <CardHeader
          title="Allocation"
          subtitle="What the money is sitting in"
        />
        <div className="min-h-[260px] flex-1">
          <AllocationChart data={alloc} currency={baseCurrency} fill />
        </div>
      </div>

      <div className="xl:col-span-2">
        <WalletsCard />
      </div>
      <RevolutCard />
    </div>
  );
}
