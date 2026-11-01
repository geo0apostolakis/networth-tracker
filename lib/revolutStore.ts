import "server-only";
import { supabaseAdmin } from "./supabaseServer";
import type { Asset, Transaction } from "./types";
import type { EbAccount } from "./enableBanking";

// The Revolut connection lives in its own row of app_state (id "revolut"),
// next to the store blob. Same table, no schema change, and the browser never
// sees the session id: only the mapped assets and transactions leave the server.

export const REVOLUT_ROW = "revolut";

export interface RevolutRow {
  // Set while the user is on the consent page; matched against the callback.
  pendingState?: string;
  session?: {
    sessionId: string;
    accounts: EbAccount[];
    validUntil: string | null;
    connectedAt: string;
  };
  // Last successful read, served to the client between refreshes so the bank
  // is not called on every page load (Open Banking rate limits are per day).
  cache?: {
    assets: Asset[];
    transactions: Transaction[];
    fetchedAt: string;
    // Earliest booking date the history covers, so incremental syncs know
    // what is already there.
    historyFrom: string;
  };
  lastError?: string | null;
}

export async function readRevolut(): Promise<RevolutRow> {
  const { data, error } = await supabaseAdmin()
    .from("app_state")
    .select("data")
    .eq("id", REVOLUT_ROW)
    .maybeSingle();
  if (error) throw error;
  return (data?.data as RevolutRow) ?? {};
}

export async function writeRevolut(row: RevolutRow): Promise<void> {
  const { error } = await supabaseAdmin().from("app_state").upsert({
    id: REVOLUT_ROW,
    data: row,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
