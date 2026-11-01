import { NextResponse } from "next/server";
import { SESSION_COOKIE, cookieOptions, hasSession } from "@/lib/auth";
import { readPasskeys } from "@/lib/authStore";

export const dynamic = "force-dynamic";

// GET: is this browser signed in? Signed in, it also lists the passkeys (names
// and dates only) for the login page's management view. Signed out, it says
// nothing else, not even whether any passkey exists.
export async function GET(request: Request) {
  if (!(await hasSession(request))) return NextResponse.json({ authed: false });
  try {
    const passkeys = (await readPasskeys()).map(({ id, name, createdAt, lastUsedAt }) => ({
      id,
      name,
      createdAt,
      lastUsedAt: lastUsedAt ?? null,
    }));
    return NextResponse.json({ authed: true, passkeys });
  } catch (e) {
    return NextResponse.json({ authed: true, passkeys: [], error: e instanceof Error ? e.message : "unknown error" });
  }
}

// DELETE: sign this browser out.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  return res;
}
