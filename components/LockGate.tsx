"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Fingerprint } from "lucide-react";
import { useCurtain } from "@/lib/curtain";
import { OWNER_NAME } from "@/lib/utils";

// Mobile-only convenience lock. Uses the device's platform authenticator
// (Touch ID / fingerprint) via WebAuthn so only the owner can reveal the app.
// Note: there's no server, so this is a device-level gate, not hard security.
const CRED_KEY = "networth-bio-cred-v1";

function toB64(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function fromB64(s: string) {
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
function rand(n = 32) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

export default function LockGate() {
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [locked, setLocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canSkip, setCanSkip] = useState(false);
  // The login page has its own passkey prompt; no second lock on top of it.
  const onLogin = usePathname() === "/login";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const mq = window.matchMedia("(max-width: 768px)");
    const upd = () => setIsMobile(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);

  // Tell the rest of the app whether the lock screen is covering it.
  useEffect(() => {
    useCurtain.setState({ lock: !onLogin && (!mounted || (isMobile && locked)) });
  }, [mounted, isMobile, locked, onLogin]);

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      if (typeof window === "undefined" || !window.PublicKeyCredential) {
        setLocked(false);
        return;
      }
      const stored = localStorage.getItem(CRED_KEY);
      if (!stored) {
        // First time on this device: register a platform credential.
        const cred = (await navigator.credentials.create({
          publicKey: {
            challenge: rand(),
            rp: { name: `${OWNER_NAME} Net Worth` },
            user: { id: rand(16), name: "owner", displayName: "Owner" },
            pubKeyCredParams: [
              { type: "public-key", alg: -7 },
              { type: "public-key", alg: -257 },
            ],
            authenticatorSelection: {
              authenticatorAttachment: "platform",
              userVerification: "required",
            },
            timeout: 60000,
            attestation: "none",
          },
        })) as PublicKeyCredential | null;
        if (!cred) throw new Error("Registration cancelled");
        localStorage.setItem(CRED_KEY, toB64(cred.rawId));
        setLocked(false);
      } else {
        // Returning: verify with the fingerprint against the stored credential.
        const cred = await navigator.credentials.get({
          publicKey: {
            challenge: rand(),
            allowCredentials: [{ type: "public-key", id: fromB64(stored) }],
            userVerification: "required",
            timeout: 60000,
          },
        });
        if (!cred) throw new Error("Verification failed");
        setLocked(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t verify");
      setCanSkip(true);
    } finally {
      setBusy(false);
    }
  }

  if (onLogin || !mounted || !isMobile || !locked) return null;

  return (
    <div className="lock-gate">
      <div className="lock-gate__inner">
        <div className="lock-gate__ring">
          <Fingerprint size={38} strokeWidth={1.5} />
        </div>
        <h1 className="lock-gate__title">{OWNER_NAME}</h1>
        <p className="lock-gate__sub">MY LITTLE NETWORTH</p>
        <button
          onClick={unlock}
          disabled={busy}
          className="btn pri lock-gate__btn"
        >
          {busy ? "Verifying…" : "Unlock"}
        </button>
        {error && <p className="lock-gate__err">{error}</p>}
        {canSkip && (
          <button onClick={() => setLocked(false)} className="lock-gate__skip">
            Can’t use fingerprint? Enter anyway
          </button>
        )}
      </div>
    </div>
  );
}
