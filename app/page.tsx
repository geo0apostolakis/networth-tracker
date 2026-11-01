"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { Header, useGoKeys } from "@/components/term/Header";
import { SkinFooter } from "@/components/skin/Backdrop";
import { MobileHeader, MobileNav } from "@/components/term/Mobile";
import { NAV } from "@/components/term/nav";
import { StatusLine } from "@/components/term/StatusLine";
import AssetsSection from "@/components/sections/AssetsSection";
import BubbleMapSection from "@/components/sections/BubbleMapSection";
import DashboardSection from "@/components/sections/DashboardSection";
import GoalsSection from "@/components/sections/GoalsSection";
import InboxSection from "@/components/sections/InboxSection";
import NetWorthSection from "@/components/sections/NetWorthSection";
import ReportsSection from "@/components/sections/ReportsSection";
import SpendingSection from "@/components/sections/SpendingSection";
import TransactionsSection from "@/components/sections/TransactionsSection";
import { monthlyDigests } from "@/lib/metrics";
import { SECTION_HEADINGS, type Section } from "@/lib/sections";
import { useSkin } from "@/lib/skin";

// The open section lives in the URL hash (#bubbles, #spending...), so a section
// can be bookmarked or shared and the phone's back button steps back through
// the sections instead of leaving the app.
const onNav = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  window.addEventListener("popstate", cb);
  return () => {
    window.removeEventListener("hashchange", cb);
    window.removeEventListener("popstate", cb);
  };
};
const readHash = () => window.location.hash.slice(1);
import { useStore } from "@/lib/store";

export default function Home() {
  const fx = useStore((s) => s.fx);
  const refreshFx = useStore((s) => s.refreshFx);
  const syncFreedom24 = useStore((s) => s.syncFreedom24);
  const syncWallets = useStore((s) => s.syncWallets);
  const repriceWallets = useStore((s) => s.repriceWallets);
  const syncRevolut = useStore((s) => s.syncRevolut);
  const loadSnapshots = useStore((s) => s.loadSnapshots);
  const autoSnapshot = useStore((s) => s.autoSnapshot);
  // Gate all auto-writes until the saved Supabase row has loaded, otherwise the
  // empty default state overwrites it (the disappearing-asset bug).
  const hydrated = useStore((s) => s._hydrated);

  const hash = useSyncExternalStore(onNav, readHash, () => "");
  const section: Section = hash in SECTION_HEADINGS ? (hash as Section) : "dashboard";
  const setSection = useCallback((s: Section) => {
    const next = s === "dashboard" ? window.location.pathname + window.location.search : `#${s}`;
    if (readHash() === (s === "dashboard" ? "" : s)) return;
    window.history.pushState(null, "", next);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.scrollTo({ top: 0 });
  }, []);
  const heading = SECTION_HEADINGS[section];
  const nav = NAV.find((n) => n.id === section)!;
  const plain = useSkin((s) => s.skin) !== "terminal";
  useGoKeys(setSection);

  // Digests are derived from snapshot history, so the unread count is computed
  // here rather than stored. Only which ones have been opened is persisted.
  const snapshots = useStore((s) => s.snapshots);
  const transactions = useStore((s) => s.transactions);
  const readDigests = useStore((s) => s.readDigests);
  const unread = useMemo(() => {
    const read = new Set(readDigests);
    return monthlyDigests(snapshots, transactions, fx).filter(
      (d) => !read.has(d.id)
    ).length;
  }, [snapshots, transactions, fx, readDigests]);

  // Pull real-time FX on mount and every minute so USD/EUR values track the
  // market through the day (force=true bypasses the staleness guard).
  useEffect(() => {
    if (!hydrated) return;
    refreshFx(true);
    const id = setInterval(() => refreshFx(true), 60_000);
    return () => clearInterval(id);
  }, [hydrated, refreshFx]);

  // Auto-sync Freedom24 every minute for near-real-time stock values.
  // (Only runs while this tab is open — true 24/7 needs the backend phase.)
  useEffect(() => {
    if (!hydrated) return;
    syncFreedom24();
    const id = setInterval(() => {
      syncFreedom24();
    }, 60_000);
    return () => clearInterval(id);
  }, [hydrated, syncFreedom24]);

  // Crypto wallets, on two clocks. The chains are read every 5 minutes: each
  // wallet fans out to every EVM chain, and the public RPCs rate limit by IP.
  // Quantities only move when a transaction lands anyway; the price is what
  // moves every second, so it gets its own 60s refresh that touches no chain.
  useEffect(() => {
    if (!hydrated) return;
    syncWallets();
    const id = setInterval(() => syncWallets(), 5 * 60_000);
    return () => clearInterval(id);
  }, [hydrated, syncWallets]);

  useEffect(() => {
    if (!hydrated) return;
    const id = setInterval(() => repriceWallets(), 60_000);
    return () => clearInterval(id);
  }, [hydrated, repriceWallets]);

  // Revolut: the server holds a copy and only asks the bank every few hours,
  // so polling it every 15 minutes costs nothing against the bank's limits.
  useEffect(() => {
    if (!hydrated) return;
    syncRevolut();
    const id = setInterval(() => syncRevolut(), 15 * 60_000);
    return () => clearInterval(id);
  }, [hydrated, syncRevolut]);

  // Solcard top-ups only move when a new on-chain transfer lands, and the route
  // is CDN-cached for 10 minutes, so every 15 minutes is plenty.
  const syncSolcard = useStore((s) => s.syncSolcard);
  useEffect(() => {
    if (!hydrated) return;
    syncSolcard();
    const id = setInterval(() => syncSolcard(), 15 * 60_000);
    return () => clearInterval(id);
  }, [hydrated, syncSolcard]);

  // Bitrefill: purchases are rare and the API is cheap; every 15 minutes.
  const syncBitrefill = useStore((s) => s.syncBitrefill);
  useEffect(() => {
    if (!hydrated) return;
    syncBitrefill();
    const id = setInterval(() => syncBitrefill(), 15 * 60_000);
    return () => clearInterval(id);
  }, [hydrated, syncBitrefill]);

  // Load snapshot history from its own table, then make sure today has a point.
  // The 24/7 daily snapshot is handled by a Supabase cron + Edge Function; this
  // just fills today in immediately when the app is open (idempotent per day).
  useEffect(() => {
    if (!hydrated) return;
    loadSnapshots().then(() => autoSnapshot());
  }, [hydrated, loadSnapshots, autoSnapshot]);

  // Multi-device sync: when this tab regains focus (e.g. you pick the laptop
  // back up after editing on your phone), re-pull the latest saved row so the
  // two devices stay in step and a stale write can't clobber newer data.
  useEffect(() => {
    if (!hydrated) return;
    const pull = () => {
      if (document.visibilityState === "visible") {
        useStore.persist.rehydrate();
        loadSnapshots();
      }
    };
    window.addEventListener("focus", pull);
    document.addEventListener("visibilitychange", pull);
    return () => {
      window.removeEventListener("focus", pull);
      document.removeEventListener("visibilitychange", pull);
    };
  }, [hydrated, loadSnapshots]);

  return (
    <div className="shell">
      <Header section={section} onChange={setSection} unread={unread} />
      <MobileHeader onHome={() => setSection("dashboard")} />

      <main className="page">
        {section !== "dashboard" && (
          <div className="page-h">
            <div className="min-w-0">
              <div className="crumbs">
                {plain ? "My Little Networth / " : "networth / "}
                <b>{plain ? heading.title : heading.title.toLowerCase()}</b>
              </div>
              {plain ? (
                <h1>
                  <span className="idx">{String(NAV.indexOf(nav) + 1).padStart(2, "0")}</span>
                  {heading.title}
                </h1>
              ) : (
                <h1>
                  {nav.solid} <span className="o">{nav.outline}</span>
                </h1>
              )}
              <div className="sub">{heading.subtitle}</div>
            </div>
          </div>
        )}
        <div key={section} className="section-anim">
          {section === "dashboard" && <DashboardSection onNavigate={setSection} />}
          {section === "networth" && <NetWorthSection />}
          {section === "assets" && <AssetsSection />}
          {section === "goals" && <GoalsSection />}
          {section === "spending" && <SpendingSection />}
          {section === "transactions" && <TransactionsSection />}
          {section === "inbox" && <InboxSection />}
          {section === "reports" && <ReportsSection />}
          {section === "bubbles" && <BubbleMapSection />}
        </div>
      </main>

      <SkinFooter />
      <StatusLine section={section} />
      <MobileNav section={section} onChange={setSection} unread={unread} />
    </div>
  );
}
