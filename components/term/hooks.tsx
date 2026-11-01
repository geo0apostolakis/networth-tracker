"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

/** Wall clock that re-renders every `step` ms. */
export function useNow(step = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), step);
    return () => clearInterval(id);
  }, [step]);
  return now;
}

/** Eases toward `target` with an ease-out cubic so counters glide instead of jumping. */
export function useTween(target: number, ms = 700) {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    cur.current = v;
  });
  useEffect(() => {
    const from = cur.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(from + (target - from) * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** True for `ms` after `key` changes (e.g. a value moved). State only changes in timer callbacks. */
export function useFlash(key: unknown, ms = 900) {
  const [hot, setHot] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const on = setTimeout(() => setHot(true), 0);
    const off = setTimeout(() => setHot(false), ms);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [key, ms]);
  return hot;
}

/** A media query, read without an effect (and false on the server). */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

export const useNarrow = () => useMedia("(max-width: 640px)");
export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");

/**
 * A number that glides to each new value. It writes the text straight into
 * its own <span> every frame instead of going through React state, so a count
 * re-renders nothing around it (it used to re-render the whole dashboard,
 * charts included, sixty times a second). While `hold` is set it stays where
 * it is, so the first count-up plays when the screen is actually visible.
 */
export function Ticker({ value, format, hold = false, ms = 900, className }: { value: number; format: (v: number) => string; hold?: boolean; ms?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    if (hold) {
      shown.current = from ?? 0;
      el.textContent = format(shown.current);
      return;
    }
    if (from === null || reduce || Math.abs(value - from) < 0.005) {
      shown.current = value;
      el.textContent = format(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const v = from + (value - from) * (1 - (1 - k) ** 3);
      shown.current = v;
      el.textContent = format(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, format, hold, ms, reduce]);
  return <span ref={ref} className={className} />;
}
