"use client";

import { useMemo, useState } from "react";
import EditTransactionDialog from "@/components/EditTransactionDialog";
import { Cg } from "@/components/term/viz";
import { CardHeader } from "@/components/ui/Headings";
import { Select } from "@/components/ui/Select";
import { useStore } from "@/lib/store";
import { SOLCARD_ASSET_ID } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

// solcard(1): the card as a ledger, in USD like the card itself. Money in =
// on-chain top-ups (read automatically). Money out = what the statement PDFs
// list (purchases, card fees), the cut Solcard keeps on each top-up, purchases
// logged by hand, and whatever a balance check says is missing. What is left
// is the card balance, and it counts in net worth like any bank balance.
export default function SolcardCard() {
  const transactions = useStore((s) => s.transactions);
  const card = useStore((s) => s.assets.find((a) => a.id === SOLCARD_ASSET_ID));
  const solcard = useStore((s) => s.solcard);
  const meta = useStore((s) => s.solcardMeta);
  const cats = useStore((s) => s.txnCategories);
  const privacy = useStore((s) => s.privacy);
  const addTransaction = useStore((s) => s.addTransaction);
  const syncSolcard = useStore((s) => s.syncSolcard);
  const checkSolcardBalance = useStore((s) => s.checkSolcardBalance);
  const setSolcard = useStore((s) => s.setSolcard);
  const importStatement = useStore((s) => s.importSolcardStatement);

  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [cat, setCat] = useState("");
  // Empty until picked: a default "now" would differ between server and browser render.
  const [when, setWhen] = useState("");
  const [real, setReal] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [upload, setUpload] = useState<string | null>(null);

  const entries = useMemo(() => transactions.filter((t) => t.assetId === SOLCARD_ASSET_ID), [transactions]);
  const sum = (f: (t: (typeof entries)[number]) => boolean) => entries.filter(f).reduce((a, t) => a + t.amount, 0);
  const toppedUp = sum((t) => !!t.transfer && t.type === "earned");
  const fees = sum((t) => t.categoryId === "exp-fees");
  const unitemized = sum((t) => t.categoryId === "exp-unitemized");
  const bought = sum((t) => t.type === "spent" && t.categoryId !== "exp-fees" && t.categoryId !== "exp-unitemized");
  const refunds = sum((t) => t.type === "earned" && !t.transfer);
  const left = card?.amount ?? 0;
  const cur = card?.currency ?? "USD";
  const money = (v: number) => formatMoney(v, cur, privacy);
  const stmt = meta.statement;
  const topups = entries.filter((t) => t.transfer);
  const spending = entries.filter((t) => !t.transfer);
  const spentCats = cats.filter((c) => c.kind === "spent" && c.id !== "exp-fees" && c.id !== "exp-unitemized");

  async function onStatement(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUpload("reading the statement…");
    const r = await importStatement(file);
    setUpload(r.ok ? `imported ${r.count} entries · ${r.from} → ${r.to}` : `import failed: ${r.error}`);
  }

  function logPurchase() {
    const v = parseFloat(amount.replace(",", "."));
    if (!v || v <= 0) return;
    addTransaction({ assetId: SOLCARD_ASSET_ID, type: "spent", amount: v, note: what || "Solcard purchase", categoryId: cat || undefined, date: when ? new Date(when).toISOString() : undefined });
    setAmount("");
    setWhat("");
    setWhen("");
  }

  return (
    <section className="card p-4">
      <CardHeader
        title="solcard(1) · card ledger"
        subtitle={
          meta.error
            ? `sync failed: ${meta.error}`
            : meta.fetchedAt
              ? `top-ups from chain · ${stmt ? `${stmt.count} statement${stmt.count === 1 ? "" : "s"} up to ${stmt.to}` : "no statement yet"} · ${new Date(meta.fetchedAt).toLocaleTimeString()}`
              : "reading the chain…"
        }
        action={
          <button className="btn ghost" onClick={() => syncSolcard()} disabled={meta.loading}>
            {meta.loading ? "syncing…" : "⟳ sync"}
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <div className="eyebrow">{"left on card"}</div>
          <div className="mt-1 text-4xl font-extrabold tracking-tight text-amber-400">{money(left)}</div>
          <dl className="defs" style={{ gridTemplateColumns: "max-content minmax(0,1fr) max-content" }}>
            <dt>{"topped up"}</dt>
            <dd>{`${topups.length} on-chain`}</dd>
            <dd className="v ok">{`+${money(toppedUp)}`}</dd>
            <dt>{"fees"}</dt>
            <dd>{meta.rate != null ? `${(meta.rate * 100).toFixed(1)}% kept per top-up + card fees` : `${solcard.feePct}% per top-up (guess)`}</dd>
            <dd className="v err">{`−${money(fees)}`}</dd>
            <dt>{"bought"}</dt>
            <dd>{`${spending.filter((t) => t.type === "spent" && t.categoryId !== "exp-fees" && t.categoryId !== "exp-unitemized").length} logged`}</dd>
            <dd className="v err">{`−${money(bought)}`}</dd>
            <dt>{"unknown"}</dt>
            <dd>{unitemized > 0 ? "not itemized yet, edit to split" : "everything itemized"}</dd>
            <dd className={`v ${unitemized > 0 ? "partial" : "faint"}`}>{`−${money(unitemized)}`}</dd>
            {refunds > 0 && (
              <>
                <dt>{"refunds"}</dt>
                <dd>{"money back"}</dd>
                <dd className="v ok">{`+${money(refunds)}`}</dd>
              </>
            )}
          </dl>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted">
            <Cg frac={toppedUp ? (bought + fees + unitemized) / toppedUp : 0} cells={24} tone="acc" />
            <span>{toppedUp ? `${(((bought + fees + unitemized) / toppedUp) * 100).toFixed(0)}% used` : ""}</span>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <div className="eyebrow mb-2">{"statements"}</div>
            <label className="btn acc inline-block cursor-pointer">
              {"⇪ import statement PDF"}
              <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={onStatement} />
            </label>
            <p className="mt-1 text-[11px] text-muted">
              {upload ??
                (stmt
                  ? `last: ${stmt.from} → ${stmt.to}, closing ${formatMoney(stmt.closing, stmt.currency, privacy)}. Solcard app → card → statement → download, then drop it here.`
                  : "Solcard app → card → statement → download the PDF, then import it here. Purchases, refunds and fees are read from it.")}
            </p>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <div className="eyebrow mb-2">{"check against the solcard app"}</div>
            <div className="flex gap-2">
              <input className="input" inputMode="decimal" placeholder={`real balance (${cur})`} value={real} onChange={(e) => setReal(e.target.value)} />
              <button
                className="btn"
                onClick={() => {
                  const v = parseFloat(real.replace(",", "."));
                  if (!isNaN(v)) {
                    checkSolcardBalance(v);
                    setReal("");
                  }
                }}
              >
                {"check"}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {solcard.lastCheck
                ? `last check ${money(solcard.lastCheck.amount)} on ${new Date(solcard.lastCheck.at).toLocaleDateString()}. Anything unexplained becomes one "not itemized yet" entry you can edit.`
                : "Type what the Solcard app shows; anything the ledger can't explain becomes one \"not itemized yet\" entry you can edit later."}
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <div className="eyebrow mb-2">{"log a purchase"}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">
            <input className="input" inputMode="decimal" placeholder={`amount (${cur})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <input className="input" placeholder="what did you buy" value={what} onChange={(e) => setWhat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && logPurchase()} />
            <Select value={cat} onChange={setCat} options={[{ value: "", label: "category…" }, ...spentCats.map((c) => ({ value: c.id, label: c.name }))]} ariaLabel="Category" />
            {/* Full width on a phone: a date field won't shrink below ~220px. */}
            <div className="col-span-2 flex gap-2 sm:col-span-1">
              <input className="input min-w-0" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} title="leave empty for now" />
              <button className="btn acc" onClick={logPurchase}>
                {"+ log"}
              </button>
            </div>
          </div>

          <div className="eyebrow mb-1 mt-4">{"card history · click to edit"}</div>
          <div className="dmesg max-h-64">
            {entries.length === 0 && <span className="l faint">{"no top-ups found yet"}</span>}
            {entries.map((t) => (
              <button key={t.id} className="l w-full text-left hover:bg-surface-2" onClick={() => setEditing(t.id)}>
                <span className="ts">{`[${new Date(t.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}] `}</span>
                <span className={t.transfer ? "info" : t.type === "earned" ? "ok" : t.categoryId === "exp-unitemized" ? "partial" : "err"}>
                  {`${t.transfer ? "⇄+" : t.type === "earned" ? "+" : "−"}${formatMoney(t.amount, t.currency, privacy)}`}
                </span>
                <span className="dim">{` ${t.note ?? ""}`}</span>
              </button>
            ))}
          </div>

          <details className="mt-4 text-xs">
            <summary className="cursor-pointer text-muted">{"addresses & fee"}</summary>
            <div className="mt-2 space-y-2">
              <p className="partial">
                {`⚠ only copy the deposit address from the Solcard app. ${meta.poisoned} fake lookalike transfers were sent to this wallet to trick you into copying a scammer's address from history; they're ignored here.`}
              </p>
              <label className="block">
                <span className="text-muted">{"funding wallet (pays the card)"}</span>
                <input className="input mt-1" defaultValue={solcard.funding} onBlur={(e) => /^0x[0-9a-fA-F]{40}$/.test(e.target.value) && (setSolcard({ funding: e.target.value }), syncSolcard())} />
              </label>
              <label className="block">
                <span className="text-muted">{`deposit address · ${short(solcard.deposit)}`}</span>
                <input className="input mt-1" defaultValue={solcard.deposit} onBlur={(e) => /^0x[0-9a-fA-F]{40}$/.test(e.target.value) && (setSolcard({ deposit: e.target.value }), syncSolcard())} />
              </label>
              <label className="block">
                <span className="text-muted">{"top-up fee %"}</span>
                <input className="input mt-1 w-24" inputMode="decimal" defaultValue={solcard.feePct} onBlur={(e) => !isNaN(parseFloat(e.target.value)) && (setSolcard({ feePct: parseFloat(e.target.value) }), syncSolcard())} />
              </label>
            </div>
          </details>
        </div>
      </div>
      {editing && <EditTransactionDialog id={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
