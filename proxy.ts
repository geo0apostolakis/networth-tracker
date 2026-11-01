import { NextResponse, type NextRequest } from "next/server";
import { hasSession } from "@/lib/auth";

// Signed-out browsers go to /login; signed-out API calls get a 401. This is the
// convenience layer only: every API route checks the session again itself
// (requireSession in lib/auth.ts), so a proxy bypass still reaches no data.
//
// Open without a session: the login page and its API, and the nightly cron,
// which carries its own CRON_SECRET and could never hold a browser cookie.
const OPEN = [/^\/login$/, /^\/api\/auth\//, /^\/api\/cron\//];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN.some((r) => r.test(pathname)) || (await hasSession(request))) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" && !search ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's static output and the icons a browser fetches
  // before it has a session. This deliberately DOES match /api/*.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)"],
};
