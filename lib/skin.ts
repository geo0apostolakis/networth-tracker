import { create } from "zustand";

// The app's looks ("skins"). Each one restyles the same dashboard in the style
// of a well-known site: tokens, type, shapes and a background scene live in
// app/skins.css and components/skin/; the data and the layout never change.
// The choice is per device (localStorage), and the start screen asks for it.

export const SKINS = [
  { id: "terminal", name: "Terminal", from: "the original", line: "mono type, hairlines, a boot log", theme: "#050505", dark: true },
  { id: "orbit", name: "Orbit", from: "cyera.com", line: "violet space, lime crystals", theme: "#2a1040", dark: true },
  { id: "atmos", name: "Atmosphere", from: "atmos.gallery", line: "colour fog, glass pills", theme: "#f5f5f3", dark: false },
  { id: "capital", name: "Capital", from: "cyphercapital.com", line: "white, chrome, institutional", theme: "#ffffff", dark: false },
  { id: "hud", name: "HUD", from: "sibaldesign.com", line: "navy grid, cyan signal", theme: "#080c15", dark: true },
] as const;

export type Skin = (typeof SKINS)[number]["id"];
export const SKIN_IDS = SKINS.map((s) => s.id) as Skin[];
const isSkin = (v: unknown): v is Skin => typeof v === "string" && (SKIN_IDS as string[]).includes(v);

// Atmosphere's fog is coloured from a palette, the way atmos.gallery reads one
// from a photo. The chip in the corner steps through them.
export const ATMOS_PALETTES = [
  { name: "Frozen Slate", c: ["#c3cfe3", "#94aad3", "#f3f4f4", "#b9bdc8"], thumb: "linear-gradient(135deg,#9db4dc,#5d7fbf)" },
  { name: "High Key", c: ["#d3dfc6", "#7db27a", "#f4f4ee", "#d8d3a6"], thumb: "linear-gradient(135deg,#e8f0d8,#6aa65f)" },
  { name: "Garnet", c: ["#ecd0ca", "#c0574a", "#f7efea", "#eba07e"], thumb: "linear-gradient(135deg,#f1c2b2,#a5322a)" },
  { name: "Dusk", c: ["#d6cfe9", "#9b8bd0", "#f6f2f6", "#f0c8b4"], thumb: "linear-gradient(135deg,#d8c8f0,#e9a98d)" },
] as const;

const KEY = "nw-skin";
const TONE_KEY = "nw-atmos-tone";
const PALETTE_KEY = "nw-atmos-palette";

interface SkinState {
  skin: Skin;
  /** The start screen is up: on every open, and again from the "look" button. */
  picking: boolean;
  /** Atmosphere only: light or dark ground. */
  tone: "light" | "dark";
  palette: number;
}

// Starts as "terminal" on the server and the client alike, so hydration
// matches; SkinBoot then reads the saved choice. CSS never waits for React:
// the inline script in the layout sets data-skin before the first paint.
export const useSkin = create<SkinState>(() => ({ skin: "terminal", picking: true, tone: "light", palette: 0 }));

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

function paint(s: Pick<SkinState, "skin" | "tone">) {
  const el = document.documentElement;
  el.dataset.skin = s.skin;
  el.dataset.tone = s.skin === "atmos" ? s.tone : "";
  const meta = SKINS.find((x) => x.id === s.skin)!;
  const dark = s.skin === "atmos" ? s.tone === "dark" : meta.dark;
  el.style.colorScheme = dark ? "dark" : "light";
  const color = s.skin === "atmos" && s.tone === "dark" ? "#1c1b1a" : meta.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
}

/** Read the saved look into the store (once, on mount). */
export function loadSkin() {
  const saved = store.get(KEY);
  const tone = store.get(TONE_KEY) === "dark" ? "dark" : "light";
  const p = Number(store.get(PALETTE_KEY));
  const next = {
    skin: isSkin(saved) ? saved : ("terminal" as Skin),
    tone: tone as SkinState["tone"],
    palette: Number.isInteger(p) && p >= 0 && p < ATMOS_PALETTES.length ? p : 0,
  };
  useSkin.setState(next);
  paint(next);
}

export function setSkin(skin: Skin) {
  store.set(KEY, skin);
  useSkin.setState({ skin });
  paint({ skin, tone: useSkin.getState().tone });
}

export function toggleTone() {
  const tone = useSkin.getState().tone === "dark" ? "light" : "dark";
  store.set(TONE_KEY, tone);
  useSkin.setState({ tone });
  paint({ skin: useSkin.getState().skin, tone });
}

export function nextPalette() {
  const palette = (useSkin.getState().palette + 1) % ATMOS_PALETTES.length;
  store.set(PALETTE_KEY, String(palette));
  useSkin.setState({ palette });
}

export const openPicker = () => useSkin.setState({ picking: true });

/** Runs before the first paint (inlined in <head>), so a reload never flashes
 *  the wrong colours while React boots. */
export const SKIN_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage.getItem("${KEY}");if(s&&/^(${SKIN_IDS.join("|")})$/.test(s)){d.dataset.skin=s;if(s==="atmos")d.dataset.tone=localStorage.getItem("${TONE_KEY}")==="dark"?"dark":"light";}}catch(e){}})();`;

/** Resolve a CSS colour token to a value a canvas can use. */
export function cssColor(token: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || fallback;
}
