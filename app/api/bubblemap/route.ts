import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { buildBubbleMap } from "@/lib/bubblemap";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/bubblemap?a=0x..,0x.. — the transfer graph around these addresses.
// On-chain history is public, the same for every viewer, and slow to collect
// (a few hundred explorer calls on a cold start), so the CDN keeps each answer
// for ten minutes and serves the stale one while it refreshes.
export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  const raw = new URL(request.url).searchParams.get("a") ?? "";
  const addresses = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (addresses.length === 0) return NextResponse.json({ error: "pass addresses as ?a=0x..,0x.." }, { status: 400 });
  if (addresses.length > 25) return NextResponse.json({ error: "at most 25 addresses" }, { status: 400 });
  const expand = new URL(request.url).searchParams.get("expand") === "1";
  try {
    const map = await buildBubbleMap(addresses, { perWallet: expand ? 25 : 40 });
    // A map with a chain that failed part-way is shown, but never cached:
    // the next view should try again rather than keep the gap for ten minutes.
    const cache = map.errors.length ? "no-store" : "public, s-maxage=600, stale-while-revalidate=3600";
    return NextResponse.json(map, { headers: { "Cache-Control": cache } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "bubble map failed" }, { status: 502 });
  }
}
