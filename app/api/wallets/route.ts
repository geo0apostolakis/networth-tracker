import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { detectKind, fetchWalletAssets } from "@/lib/wallets";
import type { Wallet } from "@/lib/types";

export const dynamic = "force-dynamic";

// Reads the balances of the wallets the client sends and returns them priced,
// as assets ready to merge into the store. The wallet list lives in the store
// (it is persisted with everything else), so the client is the source of truth
// for which addresses to watch; this route only does the reading.
//
// No chain is passed in. Each address is classified by its own format and an
// EVM address is read on every chain in the registry.
export async function POST(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  let wallets: Wallet[];
  try {
    const body = await request.json();
    wallets = Array.isArray(body?.wallets) ? body.wallets : [];
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const errors: Record<string, string> = {};
  const valid = wallets.filter((w) => {
    if (!w || typeof w.id !== "string" || typeof w.address !== "string") return false;
    if (!detectKind(w.address)) {
      errors[w.id] = "not a Bitcoin, Solana or EVM address";
      return false;
    }
    return true;
  });

  // Each wallet fans out to every chain, so an unbounded list would turn this
  // route into a way to make the server hammer the public RPCs.
  if (valid.length > 25) {
    return NextResponse.json({ error: "too many wallets in one request" }, { status: 400 });
  }

  try {
    const sync = await fetchWalletAssets(valid);
    return NextResponse.json({
      assets: sync.assets,
      errors: { ...errors, ...sync.errors },
      stale: sync.stale,
      warnings: sync.warnings,
      found: sync.found,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
