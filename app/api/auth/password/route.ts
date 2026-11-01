import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { SESSION_COOKIE, SESSION_DAYS, authConfigured, cookieOptions, newSession } from "@/lib/auth";
import { clearPasswordFails, passwordLocked, recordPasswordFail } from "@/lib/authStore";

export const dynamic = "force-dynamic";

// The fallback sign-in: ADMIN_USER / ADMIN_PASSWORD from the environment. Used
// on a device without a passkey yet; a passkey is the everyday way in.

// Hash first so the compare is fixed-length and can't leak length or content.
const same = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

export async function POST(request: Request) {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!user || !password || !authConfigured()) {
    return NextResponse.json({ error: "login not configured on the server" }, { status: 503 });
  }

  let body: { user?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (typeof body.user !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "user and password required" }, { status: 400 });
  }

  try {
    if (await passwordLocked()) {
      return NextResponse.json(
        { error: "Too many wrong passwords. Use your passkey, or try again in 15 minutes." },
        { status: 429 }
      );
    }
    // Both compared before branching, so timing doesn't say which one was wrong.
    const userOk = same(body.user, user);
    const passOk = same(body.password, password);
    if (!userOk || !passOk) {
      await recordPasswordFail();
      return NextResponse.json({ error: "Wrong user or password." }, { status: 401 });
    }
    await clearPasswordFails();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "login failed" }, { status: 502 });
  }

  const token = await newSession();
  if (!token) return NextResponse.json({ error: "login not configured on the server" }, { status: 503 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_DAYS * 86_400));
  return res;
}
