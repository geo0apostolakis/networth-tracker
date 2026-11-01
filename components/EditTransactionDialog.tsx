"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Select } from "@/components/ui/Select";
import { useStore } from "@/lib/store";
import type { TransactionType } from "@/lib/types";

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Edit any transaction. Hand-entered ones change in place (and move their
// balance by the difference); imported ones (Revolut, Solcard) keep the edit
// on the side so the next sync cannot undo it, and can be hidden but not deleted.
// Categories on imported entries are first guessed from the merchant name
// (lib/categorize.ts); anything set here wins over the guess.
export default function EditTransactionDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useStore((s) => s.transactions.find((x) => x.id === id));
  const assets = useStore((s) => s.assets);
  const txnCategories = useStore((s) => s.txnCategories);
  const editTransaction = useStore((s) => s.editTransaction);
  const addTxnCategory = useStore((s) => s.addTxnCategory);

  const [type, setType] = useState<TransactionType>(t?.type ?? "spent");
  const [amount, setAmount] = useState(String(t?.amount ?? ""));
  const [categoryId, setCategoryId] = useState(t?.categoryId ?? "");
  const [note, setNote] = useState(t?.note ?? "");
  const [date, setDate] = useState(t ? toLocalInput(t.date) : "");
  const [assetId, setAssetId] = useState(t?.assetId ?? "");
  const [newCat, setNewCat] = useState("");
  const [transfer, setTransfer] = useState(!!t?.transfer);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cats = useMemo(() => txnCategories.filter((c) => c.kind === type), [txnCategories, type]);
  const imported = t?.source === "revolut" || t?.source === "solcard" || t?.source === "bitrefill";
  const targets = assets.filter((a) => a.source === "manual" || a.source === "solcard");
  if (!t) return null;

  function save() {
    let cat = categoryId;
    if (newCat.trim()) cat = addTxnCategory(newCat.trim(), type);
    const amt = parseFloat(amount.replace(",", "."));
    editTransaction(id, {
      type,
      amount: isNaN(amt) ? undefined : amt,
      categoryId: cat,
      note,
      date: date ? new Date(date).toISOString() : undefined,
      ...(transfer !== !!t?.transfer ? { transfer } : {}),
      ...(!imported && assetId !== t?.assetId ? { assetId } : {}),
    });
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="modal-card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="pane-h mb-4">
          <span className="acc">{"✎"}</span>
          <span className="t">{"edit transaction"}</span>
          <span className="rule" />
          <span className="meta">{t.source === "manual" || !t.source ? "hand-entered" : `imported · ${t.source}`}</span>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex gap-2">
            {(["spent", "earned"] as TransactionType[]).map((k) => (
              <button key={k} className={`btn flex-1 ${type === k ? (k === "spent" ? "acc" : "pri") : ""}`} onClick={() => setType(k)} disabled={transfer}>
                {k === "spent" ? "− expense" : "+ income"}
              </button>
            ))}
          </div>
          <label className="flex items-start gap-2 text-xs text-muted">
            <input type="checkbox" className="mt-0.5" checked={transfer} onChange={(e) => setTransfer(e.target.checked)} />
            <span>{"just moving my own money (between my accounts, or into crypto), so not income or spending"}</span>
          </label>

          <label className="block">
            <span className="text-xs text-muted">{`amount (${t.currency})`}</span>
            <input className="input mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>

          <label className="block">
            <span className="text-xs text-muted">{"what was it"}</span>
            <input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Spotify, groceries at Lidl" />
          </label>

          {!transfer && (
            <div>
              <span className="text-xs text-muted">{"category"}</span>
              <div className="mt-1 flex gap-2">
                <Select
                  value={categoryId}
                  onChange={setCategoryId}
                  options={[{ value: "", label: "Uncategorized" }, ...cats.map((c) => ({ value: c.id, label: c.name }))]}
                  ariaLabel="Category"
                  className="flex-1"
                />
                <input className="input w-36" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="or new…" />
              </div>
            </div>
          )}

          <label className="block">
            <span className="text-xs text-muted">{"date"}</span>
            <input className="input mt-1" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          {!imported && (
            <div>
              <span className="text-xs text-muted">{"from / to balance"}</span>
              <Select value={assetId} onChange={setAssetId} options={targets.map((a) => ({ value: a.id, label: a.name }))} ariaLabel="Balance" className="mt-1" />
            </div>
          )}

          {t.txUrl && (
            <a className="block text-xs text-cyan-400 underline" href={t.txUrl} target="_blank" rel="noreferrer">
              {"view on-chain transaction ↗"}
            </a>
          )}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            className="btn ghost err"
            onClick={() => {
              if (window.confirm(imported ? "Hide this imported transaction? It stays hidden after future syncs." : "Delete this transaction? Its balance is moved back.")) {
                editTransaction(id, { hidden: true });
                onClose();
              }
            }}
          >
            {imported ? "hide" : "delete"}
          </button>
          <span className="flex-1" />
          <button className="btn" onClick={onClose}>
            {"cancel"}
          </button>
          <button className="btn pri" onClick={save}>
            {"save"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
