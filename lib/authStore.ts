import "server-only";
import { supabaseAdmin } from "./supabaseServer";

// Passkeys and the wrong-password counter each live in their own app_state row,
// like the Revolut connection: same table, no schema change, never sent to the
// browser. Two rows, not one, so a burst of failed logins rewriting the counter
// can never race a passkey being saved.

const PASSKEYS_ROW = "auth-passkeys";
const THROTTLE_ROW = "auth-throttle";

export interface StoredPasskey {
  id: string; // credential id, base64url
  publicKey: string; // COSE public key, base64url
  counter: number;
  transports?: string[];
  name: string;
  createdAt: string;
  lastUsedAt?: string;
}

async function readRow<T>(id: string): Promise<T | null> {
  const { data, error } = await supabaseAdmin().from("app_state").select("data").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data?.data as T | undefined) ?? null;
}

async function writeRow(id: string, data: unknown): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("app_state")
    .upsert({ id, data, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function readPasskeys(): Promise<StoredPasskey[]> {
  return (await readRow<{ passkeys?: StoredPasskey[] }>(PASSKEYS_ROW))?.passkeys ?? [];
}

export async function writePasskeys(passkeys: StoredPasskey[]): Promise<void> {
  await writeRow(PASSKEYS_ROW, { passkeys });
}

// Ten wrong passwords in fifteen minutes shut the password door for the rest of
// that window. Passkeys keep working, so someone hammering the password can
// slow it down but never lock the owner out.
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;

async function recentFails(): Promise<number[]> {
  const fails = (await readRow<{ fails?: number[] }>(THROTTLE_ROW))?.fails ?? [];
  return fails.filter((t) => Date.now() - t < WINDOW_MS);
}

export async function passwordLocked(): Promise<boolean> {
  return (await recentFails()).length >= MAX_FAILS;
}

export async function recordPasswordFail(): Promise<void> {
  await writeRow(THROTTLE_ROW, { fails: [...(await recentFails()), Date.now()].slice(-MAX_FAILS) });
}

export async function clearPasswordFails(): Promise<void> {
  if ((await recentFails()).length) await writeRow(THROTTLE_ROW, { fails: [] });
}

// The relying party is whatever host the browser is on. A passkey is bound to
// the host it was made on, so one added at your-app.vercel.app works
// there and nowhere else (localhost and preview URLs fall back to the password).
export function relyingParty(request: Request): { rpID: string; origin: string } {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
}

// A label for the passkey list, from the browser that registered it.
export function deviceName(request: Request): string {
  const ua = request.headers.get("user-agent") ?? "";
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  return browser ? `${device} · ${browser}` : device;
}
