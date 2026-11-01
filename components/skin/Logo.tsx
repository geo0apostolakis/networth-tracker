"use client";

import { toggleTone, useSkin } from "@/lib/skin";
import { CapMark } from "./Backdrop";

/** The wordmark in each look's own manner. */
export function Logo({ compact = false }: { compact?: boolean }) {
  const skin = useSkin((s) => s.skin);
  if (skin === "orbit")
    return (
      <span className="lg lg-orbit">
        <OrbitMark />
        <b>{"mylittle"}</b>
        <span>{"Networth"}</span>
      </span>
    );
  if (skin === "atmos") return <span className="lg lg-atmos">{"My Little Networth"}</span>;
  if (skin === "capital")
    return (
      <span className="lg lg-cap">
        <CapMark />
        {"My Little Networth"}
      </span>
    );
  if (skin === "hud")
    return (
      <span className="lg lg-hud">
        <HudMark />
        {"NETWORTH"}
        <i>{"//"}</i>
      </span>
    );
  return (
    <span className="lg">
      {"nw"}
      <span className="eq">{compact ? " = " : "="}</span>
      {"Σ"}
      <sup>{"$"}</sup>
      {!compact && <span className="ver">{"v2"}</span>}
    </span>
  );
}

/** Atmosphere's light/dark switch, the knob at the left of its header bar. */
export function ToneSwitch() {
  const skin = useSkin((s) => s.skin);
  const tone = useSkin((s) => s.tone);
  if (skin !== "atmos") return null;
  return (
    <button className={`tone-sw${tone === "dark" ? " on" : ""}`} onClick={toggleTone} role="switch" aria-checked={tone === "dark"} aria-label="Dark mode">
      <i />
    </button>
  );
}

function OrbitMark() {
  // Eight dots round a ring, like the cog in Cyera's mark.
  return (
    <svg viewBox="-10 -10 20 20" width="17" height="17" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return <circle key={i} cx={Math.cos(a) * 6.5} cy={Math.sin(a) * 6.5} r="2.1" fill="currentColor" />;
      })}
    </svg>
  );
}

function HudMark() {
  return (
    <svg viewBox="0 0 26 26" width="22" height="22" aria-hidden>
      <circle cx="13" cy="13" r="12" fill="none" stroke="currentColor" strokeOpacity=".55" />
      <circle cx="13" cy="13" r="9" fill="none" stroke="currentColor" strokeOpacity=".9" />
      <path d="M9 9.5h7v3H10v4h7" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
