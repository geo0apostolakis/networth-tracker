import type { StateStorage } from "zustand/middleware";

// Custom zustand persist backend: Supabase is the source of truth, with
// localStorage as an instant cache + offline fallback. Single-user, behind the
// /login session; all reads/writes go through /api/state (service_role stays
// server-side).

// True once /api/state has answered a read, whether it held a row or not.
// Until then no write may reach the cloud: if the read failed (Supabase paused,
// a flaky network, a 502 on a fresh device with no cache) the store hydrates
// from the empty defaults, and the very next FX tick would have upserted that
// empty state over the real row. The _hydrated gate in the store does not
// cover this, because a failed read still counts as "hydrated".
let cloudRead = false;

// Writes are coalesced: the first seconds after opening fire a dozen syncs
// (FX, broker, wallets, bank, card...), and each one used to upload the whole
// ~70 KB blob. Now a burst becomes one upload, a moment after it settles.
// Pending writes go out at once when the tab is hidden, and a read waits for
// them, so a quick switch away and back never reads back older data.
const WRITE_DELAY = 1500;
let pending: { name: string; value: string } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;

async function send(value: string) {
  try {
    const res = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    // A newer build has saved since this tab loaded: its in-memory state is
    // missing whatever that build added, so it must not write. Reload onto
    // the current build (at most once a minute, in case something loops).
    if (res.status === 409) reloadOnce();
  } catch {
    // offline: cache already updated, will reconcile on next successful write
  }
}

function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending === null) return inflight ?? Promise.resolve();
  const { name, value } = pending;
  pending = null;
  try {
    localStorage.setItem(name, value);
  } catch {}
  const prev = inflight ?? Promise.resolve();
  inflight = prev.then(() => send(value));
  return inflight;
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", () => {
    flush();
  });
}

function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem("nw-reload-at") ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem("nw-reload-at", String(Date.now()));
  } catch {}
  window.location.reload();
}

export const supabaseStorage: StateStorage = {
  getItem: async (name) => {
    await flush();
    try {
      const res = await fetch("/api/state");
      // Session expired with the tab open: go sign in again. Meanwhile hydrate
      // from the cache below (never empty defaults); cloudRead stays false, so
      // nothing is written to the cloud from this page.
      if (res.status === 401) {
        window.location.replace("/login");
      } else if (res.ok) {
        const { data } = await res.json();
        cloudRead = true;
        if (data) {
          try {
            localStorage.setItem(name, data);
          } catch {}
          return data;
        }
        // No cloud row yet — migrate whatever is cached locally up on next write.
        try {
          return localStorage.getItem(name);
        } catch {
          return null;
        }
      }
    } catch {
      // network/offline: fall back to cache below
    }
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },

  setItem: async (name, value) => {
    // Until a cloud read has succeeded only the local cache is written; the
    // focus/visibility rehydrate in app/page.tsx retries the read.
    if (!cloudRead) {
      try {
        localStorage.setItem(name, value);
      } catch {}
      return;
    }
    pending = { name, value };
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, WRITE_DELAY);
  },

  removeItem: async (name) => {
    try {
      localStorage.removeItem(name);
    } catch {}
    if (!cloudRead) return;
    try {
      await fetch("/api/state", { method: "DELETE" });
    } catch {}
  },
};
