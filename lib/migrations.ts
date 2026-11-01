import type { Asset, Transaction, Wallet } from "./types";

// One-off repairs to the saved state, run by zustand's persist `migrate` when a
// stored blob is older than the code. Each runs exactly once per saved state,
// in whichever tab first loads the new build, and the result is written back.

// Persisted-state version. Bump it whenever a migration is added below: /api/state
// refuses writes carrying a lower version, so a tab still running an older build
// can no longer overwrite what a newer one saved.
export const STATE_VERSION = 4;

interface Persisted {
  assets?: Asset[];
  transactions?: Transaction[];
  wallets?: Wallet[];
}

// Earlier versions (v1 to v4) repaired one person's saved data: duplicated
// manual entries and wallets added to the watch list. They were specific to
// that data, so this public copy keeps only the version number they left.

export function migrateState<T extends Persisted>(persisted: T, from: number): T {
  // v2 added addressLabels (names given to addresses on the bubble map). No data
  // changes; the bump only stops a tab from before it dropping them on save.
  void from;
  return persisted;
}
