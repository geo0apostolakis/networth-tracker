// The owner's session: a cookie that says "signed in until <exp>", signed with
// HMAC-SHA256 under AUTH_SECRET. Web Crypto only, so the same code runs in
// proxy.ts and in every route handler.
//
// proxy.ts uses it to send a signed-out browser to /login. Every API route also
// calls requireSession() itself: the proxy is a redirect layer, not the
// security boundary (Next 16.2.x shipped a proxy bypass, GHSA-6gpp-xcg3-4w24).
//
// Fails closed: with AUTH_SECRET unset or short, no token signs or verifies,
// so every route answers 401 and the login answers 503.

export const SESSION_COOKIE = "nw_session";
export const CHALLENGE_COOKIE = "nw_challenge";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) return null;
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export const authConfigured = () => (process.env.AUTH_SECRET?.length ?? 0) >= 32;

// Every token names its kind, so a passkey challenge can never pass as a session.
type Signed = { kind: string; exp: number };

export async function sign<T extends Signed>(payload: T): Promise<string | null> {
  const key = await hmacKey();
  if (!key) return null;
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function unsign<T extends Signed>(token: string | undefined, kind: T["kind"]): Promise<T | null> {
  if (!token) return null;
  const key = await hmacKey();
  if (!key) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    // subtle.verify compares in constant time.
    if (!(await crypto.subtle.verify("HMAC", key, fromB64url(sig), enc.encode(body)))) return null;
    const p = JSON.parse(dec.decode(fromB64url(body))) as T;
    if (p.kind !== kind || typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export const newSession = () => sign({ kind: "session", exp: Date.now() + SESSION_DAYS * 86_400_000 });

export async function hasSession(request: Request): Promise<boolean> {
  return !!(await unsign(readCookie(request, SESSION_COOKIE), "session"));
}

// First line of every API route: null when signed in, otherwise the 401 to return.
export async function requireSession(request: Request): Promise<Response | null> {
  if (await hasSession(request)) return null;
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

// Lax, not Strict: the Revolut consent comes back as a top-level navigation
// from the bank's site, and a Strict cookie would not ride along with it.
export function cookieOptions(maxAgeSeconds: number, path = "/") {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path,
    maxAge: maxAgeSeconds,
  };
}
