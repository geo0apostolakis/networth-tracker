import type { Transaction, TransactionType, TxnCategory, TxnEdit } from "./types";

// Where an imported entry goes when nobody has said otherwise. Bank and card
// exports only carry a merchant string ("Voiceflow* Voiceflow, · Voiceflow,
// Inc."), so this reads it: first matching rule wins. A hand edit always beats
// a rule, and hand-entered transactions are never touched.

interface Target {
  id: string; // preferred id; categories you made yourself are found by name instead
  name: string;
  kind: TransactionType;
  color: string;
}

const T = {
  topups: { id: "inc-topups", name: "Top-ups", kind: "earned", color: "#3b82f6" },
  peopleIn: { id: "inc-people", name: "From people", kind: "earned", color: "#06b6d4" },
  refunds: { id: "inc-refunds", name: "Refunds", kind: "earned", color: "#7fd962" },
  ai: { id: "exp-ai-costs", name: "AI costs", kind: "spent", color: "#ef4444" },
  tools: { id: "exp-tools", name: "Tools / software", kind: "spent", color: "#f59e0b" },
  domain: { id: "exp-domain", name: "Domain", kind: "spent", color: "#ef4444" },
  subs: { id: "exp-subscriptions", name: "Subscriptions", kind: "spent", color: "#0ea5e9" },
  marketing: { id: "exp-marketing", name: "Marketing / ads", kind: "spent", color: "#6366f1" },
  food: { id: "exp-food", name: "Food", kind: "spent", color: "#f97316" },
  transport: { id: "exp-transport", name: "Transport", kind: "spent", color: "#eab308" },
  fun: { id: "exp-entertainment", name: "Entertainment", kind: "spent", color: "#f43f5e" },
  care: { id: "exp-personal-care", name: "Personal care", kind: "spent", color: "#a855f7" },
  electronics: { id: "exp-electronics", name: "Electronics / gear", kind: "spent", color: "#61afef" },
  shopping: { id: "exp-shopping", name: "Shopping", kind: "spent", color: "#ec4899" },
  sport: { id: "exp-sport", name: "Sport", kind: "spent", color: "#84cc16" },
  peopleOut: { id: "exp-people", name: "Sent to people", kind: "spent", color: "#14b8a6" },
  fees: { id: "exp-fees", name: "Fees / charges", kind: "spent", color: "#c678dd" },
} satisfies Record<string, Target>;

interface Rule {
  re: RegExp;
  to?: Target;
  transfer?: true; // money between two balances you own, or into untracked crypto
  only?: TransactionType;
}

// Rules only name well-known merchants. Add your own (your other accounts,
// local shops) at the top: the first match wins.
const RULES: Rule[] = [
  // Refunds first: the counterparty on a refund can look like a person.
  { re: /\brefund\b/i, to: T.refunds, only: "earned" },
  // Money between two accounts you own is a transfer, not income or spending.
  // Example: { re: /· (to|from) (jane doe|j doe)/i, transfer: true },
  // Revolut's in-app crypto exchange. The coins are not tracked here, so this
  // is investing, not spending; either way it stays out of the spending charts.
  { re: /^exchanged to /i, transfer: true },
  { re: /^top-up by \*/i, to: T.topups, only: "earned" },

  { re: /openai|openrouter|anthropic|claude\.ai|claude sub|vapi|voiceflow|telnyx|twilio/i, to: T.ai },
  { re: /hostinger|microsoft|apify|google cloud|vercel|supabase|github|notion|figma/i, to: T.tools },
  { re: /porkbun|godaddy|namecheap|cloudflare/i, to: T.domain },
  { re: /youtube|x corp|spotify|netflix|disney|apple\.com\/bill|itunes/i, to: T.subs },
  { re: /tiktok promote|meta ads|facebk|google ads/i, to: T.marketing },
  { re: /card delivery fee|\bfee\b/i, to: T.fees },
  { re: /barber|hair ?salon|pharmacy/i, to: T.care },
  { re: /media ?markt|apple store|best buy|currys|fnac/i, to: T.electronics },
  { re: /\bgym\b|fitness|decathlon/i, to: T.sport },
  { re: /uber|bolt|\bvoi\b|lime|taxi|metro|railway|airline/i, to: T.transport },
  { re: /cinema|steam|playstation|nintendo|xbox/i, to: T.fun },
  { re: /amazon|zara|h&m|ikea|uniqlo/i, to: T.shopping },
  {
    re: /lidl|aldi|carrefour|tesco|bakery|boulangerie|burger|kfc|mcdonald|wolt|deliveroo|uber eats|7-eleven|starbucks|coffee|cafe/i,
    to: T.food,
  },
  // Anyone else paid or paying through Revolut.
  { re: /· to /i, to: T.peopleOut, only: "spent" },
  { re: /· from /i, to: T.peopleIn, only: "earned" },
];

const IMPORTED = new Set(["revolut", "solcard", "bitrefill"]);

/** The category a target maps to in this state: by id, then by name, else created. */
function resolve(target: Target, cats: TxnCategory[]): { id: string; created?: TxnCategory } {
  const byId = cats.find((c) => c.id === target.id);
  if (byId) return { id: byId.id };
  const byName = cats.find((c) => c.kind === target.kind && c.name.trim().toLowerCase() === target.name.toLowerCase());
  if (byName) return { id: byName.id };
  const created: TxnCategory = { id: target.id, name: target.name, kind: target.kind, color: target.color };
  return { id: created.id, created };
}

/** Fill in category / transfer on imported entries that have neither and no hand edit saying otherwise. */
export function categorize(
  transactions: Transaction[],
  categories: TxnCategory[],
  edits: Record<string, TxnEdit>
): { transactions: Transaction[]; categories: TxnCategory[]; changed: boolean } {
  let cats = categories;
  let changed = false;
  const out = transactions.map((t) => {
    if (!IMPORTED.has(t.source ?? "") || t.categoryId || t.transfer) return t;
    const e = edits[t.id];
    if (e && (e.categoryId !== undefined || e.transfer !== undefined)) return t;
    const text = t.note ?? "";
    const rule = RULES.find((r) => (!r.only || r.only === t.type) && r.re.test(text));
    if (!rule) return t;
    if (rule.transfer) {
      changed = true;
      return { ...t, transfer: true };
    }
    if (!rule.to || rule.to.kind !== t.type) return t;
    const { id, created } = resolve(rule.to, cats);
    if (created) cats = [...cats, created];
    changed = true;
    return { ...t, categoryId: id };
  });
  return { transactions: changed ? out : transactions, categories: cats, changed };
}
