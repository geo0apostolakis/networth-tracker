"use client";

import { useState } from "react";
import { convertToBase } from "@/lib/fx";
import { useStore } from "@/lib/store";
import {
  type Asset,
  type Category,
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
} from "@/lib/types";
import { SUPPORTED_CURRENCIES } from "@/lib/utils";
import { Button } from "@/components/ui/neon-button";
import { Select } from "@/components/ui/Select";
import RollingNumber from "@/components/RollingNumber";

// Balances that a sync owns cannot be edited by hand: the next sync would put
// them straight back. Their badge says where they come from instead.
const SOURCE_BADGE: Record<string, string> = {
  freedom24: "Freedom24",
  wallet: "Wallet",
  revolut: "Revolut",
  solcard: "Solcard",
  bitrefill: "Bitrefill",
};

const blank = {
  name: "",
  category: "cash" as Category,
  currency: "EUR",
  amount: "",
  quantity: "",
};

export default function AssetTable() {
  const assets = useStore((s) => s.assets);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const addAsset = useStore((s) => s.addAsset);
  const updateAsset = useStore((s) => s.updateAsset);
  const removeAsset = useStore((s) => s.removeAsset);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(blank);

  function openAdd() {
    setEditing(null);
    setForm({ ...blank, currency: baseCurrency });
    setOpen(true);
  }

  function openEdit(a: Asset) {
    setEditing(a.id);
    setForm({
      name: a.name,
      category: a.category,
      currency: a.currency,
      amount: String(a.amount),
      quantity: a.quantity != null ? String(a.quantity) : "",
    });
    setOpen(true);
  }

  function submit() {
    const amount = parseFloat(form.amount);
    if (!form.name.trim() || isNaN(amount)) return;
    const payload = {
      name: form.name.trim(),
      category: form.category,
      currency: form.currency,
      amount,
      quantity: form.quantity ? parseFloat(form.quantity) : undefined,
      source: "manual" as const,
    };
    if (editing) updateAsset(editing, payload);
    else addAsset(payload);
    setOpen(false);
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Assets</h2>
        <Button
          variant="solid"
          size="sm"
          onClick={openAdd}
          className="text-sm font-medium"
        >
          + Add asset
        </Button>
      </div>

      {assets.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          No assets yet. Add your cash, bank balances, stocks and crypto.
        </p>
      ) : (
        <>
          {/* Mobile: stacked cards so nothing is cramped on a phone */}
          <ul className="space-y-2 md:hidden">
            {assets.map((a) => (
              <li
                key={a.id}
                className="rounded-lg border border-border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: CATEGORY_COLORS[a.category] }}
                      />
                      <span className="truncate font-medium">{a.name}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{CATEGORY_LABELS[a.category]}</span>
                      {SOURCE_BADGE[a.source] && (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">
                          {SOURCE_BADGE[a.source]}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <RollingNumber
                      value={a.amount}
                      currency={a.currency}
                      className="font-medium"
                    />
                    <div className="text-xs text-muted">
                      <RollingNumber
                        value={convertToBase(a.amount, a.currency, fx)}
                        currency={baseCurrency}
                      />
                    </div>
                  </div>
                </div>
                {a.source === "manual" && (
                  <div className="mt-2 flex justify-end gap-4 text-sm">
                    <button
                      onClick={() => openEdit(a)}
                      className="text-muted hover:text-foreground"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => removeAsset(a.id)}
                      className="text-muted hover:text-rose-400"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Desktop: full table */}
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="pb-2">Name</th>
                <th className="pb-2">Category</th>
                <th className="pb-2 text-right">Amount</th>
                <th className="pb-2 text-right">In {baseCurrency}</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="py-2">
                    {a.name}
                    {SOURCE_BADGE[a.source] && (
                      <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                        {SOURCE_BADGE[a.source]}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ background: CATEGORY_COLORS[a.category] }}
                      />
                      {CATEGORY_LABELS[a.category]}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <RollingNumber value={a.amount} currency={a.currency} />
                  </td>
                  <td className="py-2 text-right text-muted">
                    <RollingNumber
                      value={convertToBase(a.amount, a.currency, fx)}
                      currency={baseCurrency}
                    />
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {a.source === "manual" ? (
                      <>
                        <button
                          onClick={() => openEdit(a)}
                          className="text-muted hover:text-foreground"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeAsset(a.id)}
                          className="ml-3 text-muted hover:text-rose-400"
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-muted">synced</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="modal-card w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 font-semibold">
              {editing ? "Edit asset" : "Add asset"}
            </h3>
            <div className="space-y-3">
              <Field label="Name">
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Revolut, BTC, AAPL"
                  className="input"
                />
              </Field>
              <Field label="Category">
                <Select
                  value={form.category}
                  onChange={(v) =>
                    setForm({ ...form, category: v as Category })
                  }
                  ariaLabel="Category"
                  options={CATEGORIES.map((c) => ({
                    value: c,
                    label: CATEGORY_LABELS[c],
                  }))}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount">
                  <input
                    type="number"
                    value={form.amount}
                    onChange={(e) =>
                      setForm({ ...form, amount: e.target.value })
                    }
                    placeholder="0.00"
                    className="input"
                  />
                </Field>
                <Field label="Currency">
                  <Select
                    value={form.currency}
                    onChange={(v) => setForm({ ...form, currency: v })}
                    ariaLabel="Currency"
                    options={SUPPORTED_CURRENCIES.map((c) => ({
                      value: c,
                      label: c,
                    }))}
                  />
                </Field>
              </div>
              <Field label="Quantity (optional)">
                <input
                  type="number"
                  value={form.quantity}
                  onChange={(e) =>
                    setForm({ ...form, quantity: e.target.value })
                  }
                  placeholder="shares / units"
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
                {editing ? "Save" : "Add"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
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
