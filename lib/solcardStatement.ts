import type { SolcardStatement, SolcardStatementLine } from "./types";

// Reads the text of a Solcard "Card Statement" PDF (as extracted by unpdf,
// one line per visual line). The layout, per transaction:
//
//   Oct 1, 2026 Plaisio.gr Gr          <- date + title
//   Purchase                           <- kind
//   Billed as plaisio.gr GR            <- merchant as billed (optional)
//   2258 EUR                           <- original amount (optional; crypto on top-ups)
//   Completed −2,631.52 USD            <- status + signed amount in card currency
//
// Nothing identifying beyond the card's last four digits is kept: no name,
// no email.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = String.raw`(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})`;
const DATE_LINE = new RegExp(`^${DAY} (.+)$`);
const PERIOD = new RegExp(`^${DAY} [–-] ${DAY}$`);
const GENERATED = new RegExp(`^Generated ${DAY}$`);
const STATUS_LINE = /^([A-Za-z][A-Za-z ]*?) ([+−-])?([\d,]+\.\d{2}) ([A-Z]{3})$/;
const ORIGINAL = /^([\d,]*\.?\d+) ([A-Z]{3,6})$/;
const NETWORK = /^([A-Z]{2,6}) on ([A-Za-z ]+)$/;
const SUMMARY: Record<string, keyof SolcardStatement["summary"]> = {
  "Opening balance": "opening",
  Deposits: "deposits",
  Refunds: "refunds",
  Spend: "spend",
  "Withdrawals & transfers": "withdrawals",
  Fees: "fees",
  Adjustments: "adjustments",
  "Closing balance": "closing",
};
// Statuses that never moved money.
const VOID = /declin|revers|fail|cancel|expir|void|return/i;

const iso = (mon: string, day: string, year: string) =>
  `${year}-${String(MONTHS.indexOf(mon) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
const num = (s: string) => Number(s.replace(/,/g, ""));

export function parseSolcardStatement(text: string): SolcardStatement | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let id = "";
  let generated = "";
  let from = "";
  let to = "";
  let card: string | undefined;
  let currency = "";
  const summary = { opening: 0, deposits: 0, refunds: 0, spend: 0, withdrawals: 0, fees: 0, adjustments: 0, closing: 0 };
  const out: SolcardStatementLine[] = [];
  const seen = new Map<string, number>();

  let inTable = false;
  let cur: { date: string; title: string; details: string[] } | null = null;

  for (const line of lines) {
    if (!id) {
      const m = /^Statement ([0-9a-f-]{36})$/i.exec(line);
      if (m) id = m[1];
    }
    if (!generated) {
      const m = GENERATED.exec(line);
      if (m) generated = iso(m[1], m[2], m[3]);
    }
    if (!from) {
      const m = PERIOD.exec(line);
      if (m) {
        from = iso(m[1], m[2], m[3]);
        to = iso(m[4], m[5], m[6]);
        continue;
      }
    }
    if (!card) {
      const m = /^Card \d* ?[•*·]+ ?(\d{4})$/.exec(line);
      if (m) card = m[1];
    }
    const s = /^(.+?) (-?[\d,]+\.\d{2}) ([A-Z]{3})$/.exec(line);
    if (s && SUMMARY[s[1]] && !inTable) {
      summary[SUMMARY[s[1]]] = num(s[2]);
      currency ||= s[3];
      continue;
    }
    if (line === "Transactions" || line.startsWith("Pending at period end")) {
      inTable = true;
      continue;
    }
    if (!inTable || /^DATE DESCRIPTION/.test(line) || /^SolCard •/i.test(line)) continue;

    const d = DATE_LINE.exec(line);
    if (d) {
      cur = { date: iso(d[1], d[2], d[3]), title: d[4], details: [] };
      continue;
    }
    if (!cur) continue;
    const st = STATUS_LINE.exec(line);
    if (!st) {
      cur.details.push(line);
      continue;
    }

    const status = st[1];
    const amount = (st[2] === "−" || st[2] === "-" ? -1 : 1) * num(st[3]);
    currency ||= st[4];
    const kindLine = cur.details[0] ?? "";
    const billed = cur.details.map((x) => /^Billed as (.+)$/.exec(x)?.[1]).find(Boolean);
    const orig = cur.details.map((x) => ORIGINAL.exec(x)).find(Boolean);
    const net = cur.details.map((x) => NETWORK.exec(x)).find(Boolean);
    const topup = /^top-?up/i.test(cur.title);
    const kind: SolcardStatementLine["kind"] = topup
      ? "topup"
      : /refund/i.test(kindLine)
        ? "refund"
        : /fee/i.test(kindLine) || /fee/i.test(cur.title)
          ? "fee"
          : /withdraw|transfer/i.test(kindLine)
            ? "withdrawal"
            : /purchase/i.test(kindLine) || amount < 0
              ? "purchase"
              : "other";

    const base = `${cur.date}|${cur.title}|${billed ?? ""}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);

    if (amount !== 0 && !VOID.test(status)) {
      out.push({
        key: `${base}|${n}`,
        date: cur.date,
        kind,
        title: cur.title,
        ...(billed ? { billed } : {}),
        ...(orig && !topup ? { original: { amount: num(orig[1]), currency: orig[2] } } : {}),
        ...(orig && topup ? { crypto: { amount: num(orig[1]), symbol: orig[2], ...(net ? { network: net[2] } : {}) } } : {}),
        status,
        amount,
      });
    }
    cur = null;
  }

  if (!id && !out.length) return null;
  return {
    id: id || `${from}_${to}`,
    generated: generated || to,
    from,
    to,
    currency: currency || "USD",
    ...(card ? { card } : {}),
    summary,
    lines: out,
    importedAt: new Date().toISOString(),
  };
}
