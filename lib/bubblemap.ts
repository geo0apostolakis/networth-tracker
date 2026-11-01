import "server-only";
import { EVM_CHAINS } from "./chains";

// Who your wallets have sent money to and received it from, for the
// bubble map. Server-side only: the Etherscan key never reaches the browser.
//
// Sources, per chain:
//   - Etherscan V2 (one key, any chain id) when ETHERSCAN_API_KEY is set: normal
//     transactions, internal transactions (contract payouts) and token transfers.
//   - Without a key, Ethereum falls back to Blockscout's public API. Robinhood
//     Chain has no keyless source: its Blockscout sits behind a bot challenge,
//     which is not something to get around, so it waits for the key.
//
// Everything is normalised into transfers, spam is dropped (zero-value token
// moves, fake tickers, address-poisoning lookalikes), and transfers are summed
// into one edge per (chain, from, to).

export type ChainId = "ethereum" | "base" | "arbitrum" | "optimism" | "polygon" | "bsc" | "avalanche" | "robinhood";

// Every EVM chain the wallet sync reads. Etherscan V2 serves them all with one
// key; Blockscout serves Ethereum without one (the other chains' Blockscout
// instances sit behind bot challenges).
export const BUBBLE_CHAINS: Record<ChainId, { name: string; chainid: number; explorer: string; native: string; cg: string; blockscout?: string }> = {
  ethereum: { name: "Ethereum", chainid: 1, explorer: "https://etherscan.io", native: "ETH", cg: "ethereum", blockscout: "https://eth.blockscout.com/api/v2" },
  robinhood: { name: "Robinhood Chain", chainid: 4663, explorer: "https://robin.etherscan.io", native: "ETH", cg: "ethereum" },
  base: { name: "Base", chainid: 8453, explorer: "https://basescan.org", native: "ETH", cg: "ethereum" },
  arbitrum: { name: "Arbitrum", chainid: 42161, explorer: "https://arbiscan.io", native: "ETH", cg: "ethereum" },
  optimism: { name: "Optimism", chainid: 10, explorer: "https://optimistic.etherscan.io", native: "ETH", cg: "ethereum" },
  polygon: { name: "Polygon", chainid: 137, explorer: "https://polygonscan.com", native: "POL", cg: "polygon-ecosystem-token" },
  bsc: { name: "BNB Chain", chainid: 56, explorer: "https://bscscan.com", native: "BNB", cg: "binancecoin" },
  avalanche: { name: "Avalanche", chainid: 43114, explorer: "https://snowtrace.io", native: "AVAX", cg: "avalanche-2" },
};
// The map reads Robinhood Chain through dRPC, not the official node the wallet
// sync uses: the official one locks a caller out for a minute after a burst,
// and the map's burst would take the wallet balances down with it.
const RPC: Record<ChainId, string[]> = Object.fromEntries(
  EVM_CHAINS.map((c) => [c.id, c.id === "robinhood" ? ["https://robinhood.drpc.org", c.rpc] : [c.rpc]])
) as Record<ChainId, string[]>;

export interface Transfer {
  chain: ChainId;
  hash: string;
  ts: number; // unix seconds
  from: string; // lowercase
  to: string;
  asset: string;
  amount: number;
  usd: number | null;
}

export interface BubbleEdge {
  id: string;
  chain: ChainId;
  from: string;
  to: string;
  count: number;
  usd: number; // priced part only
  unpriced: number; // transfers with no price
  assets: Record<string, number>;
  first: number;
  last: number;
  txs: { hash: string; ts: number; asset: string; amount: number; usd: number | null }[];
}

export interface BubbleNode {
  id: string; // lowercase address
  address: string; // checksummed when the source gave it
  chains: ChainId[];
  name?: string;
  contract?: boolean;
  // What it holds right now, native coin per chain, read from each chain's RPC.
  held: Partial<Record<ChainId, { amount: number; symbol: string; usd: number }>>;
  heldUsd: number;
}

export interface ChainStatus {
  ok: boolean;
  source: "etherscan" | "blockscout" | "none";
  active: number; // how many of the wallets have ever used this chain
  note?: string;
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const STABLE = new Set(["USDC", "USDT", "DAI", "USDS", "PYUSD", "USDC.E", "USDE", "FDUSD"]);
const SPAMMY = /https?:|www\.|\.com|\.io|\.xyz|claim|visit|reward|airdrop|voucher/i;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function json<T>(url: string): Promise<T> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "networth-tracker/2" }, cache: "no-store" });
    if (res.status === 429) {
      await sleep(1200 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
    return (await res.json()) as T;
  }
  throw new Error(`${new URL(url).host} rate limited`);
}

async function nativePrices(): Promise<Record<string, number>> {
  const ids = [...new Set(Object.values(BUBBLE_CHAINS).map((c) => c.cg))].join(",");
  try {
    const j = await json<Record<string, { usd?: number }>>(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v.usd ?? 0]));
  } catch {
    return {};
  }
}

// --- RPC: activity, balances, contract or not ------------------------------------

async function rpc<T>(chain: ChainId, method: string, params: unknown[]): Promise<T> {
  let last: unknown;
  for (const url of RPC[chain]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 networth-tracker" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        cache: "no-store",
      });
      const j = (await res.json()) as { result?: T; error?: { message: string } };
      if (j.error) throw new Error(j.error.message);
      return j.result as T;
    } catch (e) {
      last = e; // next node, if there is one
    }
  }
  throw last instanceof Error ? last : new Error("rpc failed");
}

// Run jobs a few at a time so no public RPC gets hammered.
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

function priceFor(asset: string, chain: ChainId, prices: Record<string, number>): number | null {
  const s = asset.toUpperCase();
  const native = BUBBLE_CHAINS[chain];
  if (s === native.native || s === `W${native.native}`) return prices[native.cg] || null;
  if (s === "ETH" || s === "WETH") return prices.ethereum || null;
  if (STABLE.has(s) || s === "USDG") return 1;
  return null;
}

// --- Etherscan V2 --------------------------------------------------------------

interface EsTx {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  isError?: string;
  input?: string;
  contractAddress?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
}

// Free keys allow 3 calls a second (measured: "Max calls per sec rate limit
// reached (3/sec)"); every call goes through one queue spaced under that.
let gate = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = gate.then(fn);
  gate = run.then(
    () => sleep(370),
    () => sleep(370)
  );
  return run;
}

async function etherscan(chain: ChainId, action: "txlist" | "txlistinternal" | "tokentx", address: string, key: string): Promise<EsTx[]> {
  const id = BUBBLE_CHAINS[chain].chainid;
  const url = `https://api.etherscan.io/v2/api?chainid=${id}&module=account&action=${action}&address=${address}&startblock=0&endblock=999999999&page=1&offset=1000&sort=desc&apikey=${key}`;
  for (let attempt = 0; ; attempt++) {
    const j = await throttled(() => json<{ status: string; message: string; result: EsTx[] | string }>(url));
    if (Array.isArray(j.result)) return j.result;
    if (/no transactions/i.test(j.message) || /no transactions/i.test(String(j.result))) return [];
    // Another request on the same key can still push it over; wait and retry.
    if (/rate limit/i.test(String(j.result)) && attempt < 4) {
      await sleep(1100 * (attempt + 1));
      continue;
    }
    throw new Error(typeof j.result === "string" ? j.result : j.message);
  }
}

async function fromEtherscan(chain: ChainId, address: string, key: string, prices: Record<string, number>): Promise<Transfer[]> {
  const eth = prices[BUBBLE_CHAINS[chain].cg] || 0;
  const [normal, internal, tokens] = await Promise.all([
    etherscan(chain, "txlist", address, key),
    etherscan(chain, "txlistinternal", address, key),
    etherscan(chain, "tokentx", address, key),
  ]);
  const out: Transfer[] = [];
  const native = BUBBLE_CHAINS[chain].native;
  for (const t of [...normal, ...internal]) {
    if (t.isError === "1" || !t.to) continue;
    const amount = Number(t.value) / 1e18;
    if (!(amount > 0)) continue;
    out.push({ chain, hash: t.hash, ts: Number(t.timeStamp), from: t.from.toLowerCase(), to: t.to.toLowerCase(), asset: native, amount, usd: eth ? amount * eth : null });
  }
  for (const t of tokens) {
    const asset = (t.tokenSymbol ?? "").trim();
    const amount = Number(t.value) / 10 ** Number(t.tokenDecimal || 18);
    if (!(amount > 0) || !asset || /[^\x20-\x7e]/.test(asset) || SPAMMY.test(asset)) continue;
    const p = priceFor(asset, chain, prices);
    out.push({ chain, hash: t.hash, ts: Number(t.timeStamp), from: t.from.toLowerCase(), to: t.to.toLowerCase(), asset, amount, usd: p ? amount * p : null });
  }
  return out;
}

// --- Blockscout (keyless, Ethereum) ---------------------------------------------

interface BsAddr {
  hash: string;
  name?: string | null;
  is_contract?: boolean;
  is_scam?: boolean;
  ens_domain_name?: string | null;
}
interface BsTx {
  hash: string;
  timestamp: string;
  value: string;
  status: string;
  from: BsAddr;
  to: BsAddr | null;
}
interface BsTokenTransfer {
  transaction_hash: string;
  timestamp: string;
  from: BsAddr;
  to: BsAddr;
  token: { symbol: string | null; type: string; decimals: string | null };
  total: { value?: string; decimals?: string | null } | null;
}
interface BsInternal {
  transaction_hash: string;
  timestamp: string;
  value: string;
  success: boolean;
  from: BsAddr;
  to: BsAddr | null;
}

async function pages<T>(base: string, path: string, max: number): Promise<T[]> {
  const out: T[] = [];
  let params = "";
  for (let i = 0; i < max; i++) {
    const page = await json<{ items: T[]; next_page_params: Record<string, string | number> | null }>(`${base}${path}${params}`);
    out.push(...page.items);
    if (!page.next_page_params) break;
    params = "?" + new URLSearchParams(Object.entries(page.next_page_params).map(([k, v]) => [k, String(v)])).toString();
  }
  return out;
}

async function fromBlockscout(chain: ChainId, address: string, prices: Record<string, number>, meta: Map<string, BsAddr>): Promise<Transfer[]> {
  const eth = prices[BUBBLE_CHAINS[chain].cg] || 0;
  const base = BUBBLE_CHAINS[chain].blockscout as string;
  const [txs, tokens, internal] = await Promise.all([
    pages<BsTx>(base, `/addresses/${address}/transactions`, 4),
    pages<BsTokenTransfer>(base, `/addresses/${address}/token-transfers`, 3).catch(() => [] as BsTokenTransfer[]),
    pages<BsInternal>(base, `/addresses/${address}/internal-transactions`, 2).catch(() => [] as BsInternal[]),
  ]);
  const note = (a: BsAddr | null) => {
    if (!a) return;
    const k = a.hash.toLowerCase();
    if (!meta.has(k)) meta.set(k, a);
  };
  const out: Transfer[] = [];
  const native = BUBBLE_CHAINS[chain].native;
  for (const t of txs) {
    note(t.from);
    note(t.to);
    if (t.status !== "ok" || !t.to) continue;
    const amount = Number(t.value) / 1e18;
    if (!(amount > 0)) continue;
    out.push({ chain, hash: t.hash, ts: Date.parse(t.timestamp) / 1000, from: t.from.hash.toLowerCase(), to: t.to.hash.toLowerCase(), asset: native, amount, usd: eth ? amount * eth : null });
  }
  for (const t of internal) {
    note(t.from);
    note(t.to);
    if (!t.success || !t.to) continue;
    const amount = Number(t.value) / 1e18;
    if (!(amount > 0)) continue;
    out.push({ chain, hash: t.transaction_hash, ts: Date.parse(t.timestamp) / 1000, from: t.from.hash.toLowerCase(), to: t.to.hash.toLowerCase(), asset: native, amount, usd: eth ? amount * eth : null });
  }
  for (const t of tokens) {
    if (t.from.is_scam || t.to.is_scam || t.token.type !== "ERC-20") continue;
    note(t.from);
    note(t.to);
    const asset = (t.token.symbol ?? "").trim();
    const amount = Number(t.total?.value ?? 0) / 10 ** Number(t.total?.decimals ?? t.token.decimals ?? 18);
    if (!(amount > 0) || !asset || /[^\x20-\x7e]/.test(asset) || SPAMMY.test(asset)) continue;
    const p = priceFor(asset, chain, prices);
    out.push({ chain, hash: t.transaction_hash, ts: Date.parse(t.timestamp) / 1000, from: t.from.hash.toLowerCase(), to: t.to.hash.toLowerCase(), asset, amount, usd: p ? amount * p : null });
  }
  return out;
}

// --- the map ----------------------------------------------------------------------

// Same first four and last four hex characters as an address it is pretending
// to be: the address-poisoning pattern this wallet set has already been hit by.
const looksLike = (a: string, b: string) => a !== b && a.slice(2, 6) === b.slice(2, 6) && a.slice(-4) === b.slice(-4);

export async function buildBubbleMap(addresses: string[], opts: { perWallet?: number } = {}) {
  const key = process.env.ETHERSCAN_API_KEY?.trim();
  const wallets = [...new Set(addresses.filter((a) => ADDR.test(a)).map((a) => a.toLowerCase()))].slice(0, 25);
  const chainIds = Object.keys(BUBBLE_CHAINS) as ChainId[];
  const prices = await nativePrices();
  const meta = new Map<string, BsAddr>();

  // Which chains each wallet has ever touched: a nonce or a balance says so,
  // and costs two RPC calls instead of three explorer calls per chain.
  const pairs = wallets.flatMap((w) => chainIds.map((c) => ({ w, c })));
  const touched = await pool(pairs, 6, async ({ w, c }) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const [nonce, bal] = await Promise.all([rpc<string>(c, "eth_getTransactionCount", [w, "latest"]), rpc<string>(c, "eth_getBalance", [w, "latest"])]);
        return BigInt(nonce) > BigInt(0) || BigInt(bal) > BigInt(0);
      } catch {
        await sleep(400 * (attempt + 1));
      }
    }
    return c === "ethereum" || c === "robinhood"; // still unknown: assume used rather than hide it
  });
  const active = new Map<ChainId, string[]>();
  pairs.forEach((p, i) => {
    if (touched[i]) active.set(p.c, [...(active.get(p.c) ?? []), p.w]);
  });

  const status = {} as Record<ChainId, ChainStatus>;
  const transfers: Transfer[] = [];
  const errors: string[] = [];
  for (const chain of chainIds) {
    const ws = active.get(chain) ?? [];
    // Blockscout where it is open (it also names contracts and flags scams),
    // Etherscan with the key everywhere else.
    const source: ChainStatus["source"] = BUBBLE_CHAINS[chain].blockscout ? "blockscout" : key ? "etherscan" : "none";
    status[chain] = { ok: source !== "none", source, active: ws.length, ...(source === "none" && ws.length ? { note: "needs a free Etherscan API key (ETHERSCAN_API_KEY)" } : {}) };
    if (!ws.length || source === "none") continue;
    const results = await Promise.allSettled(
      ws.map((w) => (source === "etherscan" ? fromEtherscan(chain, w, key as string, prices) : fromBlockscout(chain, w, prices, meta)))
    );
    let failed = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") transfers.push(...r.value);
      else {
        failed++;
        errors.push(`${BUBBLE_CHAINS[chain].name} ${ws[i].slice(0, 8)}: ${r.reason instanceof Error ? r.reason.message : "failed"}`);
      }
    });
    if (failed === results.length) status[chain] = { ...status[chain], ok: false, note: errors[errors.length - 1] };
  }

  // Each transfer once, even when both ends are your wallets.
  const seen = new Set<string>();
  const unique = transfers.filter((t) => {
    const k = `${t.chain}|${t.hash}|${t.from}|${t.to}|${t.asset}|${t.amount}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Poisoning: a counterparty that imitates one of your wallets or one of
  // his real counterparties, and never moved anything of value.
  const valued = new Set<string>();
  for (const t of unique) if ((t.usd ?? 0) >= 1) valued.add(t.from).add(t.to);
  const real = [...wallets, ...valued];
  const poison = new Set<string>();
  for (const t of unique)
    for (const a of [t.from, t.to])
      if (!wallets.includes(a) && !valued.has(a) && real.some((r) => looksLike(a, r))) poison.add(a);

  const edges = new Map<string, BubbleEdge>();
  for (const t of unique) {
    if (poison.has(t.from) || poison.has(t.to) || t.from === t.to) continue;
    const id = `${t.chain}|${t.from}|${t.to}`;
    const e =
      edges.get(id) ??
      ({ id, chain: t.chain, from: t.from, to: t.to, count: 0, usd: 0, unpriced: 0, assets: {}, first: t.ts, last: t.ts, txs: [] } satisfies BubbleEdge);
    e.count++;
    if (t.usd != null) e.usd += t.usd;
    else e.unpriced++;
    e.assets[t.asset] = (e.assets[t.asset] ?? 0) + t.amount;
    e.first = Math.min(e.first, t.ts);
    e.last = Math.max(e.last, t.ts);
    e.txs.push({ hash: t.hash, ts: t.ts, asset: t.asset, amount: t.amount, usd: t.usd });
    edges.set(id, e);
  }

  // Keep the map readable: per wallet, its biggest counterparties only.
  const per = opts.perWallet ?? 40;
  const keep = new Set<string>(wallets);
  for (const w of wallets) {
    const vol = new Map<string, number>();
    for (const e of edges.values()) {
      const other = e.from === w ? e.to : e.to === w ? e.from : null;
      if (!other) continue;
      vol.set(other, (vol.get(other) ?? 0) + e.usd + e.count * 0.01);
    }
    [...vol.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, per)
      .forEach(([a]) => keep.add(a));
  }
  const kept = [...edges.values()].filter((e) => keep.has(e.from) && keep.has(e.to));
  for (const e of kept) e.txs = e.txs.sort((a, b) => b.ts - a.ts).slice(0, 25);

  const nodes = new Map<string, BubbleNode>();
  const touch = (a: string, chain: ChainId) => {
    const n = nodes.get(a) ?? { id: a, address: meta.get(a)?.hash ?? a, chains: [], held: {}, heldUsd: 0 };
    if (!n.chains.includes(chain)) n.chains.push(chain);
    const m = meta.get(a);
    if (m) {
      n.name = m.name ?? m.ens_domain_name ?? undefined;
      n.contract = !!m.is_contract;
    }
    nodes.set(a, n);
  };
  for (const w of wallets) nodes.set(w, { id: w, address: w, chains: chainIds.filter((c) => active.get(c)?.includes(w)), held: {}, heldUsd: 0 });
  for (const e of kept) {
    touch(e.from, e.chain);
    touch(e.to, e.chain);
  }

  // What every bubble holds now (native coin on each chain it is seen on), and
  // whether it is a contract where no explorer said.
  // Wallets first, then the addresses that moved the most with them.
  const moved = new Map<string, number>();
  for (const e of kept) for (const a of [e.from, e.to]) moved.set(a, (moved.get(a) ?? 0) + e.usd);
  const reads = [...nodes.values()]
    .sort((a, b) => Number(wallets.includes(b.id)) - Number(wallets.includes(a.id)) || (moved.get(b.id) ?? 0) - (moved.get(a.id) ?? 0))
    .flatMap((n) => n.chains.map((c) => ({ n, c })));
  await pool(reads.slice(0, 120), 6, async ({ n, c }) => {
    try {
      const [bal, code] = await Promise.all([
        rpc<string>(c, "eth_getBalance", [n.id, "latest"]),
        n.contract === undefined ? rpc<string>(c, "eth_getCode", [n.id, "latest"]) : Promise.resolve(null),
      ]);
      const amount = Number(BigInt(bal)) / 1e18;
      const usd = amount * (prices[BUBBLE_CHAINS[c].cg] || 0);
      if (amount > 0) n.held[c] = { amount, symbol: BUBBLE_CHAINS[c].native, usd };
      n.heldUsd += usd;
      if (code !== null && n.contract === undefined) n.contract = code !== "0x" && code.length > 2 && !wallets.includes(n.id);
    } catch {
      // a chain that does not answer leaves the bubble at what the others said
    }
  });

  // Names for the biggest contracts on Etherscan-read chains: verified
  // contracts carry their source name (a game, a router, a token).
  if (key) {
    const flow = new Map<string, number>();
    for (const e of kept) for (const a of [e.from, e.to]) flow.set(a, (flow.get(a) ?? 0) + e.usd + e.count);
    const unnamed = [...nodes.values()]
      .filter((n) => n.contract && !n.name && n.chains.some((c) => status[c]?.source === "etherscan"))
      .sort((a, b) => (flow.get(b.id) ?? 0) - (flow.get(a.id) ?? 0))
      .slice(0, 12);
    for (const n of unnamed) {
      const chain = n.chains.find((c) => status[c]?.source === "etherscan") as ChainId;
      try {
        const url = `https://api.etherscan.io/v2/api?chainid=${BUBBLE_CHAINS[chain].chainid}&module=contract&action=getsourcecode&address=${n.id}&apikey=${key}`;
        for (let attempt = 0; attempt < 4; attempt++) {
          const j = await throttled(() => json<{ result?: { ContractName?: string }[] | string }>(url));
          if (typeof j.result === "string" && /rate limit/i.test(j.result)) {
            await sleep(1100 * (attempt + 1));
            continue;
          }
          const name = Array.isArray(j.result) ? j.result[0]?.ContractName?.trim() : undefined;
          if (name) n.name = name;
          break;
        }
      } catch {
        // unverified or rate limited: it stays a short address
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: kept,
    status,
    keyed: !!key,
    errors: errors.slice(0, 10),
    poisoned: poison.size,
    prices,
    fetchedAt: new Date().toISOString(),
  };
}
