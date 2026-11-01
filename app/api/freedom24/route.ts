import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  callTradernet,
  isPortfolioResponse,
  mapPortfolioToAssets,
} from "@/lib/freedom24";

// Fetches the Freedom24 (Tradernet) portfolio server-side (keys stay on server)
// and returns normalized assets for the client to merge into the store.
// ?debug=1 returns the raw upstream response for verifying field names.
export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const debug = searchParams.get("debug") === "1";
  try {
    const raw = await callTradernet("getPositionJson");
    if (debug) return NextResponse.json({ raw });
    // An unrecognized payload would map to zero assets, and the client treats
    // zero assets as "the account is empty" and drops the synced holdings.
    // Fail instead, so a shape change can never silently erase the portfolio.
    if (!isPortfolioResponse(raw)) {
      return NextResponse.json(
        { error: "Unexpected Freedom24 response — portfolio not found" },
        { status: 502 },
      );
    }
    return NextResponse.json({ assets: mapPortfolioToAssets(raw) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
