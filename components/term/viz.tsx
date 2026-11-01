"use client";

import { useEffect, useRef, useState } from "react";
import { useSkin } from "@/lib/skin";

/* Static ordered-dither field: a few soft blobs thresholded through an 8×8
   Bayer matrix at one third resolution, drawn once per size. */
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];
export function Dither({ seed = 5, intensity = 0.55, className = "" }: { seed?: number; intensity?: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // The field is recomputed pixel by pixel, so it only follows real size
    // changes: once per frame at most, and not for the few pixels a phone's
    // address bar or a late-loading card nudge the hero by.
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() =>
        setSize((p) => (Math.abs(p.w - el.clientWidth) < 24 && Math.abs(p.h - el.clientHeight) < 24 ? p : { w: el.clientWidth, h: el.clientHeight }))
      );
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  useEffect(() => {
    const cv = ref.current;
    const { w, h } = size;
    if (!cv || !w || !h) return;
    const px = w < 640 ? 4 : 3;
    const W = Math.ceil(w / px);
    const H = Math.ceil(h / px);
    cv.width = W;
    cv.height = H;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(W, H);
    const blobs = Array.from({ length: 5 }, (_, n) => ({
      x: ((Math.sin(seed * 9.1 + n * 2.3) + 1) / 2) * W,
      y: ((Math.cos(seed * 3.7 + n * 1.7) + 1) / 2) * H,
      r: (0.25 + ((n * 37 + seed * 13) % 10) / 22) * Math.max(W, H),
    }));
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let v = 0;
        for (const b of blobs) v += Math.max(0, 1 - Math.hypot(x - b.x, y - b.y) / b.r) * 0.5;
        v = Math.min(1, v) * intensity * (1 - (y / H) * 0.4);
        if (v > (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64) {
          const k = (y * W + x) * 4;
          img.data[k] = 236;
          img.data[k + 1] = 233;
          img.data[k + 2] = 223;
          img.data[k + 3] = 34;
        }
      }
    ctx.putImageData(img, 0, 0);
  }, [size, seed, intensity]);
  return (
    <div ref={box} className={`dither ${className}`} aria-hidden>
      <canvas ref={ref} style={{ imageRendering: "pixelated" }} />
    </div>
  );
}

/** ▕████▉░░░▏ with a bright head that scans along the filled part. The head
 *  is one CSS-animated glyph laid over the bar: it used to be a React timer
 *  re-rendering every bar on the page twelve times a second. */
export function BlockBar({ frac, cells = 22, tone = "ok" }: { frac: number; cells?: number; tone?: "ok" | "acc" }) {
  const c = Math.max(0, Math.min(1, frac || 0)) * cells;
  const full = Math.floor(c);
  return (
    <div className={`bb ${tone === "acc" ? "acc" : ""}`} style={{ "--f": c / cells } as React.CSSProperties} aria-hidden>
      {/* The other looks draw a plain bar (.pb); Terminal draws the glyphs. */}
      <i className="pb" />
      <span className="bb-g">{"▕"}</span>
      <span className="bb-cells">
        {Array.from({ length: cells }, (_, i) => {
          const n = Math.max(0, Math.min(1, c - i));
          const ch = n >= 1 ? "█" : n > 0 ? "▏▎▍▌▋▊▉"[Math.min(6, Math.floor(n * 7))] : "░";
          return (
            <span key={i} className={n > 0 ? "bb-on" : "bb-off"}>
              {ch}
            </span>
          );
        })}
        {full >= 2 && <span className="bb-glint" style={{ "--n": full } as React.CSSProperties} />}
      </span>
      <span className="bb-g">{"▏"}</span>
    </div>
  );
}

/** ▮▮▮▯▯ cell gauge; the lit cells fill in one after another. */
export function Cg({ frac, cells = 12, tone = "acc", delay = 0, label }: { frac: number; cells?: number; tone?: string; delay?: number; label?: string }) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const on = f > 0 ? Math.max(1, Math.round(f * cells)) : 0;
  return (
    <span className={`cg cg-${tone}`} style={{ "--f": on / cells } as React.CSSProperties} role={label ? "img" : undefined} aria-label={label} aria-hidden={!label || undefined}>
      <i className="pb" />
      {Array.from({ length: cells }, (_, i) => (
        <i key={i} className={i < on ? "on" : ""} style={i < on ? { animationDelay: `${delay + i * 40}ms` } : undefined}>
          {i < on ? "▮" : "▯"}
        </i>
      ))}
    </span>
  );
}

/** 24-segment clock: elapsed share of a period, with a blinking head. */
export function Seg({ frac, n = 24 }: { frac: number; n?: number }) {
  const on = Math.floor(Math.max(0, Math.min(1, frac)) * n);
  return (
    <div className="seg" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < on ? "on" : i === on ? "head" : ""}></i>
      ))}
    </div>
  );
}

/** Dotted sparkline drawn on canvas: lit dots fade from dim to bright up each column. */
export function Sparkline({ data, color = "var(--acc)", height = 18, label }: { data: number[]; color?: string; height?: number; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(0);
  // Colours are CSS tokens, so the dots follow the look; redraw when it changes.
  const skin = useSkin((s) => s.skin);
  const tone = useSkin((s) => s.tone);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !w) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = w * dpr;
    cv.height = height * dpr;
    cv.style.width = `${w}px`;
    cv.style.height = `${height}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(cv);
    const token = (v: string) => (v.startsWith("var(") ? css.getPropertyValue(v.slice(4, -1)).trim() : v);
    const lit = token(color) || "#d97757";
    const off = css.getPropertyValue("--spark-off").trim() || "#1a1a1d";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    const step = 3.5;
    const cols = Math.floor(w / step);
    const rows = Math.floor(height / step);
    const d = data.slice(-cols);
    const lo = Math.min(...d);
    const hi = Math.max(...d);
    const span = hi - lo || 1;
    for (let i = 0; i < d.length; i++) {
      const on = Math.max(1, Math.round(((d[i] - lo) / span) * rows));
      const x = w - (d.length - i) * step;
      for (let r = 0; r < rows; r++) {
        ctx.fillStyle = r < on ? lit : off;
        ctx.globalAlpha = r < on ? 0.45 + (r / Math.max(1, rows)) * 0.55 : 1;
        ctx.fillRect(x + 0.75, height - (r + 1) * step + 0.75, 2, 2);
      }
    }
    ctx.globalAlpha = 1;
  }, [data, w, height, color, skin, tone]);
  return (
    <div ref={box} style={{ width: "100%" }} role={label ? "img" : undefined} aria-label={label}>
      <canvas ref={ref} />
    </div>
  );
}
