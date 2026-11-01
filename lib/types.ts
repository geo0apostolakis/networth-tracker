export type Category = "cash" | "bank" | "stocks" | "crypto" | "other";

export const CATEGORIES: Category[] = [
  "cash",
  "bank",
  "stocks",
  "crypto",
  "other",
];

export const CATEGORY_LABELS: Record<Category, string> = {
  cash: "Cash in hand",
  bank: "Bank / Card",
  stocks: "Stocks / Investments",
  crypto: "Crypto",
  other: "Other",
};

// Terminal palette: green cash, blue bank, orange stocks, amber crypto, purple other.
// CSS tokens, so each look can colour the asset classes its own way
// (app/globals.css and app/skins.css). Only ever used as a fill or a colour.
export const CATEGORY_COLORS: Record<Category, string> = {
  cash: "var(--cat-cash)",
  bank: "var(--cat-bank)",
  stocks: "var(--cat-stocks)",
  crypto: "var(--cat-crypto)",
  other: "var(--cat-other)",
};

// Where a balance comes from. Anything but "manual" is replaced wholesale on
// every sync of that source, so it cannot be edited by hand.
export type AssetSource = "manual" | "freedom24" | "wallet" | "revolut" | "solcard" | "bitrefill";

export interface Asset {
  id: string;
  name: string;
  category: Category;
  currency: string;
  amount: number;
  quantity?: number;
  source: AssetSource;
  // For source "wallet": the wallet this balance was read from, the chain it
  // was read on, and the key its USD price came from. The chain is what lets a
  // sync replace only the chains that answered, and the price key is what lets
  // the value be refreshed without reading the chains again.
  walletId?: string;
  chain?: string;
  priceKey?: string;
  updatedAt: string;
}

// A crypto address the app watches. Balances are read straight from the chain,
// so there is nothing secret here: an address is public by nature. Which
// chains it is read on is worked out from the address itself (see
// detectKind in lib/wallets.ts) against the registry in lib/chains.ts.
export interface Wallet {
  id: string;
  label: string;
  address: string;
  createdAt: string;
  // Wallets added before auto-detection stored the single chain they were for.
  // Kept so those records still load unchanged; nothing reads it any more.
  chain?: string;
}

export interface Snapshot {
  id: string;
  date: string;
  baseCurrency: string;
  totalNetWorth: number;
  byCategory: Record<Category, number>;
  assets: { name: string; category: Category; baseValue: number }[];
}

export interface FxState {
  base: string;
  rates: Record<string, number>;
  fetchedAt: string | null;
}

export type TransactionType = "earned" | "spent";

export interface Transaction {
  id: string;
  assetId: string;
  type: TransactionType;
  amount: number; // positive value in the asset's currency
  currency: string;
  categoryId?: string; // income source / expense type (TxnCategory.id)
  note?: string;
  date: string; // ISO
  // Imported transactions are replaced wholesale on every sync of their
  // source, so a hand edit is kept separately (State.txnEdits) and re-applied.
  source?: "manual" | "revolut" | "solcard" | "bitrefill";
  // Money moving between two of your own balances (e.g. wallet -> Solcard).
  // It changes where the money is, not how much you have, so it is left out
  // of income, spending and every rate built on them.
  transfer?: boolean;
  // Link to the on-chain transaction behind an imported entry.
  txUrl?: string;
}

// A hand edit to a transaction. For imported entries this is stored by id and
// laid over the fresh copy on every sync; `hidden` removes it from view.
export interface TxnEdit {
  type?: TransactionType;
  amount?: number;
  categoryId?: string;
  note?: string;
  date?: string;
  hidden?: boolean;
  transfer?: boolean; // false = count it as income/spending after all
}

// Solcard has no API. Top-ups are read from the chain (funding wallet ->
// deposit address); everything else comes from the PDF statements you
// downloads from the Solcard app, plus anything logged by hand.
export interface SolcardConfig {
  funding: string; // the wallet that only ever pays the card
  deposit: string; // personal Solcard deposit address (copy from the Solcard app)
  feePct: number; // top-up cost assumed until a statement shows the real one
  lastCheck?: { amount: number; at: string }; // real balance read in the app
}

// One row of a Solcard statement, as parsed from the PDF. Amounts are signed,
// in the card's currency (USD).
export interface SolcardStatementLine {
  key: string; // stable across overlapping statements: date, title, billed-as, n-th of those
  date: string; // YYYY-MM-DD
  kind: "topup" | "purchase" | "refund" | "fee" | "withdrawal" | "other";
  title: string;
  billed?: string;
  original?: { amount: number; currency: string }; // e.g. 2258 EUR behind a USD charge
  crypto?: { amount: number; symbol: string; network?: string; marketUsd?: number };
  status: string;
  amount: number;
}

export interface SolcardStatement {
  id: string;
  generated: string; // YYYY-MM-DD
  from: string;
  to: string;
  currency: string;
  card?: string; // last four digits
  summary: Record<"opening" | "deposits" | "refunds" | "spend" | "withdrawals" | "fees" | "adjustments" | "closing", number>;
  lines: SolcardStatementLine[];
  importedAt: string;
}

export const SOLCARD_ASSET_ID = "solcard-card";
// Bitrefill store credit: bought with crypto, spent on gift cards.
export const BITREFILL_ASSET_ID = "bitrefill-credit";

// User-editable income source / expense type a transaction is tagged with.
export interface TxnCategory {
  id: string;
  name: string;
  kind: TransactionType; // "earned" = income source, "spent" = expense type
  color: string;
}

// Colour pool for new categories (cycled in order).
export const TXN_PALETTE = [
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#14b8a6",
  "#6366f1",
  "#eab308",
  "#f43f5e",
  "#0ea5e9",
];

// A target the user is working towards (first 100k, debt-free, emergency fund).
// `hitAt` is stamped the first time progress reaches 100% so the celebration
// fires once and the inbox can report it.
export interface Milestone {
  id: string;
  name: string;
  target: number; // in the base currency active when it was created
  currency: string;
  createdAt: string;
  hitAt?: string;
}

// A dated note pinned to the net-worth timeline ("changed jobs", "bought car").
export interface Annotation {
  id: string;
  date: string; // YYYY-MM-DD, matched against TrendPoint.date
  label: string;
  note?: string;
}

export const DEFAULT_TXN_CATEGORIES: TxnCategory[] = [
  // income sources
  { id: "inc-ai-automation", name: "AI automation", kind: "earned", color: "#3b82f6" },
  { id: "inc-monthly-fee", name: "Monthly fee / retainer", kind: "earned", color: "#22c55e" },
  { id: "inc-consulting", name: "Consulting / one-off", kind: "earned", color: "#a855f7" },
  { id: "inc-affiliate", name: "Affiliate", kind: "earned", color: "#06b6d4" },
  { id: "inc-investment", name: "Investment income", kind: "earned", color: "#14b8a6" },
  { id: "inc-salary", name: "Salary", kind: "earned", color: "#84cc16" },
  // expense types
  { id: "exp-ai-costs", name: "AI costs", kind: "spent", color: "#ef4444" },
  { id: "exp-tools", name: "Tools / software", kind: "spent", color: "#f59e0b" },
  { id: "exp-food", name: "Food", kind: "spent", color: "#f97316" },
  { id: "exp-rent-bills", name: "Rent / bills", kind: "spent", color: "#ec4899" },
  { id: "exp-marketing", name: "Marketing / ads", kind: "spent", color: "#6366f1" },
  { id: "exp-transport", name: "Transport", kind: "spent", color: "#eab308" },
  { id: "exp-subscriptions", name: "Subscriptions", kind: "spent", color: "#0ea5e9" },
  { id: "exp-entertainment", name: "Entertainment", kind: "spent", color: "#f43f5e" },
  { id: "exp-fees", name: "Fees / charges", kind: "spent", color: "#c678dd" },
  { id: "exp-unitemized", name: "Not itemized yet", kind: "spent", color: "#55534d" },
  { id: "exp-giftcards", name: "Gift cards / Bitrefill", kind: "spent", color: "#e5c07b" },
];
