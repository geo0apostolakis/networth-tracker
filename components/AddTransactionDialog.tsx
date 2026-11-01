"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@/lib/store";
import { type TransactionType, CATEGORY_LABELS } from "@/lib/types";
import { Button } from "@/components/ui/neon-button";
import { LiquidButton } from "@/components/ui/liquid-button";
import { Select } from "@/components/ui/Select";

const NEW = "__new__";

export default function AddTransactionDialog() {
  const assets = useStore((s) => s.assets);
  const addTransaction = useStore((s) => s.addTransaction);
  const txnCategories = useStore((s) => s.txnCategories);
  const addTxnCategory = useStore((s) => s.addTxnCategory);

  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [type, setType] = useState<TransactionType>("earned");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [newCat, setNewCat] = useState("");
  const [note, setNote] = useState("");

  // Cash & bank are the manual balances you move money in and out of.
  const targets = useMemo(
    () =>
      assets.filter(
        (a) => a.source === "manual" && (a.category === "cash" || a.category === "bank")
      ),
    [assets]
  );

  // Categories matching the current direction (income vs expense).
  const cats = useMemo(
    () => txnCategories.filter((c) => c.kind === type),
    [txnCategories, type]
  );

  function chooseType(t: TransactionType) {
    setType(t);
    const first = txnCategories.find((c) => c.kind === t);
    setCategoryId(first?.id ?? "");
    setNewCat("");
  }

  function openDialog() {
    setAssetId(targets[0]?.id ?? "");
    setType("earned");
    setCategoryId(txnCategories.find((c) => c.kind === "earned")?.id ?? "");
    setAmount("");
    setNote("");
    setNewCat("");
    setOpen(true);
  }

  function createCategory() {
    const name = newCat.trim();
    if (!name) return;
    const id = addTxnCategory(name, type);
    setCategoryId(id);
    setNewCat("");
  }

  function submit() {
    const value = parseFloat(amount);
    if (!assetId || isNaN(value) || value <= 0) return;
    addTransaction({
      assetId,
      type,
      amount: value,
      categoryId: categoryId && categoryId !== NEW ? categoryId : undefined,
      note,
    });
    setOpen(false);
  }

  const selected = targets.find((a) => a.id === assetId);
  const isIncome = type === "earned";

  // The trigger lives in the sidebar, which carries a backdrop-filter. That
  // makes it the containing block for fixed-position descendants, so without a
  // portal the modal would be trapped inside the 15rem rail.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  return (
    <>
      <LiquidButton
        onClick={openDialog}
        disabled={targets.length === 0}
        title={
          targets.length === 0
            ? "Add a cash or bank asset first"
            : "Record money in or out of a cash/bank balance"
        }
      >
        + txn
      </LiquidButton>

      {open &&
        mounted &&
        createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="modal-card w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 font-semibold">Add transaction</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => chooseType("earned")}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    isIncome
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                      : "border-border text-muted hover:text-foreground"
                  }`}
                >
                  ↑ Earned (money in)
                </button>
                <button
                  onClick={() => chooseType("spent")}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    !isIncome
                      ? "border-rose-500 bg-rose-500/10 text-rose-400"
                      : "border-border text-muted hover:text-foreground"
                  }`}
                >
                  ↓ Spent (money out)
                </button>
              </div>

              <Field label={isIncome ? "Income source" : "Expense type"}>
                <Select
                  value={categoryId}
                  onChange={setCategoryId}
                  ariaLabel={isIncome ? "Income source" : "Expense type"}
                  options={[
                    ...cats.map((c) => ({ value: c.id, label: c.name })),
                    { value: NEW, label: "＋ New category…" },
                  ]}
                />
                {categoryId === NEW && (
                  <div className="mt-2 flex gap-2">
                    <input
                      autoFocus
                      value={newCat}
                      onChange={(e) => setNewCat(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createCategory()}
                      placeholder={
                        isIncome ? "e.g. Sponsorship" : "e.g. Office rent"
                      }
                      className="input"
                    />
                    <Button
                      variant="solid"
                      size="sm"
                      onClick={createCategory}
                      className="shrink-0 text-sm"
                    >
                      Add
                    </Button>
                  </div>
                )}
              </Field>

              <Field label="Into which balance?">
                <Select
                  value={assetId}
                  onChange={setAssetId}
                  ariaLabel="Into which balance?"
                  options={targets.map((a) => ({
                    value: a.id,
                    label: `${a.name} · ${CATEGORY_LABELS[a.category]} (${a.currency})`,
                  }))}
                />
              </Field>

              <Field label={`Amount${selected ? ` (${selected.currency})` : ""}`}>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="input"
                />
              </Field>

              <Field label="Note (optional)">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. client payment, groceries"
                  className="input"
                />
              </Field>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                className="text-sm text-muted hover:text-foreground"
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                size="sm"
                onClick={submit}
                className="text-sm font-medium"
              >
                Save
              </Button>
            </div>
          </div>
        </div>,
          document.body
        )}
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}
