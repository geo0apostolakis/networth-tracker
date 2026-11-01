import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { eb, isConfigured } from "@/lib/enableBanking";

export const dynamic = "force-dynamic";

// Debug helper: which banks the provider offers in a country, so the exact
// name to pass to /api/revolut/connect?aspsp= can be checked.
export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  if (!isConfigured()) {
    return NextResponse.json({ error: "Enable Banking not configured" }, { status: 503 });
  }
  const country = (new URL(request.url).searchParams.get("country") || "GR").toUpperCase();
  try {
    const j = await eb<{ aspsps: { name: string; country: string; psu_types?: string[] }[] }>(
      `/aspsps?country=${country}`
    );
    return NextResponse.json({
      country,
      aspsps: (j.aspsps ?? []).map((a) => ({ name: a.name, psu_types: a.psu_types })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 502 }
    );
  }
}
