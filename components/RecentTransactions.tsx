"use client";

import { useMemo, useState } from "react";
import EditTransactionDialog from "@/components/EditTransactionDialog";
import { CardHeader } from "@/components/ui/Headings";
import { useStore } from "@/lib/store";
import { formatMoney } from "@/lib/utils";

// The latest entries as a log: one line each, newest first. Clicking a line
// opens it for editing, whatever its source.
export default function RecentTransactions({ onOpen, fill = false }: { onOpen?: () => void; fill?: boolean }) {
  const transactions = useStore((s) => s.transactions);
  const assets = useStore((s) => s.assets);
  const privacy = useStore((s) => s.privacy);
  const [editing, setEditing] = useState<string | null>(null);
  const latest = useMemo(() => [...transactions].sort((a, b) => b.date.localeCompare(a.date)), [transactions]);

  const name = (id: string) => assets.find((a) => a.id === id)?.name ?? "deleted balance";
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

  const header = (
    <CardHeader
      title="tail -f transactions"
      subtitle="click a line to edit"
      action={
        onOpen && (
          <button onClick={onOpen} className="btn ghost">
            {"all →"}
          </button>
        )
      }
    />
  );
  const shell = `card p-4 ${fill ? "flex h-full min-h-0 flex-col" : ""}`;

  if (transactions.length === 0) {
    return (
      <div className={shell}>
        {header}
        <p className="flex flex-1 items-center justify-center py-10 text-center text-sm text-muted">{"nothing logged yet."}</p>
      </div>
    );
  }

  return (
    <div className={shell}>
      {header}
      <div className={`dmesg ${fill ? "min-h-0 flex-1" : ""}`}>
        {latest.slice(0, fill ? 60 : 8).map((t) => {
          const up = t.type === "earned";
          const tone = t.transfer ? "info" : up ? "ok" : "err";
          return (
            <button key={t.id} className="l w-full text-left hover:bg-surface-2" onClick={() => setEditing(t.id)} title="edit">
              <span className="ts">{`[${day(t.date)}] `}</span>
              <span className={tone}>{`${t.transfer ? "⇄" : up ? "+" : "−"}${formatMoney(t.amount, t.currency, privacy)}`}</span>
              <span className="dim">{` ${t.note || name(t.assetId)}`}</span>
              {t.source && t.source !== "manual" && <span className="faint">{` · ${t.source}`}</span>}
            </button>
          );
        })}
      </div>
      {editing && <EditTransactionDialog id={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
