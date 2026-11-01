import { NextResponse } from "next/server";
import { generateAuthenticationOptions, generateRegistrationOptions } from "@simplewebauthn/server";
import { CHALLENGE_COOKIE, authConfigured, cookieOptions, requireSession, sign } from "@/lib/auth";
import { readPasskeys, relyingParty } from "@/lib/authStore";
import { OWNER_NAME } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Step one of a passkey ceremony. POST {mode: "login"} anyone may ask for;
// {mode: "register"} needs a session (you add a passkey after signing in).
// The challenge goes back in a signed, five-minute, httpOnly cookie, so the
// verify step can check it without a database round trip.

const CHALLENGE_TTL = 5 * 60;
// The same user id every time, so registering again on a device that syncs
// passkeys (iCloud Keychain) replaces its old one instead of piling up copies.
const USER_ID = new TextEncoder().encode("networth-owner");

export async function POST(request: Request) {
  if (!authConfigured()) return NextResponse.json({ error: "login not configured on the server" }, { status: 503 });
  let mode: unknown;
  try {
    mode = (await request.json())?.mode;
  } catch {
    // no body
  }
  if (mode !== "login" && mode !== "register") {
    return NextResponse.json({ error: "mode must be login or register" }, { status: 400 });
  }
  const { rpID } = relyingParty(request);

  try {
    let options;
    if (mode === "register") {
      const denied = await requireSession(request);
      if (denied) return denied;
      options = await generateRegistrationOptions({
        rpName: "my little networth",
        rpID,
        userID: USER_ID,
        userName: process.env.ADMIN_USER || "owner",
        userDisplayName: OWNER_NAME,
        attestationType: "none",
        // Already on this device: the browser says so instead of making a twin.
        excludeCredentials: (await readPasskeys()).map((p) => ({ id: p.id, transports: p.transports })),
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
      });
    } else {
      // No allowCredentials: the browser offers whatever passkey it holds for
      // this site, and nothing about stored keys leaks to a signed-out caller.
      options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
    }
    const token = await sign({ kind: "challenge", mode, c: options.challenge, exp: Date.now() + CHALLENGE_TTL * 1000 });
    if (!token) return NextResponse.json({ error: "login not configured on the server" }, { status: 503 });
    const res = NextResponse.json(options);
    res.cookies.set(CHALLENGE_COOKIE, token, cookieOptions(CHALLENGE_TTL, "/api/auth"));
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 502 });
  }
}
