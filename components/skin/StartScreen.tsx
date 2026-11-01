"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useCurtain } from "@/lib/curtain";
import { loadSkin, setSkin, SKINS, useSkin, type Skin } from "@/lib/skin";
import { Crystal, Planet, Rock, Shard } from "./orbitArt";
import { CapMark } from "./Backdrop";

// The start screen: every time the app opens, one tile per look, each drawn in
// its own style. Tap one (or press 1 to 5) and the app opens in it; Enter opens
// the one used last time. The "look" button brings it back later.

const lift = () => useCurtain.setState({ splash: false });

export default function StartScreen() {
  const picking = useSkin((s) => s.picking);
  const current = useSkin((s) => s.skin);
  const [leaving, setLeaving] = useState<Skin | null>(null);
  const [focus, setFocus] = useState(0);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  // Not on the login page: the picker would cover it and its keys (Enter,
  // 1 to 5) would fire while typing the password.
  const onLogin = usePathname() === "/login";

  useEffect(() => {
    loadSkin();
    const i = SKINS.findIndex((s) => s.id === useSkin.getState().skin);
    // The saved choice is only readable on the client, after the first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocus(Math.max(0, i));
  }, []);

  const choose = (id: Skin) => {
    if (leaving) return;
    setSkin(id);
    setLeaving(id);
    lift();
    setTimeout(() => {
      useSkin.setState({ picking: false });
      setLeaving(null);
    }, 420);
  };

  useEffect(() => {
    if (!picking || onLogin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= SKINS.length) return choose(SKINS[n - 1].id);
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
        e.preventDefault();
        return choose(e.key === "Escape" ? useSkin.getState().skin : SKINS[focus].id);
      }
      const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (dir) {
        e.preventDefault();
        const next = (focus + dir + SKINS.length) % SKINS.length;
        setFocus(next);
        tiles.current[next]?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!picking || onLogin) return null;
  const last = SKINS.find((s) => s.id === current)!;
  return (
    <div className={`pick${leaving ? " out" : ""}`} role="dialog" aria-label="Pick a look">
      <div className="pick-in">
        <header className="pick-h">
          <div className="pick-k">{"my little networth"}</div>
          <h1>{"Pick a look."}</h1>
          <p>{"Same money, five designs. You can switch any time with the look button."}</p>
        </header>
        <div className="pick-grid">
          {SKINS.map((s, i) => (
            <button
              key={s.id}
              ref={(el) => {
                tiles.current[i] = el;
              }}
              className={`pk pk-${s.id}${s.id === current ? " last" : ""}${leaving === s.id ? " chosen" : ""}`}
              style={{ "--i": i } as React.CSSProperties}
              onClick={() => choose(s.id)}
              onFocus={() => setFocus(i)}
              aria-label={`${s.name}, from ${s.from}`}
            >
              <span className="pk-art" aria-hidden>
                <TileArt id={s.id} />
              </span>
              <span className="pk-f">
                <span className="pk-n">{`0${i + 1}`}</span>
                <span className="pk-name">{s.name}</span>
                <span className="pk-from">{s.from}</span>
                {s.id === current && <span className="pk-last">{"last used"}</span>}
              </span>
            </button>
          ))}
        </div>
        <div className="pick-foot">
          <span>
            <kbd>{"1"}</kbd>
            {"–"}
            <kbd>{"5"}</kbd>
            {" pick"}
          </span>
          <span>
            <kbd>{"enter"}</kbd>
            {` open ${last.name}`}
          </span>
        </div>
      </div>
    </div>
  );
}

/** A small picture of each look, in its own type and colours. */
function TileArt({ id }: { id: Skin }) {
  if (id === "terminal")
    return (
      <span className="ta-term">
        <span className="wm">
          {"nw"}
          <em>{" = "}</em>
          {"Σ"}
          <sup>{"$"}</sup>
        </span>
        <span>
          {"[ "}
          <b>{"OK"}</b>
          {" ] Started wallets.service"}
        </span>
        <span>
          {"[ "}
          <b>{"OK"}</b>
          {" ] Started revolut-ob.service"}
        </span>
        <span>
          {"[ "}
          <b>{"OK"}</b>
          {" ] Reached target networth"}
        </span>
        <span className="cur">{"_"}</span>
      </span>
    );
  if (id === "orbit")
    return (
      <span className="ta-orbit">
        <span className="ring" />
        <span className="f r1">
          <Rock size={56} />
        </span>
        <span className="f r2">
          <Rock size={34} tone={1} />
        </span>
        <span className="f s1">
          <Shard size={22} />
        </span>
        <span className="f c1">
          <Crystal size={44} />
        </span>
        <Planet className="pl" />
        <span className="t">{"Know your money."}</span>
        <span className="go">
          {"Begin your mission"}
          <i>{"→"}</i>
        </span>
      </span>
    );
  if (id === "atmos")
    return (
      <span className="ta-atmos">
        <span className="fog" />
        <span className="bar">{"My Little Networth"}</span>
        <span className="t">
          {"Money read like"}
          <br />
          {"the weather."}
          <em>{"In seconds."}</em>
        </span>
        <span className="pills">
          <b>{"Open"}</b>
          <i>{"How it works"}</i>
        </span>
      </span>
    );
  if (id === "capital")
    return (
      <span className="ta-cap">
        <span className="tubes">
          <i />
          <i />
          <i />
        </span>
        <span className="lg">
          <CapMark />
          {"My Little Networth"}
        </span>
        <span className="t">{"Bridging pocket money with frontier opportunities"}</span>
        <span className="u">{"Explore holdings"}</span>
      </span>
    );
  return (
    <span className="ta-hud">
      <span className="grid" />
      <span className="tag">
        <i />
        {"NOW.ONLINE"}
      </span>
      <span className="t">
        {"NET WORTH"}
        <em>{"SYSTEM"}</em>
      </span>
      <span className="m">{"EST.2026 [PORTFOLIO / V2]"}</span>
      <span className="streak" />
    </span>
  );
}
