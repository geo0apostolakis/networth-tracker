"use client";

import { Download, FileText } from "lucide-react";
import {
  accountsCsv,
  downloadFile,
  fullJson,
  snapshotsCsv,
  stamp,
  transactionsCsv,
  type ExportInput,
} from "@/lib/exporters";
import { useStore } from "@/lib/store";

export default function ExportCard() {
  const assets = useStore((s) => s.assets);
  const snapshots = useStore((s) => s.snapshots);
  const transactions = useStore((s) => s.transactions);
  const txnCategories = useStore((s) => s.txnCategories);
  const milestones = useStore((s) => s.milestones);
  const annotations = useStore((s) => s.annotations);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const fx = useStore((s) => s.fx);

  const input: ExportInput = {
    assets,
    snapshots,
    transactions,
    txnCategories,
    milestones,
    annotations,
    baseCurrency,
    fx,
  };

  const csvFiles: { label: string; file: string; build: () => string }[] = [
    { label: "Snapshots", file: "snapshots", build: () => snapshotsCsv(input) },
    { label: "Accounts", file: "accounts", build: () => accountsCsv(input) },
    {
      label: "Transactions",
      file: "transactions",
      build: () => transactionsCsv(input),
    },
  ];

  return (
    <section className="card p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Download size={16} className="text-blue-400" />
        Export your data
      </h2>
      <p className="mb-3 mt-1 text-xs text-muted">
        Everything the app holds, in formats you can open anywhere. Nothing here
        is locked in.
      </p>

      <div className="flex flex-wrap gap-2">
        {csvFiles.map((f) => (
          <button
            key={f.file}
            onClick={() =>
              downloadFile(
                `networth-${f.file}-${stamp()}.csv`,
                f.build(),
                "text/csv"
              )
            }
            className="input w-auto px-3 text-sm"
          >
            {f.label} CSV
          </button>
        ))}
        <button
          onClick={() =>
            downloadFile(
              `networth-full-${stamp()}.json`,
              fullJson(input),
              "application/json"
            )
          }
          className="input w-auto px-3 text-sm"
        >
          Everything JSON
        </button>
        <a
          href="/statement"
          target="_blank"
          rel="noreferrer"
          className="input flex w-auto items-center gap-1.5 px-3 text-sm text-emerald-400"
        >
          <FileText size={14} />
          Net worth statement
        </a>
      </div>
      <p className="mt-2 text-xs text-muted">
        The statement opens as a printable page. Print to PDF for anything a
        broker or lender asks for.
      </p>
    </section>
  );
}
