import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import crypto from "crypto";
import { eb, isConfigured } from "@/lib/enableBanking";
import { readRevolut, writeRevolut } from "@/lib/revolutStore";

export const dynamic = "force-dynamic";

// Starts the Open Banking consent: asks Enable Banking for a Revolut
// authorization URL and sends the browser there. Revolut hands back a code to
// /api/revolut/callback once the user approves. Consent lasts up to 90 days.
export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "ENABLE_BANKING_APP_ID / ENABLE_BANKING_PRIVATE_KEY not set" },
      { status: 503 }
    );
  }
  const { searchParams } = new URL(request.url);
  // Revolut is registered per country on the provider's side. Greece by
  // default; override with ?country=XX if the account was opened elsewhere.
  const country = (searchParams.get("country") || "GR").toUpperCase();
  const aspsp = searchParams.get("aspsp") || "Revolut";
  const origin = process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;

  try {
    const state = crypto.randomUUID();
    const validUntil = new Date(Date.now() + 89 * 86_400_000).toISOString();
    const auth = await eb<{ url: string; authorization_id: string }>("/auth", {
      method: "POST",
      body: JSON.stringify({
        access: { valid_until: validUntil },
        aspsp: { name: aspsp, country },
        redirect_url: `${origin}/api/revolut/callback`,
        psu_type: "personal",
        state,
      }),
    });
    const row = await readRevolut();
    await writeRevolut({ ...row, pendingState: state, lastError: null });
    return NextResponse.redirect(auth.url);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
