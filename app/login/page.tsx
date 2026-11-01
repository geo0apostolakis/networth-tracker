"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { OWNER_NAME } from "@/lib/utils";

// Sign-in for the one owner. A passkey (Touch ID / Face ID) is the everyday way
// in; the password is the fallback for a device that has none yet, and right
// after a password sign-in the page offers to add one. Visited while signed in,
// it lists the passkeys and signs out.

interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

type View = "loading" | "signedOut" | "offer" | "signedIn";

async function post<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

// What the browser's passkey prompt throws, in words.
function explain(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  const code = (e as { code?: string } | null)?.code;
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "This device already has a passkey here.";
  if (name === "NotAllowedError" || name === "AbortError") return "Cancelled, or no passkey for this site on this device.";
  return e instanceof Error ? e.message : "Something went wrong.";
}

// Only a same-site path, never "//evil.com" or a full URL.
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function LoginPage() {
  const [view, setView] = useState<View>("loading");
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");

  async function refresh() {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      const j = (await res.json()) as { authed: boolean; passkeys?: PasskeyInfo[] };
      setPasskeys(j.passkeys ?? []);
      setView(j.authed ? "signedIn" : "signedOut");
    } catch {
      setView("signedOut");
    }
  }

  useEffect(() => {
    // WebAuthn support is only knowable in the browser, after the first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(browserSupportsWebAuthn());
    refresh();
  }, []);

  const go = () => window.location.replace(nextPath());

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await task();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  }

  const passkeyLogin = () =>
    run("passkey", async () => {
      const optionsJSON = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
        "/api/auth/passkey/options",
        { mode: "login" }
      );
      const response = await startAuthentication({ optionsJSON });
      await post("/api/auth/passkey/verify", { mode: "login", response });
      go();
    });

  const passwordLogin = (e: React.FormEvent) => {
    e.preventDefault();
    run("password", async () => {
      await post("/api/auth/password", { user, password });
      setPassword("");
      if (supported) setView("offer");
      else go();
    });
  };

  const addPasskey = (thenGo: boolean) =>
    run("add", async () => {
      const optionsJSON = await post<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
        "/api/auth/passkey/options",
        { mode: "register" }
      );
      const response = await startRegistration({ optionsJSON });
      await post("/api/auth/passkey/verify", { mode: "register", response });
      if (thenGo) return go();
      await refresh();
      setNote("Passkey added. Next time, sign in with it.");
    });

  const removePasskey = (id: string) =>
    run(`rm-${id}`, async () => {
      const res = await fetch(`/api/auth/passkey?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      await refresh();
    });

  const signOut = () =>
    run("out", async () => {
      await fetch("/api/auth/session", { method: "DELETE" });
      await refresh();
    });

  return (
    <main className="lock-gate login">
      <div className="lock-gate__inner login__inner">
        <div className="lock-gate__ring">
          <KeyRound size={34} strokeWidth={1.5} />
        </div>
        <h1 className="lock-gate__title">{OWNER_NAME}</h1>
        <p className="lock-gate__sub">MY LITTLE NETWORTH</p>

        {view === "loading" && <p className="dim login__line">…</p>}

        {view === "signedOut" && (
          <>
            {supported && (
              <button onClick={passkeyLogin} disabled={!!busy} className="btn pri lock-gate__btn" autoFocus>
                {busy === "passkey" ? "Waiting for passkey…" : "Sign in with passkey"}
              </button>
            )}
            <form onSubmit={passwordLogin} className="login__form">
              {supported && <p className="faint login__or">or with the password</p>}
              <input
                className="input"
                name="username"
                autoComplete="username"
                placeholder="user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                required
              />
              <input
                className="input"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button type="submit" disabled={!!busy} className={`btn ${supported ? "" : "pri"}`}>
                {busy === "password" ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </>
        )}

        {view === "offer" && (
          <>
            <p className="login__line">Skip the password next time: add a passkey for this device.</p>
            <button onClick={() => addPasskey(true)} disabled={!!busy} className="btn pri lock-gate__btn" autoFocus>
              {busy === "add" ? "Waiting for passkey…" : "Add passkey"}
            </button>
            <button onClick={go} disabled={!!busy} className="lock-gate__skip">
              Not now
            </button>
          </>
        )}

        {view === "signedIn" && (
          <>
            <p className="ok login__line">Signed in on this browser.</p>
            <ul className="login__keys">
              {passkeys.length === 0 && <li className="dim">No passkeys yet.</li>}
              {passkeys.map((p) => (
                <li key={p.id}>
                  <span className="txt">{p.name}</span>
                  <span className="faint">
                    added {day(p.createdAt)}
                    {p.lastUsedAt ? ` · used ${day(p.lastUsedAt)}` : ""}
                  </span>
                  <button onClick={() => removePasskey(p.id)} disabled={!!busy} className="btn ghost">
                    remove
                  </button>
                </li>
              ))}
            </ul>
            <div className="login__row">
              <button onClick={go} disabled={!!busy} className="btn pri">
                Open dashboard
              </button>
              {supported && (
                <button onClick={() => addPasskey(false)} disabled={!!busy} className="btn">
                  {busy === "add" ? "Waiting…" : "Add passkey on this device"}
                </button>
              )}
              <button onClick={signOut} disabled={!!busy} className="btn ghost">
                Sign out
              </button>
            </div>
          </>
        )}

        {note && <p className="ok login__line">{note}</p>}
        {error && <p className="lock-gate__err">{error}</p>}
      </div>
    </main>
  );
}
