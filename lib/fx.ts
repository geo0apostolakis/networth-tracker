import type { FxState } from "./types";

// /api/fx returns rates[X] = units of X per 1 base (Coinbase real-time, with
// frankfurter as fallback). To convert an amount in currency C back to base:
// amount / rates[C].
export async function fetchRates(base: string): Promise<FxState> {
  const res = await fetch(`/api/fx?base=${base}`);
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const data: { base: string; rates: Record<string, number> } =
    await res.json();
  return {
    base,
    rates: { ...data.rates, [base]: 1 },
    fetchedAt: new Date().toISOString(),
  };
}

export function convertToBase(
  amount: number,
  currency: string,
  fx: FxState
): number {
  if (currency === fx.base) return amount;
  const rate = fx.rates[currency];
  if (!rate) return amount; // unknown currency: fall back to raw amount
  return amount / rate;
}

export function isStale(fx: FxState, maxHours = 12): boolean {
  if (!fx.fetchedAt) return true;
  const ageMs = Date.now() - new Date(fx.fetchedAt).getTime();
  return ageMs > maxHours * 3600 * 1000;
}
