import { SOLCARD_ASSET_ID, type SolcardConfig, type SolcardStatement, type SolcardStatementLine, type Transaction } from "./types";

// The Solcard card as a ledger, in the card's own currency (USD), rebuilt
// from two sources on every sync:
//
//   - the chain: every ETH top-up, with what it was worth at that minute
//   - the statement PDFs: what the card actually credited, every purchase,
//     refund and fee
//
// A top-up found in both becomes a transfer of its market value onto the card
// plus a fee for whatever Solcard kept in the conversion, so the card balance
// lands on what the statement says while the cost of topping up shows up as
// spending. A top-up only the chain knows about (newer than the last
// statement) is costed at the rate the statements have shown so far.

export interface ChainTopup {
  hash: string;
  from?: string;
  date: string;
  eth: number;
  eur: number;
  usd: number;
  url: string;
}

export const CARD_CURRENCY = "USD";

const r2 = (v: number) => Math.round(v * 100) / 100;
const usd = (v: number) => `$${v.toFixed(2)}`;
const pct = (f: number) => `${(f * 100).toFixed(1)}%`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const qty = (v: number) => String(Number(v.toFixed(4)));
const noon = (day: string) => `${day}T12:00:00.000Z`;

// Short, stable id for a statement line key (djb2).
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function buildCardLedger(topups: ChainTopup[], statements: SolcardStatement[], cfg: SolcardConfig) {
  const base = { assetId: SOLCARD_ASSET_ID, currency: CARD_CURRENCY, source: "solcard" as const };
  const out: Transaction[] = [];

  // Every line once; where statements overlap, the newest one's copy wins
  // (a purchase "Authorized" on one is "Completed" with its final amount on the next).
  const byKey = new Map<string, SolcardStatementLine>();
  for (const s of [...statements].sort((a, b) => a.generated.localeCompare(b.generated))) for (const l of s.lines) byKey.set(l.key, l);

  const matched = new Set<string>();
  let market = 0;
  let credited = 0;

  for (const l of byKey.values()) {
    const id = `solcard:stmt:${hash(l.key)}`;
    if (l.kind === "topup") {
      const c = l.crypto;
      const hit = c ? topups.find((t) => !matched.has(t.hash) && Math.abs(t.eth - c.amount) < 1e-9) : undefined;
      if (hit) matched.add(hit.hash);
      const worth = hit ? hit.usd : c?.marketUsd;
      const gross = worth && worth > l.amount ? r2(worth) : l.amount;
      const what = c ? `${qty(c.amount)} ${c.symbol}` : "top-up";
      const date = hit ? hit.date : noon(l.date);
      const link = hit ? { txUrl: hit.url } : {};
      out.push({
        ...base,
        ...link,
        id: hit ? `solcard:topup:${hit.hash}` : id,
        type: "earned",
        transfer: true,
        amount: gross,
        note: `Solcard top-up · ${what}${hit?.from ? ` from ${short(hit.from)}` : ""} · card credited ${usd(l.amount)}`,
        date,
      });
      if (gross > l.amount) {
        const cost = r2(gross - l.amount);
        if (hit) {
          market += gross;
          credited += l.amount;
        }
        out.push({
          ...base,
          ...link,
          id: hit ? `solcard:fee:${hit.hash}` : `${id}:fee`,
          type: "spent",
          amount: cost,
          categoryId: "exp-fees",
          note: `Solcard top-up cost ${pct(cost / gross)} · ${what} was worth ${hit ? "" : "≈"}${usd(gross)}, card got ${usd(l.amount)}`,
          date,
        });
      }
      continue;
    }
    const orig = l.original && l.original.currency !== CARD_CURRENCY ? ` · ${l.original.amount} ${l.original.currency}` : "";
    const pending = /authori|pending/i.test(l.status) ? " · pending" : "";
    out.push({
      ...base,
      id,
      type: l.amount < 0 ? "spent" : "earned",
      amount: r2(Math.abs(l.amount)),
      note: l.kind === "refund" ? `Refund from ${l.title}${orig}` : `${l.title}${orig}${pending}`,
      date: noon(l.date),
      ...(l.kind === "fee" ? { categoryId: "exp-fees" } : {}),
      ...(l.kind === "withdrawal" ? { transfer: true } : {}),
    });
  }

  // Card fees only appear as a total in each statement's summary. Overlapping
  // statements would count the same fees twice, so only non-overlapping ones
  // (newest first) contribute.
  const chosen: SolcardStatement[] = [];
  for (const s of [...statements].sort((a, b) => b.to.localeCompare(a.to))) {
    if (chosen.some((c) => s.from <= c.to && c.from <= s.to)) continue;
    chosen.push(s);
    const listed = s.lines.filter((l) => l.kind === "fee").reduce((a, l) => a + Math.abs(l.amount), 0);
    const fee = r2(s.summary.fees - listed);
    if (fee > 0)
      out.push({ ...base, id: `solcard:stmtfee:${s.id}`, type: "spent", amount: fee, categoryId: "exp-fees", note: `Solcard card fees · statement ${s.from} → ${s.to}`, date: noon(s.to) });
  }

  // Top-ups no statement covers yet.
  const rate = market > 0 ? (market - credited) / market : cfg.feePct / 100;
  for (const t of topups) {
    if (matched.has(t.hash)) continue;
    const gross = r2(t.usd);
    out.push({
      ...base,
      id: `solcard:topup:${t.hash}`,
      type: "earned",
      transfer: true,
      amount: gross,
      note: `Solcard top-up · ${qty(t.eth)} ETH${t.from ? ` from ${short(t.from)}` : ""} · not on a statement yet`,
      date: t.date,
      txUrl: t.url,
    });
    if (rate > 0)
      out.push({
        ...base,
        id: `solcard:fee:${t.hash}`,
        type: "spent",
        amount: r2(gross * rate),
        categoryId: "exp-fees",
        note: `Solcard top-up cost ≈${pct(rate)} (estimate until a statement shows it)`,
        date: t.date,
        txUrl: t.url,
      });
  }

  const latest = [...statements].sort((a, b) => b.to.localeCompare(a.to))[0];
  return {
    entries: out,
    rate: market > 0 ? rate : null,
    statement: latest
      ? { from: latest.from, to: latest.to, closing: latest.summary.closing, currency: latest.currency, generated: latest.generated, count: statements.length }
      : null,
  };
}
