import "server-only";
import type { Asset, Wallet } from "./types";
import { BITCOIN, EVM_CHAINS, SOLANA, type EvmChain, type TokenSpec } from "./chains";

// ---------------------------------------------------------------------------
// Reads crypto balances straight from public chain endpoints and prices them.
// Everything here is keyless: an address is public, and the RPCs and price
// feeds used are open. Runs server-side only so the browser never talks to a
// dozen hosts and so rate-limited endpoints see one caller.
//
// There is no chain to choose. The address format says whether it is Bitcoin,
// Solana or EVM, and an EVM address is then read on every chain in the
// registry at once, because the same 0x address exists on all of them and only
// the balances say where the money actually is.
// ---------------------------------------------------------------------------

// Minimal ERC-20 balanceOf(address) selector.
const BALANCE_OF = "0x70a08231";

// Robinhood Chain's RPC answers 403 to a request with no User-Agent, so every
// call carries one. The public nodes do not care either way.
const UA = "Mozilla/5.0 (networth-tracker)";

export type WalletKind = "evm" | "bitcoin" | "solana";

interface Holding {
  chain: string; // registry chain id
  chainLabel: string;
  symbol: string;
  name?: string;
  qty: number; // whole units (BTC, ETH, USDC, AAPL...), not sats or wei
  price: string; // price key, "cg:<id>", "yf:<symbol>" or "ds:solana:<mint>"
  category: "crypto" | "stocks";
}

// Which chain family an address belongs to, from its shape alone. This is what
// replaced the chain picker: a typo still fails here, before any network call,
// but a correct address never has to be classified by hand.
export function detectKind(address: string): WalletKind | null {
  const a = address.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return "evm";
  if (/^(bc1[a-zA-HJ-NP-Z0-9]{25,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(a)) return "bitcoin";
  // Base58 with no 0, O, I or l. Checked after Bitcoin, whose legacy "1..."
  // addresses are base58 too and would otherwise match here.
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return "solana";
  return null;
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "User-Agent": UA, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${new URL(url).host} -> HTTP ${res.status}`);
  return res.json();
}

interface RpcCall {
  method: string;
  params: unknown[];
}

interface RpcReply {
  id?: number;
  result?: string;
  error?: { message?: string };
}

// One HTTP request for a whole chain: a native balance plus a balanceOf per
// token go up as a JSON-RPC batch. Eight chains then cost eight requests
// instead of sixty. Replies are matched on id, because a batch response is not
// required to come back in request order.
async function rpcBatch(url: string, calls: RpcCall[]): Promise<(string | null)[]> {
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params }));
  const json = await getJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!Array.isArray(json)) throw new Error("rpc: batch not supported");
  const byId = new Map<number, RpcReply>();
  for (const r of json as RpcReply[]) {
    if (typeof r?.id === "number") byId.set(r.id, r);
  }
  // A single failed call in the batch is null, not a thrown error: a token
  // that cannot be read must not hide the native balance next to it.
  return calls.map((_, i) => {
    const r = byId.get(i);
    return r && !r.error && typeof r.result === "string" ? r.result : null;
  });
}

// Fallback for an endpoint that refuses arrays or caps their size. Sequential
// on purpose: it only runs when the cheap path already failed.
async function rpcOneByOne(url: string, calls: RpcCall[]): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (const c of calls) {
    try {
      const json = (await getJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: c.method, params: c.params }),
      })) as RpcReply;
      out.push(!json.error && typeof json.result === "string" ? json.result : null);
    } catch {
      out.push(null);
    }
  }
  return out;
}

// Hex quantity -> whole units, via BigInt so 18-decimal balances keep precision.
function fromHex(hex: string, decimals: number): number {
  const n = BigInt(hex === "0x" ? "0x0" : hex);
  const base = BigInt(10) ** BigInt(decimals);
  return Number(n / base) + Number(n % base) / Number(base);
}

function holdingFor(chain: EvmChain, t: TokenSpec, qty: number): Holding {
  return {
    chain: chain.id,
    chainLabel: chain.label,
    symbol: t.symbol,
    name: t.name,
    qty,
    price: t.price,
    category: t.category ?? "crypto",
  };
}

async function readEvmChain(chain: EvmChain, address: string): Promise<Holding[]> {
  const data = BALANCE_OF + address.slice(2).toLowerCase().padStart(64, "0");
  const calls: RpcCall[] = [
    { method: "eth_getBalance", params: [address, "latest"] },
    ...chain.tokens.map((t) => ({
      method: "eth_call",
      params: [{ to: t.address, data }, "latest"],
    })),
  ];

  let results: (string | null)[];
  try {
    results = await rpcBatch(chain.rpc, calls);
  } catch {
    results = await rpcOneByOne(chain.rpc, calls);
  }

  const [nativeHex, ...tokenHex] = results;
  if (nativeHex === null) throw new Error("native balance unreadable");

  const out: Holding[] = [
    {
      chain: chain.id,
      chainLabel: chain.label,
      symbol: chain.native.symbol,
      qty: fromHex(nativeHex, 18),
      price: chain.native.price,
      category: "crypto",
    },
  ];
  chain.tokens.forEach((t, i) => {
    const hex = tokenHex[i];
    if (hex === null) return;
    out.push(holdingFor(chain, t, fromHex(hex, t.decimals)));
  });
  return out;
}

async function readBitcoin(address: string): Promise<Holding[]> {
  const j = (await getJson(`https://blockstream.info/api/address/${address}`)) as {
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
    mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
  };
  const sats =
    j.chain_stats.funded_txo_sum -
    j.chain_stats.spent_txo_sum +
    j.mempool_stats.funded_txo_sum -
    j.mempool_stats.spent_txo_sum;
  return [
    {
      chain: BITCOIN.id,
      chainLabel: BITCOIN.label,
      symbol: BITCOIN.symbol,
      qty: sats / 1e8,
      price: BITCOIN.price,
      category: "crypto",
    },
  ];
}

// Solana: SOL, plus every SPL token the wallet holds that actually trades.
// Long-tail tokens have no CoinGecko id, so tokens
// are priced from DexScreener by mint; anything without a pool holding at
// least $1,000 of liquidity is treated as worthless (airdropped spam, dead
// coins), rather than valued at whatever its last trade said.
const SOL_RPC = "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
const MIN_LIQUIDITY = 1000;

// The public endpoint is the only keyless one that answers token queries
// (publicnode and dRPC want a paid plan for them), and it rate limits by IP,
// which on Vercel is shared. So each call gets three tries with a back-off.
async function solRpc<T>(method: string, params: unknown[]): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise<void>((r) => setTimeout(r, 500 * 3 ** (i - 1)));
    try {
      const j = (await getJson(SOL_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      })) as { result?: T; error?: { message?: string } };
      if (j.error) throw new Error(j.error.message ?? "rpc error");
      return j.result as T;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("solana rpc failed");
}

interface DexPair {
  baseToken?: { address?: string; symbol?: string; name?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
}

// Best-liquidity pool per mint, from DexScreener (30 mints per call, keyless).
// Mints DexScreener does not list are looked up on GeckoTerminal, which also
// indexes newer launchpad pools; the same $1,000 liquidity floor applies.
async function dexPairs(chain: string, mints: string[]): Promise<Map<string, DexPair>> {
  const best = await dexScreenerPairs(chain, mints);
  const rest = mints.filter((m) => !best.has(m));
  for (let i = 0; i < rest.length; i += 30) {
    const batch = rest.slice(i, i + 30);
    try {
      const j = (await getJson(`https://api.geckoterminal.com/api/v2/networks/${chain}/tokens/multi/${batch.join(",")}`)) as {
        data?: { attributes?: { address?: string; symbol?: string; name?: string; price_usd?: string | null; total_reserve_in_usd?: string | null } }[];
      };
      for (const t of j.data ?? []) {
        const a = t.attributes;
        if (!a?.address || !a.price_usd) continue;
        best.set(a.address, {
          baseToken: { address: a.address, symbol: a.symbol, name: a.name },
          priceUsd: a.price_usd,
          liquidity: { usd: Number(a.total_reserve_in_usd ?? 0) },
        });
      }
    } catch {
      // GeckoTerminal down too: those tokens stay unvalued this round
    }
  }
  return best;
}

async function dexScreenerPairs(chain: string, mints: string[]): Promise<Map<string, DexPair>> {
  const best = new Map<string, DexPair>();
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    try {
      const pairs = (await getJson(`https://api.dexscreener.com/tokens/v1/${chain}/${batch.join(",")}`)) as DexPair[];
      for (const p of Array.isArray(pairs) ? pairs : []) {
        const mint = p.baseToken?.address;
        if (!mint || !batch.includes(mint)) continue;
        const prev = best.get(mint);
        if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) best.set(mint, p);
      }
    } catch {
      // DexScreener down: the tokens simply go unvalued this round
    }
  }
  return best;
}

async function readSolana(address: string): Promise<{ holdings: Holding[]; failed: string[] }> {
  const lamports = await solRpc<{ value?: number }>("getBalance", [address]);
  const out: Holding[] = [
    { chain: SOLANA.id, chainLabel: SOLANA.label, symbol: SOLANA.symbol, qty: (lamports.value ?? 0) / 1e9, price: SOLANA.price, category: "crypto" },
  ];
  type Accounts = { value?: { account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } } } }[] };
  const held = new Map<string, number>();
  let tokensFailed = false;
  for (const programId of TOKEN_PROGRAMS) {
    try {
      const r = await solRpc<Accounts>("getTokenAccountsByOwner", [address, { programId }, { encoding: "jsonParsed" }]);
      for (const a of r.value ?? []) {
        const info = a.account?.data?.parsed?.info;
        const amt = info?.tokenAmount?.uiAmount ?? 0;
        if (info?.mint && amt > 0) held.set(info.mint, (held.get(info.mint) ?? 0) + amt);
      }
    } catch {
      // One token program failing still leaves the SOL and the other program,
      // but the chain is reported stale so the last token figures are kept
      // (and the card says so) instead of the coins silently disappearing.
      tokensFailed = true;
    }
  }
  if (held.size) {
    const pairs = await dexPairs("solana", [...held.keys()]);
    for (const [mint, qty] of held) {
      const p = pairs.get(mint);
      if (!p || (p.liquidity?.usd ?? 0) < MIN_LIQUIDITY || !p.baseToken?.symbol) continue;
      out.push({ chain: SOLANA.id, chainLabel: SOLANA.label, symbol: p.baseToken.symbol.slice(0, 16), name: p.baseToken.name, qty, price: `ds:solana:${mint}`, category: "crypto" });
    }
  }
  return { holdings: out, failed: tokensFailed ? [SOLANA.id] : [] };
}

// --- prices ----------------------------------------------------------------

export interface PriceResult {
  prices: Record<string, number>;
  // Keys that could not be priced. A holding with no price is never valued at
  // zero: it is reported here so the caller can keep the last known figure and
  // say that it is stale.
  missing: string[];
}

// USD prices for a set of price keys. CoinGecko covers the coins in one call;
// tokenised equities come from the Yahoo chart endpoint already used by
// /api/benchmark, one call each but only for symbols actually held.
export async function fetchPrices(keys: string[]): Promise<PriceResult> {
  const unique = [...new Set(keys)];
  const cg = unique.filter((k) => k.startsWith("cg:")).map((k) => k.slice(3));
  const yf = unique.filter((k) => k.startsWith("yf:")).map((k) => k.slice(3));
  const ds = unique.filter((k) => /^ds:solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(k)).map((k) => k.slice(10));
  const prices: Record<string, number> = {};

  const jobs: Promise<void>[] = [];

  if (cg.length > 0) {
    jobs.push(
      (async () => {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cg.join(
          ","
        )}&vs_currencies=usd`;
        // Cached for a minute across requests: the free tier is rate limited
        // and every open tab would otherwise hit it.
        const res = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate: 60 } });
        if (!res.ok) return;
        const j = (await res.json()) as Record<string, { usd?: number }>;
        for (const id of cg) {
          const p = j[id]?.usd;
          if (typeof p === "number" && Number.isFinite(p)) prices[`cg:${id}`] = p;
        }
      })().catch(() => {})
    );
  }

  for (const symbol of yf) {
    jobs.push(
      (async () => {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
            symbol
          )}?range=1d&interval=1d`,
          // Yahoo serves an empty body to clients with no UA.
          { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 60 } }
        );
        if (!res.ok) return;
        const j = (await res.json()) as {
          chart?: { result?: { meta?: { regularMarketPrice?: number } }[] };
        };
        const p = j.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (typeof p === "number" && Number.isFinite(p)) prices[`yf:${symbol}`] = p;
      })().catch(() => {})
    );
  }

  if (ds.length > 0) {
    jobs.push(
      (async () => {
        const pairs = await dexPairs("solana", ds);
        for (const [mint, p] of pairs) {
          const v = Number(p.priceUsd);
          if ((p.liquidity?.usd ?? 0) >= MIN_LIQUIDITY && Number.isFinite(v) && v > 0) prices[`ds:solana:${mint}`] = v;
        }
      })().catch(() => {})
    );
  }

  await Promise.all(jobs);
  return { prices, missing: unique.filter((k) => prices[k] === undefined) };
}

// --- the sync ---------------------------------------------------------------

export interface WalletSync {
  assets: Asset[];
  // Wallets nothing at all could be read for, keyed by wallet id.
  errors: Record<string, string>;
  // Per wallet, the chains whose figures did not come back this time. The
  // client keeps whatever those chains reported last, instead of dropping the
  // balance to zero.
  stale: Record<string, string[]>;
  // Per wallet, something worth saying that is not a failure: a chain that
  // holds a balance nobody could price, for instance.
  warnings: Record<string, string>;
  // Per wallet, the chains value was actually found on, for the card to show.
  found: Record<string, string[]>;
}

async function readWallet(
  address: string,
  kind: WalletKind
): Promise<{ holdings: Holding[]; failed: string[] }> {
  if (kind === "bitcoin") {
    return { holdings: await readBitcoin(address), failed: [] };
  }
  if (kind === "solana") {
    return readSolana(address);
  }
  const holdings: Holding[] = [];
  const failed: string[] = [];
  await Promise.all(
    EVM_CHAINS.map(async (chain) => {
      try {
        holdings.push(...(await readEvmChain(chain, address)));
      } catch {
        failed.push(chain.id);
      }
    })
  );
  // Every chain refusing is a dead address read, not an empty wallet.
  if (failed.length === EVM_CHAINS.length) throw new Error("no chain answered");
  return { holdings, failed };
}

export async function fetchWalletAssets(wallets: Wallet[]): Promise<WalletSync> {
  const now = new Date().toISOString();
  const errors: Record<string, string> = {};
  const stale: Record<string, string[]> = {};
  const warnings: Record<string, string> = {};
  const found: Record<string, string[]> = {};
  const held: { wallet: Wallet; holdings: Holding[] }[] = [];

  await Promise.all(
    wallets.map(async (w) => {
      const kind = detectKind(w.address);
      if (!kind) {
        errors[w.id] = "address does not look like a Bitcoin, Solana or EVM address";
        return;
      }
      try {
        const { holdings, failed } = await readWallet(w.address.trim(), kind);
        held.push({ wallet: w, holdings });
        if (failed.length > 0) stale[w.id] = failed;
        if (kind === "solana" && failed.length > 0) warnings[w.id] = "Solana tokens could not be read just now; showing their last figures";
      } catch (e) {
        errors[w.id] = e instanceof Error ? e.message : "failed";
      }
    })
  );

  // Only price what is actually held, so a wallet with one coin does not pull
  // thirty stock quotes.
  const wanted = held.flatMap((h) => h.holdings.filter((x) => x.qty > 0).map((x) => x.price));
  const { prices, missing } = await fetchPrices(wanted);
  const missingSet = new Set(missing);

  const assets: Asset[] = [];
  for (const { wallet, holdings } of held) {
    const chains = new Set<string>();
    const unpriced = new Set<string>();
    for (const h of holdings) {
      if (h.qty <= 0) continue;
      const price = prices[h.price];
      if (price === undefined) {
        // Missing money is louder than a zero: say which chain went unpriced,
        // and keep that chain's previous figure rather than overwriting it.
        unpriced.add(h.chain);
        missingSet.add(h.price);
        continue;
      }
      chains.add(h.chain);
      assets.push({
        // Chain is part of the id because one address holds ETH on four chains
        // and USDC on six; without it they would all collide on one row.
        // Mint in the id too for DexScreener-priced tokens: two coins can share a ticker.
        id: `wallet-${wallet.id}-${h.chain}-${h.symbol}${h.price.startsWith("ds:") ? `-${h.price.slice(-8)}` : ""}`,
        name: `${wallet.label} · ${h.chainLabel} ${h.symbol}`,
        category: h.category,
        currency: "USD",
        amount: h.qty * price,
        quantity: h.qty,
        source: "wallet",
        walletId: wallet.id,
        chain: h.chain,
        priceKey: h.price,
        updatedAt: now,
      });
    }
    found[wallet.id] = [...chains];
    if (unpriced.size > 0) {
      const list = [...unpriced];
      stale[wallet.id] = [...new Set([...(stale[wallet.id] ?? []), ...list])];
      const note = `no price for a balance on ${list.join(", ")}; showing the last figure`;
      warnings[wallet.id] = warnings[wallet.id] ? `${warnings[wallet.id]}; ${note}` : note;
    }
  }

  return { assets, errors, stale, warnings, found };
}
