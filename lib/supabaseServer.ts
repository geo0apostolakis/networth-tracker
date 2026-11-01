import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client using the service_role key. This bypasses RLS, so
// it must never be imported into client code.
//
// Created lazily, on the first request that needs it. Throwing at import time
// looked stricter but made `next build` itself fail whenever the env vars were
// not present at build time (Next evaluates every route module while
// collecting page data), so a clean checkout could not even be built. Missing
// vars now surface where they belong: as a 502 from the route that hit them.
let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env vars missing (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// Single-user app: the whole store lives in one row.
export const STATE_ID = "default";
