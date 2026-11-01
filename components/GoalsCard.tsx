"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PartyPopper, Target, Trash2 } from "lucide-react";
import { milestoneProgress, savingsRate } from "@/lib/metrics";
import { useStore } from "@/lib/store";
import { formatMoney } from "@/lib/utils";

const CELEBRATE_MS = 6000;

export default function GoalsCard({ netWorth }: { netWorth: number }) {
  const milestones = useStore((s) => s.milestones);
  const addMilestone = useStore((s) => s.addMilestone);
  const removeMilestone = useStore((s) => s.removeMilestone);
  const markMilestoneHit = useStore((s) => s.markMilestoneHit);
  const transactions = useStore((s) => s.transactions);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const privacy = useStore((s) => s.privacy);

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");

  const progress = useMemo(
    () => milestoneProgress(milestones, netWorth),
    [milestones, netWorth]
  );
  const saving = useMemo(
    () => savingsRate(transactions, fx),
    [transactions, fx]
  );

  const [celebrating, setCelebrating] = useState<string | null>(null);

  // Stamp `hitAt` the first time net worth crosses a target. It persists, so a
  // refresh does not replay the party.
  const justHitId = progress.find(
    (p) => p.reached && !p.milestone.hitAt
  )?.milestone.id;
  useEffect(() => {
    if (justHitId) markMilestoneHit(justHitId);
  }, [justHitId, markMilestoneHit]);

  // Showing the banner is deliberately a separate effect keyed on which goals
  // carry a stamp. Doing it in the effect above would tear its own timer down:
  // the stamp lands synchronously, the goal stops being "just hit", the deps
  // change and cleanup cancels the reveal before it can run.
  const stamped = milestones.filter((m) => m.hitAt);
  const stampKey = stamped.map((m) => m.id).join(",");
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    // First pass only records what was already reached in an earlier session.
    if (seen.current === null) {
      seen.current = new Set(stamped.map((m) => m.id));
      return;
    }
    const fresh = stamped.find((m) => !seen.current?.has(m.id));
    if (!fresh) return;
    seen.current.add(fresh.id);
    // Deferred by a tick so this is not a synchronous setState in an effect.
    const show = window.setTimeout(() => setCelebrating(fresh.name), 0);
    const hide = window.setTimeout(() => setCelebrating(null), CELEBRATE_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stampKey]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseFloat(target.replace(",", "."));
    if (!name.trim() || isNaN(value) || value <= 0) return;
    addMilestone(name, value);
    setName("");
    setTarget("");
  }

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Target size={16} className="text-emerald-400" />
          Goals
        </h2>
        <SavingsGauge pct={saving.pct} hasIncome={saving.hasIncome} />
      </div>

      {celebrating && (
        <div className="celebrate mb-3 flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">
          <PartyPopper size={16} />
          <span>
            <strong>{celebrating}</strong> reached. That one is done.
          </span>
        </div>
      )}

      {progress.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">
          No goals yet. Set one below, like a first 100k or a 6 month emergency
          fund.
        </p>
      ) : (
        <ul className="space-y-3">
          {progress.map((p) => (
            <li key={p.milestone.id}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  {p.reached && (
                    <PartyPopper size={13} className="shrink-0 text-emerald-400" />
                  )}
                  <span className="truncate font-medium">{p.milestone.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  {formatMoney(p.milestone.target, p.milestone.currency, privacy)}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/8">
                <div
                  className={`h-full rounded-full transition-[width] duration-700 ${
                    p.reached
                      ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]"
                      : "bg-blue-500"
                  }`}
                  style={{ width: `${p.pct}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                <span className="tabular-nums">
                  {p.pct.toFixed(p.pct >= 10 ? 0 : 1)}%
                  {!p.reached && (
                    <>
                      {" · "}
                      {formatMoney(p.remaining, baseCurrency, privacy)} to go
                    </>
                  )}
                </span>
                <button
                  onClick={() => removeMilestone(p.milestone.id)}
                  title="Delete goal"
                  className="shrink-0 hover:text-rose-400"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-4 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Goal name"
          className="input min-w-0 flex-1 text-sm"
        />
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          inputMode="decimal"
          placeholder={`Target (${baseCurrency})`}
          className="input w-32 text-sm"
        />
        <button
          type="submit"
          disabled={!name.trim() || !target.trim()}
          className="input w-auto px-3 text-sm font-medium text-blue-400 disabled:opacity-40"
        >
          Add
        </button>
      </form>
    </section>
  );
}

// Savings rate is income minus spending as a share of income. Shown next to the
// goals because it is the number that decides how fast any of them arrive.
function SavingsGauge({ pct, hasIncome }: { pct: number; hasIncome: boolean }) {
  if (!hasIncome) {
    return <span className="text-xs text-muted">Savings rate n/a</span>;
  }
  const clamped = Math.max(0, Math.min(100, pct));
  const tone =
    pct >= 50
      ? "text-emerald-400"
      : pct >= 20
        ? "text-amber-400"
        : "text-rose-400";
  return (
    <div
      className={`flex items-center gap-2 ${tone}`}
      title="Income minus spending, as a share of income"
    >
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full bg-current opacity-80"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs font-medium tabular-nums">
        {pct.toFixed(0)}% saved
      </span>
    </div>
  );
}
