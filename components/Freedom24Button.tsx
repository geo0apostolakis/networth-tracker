"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/neon-button";

export default function Freedom24Button() {
  const syncFreedom24 = useStore((s) => s.syncFreedom24);
  const syncError = useStore((s) => s.freedom24Error);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    setStatus(null);
    const r = await syncFreedom24();
    setBusy(false);
    setStatus(
      r.ok ? `ok · ${r.count} positions` : `err: ${r.error}`
    );
    setTimeout(() => setStatus(null), 6000);
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={sync}
        disabled={busy}
        variant="ghost"
        title="Fetch stock positions from Freedom24"
      >
        {busy ? "syncing…" : "⟳ f24"}
      </Button>
      {status && <span className="text-xs text-muted whitespace-nowrap">{status}</span>}
      {!status && syncError && (
        <span className="text-xs text-red-400" title={syncError}>
          f24 sync failed
        </span>
      )}
    </div>
  );
}
