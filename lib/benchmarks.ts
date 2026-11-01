// Benchmarks the portfolio can be compared against. This list is also the
// allowlist for /api/benchmark: the symbol lands in a URL the server fetches,
// so accepting arbitrary input would turn that route into an open proxy.

export interface Benchmark {
  symbol: string;
  label: string;
  currency: string;
}

export const BENCHMARKS: Benchmark[] = [
  { symbol: "URTH", label: "MSCI World", currency: "USD" },
  { symbol: "^GSPC", label: "S&P 500", currency: "USD" },
  { symbol: "IWDA.AS", label: "MSCI World (EUR)", currency: "EUR" },
  { symbol: "^STOXX50E", label: "Euro Stoxx 50", currency: "EUR" },
];

export interface BenchmarkSeries {
  symbol: string;
  label: string;
  currency: string;
  points: { date: string; close: number }[];
}

// Closest close at or before `date`, so a portfolio window that starts on a
// weekend or a market holiday still lands on a real traded price.
export function closeOn(
  points: { date: string; close: number }[],
  date: string
): number | null {
  let found: number | null = null;
  for (const p of points) {
    if (p.date <= date) found = p.close;
    else break;
  }
  return found;
}

// Index return between two dates, as a percentage. Null when either end has no
// price, which is the honest answer rather than a zero.
export function benchmarkReturn(
  series: BenchmarkSeries,
  from: string,
  to: string
): number | null {
  const a = closeOn(series.points, from);
  const b = closeOn(series.points, to);
  if (a === null || b === null || a === 0) return null;
  return ((b - a) / a) * 100;
}
