import { create } from "zustand";

// Whether something still covers the app: the boot log, or the fingerprint
// lock on a phone. Motion meant to be seen (the chart drawing itself in, the
// total counting up) waits for both to lift instead of playing underneath.
export const useCurtain = create<{ splash: boolean; lock: boolean }>(() => ({ splash: true, lock: true }));

export const useCurtainUp = () => useCurtain((s) => !s.splash && !s.lock);
