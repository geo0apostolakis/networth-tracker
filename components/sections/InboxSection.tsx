"use client";

import { useMemo } from "react";
import { Inbox, PartyPopper, TrendingDown, TrendingUp } from "lucide-react";
import { GroupHeading } from "@/components/ui/Headings";
import { monthlyDigests, type Digest } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { formatMoney, formatPct } from "@/lib/utils";

export default function InboxSection() {
  const snapshots = useStore((s) => s.snapshots);
  const transactions = useStore((s) => s.transactions);
  const milestones = useStore((s) => s.milestones);
  const readDigests = useStore((s) => s.readDigests);
  const markDigestRead = useStore((s) => s.markDigestRead);
  const markAllDigestsRead = useStore((s) => s.markAllDigestsRead);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const privacy = useStore((s) => s.privacy);

  const digests = useMemo(
    () => monthlyDigests(snapshots, transactions, fx),
    [snapshots, transactions, fx]
  );

  const hit = useMemo(
    () =>
      milestones
        .filter((m) => m.hitAt)
        .sort((a, b) => (b.hitAt as string).localeCompare(a.hitAt as string)),
    [milestones]
  );

  const read = new Set(readDigests);
  const unread = digests.filter((d) => !read.has(d.id));

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      {hit.length > 0 && (
        <section>
          <GroupHeading
            title="Milestones"
            subtitle="Targets you have already passed"
          />
          <div className="card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <PartyPopper size={15} className="text-emerald-400" />
              Goals reached
            </h3>
            <ul className="space-y-1.5 text-sm">
              {hit.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{m.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {new Date(m.hitAt as string).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="flex min-h-0 flex-col lg:flex-1">
        <GroupHeading
          title="Monthly digests"
          subtitle="What changed, month by month"
          action={
            unread.length > 0 ? (
              <button
                onClick={() => markAllDigestsRead(digests.map((d) => d.id))}
                className="input w-auto px-3 text-sm"
              >
                Mark all read
              </button>
            ) : undefined
          }
        />
        <div className="card mb-4 flex items-start gap-2 p-4 text-xs text-muted">
          <Inbox size={15} className="mt-0.5 shrink-0 text-cyan-400" />
          <p>
            A short digest for every month your net worth was tracked. Built from
            the daily snapshots, so it appears on its own.
          </p>
        </div>

        {digests.length === 0 ? (
          <div className="card p-10 text-center text-sm text-muted">
            Nothing here yet. Digests appear once there are snapshots spanning
            more than one day, which the daily job builds on its own.
          </div>
        ) : (
          <div className="space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {digests.map((d) => (
              <DigestCard
                key={d.id}
                digest={d}
                unread={!read.has(d.id)}
                onRead={() => markDigestRead(d.id)}
                currency={baseCurrency}
                privacy={privacy}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DigestCard({
  digest: d,
  unread,
  onRead,
  currency,
  privacy,
}: {
  digest: Digest;
  unread: boolean;
  onRead: () => void;
  currency: string;
  privacy: boolean;
}) {
  const up = d.delta >= 0;
  const biggest = d.movers[0];

  return (
    <section
      onClick={unread ? onRead : undefined}
      className={`card p-4 ${unread ? "cursor-pointer ring-1 ring-cyan-400/30" : ""}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          {unread && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-400" />
          )}
          {d.title}
        </h3>
        <span
          className={`flex items-center gap-1 text-sm font-medium ${
            up ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {up ? "+" : "−"}
          {formatMoney(Math.abs(d.delta), currency, privacy)}
          <span className="text-muted">({formatPct(d.pct)})</span>
        </span>
      </div>

      <p className="text-sm leading-relaxed">
        Net worth went from {formatMoney(d.startValue, currency, privacy)} to{" "}
        {formatMoney(d.endValue, currency, privacy)}.
        {biggest && (
          <>
            {" "}
            Biggest mover: {biggest.label}{" "}
            {biggest.delta >= 0 ? "+" : "−"}
            {formatMoney(Math.abs(biggest.delta), currency, privacy)}.
          </>
        )}
        {d.income > 0 || d.expense > 0 ? (
          <>
            {" "}
            Logged {formatMoney(d.income, currency, privacy)} in and{" "}
            {formatMoney(d.expense, currency, privacy)} out
            {d.income > 0 ? `, keeping ${d.savingsPct.toFixed(0)}%` : ""}.
          </>
        ) : null}
      </p>

      {d.movers.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {d.movers.slice(1).map((m) => (
            <li key={m.category}>
              {m.label} {m.delta >= 0 ? "+" : "−"}
              {formatMoney(Math.abs(m.delta), currency, privacy)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
