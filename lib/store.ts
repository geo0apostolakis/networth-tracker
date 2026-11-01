import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { supabaseStorage } from "./supabaseStorage";
import { fetchRates, isStale } from "./fx";
import {
  type Annotation,
  type Asset,
  type FxState,
  type Milestone,
  type Snapshot,
  type Transaction,
  type TransactionType,
  type TxnCategory,
  type Wallet,
  type SolcardConfig,
  type TxnEdit,
  DEFAULT_TXN_CATEGORIES,
  SOLCARD_ASSET_ID,
  BITREFILL_ASSET_ID,
  TXN_PALETTE,
} from "./types";
import { uid, dayKey } from "./utils";
import { categorize } from "./categorize";
import { buildCardLedger, CARD_CURRENCY, type ChainTopup } from "./solcardLedger";
import { migrateState, STATE_VERSION } from "./migrations";

interface State {
  assets: Asset[];
  snapshots: Snapshot[];
  transactions: Transaction[];
  txnCategories: TxnCategory[];
  baseCurrency: string;
  fx: FxState;
  milestones: Milestone[];
  annotations: Annotation[];
  readDigests: string[]; // digest ids ("2026-03") already opened in the inbox
  benchmark: string; // ticker compared against the portfolio
  privacy: boolean; // "bare mode" — hide real amounts, keep percentages
  chartMode: "stacked" | "line"; // net-worth-over-time view: category bands vs glowing total line
  // Last broker sync failure, kept in memory only. The sync runs on a timer, so
  // without this a broken key fails silently and net worth just reads low.
  freedom24Error: string | null;
  // Crypto addresses being watched. Their balances arrive as assets with
  // source "wallet" and are replaced wholesale on every sync.
  wallets: Wallet[];
  walletErrors: Record<string, string>; // wallet id -> last failure, memory only
  walletWarnings: Record<string, string>; // wallet id -> read but unpriced, memory only
  walletChains: Record<string, string[]>; // wallet id -> chains value was found on, memory only
  // Revolut connection, as reported by /api/revolut. Memory only: the server
  // holds the session, the client only ever sees status and mapped data.
  revolut: RevolutStatus;
  // Hand edits, by transaction id. Imported entries are rebuilt on every sync,
  // so their edits live here and are laid back over the fresh copy.
  txnEdits: Record<string, TxnEdit>;
  // Names you give to addresses on the bubble map, by lowercase address.
  addressLabels: Record<string, string>;
  solcard: SolcardConfig;
  // Last Solcard read, memory only.
  solcardMeta: {
    fetchedAt: string | null;
    error: string | null;
    poisoned: number;
    loading: boolean;
    rate: number | null; // share of each top-up Solcard kept, as seen on statements
    statement: { from: string; to: string; closing: number; currency: string; generated: string; count: number } | null;
  };
  bitrefillMeta: { configured: boolean; fetchedAt: string | null; error: string | null };
  _hydrated: boolean;
  // True once /api/snapshots has answered (memory only). The chart waits for
  // it so it draws the history once, not a lone "today" point first.
  snapshotsLoaded: boolean;
  togglePrivacy: () => void;
  setChartMode: (m: "stacked" | "line") => void;
  addMilestone: (name: string, target: number) => void;
  removeMilestone: (id: string) => void;
  markMilestoneHit: (id: string) => void;
  addAnnotation: (date: string, label: string, note?: string) => void;
  removeAnnotation: (id: string) => void;
  markDigestRead: (id: string) => void;
  markAllDigestsRead: (ids: string[]) => void;
  setBenchmark: (symbol: string) => void;
  addAsset: (a: Omit<Asset, "id" | "updatedAt">) => void;
  updateAsset: (id: string, patch: Partial<Asset>) => void;
  removeAsset: (id: string) => void;
  addTransaction: (t: {
    assetId: string;
    type: TransactionType;
    amount: number;
    categoryId?: string;
    note?: string;
    date?: string;
  }) => void;
  editTransaction: (id: string, patch: TxnEdit & { assetId?: string }) => void;
  setSolcard: (patch: Partial<SolcardConfig>) => void;
  setAddressLabel: (address: string, label: string) => void;
  syncSolcard: () => Promise<{ ok: boolean; count?: number; error?: string }>;
  checkSolcardBalance: (real: number) => void;
  importSolcardStatement: (file: File) => Promise<{ ok: boolean; error?: string; from?: string; to?: string; count?: number }>;
  syncBitrefill: () => Promise<{ ok: boolean; count?: number; error?: string }>;
  removeTransaction: (id: string) => void;
  removeTransactions: (ids: string[]) => void;
  addTxnCategory: (name: string, kind: TransactionType) => string;
  renameTxnCategory: (id: string, name: string) => void;
  removeTxnCategory: (id: string) => void;
  loadSnapshots: () => Promise<void>;
  saveSnapshot: () => Promise<void>;
  autoSnapshot: () => Promise<void>;
  removeSnapshot: (id: string) => Promise<void>;
  setBaseCurrency: (c: string) => Promise<void>;
  refreshFx: (force?: boolean) => Promise<void>;
  syncFreedom24: () => Promise<{ ok: boolean; count?: number; error?: string }>;
  addWallet: (label: string, address: string) => void;
  removeWallet: (id: string) => void;
  syncWallets: () => Promise<{ ok: boolean; count?: number; error?: string }>;
  repriceWallets: () => Promise<void>;
  syncRevolut: (force?: boolean) => Promise<{ ok: boolean; error?: string }>;
  disconnectRevolut: () => Promise<void>;
}

export interface RevolutStatus {
  configured: boolean;
  connected: boolean;
  accounts: { name: string; currency: string }[];
  connectedAt: string | null;
  validUntil: string | null;
  fetchedAt: string | null;
  error: string | null;
  loading: boolean;
}

const emptyRevolut: RevolutStatus = {
  configured: false,
  connected: false,
  accounts: [],
  connectedAt: null,
  validUntil: null,
  fetchedAt: null,
  error: null,
  loading: false,
};

const emptyFx = (base: string): FxState => ({
  base,
  rates: { [base]: 1 },
  fetchedAt: null,
});

// Two addresses, entered in the Solcard panel: the wallet that only ever pays
// the card, and the card's deposit address (check it against your first real
// top-up: address-poisoning spam imitates it). Empty until you set them.
export const DEFAULT_SOLCARD: SolcardConfig = {
  funding: "",
  deposit: "",
  feePct: 5,
};

/** Lay saved edits over a list; hidden entries drop out. */
export function applyEdits(list: Transaction[], edits: Record<string, TxnEdit>): Transaction[] {
  const out: Transaction[] = [];
  for (const t of list) {
    const e = edits[t.id];
    if (!e) {
      out.push(t);
      continue;
    }
    if (e.hidden) continue;
    const { hidden: _h, ...rest } = e;
    void _h;
    out.push({ ...t, ...rest });
  }
  return out;
}

/** A derived balance (Solcard card, Bitrefill credit) is never stored by hand: it is every entry on it, summed. */
function cardBalance(transactions: Transaction[], assetId: string = SOLCARD_ASSET_ID): number {
  let v = 0;
  for (const t of transactions) {
    if (t.assetId !== assetId) continue;
    v += t.type === "earned" ? t.amount : -t.amount;
  }
  return Math.round(v * 100) / 100;
}

const DERIVED = [SOLCARD_ASSET_ID, BITREFILL_ASSET_ID];

/** Re-derive the amounts of the ledger-backed balances from their entries. */
function withCard(assets: Asset[], transactions: Transaction[]): Asset[] {
  if (!assets.some((a) => DERIVED.includes(a.id))) return assets;
  return assets.map((a) => {
    if (!DERIVED.includes(a.id)) return a;
    const amount = cardBalance(transactions, a.id);
    return a.amount !== amount ? { ...a, amount, updatedAt: new Date().toISOString() } : a;
  });
}

const IMPORTED = new Set(["revolut", "solcard", "bitrefill"]);

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      assets: [],
      snapshots: [],
      transactions: [],
      txnCategories: DEFAULT_TXN_CATEGORIES,
      milestones: [],
      annotations: [],
      readDigests: [],
      benchmark: "URTH",
      baseCurrency: "EUR",
      fx: emptyFx("EUR"),
      privacy: false,
      chartMode: "stacked",
      freedom24Error: null,
      wallets: [],
      walletErrors: {},
      walletWarnings: {},
      walletChains: {},
      revolut: emptyRevolut,
      txnEdits: {},
      addressLabels: {},
      solcard: DEFAULT_SOLCARD,
      solcardMeta: { fetchedAt: null, error: null, poisoned: 0, loading: false, rate: null, statement: null },
      bitrefillMeta: { configured: false, fetchedAt: null, error: null },
      _hydrated: false,
      snapshotsLoaded: false,

      togglePrivacy: () => set((s) => ({ privacy: !s.privacy })),

      setChartMode: (m) => set({ chartMode: m }),

      addMilestone: (name, target) =>
        set((s) => ({
          milestones: [
            ...s.milestones,
            {
              id: uid(),
              name: name.trim(),
              target,
              currency: s.baseCurrency,
              createdAt: new Date().toISOString(),
            },
          ],
        })),

      removeMilestone: (id) =>
        set((s) => ({ milestones: s.milestones.filter((m) => m.id !== id) })),

      // Stamped the first time a target is reached, so the celebration fires
      // once instead of on every render that happens to be above the line.
      markMilestoneHit: (id) =>
        set((s) => ({
          milestones: s.milestones.map((m) =>
            m.id === id && !m.hitAt
              ? { ...m, hitAt: new Date().toISOString() }
              : m
          ),
        })),

      addAnnotation: (date, label, note) =>
        set((s) => ({
          annotations: [
            ...s.annotations,
            { id: uid(), date, label: label.trim(), note: note?.trim() || undefined },
          ].sort((a, b) => a.date.localeCompare(b.date)),
        })),

      removeAnnotation: (id) =>
        set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),

      markDigestRead: (id) =>
        set((s) =>
          s.readDigests.includes(id)
            ? {}
            : { readDigests: [...s.readDigests, id] }
        ),

      markAllDigestsRead: (ids) =>
        set((s) => ({ readDigests: [...new Set([...s.readDigests, ...ids])] })),

      setBenchmark: (symbol) => set({ benchmark: symbol }),

      addAsset: (a) =>
        set((s) => ({
          assets: [
            ...s.assets,
            { ...a, id: uid(), updatedAt: new Date().toISOString() },
          ],
        })),

      updateAsset: (id, patch) =>
        set((s) => ({
          assets: s.assets.map((a) =>
            a.id === id
              ? { ...a, ...patch, updatedAt: new Date().toISOString() }
              : a
          ),
        })),

      removeAsset: (id) =>
        set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),

      // Apply a money-in (earned) or money-out (spent) movement to an existing
      // asset and log it with a note — no need to open Edit.
      addTransaction: ({ assetId, type, amount, categoryId, note, date }) =>
        set((s) => {
          const asset = s.assets.find((a) => a.id === assetId);
          if (!asset || isNaN(amount)) return {};
          const delta = type === "earned" ? amount : -amount;
          const txn: Transaction = {
            id: uid(),
            assetId,
            type,
            amount: Math.abs(amount),
            currency: asset.currency,
            categoryId,
            note: note?.trim() || undefined,
            date: date ?? new Date().toISOString(),
          };
          // Kept newest first like every sync leaves it: a purchase logged with
          // an older date belongs further down, not at the top of the log.
          const transactions = [txn, ...s.transactions].sort((a, b) => b.date.localeCompare(a.date));
          if (DERIVED.includes(assetId)) return { transactions, assets: withCard(s.assets, transactions) };
          return {
            assets: s.assets.map((a) =>
              a.id === assetId
                ? {
                    ...a,
                    amount: Math.round((a.amount + delta) * 100) / 100,
                    updatedAt: new Date().toISOString(),
                  }
                : a
            ),
            transactions,
          };
        }),

      // Delete history entries. Removes the log only — current asset balances
      // are left as-is (the money movement already happened). Imported rows
      // are skipped: the next bank sync would only bring them back.
      removeTransaction: (id) =>
        set((s) => {
          const transactions = s.transactions.filter((t) => t.id !== id || IMPORTED.has(t.source ?? ""));
          return { transactions, assets: withCard(s.assets, transactions) };
        }),

      removeTransactions: (ids) =>
        set((s) => {
          const drop = new Set(ids);
          return {
            transactions: s.transactions.filter(
              (t) => !drop.has(t.id) || IMPORTED.has(t.source ?? "")
            ),
          };
        }),

      // Edit any entry. Imported ones keep the edit in txnEdits so the next sync
      // cannot undo it. A hand-entered one is changed in place, and if it sits
      // on a hand-kept balance, that balance is moved by the difference (the
      // same way adding it moved it in the first place).
      editTransaction: (id, patch) =>
        set((s) => {
          const old = s.transactions.find((t) => t.id === id);
          if (!old) return {};
          const { assetId: newAssetId, ...edit } = patch;
          if (IMPORTED.has(old.source ?? "")) {
            const txnEdits = { ...s.txnEdits, [id]: { ...s.txnEdits[id], ...edit } };
            const transactions = edit.hidden
              ? s.transactions.filter((t) => t.id !== id)
              : s.transactions.map((t) => (t.id === id ? { ...t, ...edit, hidden: undefined } as Transaction : t));
            return { txnEdits, transactions, assets: withCard(s.assets, transactions) };
          }
          if (edit.hidden) {
            // Deleting a hand-entered entry undoes what adding it did to its balance.
            const transactions = s.transactions.filter((t) => t.id !== id);
            const back = old.type === "earned" ? -old.amount : old.amount;
            const assets = s.assets.map((a) =>
              a.id === old.assetId && a.source === "manual"
                ? { ...a, amount: Math.round((a.amount + back) * 100) / 100, updatedAt: new Date().toISOString() }
                : a
            );
            return { transactions, assets: withCard(assets, transactions) };
          }
          const next: Transaction = {
            ...old,
            ...(edit.type ? { type: edit.type } : {}),
            ...(edit.amount != null && !isNaN(edit.amount) ? { amount: Math.abs(edit.amount) } : {}),
            ...(edit.categoryId !== undefined ? { categoryId: edit.categoryId || undefined } : {}),
            ...(edit.note !== undefined ? { note: edit.note.trim() || undefined } : {}),
            ...(edit.date ? { date: edit.date } : {}),
            ...(edit.transfer !== undefined ? { transfer: edit.transfer || undefined } : {}),
            ...(newAssetId ? { assetId: newAssetId } : {}),
          };
          const effect = (t: Transaction) => (t.type === "earned" ? t.amount : -t.amount);
          const manual = (assetId: string) => s.assets.find((a) => a.id === assetId)?.source === "manual";
          const moves = new Map<string, number>();
          if (manual(old.assetId)) moves.set(old.assetId, (moves.get(old.assetId) ?? 0) - effect(old));
          if (manual(next.assetId)) moves.set(next.assetId, (moves.get(next.assetId) ?? 0) + effect(next));
          const transactions = s.transactions.map((t) => (t.id === id ? next : t)).sort((a, b) => b.date.localeCompare(a.date));
          const assets = s.assets.map((a) =>
            moves.get(a.id) ? { ...a, amount: Math.round((a.amount + (moves.get(a.id) ?? 0)) * 100) / 100, updatedAt: new Date().toISOString() } : a
          );
          return { transactions, assets: withCard(assets, transactions) };
        }),

      setSolcard: (patch) => set((s) => ({ solcard: { ...s.solcard, ...patch } })),

      setAddressLabel: (address, label) =>
        set((s) => {
          const k = address.toLowerCase();
          const next = { ...s.addressLabels };
          if (label.trim()) next[k] = label.trim();
          else delete next[k];
          return { addressLabels: next };
        }),

      // Rebuild the card ledger from the chain (top-ups) and the uploaded
      // statements (what the card credited, purchases, fees). Whatever was
      // logged by hand against the card stays as it is.
      syncSolcard: async () => {
        const { solcard } = get();
        set((s) => ({ solcardMeta: { ...s.solcardMeta, loading: true } }));
        try {
          const [chainRes, stmtRes] = await Promise.all([
            solcard.funding && solcard.deposit ? fetch(`/api/solcard?funding=${solcard.funding}&deposit=${solcard.deposit}`) : null,
            fetch("/api/solcard/statement"),
          ]);
          const chain = chainRes ? await chainRes.json() : { topups: [] };
          if (chainRes && !chainRes.ok) throw new Error(chain.error || `HTTP ${chainRes.status}`);
          const stmt = await stmtRes.json();
          if (!stmtRes.ok) throw new Error(stmt.error || `statements HTTP ${stmtRes.status}`);
          const topups: ChainTopup[] = chain.topups ?? [];
          const { entries, rate, statement } = buildCardLedger(topups, stmt.statements ?? [], solcard);
          set((s) => {
            const merged = [...applyEdits(entries, s.txnEdits), ...s.transactions.filter((t) => t.source !== "solcard")];
            const cat = categorize(merged, s.txnCategories, s.txnEdits);
            const transactions = cat.transactions.sort((a, b) => b.date.localeCompare(a.date));
            const has = s.assets.find((a) => a.id === SOLCARD_ASSET_ID);
            const card: Asset = {
              id: SOLCARD_ASSET_ID,
              name: "Solcard card",
              category: "bank",
              currency: CARD_CURRENCY,
              amount: 0,
              source: "solcard",
              updatedAt: new Date().toISOString(),
            };
            // The card is a USD card; early versions kept it in EUR.
            const assets = has
              ? has.currency === CARD_CURRENCY
                ? s.assets
                : s.assets.map((a) => (a.id === SOLCARD_ASSET_ID ? { ...a, currency: CARD_CURRENCY } : a))
              : entries.length
                ? [...s.assets, card]
                : s.assets;
            // The funding wallet's own leftover counts too: watch it like any wallet.
            const watched = !solcard.funding || s.wallets.some((w) => w.address.toLowerCase() === solcard.funding.toLowerCase());
            const wallets = watched
              ? s.wallets
              : [...s.wallets, { id: uid(), label: "Solcard funding", address: solcard.funding, createdAt: new Date().toISOString() }];
            // Make sure the categories the ledger uses exist in older saved data.
            const need = DEFAULT_TXN_CATEGORIES.filter((c) => (c.id === "exp-fees" || c.id === "exp-unitemized") && !cat.categories.some((x) => x.id === c.id));
            return {
              transactions,
              assets: withCard(assets, transactions),
              wallets,
              txnCategories: need.length ? [...cat.categories, ...need] : cat.categories,
              solcardMeta: { fetchedAt: chain.fetchedAt ?? new Date().toISOString(), error: null, poisoned: chain.poisoned ?? 0, loading: false, rate, statement },
            };
          });
          return { ok: true, count: entries.length };
        } catch (e) {
          const error = e instanceof Error ? e.message : "failed";
          set((s) => ({ solcardMeta: { ...s.solcardMeta, loading: false, error } }));
          return { ok: false, error };
        }
      },

      // Upload a statement PDF from the Solcard app; the server parses and keeps
      // it, then the ledger is rebuilt with it.
      importSolcardStatement: async (file) => {
        try {
          const body = new FormData();
          body.append("file", file);
          const res = await fetch("/api/solcard/statement", { method: "POST", body });
          const data = await res.json();
          if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
          await get().syncSolcard();
          return { ok: true, from: data.statement?.from, to: data.statement?.to, count: data.statement?.count };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "upload failed" };
        }
      },

      // The real balance read in the Solcard app. Whatever the ledger cannot
      // explain becomes one "not itemized yet" entry, to be edited or split later.
      checkSolcardBalance: (real) =>
        set((s) => {
          if (isNaN(real)) return {};
          const diff = Math.round((cardBalance(s.transactions) - real) * 100) / 100;
          const currency = s.assets.find((a) => a.id === SOLCARD_ASSET_ID)?.currency ?? CARD_CURRENCY;
          const at = new Date().toISOString();
          if (Math.abs(diff) < 0.01) return { solcard: { ...s.solcard, lastCheck: { amount: real, at } } };
          const txn: Transaction = {
            id: uid(),
            assetId: SOLCARD_ASSET_ID,
            type: diff > 0 ? "spent" : "earned",
            amount: Math.abs(diff),
            currency,
            categoryId: diff > 0 ? "exp-unitemized" : undefined,
            note: diff > 0 ? "Card spending not itemized yet (balance check)" : "Card balance correction (balance check)",
            date: at,
            source: "manual",
          };
          const transactions = [txn, ...s.transactions];
          return { transactions, assets: withCard(s.assets, transactions), solcard: { ...s.solcard, lastCheck: { amount: real, at } } };
        }),

      // Bitrefill: buying store credit moves your own money (a transfer onto the
      // credit balance); gift cards and eSIMs are spending. Paid from credit,
      // they come off the credit balance; paid directly with crypto, the wallet
      // sync already saw the money leave, so they are recorded only.
      syncBitrefill: async () => {
        try {
          const res = await fetch("/api/bitrefill");
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          if (!data.configured) {
            set({ bitrefillMeta: { configured: false, fetchedAt: null, error: null } });
            return { ok: true, count: 0 };
          }
          type Entry = { id: string; kind: "credit" | "purchase"; fromCredit: boolean; method: string; product: string; amount: number; currency: string; date: string };
          const entries: Entry[] = data.entries ?? [];
          set((s) => {
            const fresh: Transaction[] = entries.map((e) =>
              e.kind === "credit"
                ? {
                    id: `bitrefill:${e.id}`,
                    assetId: BITREFILL_ASSET_ID,
                    type: "earned" as const,
                    transfer: true,
                    amount: e.amount,
                    currency: e.currency,
                    note: `Bitrefill store credit · paid with ${e.method}`,
                    date: e.date,
                    source: "bitrefill" as const,
                  }
                : {
                    id: `bitrefill:${e.id}`,
                    assetId: e.fromCredit ? BITREFILL_ASSET_ID : "bitrefill",
                    type: "spent" as const,
                    amount: e.amount,
                    currency: e.currency,
                    categoryId: "exp-giftcards",
                    note: `${e.product}${e.fromCredit ? "" : ` · paid with ${e.method}`}`,
                    date: e.date,
                    source: "bitrefill" as const,
                  }
            );
            const transactions = [...applyEdits(fresh, s.txnEdits), ...s.transactions.filter((t) => t.source !== "bitrefill")].sort((a, b) =>
              b.date.localeCompare(a.date)
            );
            const needCredit = entries.some((e) => e.kind === "credit" || e.fromCredit);
            const hasCredit = s.assets.some((a) => a.id === BITREFILL_ASSET_ID);
            const assets =
              needCredit && !hasCredit
                ? [...s.assets, { id: BITREFILL_ASSET_ID, name: "Bitrefill credit", category: "bank" as const, currency: "EUR", amount: 0, source: "bitrefill" as const, updatedAt: new Date().toISOString() }]
                : s.assets;
            const need = DEFAULT_TXN_CATEGORIES.filter((c) => c.id === "exp-giftcards" && !s.txnCategories.some((x) => x.id === c.id));
            return {
              transactions,
              assets: withCard(assets, transactions),
              txnCategories: need.length ? [...s.txnCategories, ...need] : s.txnCategories,
              bitrefillMeta: { configured: true, fetchedAt: data.fetchedAt ?? new Date().toISOString(), error: null },
            };
          });
          return { ok: true, count: entries.length };
        } catch (e) {
          const error = e instanceof Error ? e.message : "failed";
          set((s) => ({ bitrefillMeta: { ...s.bitrefillMeta, error } }));
          return { ok: false, error };
        }
      },

      // Create a category on the fly; returns its id so the dialog can select it.
      addTxnCategory: (name, kind) => {
        const id = uid();
        const color =
          TXN_PALETTE[get().txnCategories.length % TXN_PALETTE.length];
        set((s) => ({
          txnCategories: [...s.txnCategories, { id, name: name.trim(), kind, color }],
        }));
        return id;
      },

      renameTxnCategory: (id, name) =>
        set((s) => ({
          txnCategories: s.txnCategories.map((c) =>
            c.id === id ? { ...c, name: name.trim() } : c
          ),
        })),

      removeTxnCategory: (id) =>
        set((s) => ({
          txnCategories: s.txnCategories.filter((c) => c.id !== id),
        })),

      // Snapshots live in their own Supabase table, not the persisted blob (the
      // blob is rewritten every 60s by the FX ticker and would clobber points the
      // backend cron writes). Load the history from /api/snapshots on hydrate.
      loadSnapshots: async () => {
        try {
          const res = await fetch("/api/snapshots");
          if (!res.ok) return;
          const { snapshots } = await res.json();
          if (Array.isArray(snapshots)) set({ snapshots });
        } catch {
          // offline: keep whatever is already in memory
        } finally {
          if (!get().snapshotsLoaded) set({ snapshotsLoaded: true });
        }
      },

      // Record today's snapshot server-side (idempotent per Athens day), then
      // reload the history so the chart reflects it.
      saveSnapshot: async () => {
        try {
          await fetch("/api/snapshots", { method: "POST" });
          await get().loadSnapshots();
        } catch {
          // offline: cron will still record the day server-side
        }
      },

      // Ensure today has a snapshot. Runs on app open so the chart fills in even
      // before the backend cron fires; the server insert is idempotent per day,
      // so this never fights the cron.
      autoSnapshot: async () => {
        const { snapshots, assets } = get();
        if (assets.length === 0) return;
        const today = dayKey();
        const hasToday = snapshots.some((s) => s.date.slice(0, 10) === today);
        if (!hasToday) await get().saveSnapshot();
      },

      removeSnapshot: async (id) => {
        try {
          await fetch(`/api/snapshots?id=${encodeURIComponent(id)}`, {
            method: "DELETE",
          });
        } catch {
          // ignore network error; UI removal below is optimistic
        }
        set((s) => ({ snapshots: s.snapshots.filter((x) => x.id !== id) }));
      },

      setBaseCurrency: async (c) => {
        // Switch the label immediately, but keep the old rates on screen until
        // the new ones land so values reconvert in one clean step (no flash to
        // raw/1:1 numbers mid-fetch).
        set({ baseCurrency: c });
        try {
          const next = await fetchRates(c);
          set({ fx: next });
        } catch (e) {
          console.error("FX switch failed", e);
          set({ fx: emptyFx(c) });
        }
      },

      refreshFx: async (force = false) => {
        const { fx, baseCurrency } = get();
        if (!force && !isStale(fx)) return;
        try {
          const next = await fetchRates(baseCurrency);
          set({ fx: next });
        } catch (e) {
          console.error("FX refresh failed", e);
        }
      },

      syncFreedom24: async () => {
        try {
          const res = await fetch("/api/freedom24");
          const data = await res.json();
          if (!res.ok) {
            // Keep the holdings we already have. Replacing them with nothing is
            // how an expired API key turned into four days of wrong net worth.
            const error = data.error || `HTTP ${res.status}`;
            set({ freedom24Error: error });
            return { ok: false, error };
          }
          const incoming: Asset[] = data.assets ?? [];
          set((s) => ({
            assets: [
              ...s.assets.filter((a) => a.source !== "freedom24"),
              ...incoming,
            ],
            freedom24Error: null,
          }));
          return { ok: true, count: incoming.length };
        } catch (e) {
          const error = e instanceof Error ? e.message : "failed";
          set({ freedom24Error: error });
          return { ok: false, error };
        }
      },

      addWallet: (label, address) =>
        set((s) => ({
          wallets: [
            ...s.wallets,
            {
              id: uid(),
              label: label.trim() || "Wallet",
              address: address.trim(),
              createdAt: new Date().toISOString(),
            },
          ],
        })),

      // Dropping a wallet drops the balances read from it in the same step, so
      // net worth never shows a coin for an address that is no longer watched.
      removeWallet: (id) =>
        set((s) => ({
          wallets: s.wallets.filter((w) => w.id !== id),
          assets: s.assets.filter((a) => a.walletId !== id),
        })),

      syncWallets: async () => {
        const { wallets } = get();
        if (wallets.length === 0) {
          set((s) =>
            s.assets.some((a) => a.source === "wallet")
              ? { assets: s.assets.filter((a) => a.source !== "wallet"), walletChains: {} }
              : {}
          );
          return { ok: true, count: 0 };
        }
        try {
          const res = await fetch("/api/wallets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wallets }),
          });
          const data = await res.json();
          if (!res.ok) {
            const error = data.error || `HTTP ${res.status}`;
            set((s) => ({
              walletErrors: Object.fromEntries(s.wallets.map((w) => [w.id, error])),
            }));
            return { ok: false, error };
          }
          const incoming: Asset[] = data.assets ?? [];
          const errors: Record<string, string> = data.errors ?? {};
          const stale: Record<string, string[]> = data.stale ?? {};
          set((s) => {
            // A chain that answered is replaced by what it just said. A chain
            // that did not answer, or held something nobody could price, keeps
            // the figure it last reported: dropping it would read as the money
            // having gone, which is the failure this app has already had once.
            const kept = s.assets.filter((a) => {
              if (a.source !== "wallet") return false;
              if (!a.walletId) return false;
              if (errors[a.walletId]) return true;
              return !!a.chain && (stale[a.walletId] ?? []).includes(a.chain);
            });
            // Merged by id so a kept row and a fresh row for the same holding
            // can never both survive. Fresh wins.
            const merged = new Map<string, Asset>();
            for (const a of kept) merged.set(a.id, a);
            for (const a of incoming) merged.set(a.id, a);
            return {
              assets: [...s.assets.filter((a) => a.source !== "wallet"), ...merged.values()],
              walletErrors: errors,
              walletWarnings: data.warnings ?? {},
              walletChains: data.found ?? {},
            };
          });
          return { ok: true, count: incoming.length };
        } catch (e) {
          const error = e instanceof Error ? e.message : "failed";
          set((s) => ({
            walletErrors: Object.fromEntries(s.wallets.map((w) => [w.id, error])),
          }));
          return { ok: false, error };
        }
      },

      // Re-value the balances already read, without touching a chain. Quantity
      // only changes when a transaction lands; price changes every second, so
      // this runs on a much faster clock than syncWallets and costs one call.
      repriceWallets: async () => {
        const held = get().assets.filter((a) => a.source === "wallet" && a.priceKey);
        if (held.length === 0) return;
        const keys = [...new Set(held.map((a) => a.priceKey as string))];
        try {
          const res = await fetch("/api/wallets/prices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keys }),
          });
          if (!res.ok) return;
          const { prices } = (await res.json()) as { prices: Record<string, number> };
          set((s) => ({
            assets: s.assets.map((a) => {
              if (a.source !== "wallet" || !a.priceKey || a.quantity === undefined) return a;
              const p = prices[a.priceKey];
              // An unpriced key leaves the row exactly as it was, rather than
              // writing a zero into net worth.
              if (typeof p !== "number") return a;
              return { ...a, amount: a.quantity * p, updatedAt: new Date().toISOString() };
            }),
          }));
        } catch {
          // The next chain sync reports anything really broken.
        }
      },

      // Pull the Revolut balances and history. The server keeps its own copy
      // and only asks the bank every few hours, so calling this often is free.
      syncRevolut: async (force = false) => {
        set((s) => ({ revolut: { ...s.revolut, loading: true } }));
        try {
          const res = await fetch(`/api/revolut${force ? "?force=1" : ""}`);
          const data = await res.json();
          if (!res.ok && !data.connected) {
            const error = data.error || `HTTP ${res.status}`;
            set((s) => ({ revolut: { ...s.revolut, loading: false, error } }));
            return { ok: false, error };
          }
          const assets: Asset[] = data.assets ?? [];
          const transactions: Transaction[] = data.transactions ?? [];
          set((s) => {
            const cat = data.connected
              ? categorize(
                  [...applyEdits(transactions, s.txnEdits), ...s.transactions.filter((t) => t.source !== "revolut")],
                  s.txnCategories,
                  s.txnEdits
                )
              : null;
            return {
              revolut: {
                configured: !!data.configured,
                connected: !!data.connected,
                accounts: data.accounts ?? [],
                connectedAt: data.connectedAt ?? null,
                validUntil: data.validUntil ?? null,
                fetchedAt: data.fetchedAt ?? null,
                error: data.error ?? null,
                loading: false,
              },
              // Only a connected answer replaces what was imported. A server that
              // is merely unconfigured (e.g. a fresh deploy without the bank keys)
              // must not wipe the history; disconnectRevolut clears it on purpose.
              assets: data.connected
                ? [...s.assets.filter((a) => a.source !== "revolut"), ...assets]
                : s.assets,
              transactions: cat ? cat.transactions.sort((a, b) => b.date.localeCompare(a.date)) : s.transactions,
              txnCategories: cat ? cat.categories : s.txnCategories,
            };
          });
          return { ok: !data.error, error: data.error ?? undefined };
        } catch (e) {
          const error = e instanceof Error ? e.message : "failed";
          set((s) => ({ revolut: { ...s.revolut, loading: false, error } }));
          return { ok: false, error };
        }
      },

      disconnectRevolut: async () => {
        try {
          await fetch("/api/revolut", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "disconnect" }),
          });
        } catch {
          // the sync below reports whatever state the server is really in
        }
        set((s) => ({
          assets: s.assets.filter((a) => a.source !== "revolut"),
          transactions: s.transactions.filter((t) => t.source !== "revolut"),
          revolut: { ...emptyRevolut, configured: s.revolut.configured },
        }));
      },
    }),
    {
      name: "networth-v1",
      storage: createJSONStorage(() => supabaseStorage),
      // Older saved blobs are upgraded once by lib/migrations.ts. Without a
      // migrate function zustand would refuse the saved row and start empty.
      version: STATE_VERSION,
      migrate: (persisted, from) => migrateState(persisted as Partial<State>, from) as State,
      // NOTE: `snapshots` is intentionally NOT persisted here. It has its own
      // Supabase table (loaded via loadSnapshots), so the 60s blob writes can't
      // overwrite snapshots the backend cron records.
      // Anything missing from this whitelist is silently dropped on reload —
      // add new persisted state here or it will not survive a refresh.
      partialize: (s) => ({
        assets: s.assets,
        transactions: s.transactions,
        txnCategories: s.txnCategories,
        milestones: s.milestones,
        annotations: s.annotations,
        readDigests: s.readDigests,
        benchmark: s.benchmark,
        baseCurrency: s.baseCurrency,
        fx: s.fx,
        privacy: s.privacy,
        chartMode: s.chartMode,
        wallets: s.wallets,
        txnEdits: s.txnEdits,
        addressLabels: s.addressLabels,
        solcard: s.solcard,
      }),
      // Flip on once the saved Supabase row has loaded. Until then the UI must
      // not write, or the empty default state clobbers the saved row (the
      // disappearing-manual-asset bug). Runs again after every rehydrate().
      // Saved entries are sorted here too, so the categories reach data
      // imported before the rules existed, even while the bank is offline.
      onRehydrateStorage: () => () => {
        useStore.setState((s) => {
          const cat = categorize(s.transactions, s.txnCategories, s.txnEdits);
          return cat.changed ? { _hydrated: true, transactions: cat.transactions, txnCategories: cat.categories } : { _hydrated: true };
        });
      },
    }
  )
);
