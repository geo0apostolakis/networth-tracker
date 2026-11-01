import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabaseAdmin, STATE_ID } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// Single-document persistence for the whole Zustand store. The browser talks to
// this route; the service_role key never leaves the server.

export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  try {
    const { data, error } = await supabaseAdmin()
      .from("app_state")
      .select("data")
      .eq("id", STATE_ID)
      .maybeSingle();
    if (error) throw error;
    // Return the stored object as a JSON string (what zustand persist expects).
    return NextResponse.json({ data: data ? JSON.stringify(data.data) : null });
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : typeof e === "object" && e
          ? JSON.stringify(e)
          : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  try {
    const { value } = await request.json();
    if (typeof value !== "string") {
      return NextResponse.json({ error: "value must be a string" }, { status: 400 });
    }
    // A tab left open across a deploy keeps rewriting the whole blob from the
    // older build and drops whatever that build does not know about (it wiped
    // the Solcard ledger once, and kept a stale card balance on the chart).
    // Saved state carries a version (lib/migrations.ts); a write from a lower
    // one is refused, and that tab reloads itself onto the current build.
    const incoming = JSON.parse(value) as { version?: number };
    const { data: current, error: readErr } = await supabaseAdmin()
      .from("app_state")
      .select("data")
      .eq("id", STATE_ID)
      .maybeSingle();
    if (readErr) throw readErr;
    const stored = (current?.data as { version?: number } | null)?.version ?? 0;
    if ((incoming.version ?? 0) < stored) {
      return NextResponse.json({ error: "outdated", stored }, { status: 409 });
    }
    const { error } = await supabaseAdmin().from("app_state").upsert({
      id: STATE_ID,
      data: incoming,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : typeof e === "object" && e
          ? JSON.stringify(e)
          : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// Wiping the row is only ever triggered by zustand's clearStorage, which the
// app never calls. So the one request that could destroy the data is refused
// outright, signed in or not: there is nothing it is needed for.
export async function DELETE() {
  return NextResponse.json(
    { error: "deleting the saved state is disabled" },
    { status: 405 }
  );
}
