"use client";

import { useEffect, useState } from "react";
import { Landmark, RefreshCw } from "lucide-react";
import { CardHeader } from "@/components/ui/Headings";
import { useStore } from "@/lib/store";

// Revolut, through Open Banking (Enable Banking). Connecting sends you to
// Revolut to approve read access; from then on every currency pocket is a bank
// asset here and every card payment and top-up is a transaction, refreshed a
// few times a day. Consent lasts 90 days, then Revolut asks again.
export default function RevolutCard() {
  const revolut = useStore((s) => s.revolut);
  const syncRevolut = useStore((s) => s.syncRevolut);
  const disconnectRevolut = useStore((s) => s.disconnectRevolut);
  const [flash, setFlash] = useState<string | null>(null);

  // Landing back from the consent screen: say how it went, then clean the URL.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("revolut");
    if (!q) return;
    const id = setTimeout(
      () =>
        setFlash(
          q === "connected"
            ? "Revolut connected. Pulling balances and history…"
            : "Revolut connection did not complete."
        ),
      0
    );
    window.history.replaceState(null, "", window.location.pathname);
    return () => clearTimeout(id);
  }, []);

  // Days of consent left. Computed on a tick, not in render: the compiler
  // flags Date.now() during render, and the number only needs to be right to
  // the day anyway.
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => {
    const update = () =>
      setDays(
        revolut.validUntil
          ? Math.max(
              0,
              Math.ceil((new Date(revolut.validUntil).getTime() - Date.now()) / 86_400_000)
            )
          : null
      );
    const id = setTimeout(update, 0);
    return () => clearTimeout(id);
  }, [revolut.validUntil]);

  return (
    <section className="card p-4">
      <CardHeader
        title="Revolut"
        subtitle="Balances and every transaction, through Open Banking"
        icon={<Landmark size={16} className="text-blue-400" />}
        action={
          revolut.connected ? (
            <button
              onClick={() => syncRevolut(true)}
              disabled={revolut.loading}
              className="input flex w-auto items-center gap-1.5 px-2.5 py-1 text-xs text-muted hover:text-foreground disabled:opacity-50"
              title="Ask the bank now instead of waiting for the next refresh"
            >
              <RefreshCw size={12} className={revolut.loading ? "animate-spin" : ""} />
              {revolut.loading ? "Syncing…" : "Sync now"}
            </button>
          ) : undefined
        }
      />

      {flash && <p className="mb-2 text-xs text-muted">{flash}</p>}

      {!revolut.configured ? (
        <p className="py-3 text-sm text-muted">
          Not set up on the server yet. Needs <code>ENABLE_BANKING_APP_ID</code> and{" "}
          <code>ENABLE_BANKING_PRIVATE_KEY</code> in the environment.
        </p>
      ) : !revolut.connected ? (
        <div className="py-2">
          <p className="mb-3 text-sm text-muted">
            You will be sent to Revolut to approve read-only access. Nothing can
            move money.
          </p>
          <a
            href="/api/revolut/connect"
            className="input inline-flex w-auto items-center gap-2 px-3 text-sm font-medium text-blue-400"
          >
            Connect Revolut
          </a>
          {revolut.error && (
            <p className="mt-2 text-xs text-rose-400">{revolut.error}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <ul className="flex flex-wrap gap-2">
            {revolut.accounts.map((a, i) => (
              <li
                key={i}
                className="rounded-md border border-border bg-surface-2 px-2 py-1 text-xs"
              >
                {a.name} · {a.currency}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            {revolut.fetchedAt
              ? `Last read ${new Date(revolut.fetchedAt).toLocaleString()}`
              : "Not read yet"}
            {days !== null && (
              <>
                {" · "}
                consent {days === 0 ? "expires today" : `valid ${days} more day${days === 1 ? "" : "s"}`}
              </>
            )}
          </p>
          {revolut.error && (
            <p className="text-xs text-rose-400">
              Last sync failed: {revolut.error}. Showing the last good copy.
              {days === 0 && " Reconnect to renew the consent."}
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-1 text-xs">
            <a href="/api/revolut/connect" className="text-muted hover:text-foreground">
              Reconnect
            </a>
            <button
              onClick={() => {
                if (window.confirm("Disconnect Revolut? Imported balances and history are removed from the tracker.")) {
                  disconnectRevolut();
                }
              }}
              className="text-muted hover:text-rose-400"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Refreshed at most every 4 hours (banks limit how often an app may ask).
        Imported transactions arrive uncategorized, and a transfer between your
        own accounts counts as income on one side and expense on the other.
      </p>
    </section>
  );
}
