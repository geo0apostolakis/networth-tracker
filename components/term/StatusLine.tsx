"use client";

import { useStore } from "@/lib/store";
import type { Section } from "@/lib/sections";
import { APP_TZ } from "@/lib/utils";
import { useNow } from "./hooks";
import { NAV } from "./nav";

const clock = (t: number) => new Date(t).toLocaleTimeString("en-GB", { timeZone: APP_TZ, hour12: false });

export function StatusLine({ section }: { section: Section }) {
  const now = useNow();
  const hydrated = useStore((s) => s._hydrated);
  const fx = useStore((s) => s.fx);
  const baseCurrency = useStore((s) => s.baseCurrency);
  const f24 = useStore((s) => s.freedom24Error);
  const wallets = useStore((s) => s.wallets);
  const walletErrors = useStore((s) => s.walletErrors);
  const revolut = useStore((s) => s.revolut);
  const snapshots = useStore((s) => s.snapshots);
  const fxAge = fx.fetchedAt ? Math.round((now - new Date(fx.fetchedAt).getTime()) / 1000) : null;
  const wErr = Object.keys(walletErrors).length;
  const path = NAV.find((n) => n.id === section);
  return (
    <footer className="sl no-print" aria-label="status line">
      <span className={`mode ${hydrated ? "" : "off"}`}>{hydrated ? "LIVE" : "BOOT"}</span>
      <span>{baseCurrency}</span>
      <span>
        {"fx:"}
        <span className={fxAge != null && fxAge < 180 ? "ok" : "partial"}>{fxAge == null ? "…" : `${fxAge}s`}</span>
      </span>
      <span title={f24 ?? "Freedom24 positions synced"}>
        {"f24:"}
        <span className={f24 ? "err" : "ok"}>{f24 ? "err" : "up"}</span>
      </span>
      <span>
        {"wallets:"}
        <span className={wErr ? "partial" : "ok"}>{wallets.length ? `${wallets.length - wErr}/${wallets.length}` : "—"}</span>
      </span>
      {revolut.configured && (
        <span>
          {"revolut:"}
          <span className={revolut.error ? "err" : revolut.connected ? "ok" : "faint"}>{revolut.error ? "err" : revolut.connected ? "up" : "off"}</span>
        </span>
      )}
      <span className="dim">{`snapshots ${snapshots.length}`}</span>
      <span className="fill faint">{`~/networth/${path?.label.replace(" ", "-") ?? ""}`}</span>
      <span>{`${clock(now)} ${APP_TZ.split("/")[1] ?? ""}`}</span>
      <span className="end">
        <span className="kbd">{"g"}</span>
        {" jump"}
      </span>
    </footer>
  );
}
