import { NextResponse } from "next/server";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
  SESSION_DAYS,
  cookieOptions,
  newSession,
  readCookie,
  requireSession,
  unsign,
} from "@/lib/auth";
import { deviceName, readPasskeys, relyingParty, writePasskeys } from "@/lib/authStore";

export const dynamic = "force-dynamic";

// Step two. POST {mode, response} with what the browser's passkey prompt
// returned. "register" saves the new passkey (needs a session); "login" checks
// the signature against a saved one and hands out the session cookie.

type Challenge = { kind: "challenge"; exp: number; mode: "login" | "register"; c: string };

export async function POST(request: Request) {
  let body: { mode?: unknown; response?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const challenge = await unsign<Challenge>(readCookie(request, CHALLENGE_COOKIE), "challenge");
  if (!challenge || challenge.mode !== body.mode || !body.response || typeof body.response !== "object") {
    return NextResponse.json({ error: "That took too long. Try again." }, { status: 400 });
  }
  const { rpID, origin } = relyingParty(request);
  // A challenge is good for one answer, right or wrong.
  const done = (res: NextResponse) => {
    res.cookies.set(CHALLENGE_COOKIE, "", cookieOptions(0, "/api/auth"));
    return res;
  };

  try {
    if (challenge.mode === "register") {
      const denied = await requireSession(request);
      if (denied) return denied;
      const v = await verifyRegistrationResponse({
        response: body.response as RegistrationResponseJSON,
        expectedChallenge: challenge.c,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!v.verified) return done(NextResponse.json({ error: "The passkey could not be verified." }, { status: 400 }));
      const { credential } = v.registrationInfo;
      const passkeys = (await readPasskeys()).filter((p) => p.id !== credential.id);
      passkeys.push({
        id: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
        name: deviceName(request),
        createdAt: new Date().toISOString(),
      });
      await writePasskeys(passkeys);
      return done(NextResponse.json({ ok: true }));
    }

    const response = body.response as AuthenticationResponseJSON;
    const passkeys = await readPasskeys();
    const saved = passkeys.find((p) => p.id === response.id);
    if (!saved) {
      return done(NextResponse.json({ error: "That passkey isn't registered here. Sign in with the password, then add it." }, { status: 401 }));
    }
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.c,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: saved.id,
        publicKey: isoBase64URL.toBuffer(saved.publicKey),
        counter: saved.counter,
        transports: saved.transports,
      },
      requireUserVerification: true,
    });
    if (!v.verified) return done(NextResponse.json({ error: "The passkey could not be verified." }, { status: 401 }));
    saved.counter = v.authenticationInfo.newCounter;
    saved.lastUsedAt = new Date().toISOString();
    await writePasskeys(passkeys);

    const token = await newSession();
    if (!token) return done(NextResponse.json({ error: "login not configured on the server" }, { status: 503 }));
    const res = done(NextResponse.json({ ok: true }));
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_DAYS * 86_400));
    return res;
  } catch (e) {
    return done(NextResponse.json({ error: e instanceof Error ? e.message : "passkey check failed" }, { status: 400 }));
  }
}
