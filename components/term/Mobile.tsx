"use client";

import { useMemo, useState } from "react";
import { Logo, ToneSwitch } from "@/components/skin/Logo";
import { currentNetWorth } from "@/lib/metrics";
import type { Section } from "@/lib/sections";
import { openPicker, useSkin } from "@/lib/skin";
import { useStore } from "@/lib/store";
import { formatMoney } from "@/lib/utils";
import { NAV } from "./nav";

export function MobileHeader({ onHome }: { onHome: () => void }) {
  const assets = useStore((s) => s.assets);
  const fx = useStore((s) => s.fx);
  const base = useStore((s) => s.baseCurrency);
  const privacy = useStore((s) => s.privacy);
  const nw = useMemo(() => currentNetWorth(assets, fx), [assets, fx]);
  return (
    <header className="mhdr no-print">
      <ToneSwitch />
      <button className="logo" onClick={onHome}>
        <Logo compact />
      </button>
      <div className="nw">
        <div className="k">{"net worth"}</div>
        <b>{formatMoney(nw, base, privacy)}</b>
      </div>
    </header>
  );
}

const BAR: Section[] = ["dashboard", "transactions", "spending", "inbox"];

export function MobileNav({ section, onChange, unread }: { section: Section; onChange: (s: Section) => void; unread: number }) {
  const [open, setOpen] = useState(false);
  const togglePrivacy = useStore((s) => s.togglePrivacy);
  const privacy = useStore((s) => s.privacy);
  const plain = useSkin((s) => s.skin) !== "terminal";
  return (
    <>
      <nav className="mnav no-print" aria-label="Sections">
        {BAR.map((id) => {
          const n = NAV.find((x) => x.id === id)!;
          return (
            <button key={id} className={section === id ? "on" : ""} onClick={() => onChange(id)}>
              <span className="c">{n.cmd}</span>
              {plain ? (id === "dashboard" ? "Home" : id === "transactions" ? "Activity" : n.name) : n.label}
              {id === "inbox" && unread > 0 ? <span className="acc">{` ${unread}`}</span> : null}
            </button>
          );
        })}
        <button className={BAR.includes(section) ? "" : "on"} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
          <span className="c">{"man -k"}</span>
          {plain ? "More" : "more"}
        </button>
      </nav>
      {open && (
        <>
          <div className="msheet-ovl" onClick={() => setOpen(false)} />
          <div className="msheet" role="dialog" aria-label="All sections">
            {NAV.map((n) => (
              <button
                key={n.id}
                className="row"
                onClick={() => {
                  onChange(n.id);
                  setOpen(false);
                }}
              >
                <span className="c">{n.cmd}</span>
                <span className={section === n.id ? "acc" : ""}>{plain ? n.name : n.label}</span>
              </button>
            ))}
            <button className="row" onClick={togglePrivacy}>
              <span className="c">{"stty"}</span>
              <span>{privacy ? "show amounts" : "bare mode (hide amounts)"}</span>
            </button>
            <button
              className="row"
              onClick={() => {
                setOpen(false);
                openPicker();
              }}
            >
              <span className="c">{"theme"}</span>
              <span>{"change the look"}</span>
            </button>
          </div>
        </>
      )}
    </>
  );
}
