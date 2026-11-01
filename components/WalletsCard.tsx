"use client";

import { useState } from "react";
import { RefreshCw, Trash2, Wallet as WalletIcon } from "lucide-react";
import { CardHeader } from "@/components/ui/Headings";
import { CHAIN_LABELS, EVM_CHAINS } from "@/lib/chains";
import { convertToBase } from "@/lib/fx";
import { useStore } from "@/lib/store";
import { formatMoney } from "@/lib/utils";

// Watch-only crypto addresses. Paste an address and the server works out which
// chains it belongs to, reads every one of them, and prices what it finds;
// the result shows up under Crypto (or Stocks, for tokenised equities) like any
// other asset. Nothing here can move money: an address is public by nature.
export default function WalletsCard() {
  const wallets = useStore((s) => s.wallets);
  const walletErrors = useStore((s) => s.walletErrors);
  const walletWarnings = useStore((s) => s.walletWarnings);
  const walletChains = useStore((s) => s.walletChains);
  const assets = useStore((s) => s.assets);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const privacy = useStore((s) => s.privacy);
  const addWallet = useStore((s) => s.addWallet);
  const removeWallet = useStore((s) => s.removeWallet);
  const syncWallets = useStore((s) => s.syncWallets);

  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setStatus(null);
    const r = await syncWallets();
    setBusy(false);
    setStatus(r.ok ? `Read ${r.count} balance${r.count === 1 ? "" : "s"}` : `Failed: ${r.error}`);
    setTimeout(() => setStatus(null), 6000);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;
    addWallet(label, address);
    setLabel("");
    setAddress("");
    // Read it straight away so the new balance lands without waiting for the
    // timer. addWallet is synchronous, so the store already has it.
    await sync();
  }

  return (
    <section className="card p-4">
      <CardHeader
        title="Crypto wallets"
        subtitle="Paste an address, the chains are found for you"
        icon={<WalletIcon size={16} className="text-amber-400" />}
        action={
          wallets.length > 0 ? (
            <button
              onClick={sync}
              disabled={busy}
              className="input flex w-auto items-center gap-1.5 px-2.5 py-1 text-xs text-muted hover:text-foreground disabled:opacity-50"
              title="Read balances now"
            >
              <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
              {busy ? "Reading…" : "Refresh"}
            </button>
          ) : undefined
        }
      />

      {status && <p className="mb-2 text-xs text-muted">{status}</p>}

      {wallets.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted">
          No wallets yet. Add an address below and its coins join your net worth.
        </p>
      ) : (
        <ul className="mb-3 space-y-2">
          {wallets.map((w) => {
            const held = assets.filter((a) => a.walletId === w.id);
            const value = held.reduce(
              (sum, a) => sum + convertToBase(a.amount, a.currency, fx),
              0
            );
            const err = walletErrors[w.id];
            const warn = walletWarnings[w.id];
            const on = walletChains[w.id] ?? [];
            return (
              <li key={w.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-medium">{w.label}</span>
                    <div className="truncate font-mono text-[11px] text-muted" title={w.address}>
                      {w.address}
                    </div>
                    {on.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {on.map((c) => (
                          <span
                            key={c}
                            className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted"
                          >
                            {CHAIN_LABELS[c] ?? c}
                          </span>
                        ))}
                      </div>
                    )}
                    {held.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                        {held.map((a) => (
                          <span key={a.id}>
                            {privacy
                              ? "••••"
                              : (a.quantity ?? 0).toLocaleString(undefined, {
                                  maximumFractionDigits: 6,
                                })}{" "}
                            {a.name.split(" · ").pop()}
                          </span>
                        ))}
                      </div>
                    )}
                    {err && <p className="mt-1 text-xs text-rose-400">{err}</p>}
                    {!err && warn && <p className="mt-1 text-xs text-amber-400">{warn}</p>}
                    {!err && held.length === 0 && (
                      <p className="mt-1 text-xs text-muted">Nothing held, or not read yet.</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="tabular-nums">
                      {formatMoney(value, baseCurrency, privacy)}
                    </span>
                    <button
                      onClick={() => removeWallet(w.id)}
                      title="Stop watching this wallet"
                      className="text-muted hover:text-rose-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. MetaMask, Ledger)"
          className="input text-sm"
        />
        <div className="flex gap-2">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x… , bc1… or a Solana address"
            spellCheck={false}
            autoCapitalize="off"
            className="input min-w-0 flex-1 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={!address.trim() || busy}
            className="input w-auto px-3 text-sm font-medium text-amber-400 disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </form>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        A 0x address is read on all {EVM_CHAINS.length} EVM chains at once, Robinhood Chain
        included, so tokenised stocks count too. Balances refresh every 5 minutes, prices every
        minute.
      </p>
    </section>
  );
}
