// Full data export. Everything the app knows lives in the store, so these are
// pure functions over it: no server round trip, nothing that can be withheld.

import { convertToBase } from "./fx";
import type {
  Annotation,
  Asset,
  FxState,
  Milestone,
  Snapshot,
  Transaction,
  TxnCategory,
} from "./types";

export interface ExportInput {
  assets: Asset[];
  snapshots: Snapshot[];
  transactions: Transaction[];
  txnCategories: TxnCategory[];
  milestones: Milestone[];
  annotations: Annotation[];
  baseCurrency: string;
  fx: FxState;
}

// RFC 4180: quote every field, double any embedded quote. Cheaper to always
// quote than to guess which values contain separators.
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function csv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function accountsCsv(input: ExportInput): string {
  return csv(
    ["id", "name", "category", "currency", "amount", "value_in_base", "base_currency", "source", "updated_at"],
    input.assets.map((a) => [
      a.id,
      a.name,
      a.category,
      a.currency,
      a.amount,
      convertToBase(a.amount, a.currency, input.fx).toFixed(2),
      input.baseCurrency,
      a.source,
      a.updatedAt,
    ])
  );
}

export function transactionsCsv(input: ExportInput): string {
  const catName = new Map(input.txnCategories.map((c) => [c.id, c.name]));
  const assetName = new Map(input.assets.map((a) => [a.id, a.name]));
  return csv(
    ["id", "date", "type", "category", "account", "amount", "currency", "amount_in_base", "base_currency", "note"],
    input.transactions.map((t) => [
      t.id,
      t.date,
      t.transfer ? "transfer" : t.type === "earned" ? "income" : "expense",
      t.categoryId ? (catName.get(t.categoryId) ?? "Uncategorized") : "Uncategorized",
      assetName.get(t.assetId) ?? "deleted balance",
      t.amount,
      t.currency,
      convertToBase(t.amount, t.currency, input.fx).toFixed(2),
      input.baseCurrency,
      t.note ?? "",
    ])
  );
}

export function snapshotsCsv(input: ExportInput): string {
  return csv(
    ["date", "base_currency", "total_net_worth", "cash", "bank", "stocks", "crypto", "other"],
    [...input.snapshots]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => [
        s.date.slice(0, 10),
        s.baseCurrency,
        s.totalNetWorth.toFixed(2),
        s.byCategory.cash?.toFixed(2) ?? "0.00",
        s.byCategory.bank?.toFixed(2) ?? "0.00",
        s.byCategory.stocks?.toFixed(2) ?? "0.00",
        s.byCategory.crypto?.toFixed(2) ?? "0.00",
        s.byCategory.other?.toFixed(2) ?? "0.00",
      ])
  );
}

// One file with everything, including the FX rates the values were converted
// with, so the export can be re-read without this app.
export function fullJson(input: ExportInput): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      schema: "networth-tracker/v1",
      baseCurrency: input.baseCurrency,
      fx: input.fx,
      accounts: input.assets,
      transactions: input.transactions,
      transactionCategories: input.txnCategories,
      snapshots: input.snapshots,
      milestones: input.milestones,
      annotations: input.annotations,
    },
    null,
    2
  );
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}
