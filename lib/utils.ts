export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Name shown on the intro splash and the mobile lock screen. Set
// NEXT_PUBLIC_OWNER_NAME at build time (it is baked into the client bundle, so
// it must be a name you are happy to make public — never a secret).
export const OWNER_NAME = process.env.NEXT_PUBLIC_OWNER_NAME || "Your Name";

// "A day" means a calendar day in this timezone. The daily snapshot is keyed on
// it so the frontend and the backend cron agree on which day a snapshot belongs
// to (and never double-record one). Override with NEXT_PUBLIC_APP_TZ.
export const APP_TZ = process.env.NEXT_PUBLIC_APP_TZ || "Europe/Athens";
export function dayKey(date: Date = new Date(), tz: string = APP_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date); // YYYY-MM-DD
}

export function formatCurrency(
  value: number,
  currency: string,
  opts: { compact?: boolean } = {}
): string {
  try {
    return new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency,
      maximumFractionDigits: opts.compact ? 1 : 2,
      notation: opts.compact ? "compact" : "standard",
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function formatPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export const MONEY_MASK = "••••";

// formatCurrency, but hidden when "bare mode" (privacy) is on.
export function formatMoney(
  value: number,
  currency: string,
  hidden: boolean,
  opts: { compact?: boolean } = {}
): string {
  return hidden ? MONEY_MASK : formatCurrency(value, currency, opts);
}

// formatCurrency caps at 2 decimals, which renders every per-second rate as
// "€0.00". This keeps small magnitudes readable by widening the decimals until
// the number actually says something, while big values stay at plain 2dp.
export function formatRate(
  value: number,
  currency: string,
  hidden: boolean
): string {
  if (hidden) return MONEY_MASK;
  const abs = Math.abs(value);
  let digits = 2;
  if (abs > 0) {
    if (abs < 0.0001) digits = 8;
    else if (abs < 0.01) digits = 6;
    else if (abs < 1) digits = 4;
  }
  try {
    return new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

// Whole days between two instants, floored at 1 so a same-day denominator
// never divides by zero.
export function daysBetween(from: string | Date, to: string | Date): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Math.max(1, Math.floor((b - a) / 86_400_000));
}

export const SUPPORTED_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "JPY",
  "CAD",
  "AUD",
  "SEK",
  "NOK",
  "PLN",
];
