"use client";

import { useEffect } from "react";
import AddTransactionDialog from "@/components/AddTransactionDialog";
import Freedom24Button from "@/components/Freedom24Button";
import { PaletteChip } from "@/components/skin/Backdrop";
import { Logo, ToneSwitch } from "@/components/skin/Logo";
import { Select } from "@/components/ui/Select";
import type { Section } from "@/lib/sections";
import { openPicker, useSkin } from "@/lib/skin";
import { useStore } from "@/lib/store";
import { SUPPORTED_CURRENCIES } from "@/lib/utils";
import { NAV } from "./nav";

/** vim-style "g <key>" to jump between sections. */
export function useGoKeys(onChange: (s: Section) => void) {
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, select, [contenteditable=true], [role=listbox]")) return;
      if (armed && Date.now() - armed < 1200) {
        armed = 0;
        const hit = NAV.find((n) => n.key === e.key);
        if (hit) onChange(hit.id);
        return;
      }
      if (e.key === "g") armed = Date.now();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChange]);
}

export function Header({ section, onChange, unread }: { section: Section; onChange: (s: Section) => void; unread: number }) {
  const baseCurrency = useStore((s) => s.baseCurrency);
  const setBaseCurrency = useStore((s) => s.setBaseCurrency);
  const privacy = useStore((s) => s.privacy);
  const togglePrivacy = useStore((s) => s.togglePrivacy);
  const plain = useSkin((s) => s.skin) !== "terminal";
  return (
    <header className="hdr no-print">
      <ToneSwitch />
      <button className="logo" onClick={() => onChange("dashboard")} aria-label="networth home">
        <Logo />
      </button>
      <nav aria-label="Sections">
        {NAV.map((n) => (
          <button key={n.id} className={section === n.id ? "on" : ""} aria-current={section === n.id ? "page" : undefined} onClick={() => onChange(n.id)}>
            <span className="k">{`g${n.key}`}</span>
            {plain ? n.name : n.label}
            {n.id === "inbox" && unread > 0 && <span className="badge">{unread}</span>}
          </button>
        ))}
      </nav>
      <div className="right">
        <PaletteChip />
        <Select
          value={baseCurrency}
          onChange={(v) => setBaseCurrency(v)}
          options={SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))}
          ariaLabel="Base currency"
          className="w-[84px]"
        />
        <button className="btn ghost look-btn" onClick={openPicker} title="Change the look">
          {plain ? "Look" : "look"}
        </button>
        <button className={`btn ghost ${privacy ? "acc" : ""}`} onClick={togglePrivacy} aria-pressed={privacy} title={privacy ? "Show amounts" : "Bare mode: hide amounts"}>
          {plain ? (privacy ? "Show amounts" : "Hide amounts") : privacy ? "[bare]" : "bare"}
        </button>
        <Freedom24Button />
        <AddTransactionDialog />
      </div>
    </header>
  );
}
