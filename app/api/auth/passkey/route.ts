import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { readPasskeys, writePasskeys } from "@/lib/authStore";

export const dynamic = "force-dynamic";

// DELETE ?id=: forget a passkey (a lost or replaced device). It stops working
// here at once; the device itself keeps the dead key until removed there.
export async function DELETE(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const passkeys = await readPasskeys();
    const kept = passkeys.filter((p) => p.id !== id);
    if (kept.length === passkeys.length) return NextResponse.json({ error: "no such passkey" }, { status: 404 });
    await writePasskeys(kept);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown error" }, { status: 502 });
  }
}
