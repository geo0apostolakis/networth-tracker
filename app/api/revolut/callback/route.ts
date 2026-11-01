import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { eb, type EbSession } from "@/lib/enableBanking";
import { readRevolut, writeRevolut } from "@/lib/revolutStore";

export const dynamic = "force-dynamic";

// Where Revolut sends the user after the consent screen. Trades the one-time
// code for a session, remembers which accounts were authorized, and bounces
// back to the dashboard. Any failure lands on the dashboard with ?revolut=error
// and the reason stored server-side for the card to show.
export async function GET(request: Request) {
  const signedOut = await requireSession(request);
  if (signedOut) return signedOut;
  const { searchParams, origin: reqOrigin } = new URL(request.url);
  const origin = process.env.APP_URL?.replace(/\/$/, "") || reqOrigin;
  const home = (q: string) => NextResponse.redirect(`${origin}/?revolut=${q}`);

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const denied = searchParams.get("error");

  let row;
  try {
    row = await readRevolut();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 502 }
    );
  }

  if (denied || !code) {
    await writeRevolut({ ...row, pendingState: undefined, lastError: denied || "no code returned" });
    return home("error");
  }
  if (!row.pendingState || row.pendingState !== state) {
    await writeRevolut({ ...row, pendingState: undefined, lastError: "state mismatch" });
    return home("error");
  }

  try {
    const session = await eb<EbSession>("/sessions", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    await writeRevolut({
      session: {
        sessionId: session.session_id,
        accounts: session.accounts ?? [],
        validUntil: session.access?.valid_until ?? null,
        connectedAt: new Date().toISOString(),
      },
      // A fresh consent means a fresh history: drop whatever the old one held.
      cache: undefined,
      pendingState: undefined,
      lastError: null,
    });
    return home("connected");
  } catch (e) {
    await writeRevolut({
      ...row,
      pendingState: undefined,
      lastError: e instanceof Error ? e.message : "unknown error",
    });
    return home("error");
  }
}
