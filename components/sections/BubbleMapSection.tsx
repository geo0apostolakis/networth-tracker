"use client";

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNarrow } from "@/components/term/hooks";
import { convertToBase } from "@/lib/fx";
import { useStore } from "@/lib/store";
import { formatMoney } from "@/lib/utils";

// bubble map: your wallets and everything they have sent money to or
// received it from, in the style of Bubblemaps.
//
// Layout: each of his wallets is an island on a ring, and the addresses it
// deals with gather on the outside of it; an address shared by several of his
// wallets sits between them. Bubbles are solid and never overlap, labels
// never cover each other. His wallets are sized by what they hold; every
// other address by how much money it moved with him.
//
// Colour, by default, answers "where did the money go": green paid you, red
// you paid, yellow both ways, orange between two of your own wallets. It can
// be switched to one colour per wallet, or one per chain.

type ChainId = "ethereum" | "robinhood" | "base" | "arbitrum" | "optimism" | "polygon" | "bsc" | "avalanche";
type ColorBy = "money" | "wallet" | "chain";

interface ApiEdge {
  id: string;
  chain: ChainId;
  from: string;
  to: string;
  count: number;
  usd: number;
  unpriced: number;
  assets: Record<string, number>;
  first: number;
  last: number;
  txs: { hash: string; ts: number; asset: string; amount: number; usd: number | null }[];
}
interface ApiNode {
  id: string;
  address: string;
  chains: ChainId[];
  name?: string;
  contract?: boolean;
  held: Partial<Record<ChainId, { amount: number; symbol: string; usd: number }>>;
  heldUsd: number;
}
interface ApiMap {
  nodes: ApiNode[];
  edges: ApiEdge[];
  status: Record<ChainId, { ok: boolean; source: string; active: number; note?: string }>;
  keyed: boolean;
  errors: string[];
  poisoned: number;
  fetchedAt: string;
}

const CHAIN: Record<ChainId, { name: string; color: string; explorer: string; scan: string }> = {
  ethereum: { name: "Ethereum", color: "#8c9eff", explorer: "https://etherscan.io", scan: "etherscan" },
  robinhood: { name: "Robinhood Chain", color: "#c6f432", explorer: "https://robin.etherscan.io", scan: "robin.etherscan" },
  base: { name: "Base", color: "#3c7bff", explorer: "https://basescan.org", scan: "basescan" },
  arbitrum: { name: "Arbitrum", color: "#2ea8ff", explorer: "https://arbiscan.io", scan: "arbiscan" },
  optimism: { name: "Optimism", color: "#ff4d6a", explorer: "https://optimistic.etherscan.io", scan: "op etherscan" },
  polygon: { name: "Polygon", color: "#a77bff", explorer: "https://polygonscan.com", scan: "polygonscan" },
  bsc: { name: "BNB Chain", color: "#f3ba2f", explorer: "https://bscscan.com", scan: "bscscan" },
  avalanche: { name: "Avalanche", color: "#ff6b6b", explorer: "https://snowtrace.io", scan: "snowtrace" },
};
const CHAIN_IDS = Object.keys(CHAIN) as ChainId[];
// Chains a holding can be on that the transfer map does not read (yet).
const OTHER: Record<string, { name: string; color: string }> = { solana: { name: "Solana", color: "#9945ff" }, bitcoin: { name: "Bitcoin", color: "#f7931a" } };
const chainOf = (c: string) => CHAIN[c as ChainId] ?? OTHER[c] ?? { name: c, color: "#55534d" };
// Wallet colours: distinct hues, none of them the green/red/yellow/orange the
// money view uses for direction.
const PALETTE = ["#c678dd", "#61afef", "#56b6c2", "#f0a3ff", "#9ccfd8", "#a78bfa", "#7dd3fc", "#f9a8d4", "#93c5fd", "#c4b5fd", "#67e8f9"];
const C = { in: "#7fd962", out: "#e06c75", both: "#e5c07b", own: "#d97757", none: "#5a6488", known: "#61afef", empty: "#55534d" };
const KNOWN: Record<string, string> = { "0x0000000000001ff3684f28c67538d4d072c22734": "Solcard hot wallet" };

interface Holding {
  chain: string;
  symbol: string;
  qty?: number;
  usd: number;
}
interface GNode extends SimulationNodeDatum {
  id: string;
  address: string;
  label: string;
  mine: boolean;
  empty: boolean; // one of your wallets that has never been used
  known: boolean;
  contract: boolean;
  shared: boolean;
  walletColor: string; // the wallet's own colour, or the colour of the wallet it deals with most
  r: number;
  heldUsd: number;
  holdings: Holding[];
  chains: ChainId[];
  flowUsd: number;
  toYou: number; // money it sent to your wallets
  fromYou: number; // money your wallets sent it
  ax: number; // where the layout pulls it
  ay: number;
}
interface GLink extends SimulationLinkDatum<GNode> {
  id: string;
  edge: ApiEdge;
  width: number;
  kind: "in" | "out" | "own" | "other";
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const day = (ts: number) => new Date(ts * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
const qty = (v: number) => (v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v >= 1 ? v.toFixed(3) : v.toPrecision(3));
const log = (v: number) => Math.log10(1 + Math.max(0, v));
const edgeUsd = (e: ApiEdge, until: number | null) => (until === null ? e.usd : e.txs.reduce((s, t) => s + (t.ts <= until ? (t.usd ?? 0) : 0), 0));

export default function BubbleMapSection() {
  const wallets = useStore((s) => s.wallets);
  const assets = useStore((s) => s.assets);
  const fx = useStore((s) => s.fx);
  const base = useStore((s) => s.baseCurrency);
  const privacy = useStore((s) => s.privacy);
  const deposit = useStore((s) => s.solcard.deposit);
  const names = useStore((s) => s.addressLabels);
  const setAddressLabel = useStore((s) => s.setAddressLabel);
  const addWallet = useStore((s) => s.addWallet);
  const narrow = useNarrow();

  const [maps, setMaps] = useState<ApiMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanding, setExpanding] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [off, setOff] = useState<Set<ChainId>>(new Set());
  const [minUsd, setMinUsd] = useState(0);
  const [flows, setFlows] = useState(true);
  const [colorBy, setColorBy] = useState<ColorBy>("money");
  const [listOpen, setListOpen] = useState(false);
  const [until, setUntil] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState("");

  const addrs = useMemo(() => [...new Set(wallets.map((w) => w.address.trim()).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)))].sort(), [wallets]);
  const key = addrs.join(",");

  useEffect(() => {
    if (!key) return;
    let live = true;
    // v= changes whenever the answer's shape does, so a CDN copy of the old shape is never served.
    fetch(`/api/bubblemap?v=4&a=${key}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (j.error) setError(j.error);
        else setMaps([j as ApiMap]);
        setLoading(false);
      })
      .catch((e) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : "failed");
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [key]);

  async function expand(id: string) {
    setExpanding(id);
    try {
      const j = await (await fetch(`/api/bubblemap?v=4&a=${id}&expand=1`)).json();
      if (!j.error) {
        setMaps((m) => [...m, j as ApiMap]);
        setExpanded((x) => [...x, id.toLowerCase()]);
      }
    } finally {
      setExpanding(null);
    }
  }

  const toBase = (usd: number) => convertToBase(usd, "USD", fx);
  const money = (usd: number) => formatMoney(toBase(usd), base, privacy);
  const compact = (usd: number) => formatMoney(toBase(usd), base, privacy, { compact: usd >= 10000 });

  // your wallets: what each holds, from the wallet sync (tokens included).
  const mineHoldings = useMemo(() => {
    const out = new Map<string, Holding[]>();
    for (const w of wallets) {
      const rows = assets
        .filter((a) => a.walletId === w.id && a.amount > 0.005)
        .map((a) => ({ chain: a.chain ?? "", symbol: a.name.split(" ").pop() ?? "", qty: a.quantity, usd: a.currency === "USD" ? a.amount : convertToBase(a.amount, a.currency, fx) * (fx.rates.USD ?? 1) }))
        .sort((a, b) => b.usd - a.usd);
      out.set(w.address.toLowerCase(), rows);
    }
    return out;
  }, [wallets, assets, fx]);

  const merged = useMemo(() => {
    const nodes = new Map<string, ApiNode>();
    const edges = new Map<string, ApiEdge>();
    for (const m of maps) {
      for (const n of m.nodes) {
        const p = nodes.get(n.id);
        nodes.set(n.id, p ? { ...p, ...n, chains: [...new Set([...p.chains, ...n.chains])], held: { ...p.held, ...n.held }, heldUsd: Math.max(p.heldUsd, n.heldUsd) } : n);
      }
      for (const e of m.edges) edges.set(e.id, e);
    }
    return { nodes, edges };
  }, [maps]);

  const status = maps[0]?.status;
  const locked = status ? CHAIN_IDS.filter((c) => !status[c].ok && status[c].active > 0) : [];
  const present = status ? CHAIN_IDS.filter((c) => status[c].active > 0 || [...merged.edges.values()].some((e) => e.chain === c)) : [];

  // The graph for the current filters. Colours are not part of it (switching
  // the colour view must not move anything), nor is the timeline.
  const graph = useMemo(() => {
    const mineLabel = new Map(wallets.map((w) => [w.address.toLowerCase(), w.label]));
    const mineAddr = new Map(wallets.map((w) => [w.address.toLowerCase(), w.address.trim()]));
    const known = new Map(Object.entries(KNOWN));
    if (deposit) known.set(deposit.toLowerCase(), "Solcard deposit");
    const shown = [...merged.edges.values()].filter((e) => !off.has(e.chain) && e.usd >= minUsd && !hidden.has(e.from) && !hidden.has(e.to));

    const mineIds = [...mineLabel.keys()];
    const color = new Map(mineIds.map((id, i) => [id, PALETTE[i % PALETTE.length]]));
    const flow = new Map<string, number>();
    const ties = new Map<string, Map<string, number>>();
    const toYou = new Map<string, number>();
    const fromYou = new Map<string, number>();
    for (const e of shown) {
      const fm = mineLabel.has(e.from);
      const tm = mineLabel.has(e.to);
      if (fm && !tm) fromYou.set(e.to, (fromYou.get(e.to) ?? 0) + e.usd);
      if (tm && !fm) toYou.set(e.from, (toYou.get(e.from) ?? 0) + e.usd);
      for (const [a, b] of [
        [e.from, e.to],
        [e.to, e.from],
      ]) {
        flow.set(a, (flow.get(a) ?? 0) + e.usd);
        if (mineLabel.has(b) && !mineLabel.has(a)) {
          const m = ties.get(a) ?? new Map<string, number>();
          m.set(b, (m.get(b) ?? 0) + e.usd + 0.01);
          ties.set(a, m);
        }
      }
    }
    const ids = new Set<string>(mineIds);
    for (const e of shown) ids.add(e.from).add(e.to);
    for (const h of hidden) ids.delete(h);

    const nodes: GNode[] = [...ids].map((id) => {
      const n = merged.nodes.get(id);
      const mine = mineLabel.has(id);
      const t = ties.get(id);
      const lead = t ? [...t.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
      const holdings: Holding[] = mine
        ? (mineHoldings.get(id) ?? [])
        : Object.entries(n?.held ?? {}).map(([c, h]) => ({ chain: c, symbol: h.symbol, qty: h.amount, usd: h.usd }));
      const heldUsd = holdings.reduce((s, h) => s + h.usd, 0);
      const contract = !!n?.contract && !mine;
      const moved = flow.get(id) ?? 0;
      const empty = mine && heldUsd < 0.01 && (n?.chains.length ?? 0) === 0 && !moved;
      // Yours: by what it holds. Anyone else: by what moved with you, which is
      // what the map is about (a router holding €120M is not 120M of yours).
      const r = mine ? (empty ? 9 : Math.max(13, Math.min(46, 9 + 6.5 * log(heldUsd)))) : Math.max(5, Math.min(30, 4 + 5 * log(moved)));
      return {
        id,
        address: mineAddr.get(id) ?? n?.address ?? id,
        label: names[id] ?? mineLabel.get(id) ?? known.get(id) ?? n?.name ?? short(n?.address ?? id),
        mine,
        empty,
        known: known.has(id),
        contract,
        shared: !!t && t.size >= 2,
        walletColor: mine ? (empty ? C.empty : (color.get(id) as string)) : lead ? (color.get(lead) as string) : C.none,
        r,
        heldUsd,
        holdings,
        chains: n?.chains ?? [],
        flowUsd: moved,
        toYou: toYou.get(id) ?? 0,
        fromYou: fromYou.get(id) ?? 0,
        ax: 0,
        ay: 0,
      };
    });
    const index = new Map(nodes.map((n) => [n.id, n]));

    // Islands: used wallets evenly on a ring, never-used ones in a row
    // underneath, every other address pulled outward from the wallet(s) it
    // deals with (an address shared by two wallets lands between them).
    const used = nodes.filter((n) => n.mine && !n.empty);
    const R = 120 + used.length * 28;
    used.forEach((n, i) => {
      const a = (i / Math.max(1, used.length)) * Math.PI * 2 - Math.PI / 2;
      n.ax = Math.cos(a) * R;
      n.ay = Math.sin(a) * R;
    });
    const empties = nodes.filter((n) => n.empty);
    empties.forEach((n, i) => {
      n.ax = (i - (empties.length - 1) / 2) * 70;
      n.ay = R * 1.3;
    });
    for (const n of nodes) {
      if (n.mine) continue;
      const t = ties.get(n.id);
      let x = 0;
      let y = 0;
      let w = 0;
      for (const [m, v] of t ?? []) {
        const a = index.get(m);
        if (!a) continue;
        const wt = 1 + log(v);
        x += a.ax * wt;
        y += a.ay * wt;
        w += wt;
      }
      const spread = t && t.size >= 2 ? 0.9 : 1.5;
      n.ax = w ? (x / w) * spread : 0;
      n.ay = w ? (y / w) * spread : 0;
    }

    const links: GLink[] = shown
      .filter((e) => index.has(e.from) && index.has(e.to))
      .map((e) => {
        const fm = mineLabel.has(e.from);
        const tm = mineLabel.has(e.to);
        return { id: e.id, source: e.from, target: e.to, edge: e, width: 0.8 + Math.min(4, log(e.usd) * 0.75), kind: fm && tm ? "own" : tm ? "in" : fm ? "out" : "other" };
      });
    const span = links.length ? { from: Math.min(...links.map((l) => l.edge.first)), to: Math.max(...links.map((l) => l.edge.last)) } : null;
    return { nodes, links, index, span };
  }, [merged, wallets, deposit, mineHoldings, names, off, minUsd, hidden]);

  // Colours for the current view, kept apart from the layout.
  const paint = useMemo(() => {
    const node = new Map<string, string>();
    for (const n of graph.nodes) {
      let c: string;
      if (n.mine) c = n.walletColor;
      else if (colorBy === "wallet") c = n.walletColor;
      else if (colorBy === "chain") c = n.chains.length === 1 ? CHAIN[n.chains[0]].color : n.chains.length > 1 ? "#ece9df" : C.none;
      else if (n.known) c = C.known;
      else if (n.toYou > n.fromYou * 1.25) c = C.in;
      else if (n.fromYou > n.toYou * 1.25) c = C.out;
      else c = n.toYou + n.fromYou > 0 ? C.both : C.none;
      node.set(n.id, c);
    }
    const link = new Map<string, string>();
    for (const l of graph.links) {
      link.set(l.id, colorBy === "chain" ? CHAIN[l.edge.chain].color : colorBy === "wallet" ? "#8a93b8" : l.kind === "in" ? C.in : l.kind === "out" ? C.out : l.kind === "own" ? C.own : C.none);
    }
    return { node, link };
  }, [graph, colorBy]);

  // Totals for the strip above the map: money crossing the edge of your
  // own wallets only (moves between two of his are counted apart).
  const totals = useMemo(() => {
    let held = 0;
    for (const n of graph.nodes) if (n.mine) held += n.heldUsd;
    let inUsd = 0;
    let outUsd = 0;
    let between = 0;
    const outTo = new Map<string, number>();
    const inFrom = new Map<string, number>();
    for (const l of graph.links) {
      const v = edgeUsd(l.edge, until);
      if (!v) continue;
      if (l.kind === "own") between += v;
      else if (l.kind === "out") {
        outUsd += v;
        outTo.set(l.edge.to, (outTo.get(l.edge.to) ?? 0) + v);
      } else if (l.kind === "in") {
        inUsd += v;
        inFrom.set(l.edge.from, (inFrom.get(l.edge.from) ?? 0) + v);
      }
    }
    const top = (m: Map<string, number>) => {
      const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      return best ? { node: graph.index.get(best[0]) as GNode, usd: best[1] } : null;
    };
    return { held, inUsd, outUsd, between, topOut: top(outTo), topIn: top(inFrom), used: graph.nodes.filter((n) => n.mine && !n.empty).length, mine: graph.nodes.filter((n) => n.mine).length };
  }, [graph, until]);

  // ---------------------------------------------------------------- timeline
  useEffect(() => {
    if (!playing || !graph.span) return;
    const { from, to } = graph.span;
    const step = Math.max(3600, (to - from) / 140);
    const id = setInterval(() => {
      setUntil((u) => {
        const next = (u ?? from) + step;
        if (next >= to) {
          setPlaying(false);
          return null;
        }
        return next;
      });
    }, 80);
    return () => clearInterval(id);
  }, [playing, graph.span]);

  // ---------------------------------------------------------------- canvas
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const nodesRef = useRef<GNode[]>([]);
  const linksRef = useRef<GLink[]>([]);
  // touched: the user has panned, zoomed or dragged, so the view stops re-framing itself.
  const view = useRef({ k: 1, x: 0, y: 0, w: 0, h: 0, fitted: false, touched: false });
  const ui = useRef({
    hover: null as string | null,
    selected: null as string | null,
    flows: true,
    until: null as number | null,
    dirty: true,
    font: "11px ui-monospace, monospace",
    money: (v: number) => String(v),
    node: new Map<string, string>(),
    link: new Map<string, string>(),
  });
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; id: string } | null>(null);

  useEffect(() => {
    const u = ui.current;
    u.selected = selected;
    u.flows = flows;
    u.until = until;
    u.node = paint.node;
    u.link = paint.link;
    u.money = (usd: number) => formatMoney(convertToBase(usd, "USD", fx), base, privacy, { compact: usd >= 10000 });
    u.dirty = true;
  }, [selected, flows, until, privacy, fx, base, paint]);

  // (Re)build the simulation when the graph changes, keeping every bubble
  // that was already on screen where it was.
  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes = graph.nodes.map((n) => {
      const p = prev.get(n.id);
      return p ? Object.assign(p, { ...n, x: p.x, y: p.y, vx: p.vx, vy: p.vy, fx: p.fx, fy: p.fy }) : n;
    });
    for (const n of nodes) {
      if (n.x !== undefined) continue;
      n.x = n.ax + (Math.random() - 0.5) * 60;
      n.y = n.ay + (Math.random() - 0.5) * 60;
    }
    const links = graph.links.map((l) => ({ ...l }));
    nodesRef.current = nodes;
    linksRef.current = links;
    let sim = simRef.current;
    if (!sim) {
      sim = forceSimulation<GNode, GLink>()
        .force("charge", forceManyBody<GNode>().strength((d) => -24 - d.r * 2.6).distanceMax(420))
        // Room for the bubble and its label: nothing can sit on anything else.
        .force("collide", forceCollide<GNode>((d) => d.r + (d.mine || d.r > 12 ? 16 : 7)).strength(1).iterations(4))
        .alphaDecay(0.025)
        .on("tick", () => {
          ui.current.dirty = true;
        })
        // Frame the map again once it has settled, unless the user already moved it.
        .on("end", () => {
          if (!view.current.touched) (wrapRef.current as (HTMLDivElement & { fit?: (mark?: boolean) => void }) | null)?.fit?.(true);
        });
      simRef.current = sim;
    }
    const pull = (d: GNode) => (d.empty ? 0.5 : d.mine ? 0.18 : 0.06);
    sim.force("x", forceX<GNode>((d) => d.ax).strength(pull));
    sim.force("y", forceY<GNode>((d) => d.ay).strength(pull));
    sim.nodes(nodes);
    sim.force(
      "link",
      forceLink<GNode, GLink>(links)
        .id((d) => d.id)
        .distance((l) => 36 + (l.source as GNode).r + (l.target as GNode).r)
        .strength(0.07)
    );
    const first = !view.current.fitted && nodes.length > 0 && (links.length > 0 || graph.nodes.every((n) => n.mine));
    if (first) {
      sim.alpha(1).tick(320);
      (wrapRef.current as (HTMLDivElement & { fit?: (mark?: boolean) => void }) | null)?.fit?.(true);
    }
    sim.alpha(first ? 0.15 : 0.5).restart();
    ui.current.dirty = true;
  }, [graph]);

  useEffect(() => () => void simRef.current?.stop(), []);

  // Size, input and the draw loop.
  useEffect(() => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    if (!wrap || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ui.current.font = `11px ${getComputedStyle(document.body).fontFamily}`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const fit = (mark = true) => {
      const ns = nodesRef.current;
      if (!ns.length || !view.current.w) return;
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const n of ns) {
        x0 = Math.min(x0, (n.x ?? 0) - n.r - 40);
        y0 = Math.min(y0, (n.y ?? 0) - n.r);
        x1 = Math.max(x1, (n.x ?? 0) + n.r + 40);
        y1 = Math.max(y1, (n.y ?? 0) + n.r + 30);
      }
      const v = view.current;
      v.k = Math.max(0.2, Math.min(1.6, Math.min(v.w / (x1 - x0 + 40), v.h / (y1 - y0 + 40))));
      v.x = v.w / 2 - ((x0 + x1) / 2) * v.k;
      v.y = v.h / 2 - ((y0 + y1) / 2) * v.k;
      if (mark) v.fitted = true;
      ui.current.dirty = true;
    };
    (wrap as HTMLDivElement & { fit?: (mark?: boolean) => void }).fit = fit;
    // Put every bubble back on its island and frame the result.
    (wrap as HTMLDivElement & { tidy?: () => void }).tidy = () => {
      for (const n of nodesRef.current) {
        n.fx = null;
        n.fy = null;
        n.x = n.ax + (Math.random() - 0.5) * 40;
        n.y = n.ay + (Math.random() - 0.5) * 40;
      }
      simRef.current?.alpha(1).tick(300);
      simRef.current?.alpha(0.1).restart();
      fit();
    };

    const ro = new ResizeObserver(() => {
      const v = view.current;
      v.w = wrap.clientWidth;
      v.h = wrap.clientHeight;
      cv.width = Math.round(v.w * dpr);
      cv.height = Math.round(v.h * dpr);
      cv.style.width = `${v.w}px`;
      cv.style.height = `${v.h}px`;
      if (!v.fitted) fit(false);
      ui.current.dirty = true;
    });
    ro.observe(wrap);

    const world = (sx: number, sy: number) => ({ x: (sx - view.current.x) / view.current.k, y: (sy - view.current.y) / view.current.k });
    const hit = (sx: number, sy: number) => {
      const p = world(sx, sy);
      let best: GNode | null = null;
      for (const n of nodesRef.current) {
        const d = Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y);
        if (d <= n.r + 6 / view.current.k && (!best || n.r < best.r)) best = n;
      }
      return best;
    };

    // ---------------------------------------------------------- pointers
    const pts = new Map<number, { x: number; y: number }>();
    let drag: { node: GNode | null; sx: number; sy: number; moved: boolean; vx: number; vy: number } | null = null;
    let pinch: { d: number; k: number; cx: number; cy: number } | null = null;
    const local = (e: PointerEvent | WheelEvent) => {
      const b = cv.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const zoomAt = (sx: number, sy: number, k: number) => {
      const v = view.current;
      v.touched = true;
      const nk = Math.max(0.2, Math.min(6, k));
      v.x = sx - ((sx - v.x) * nk) / v.k;
      v.y = sy - ((sy - v.y) * nk) / v.k;
      v.k = nk;
      ui.current.dirty = true;
    };
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.current.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        if (drag?.node) {
          drag.node.fx = null;
          drag.node.fy = null;
        }
        drag = null;
        return;
      }
      const node = hit(p.x, p.y);
      drag = { node, sx: p.x, sy: p.y, moved: false, vx: view.current.x, vy: view.current.y };
      if (node) {
        node.fx = node.x;
        node.fy = node.y;
        simRef.current?.alphaTarget(0.2).restart();
      }
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        zoomAt(pinch.cx, pinch.cy, (pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d);
        return;
      }
      if (drag) {
        if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 4) {
          drag.moved = true;
          view.current.touched = true;
        }
        if (drag.node) {
          const w = world(p.x, p.y);
          drag.node.fx = w.x;
          drag.node.fy = w.y;
        } else {
          view.current.x = drag.vx + (p.x - drag.sx);
          view.current.y = drag.vy + (p.y - drag.sy);
        }
        ui.current.dirty = true;
        return;
      }
      if (e.pointerType === "mouse") {
        const n = hit(p.x, p.y);
        const id = n?.id ?? null;
        if (id !== ui.current.hover) {
          ui.current.hover = id;
          ui.current.dirty = true;
          cv.style.cursor = n ? "pointer" : "grab";
        }
        setHoverTip(n ? { x: p.x, y: p.y, id: n.id } : null);
      }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!drag) return;
      const d = drag;
      drag = null;
      simRef.current?.alphaTarget(0);
      if (!d.moved) {
        if (d.node) {
          d.node.fx = null;
          d.node.fy = null;
        }
        setSelected(d.node ? d.node.id : null);
      } else if (d.node) {
        // Dropped bubbles stay where they were put; the rest settle around them.
        d.node.ax = d.node.fx ?? d.node.ax;
        d.node.ay = d.node.fy ?? d.node.ay;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(p.x, p.y, view.current.k * Math.exp(-e.deltaY * 0.0015));
    };
    const leave = () => {
      ui.current.hover = null;
      ui.current.dirty = true;
      setHoverTip(null);
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", leave);
    cv.addEventListener("wheel", wheel, { passive: false });

    // ---------------------------------------------------------- drawing
    let raf = 0;
    let frame = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const u = ui.current;
      if (document.hidden || (!u.dirty && !u.flows)) return;
      u.dirty = false;
      const v = view.current;
      // Keep the whole map in frame while it settles, until the user takes over.
      const sim = simRef.current;
      if (!v.touched && v.fitted && sim && sim.alpha() > sim.alphaMin() && ++frame % 15 === 0) fit(true);
      const ns = nodesRef.current;
      const ls = linksRef.current;
      const until = u.until ?? Infinity;
      const replay = u.until !== null;
      const col = (id: string) => u.node.get(id) ?? C.none;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = ctx.createRadialGradient(v.w / 2, v.h / 2, 0, v.w / 2, v.h / 2, Math.max(v.w, v.h) * 0.7);
      g.addColorStop(0, "#0d1226");
      g.addColorStop(1, "#050507");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, v.w, v.h);
      ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y);

      const live = new Set<string>();
      for (const l of ls) {
        if (l.edge.first > until) continue;
        live.add((l.source as GNode).id).add((l.target as GNode).id);
      }
      const focus = u.selected ?? u.hover;
      const near = new Set<string>();
      if (focus) {
        near.add(focus);
        for (const l of ls) {
          const s = (l.source as GNode).id;
          const d = (l.target as GNode).id;
          if (s === focus) near.add(d);
          if (d === focus) near.add(s);
        }
      }
      const dim = (id: string) => focus !== null && !near.has(id);
      const k2 = Math.sqrt(v.k);

      // links: edge to edge, ending in an arrowhead at the receiver
      for (const l of ls) {
        if (l.edge.first > until) continue;
        const s = l.source as GNode;
        const d = l.target as GNode;
        const dx = (d.x ?? 0) - (s.x ?? 0);
        const dy = (d.y ?? 0) - (s.y ?? 0);
        const len = Math.hypot(dx, dy) || 1;
        if (len < s.r + d.r + 2) continue;
        const ux = dx / len;
        const uy = dy / len;
        const x0 = (s.x ?? 0) + ux * (s.r + 1);
        const y0 = (s.y ?? 0) + uy * (s.r + 1);
        const x1 = (d.x ?? 0) - ux * (d.r + 3);
        const y1 = (d.y ?? 0) - uy * (d.r + 3);
        const on = focus !== null && (s.id === focus || d.id === focus);
        const lc = u.link.get(l.id) ?? C.none;
        const fresh = replay && l.edge.txs.some((x) => x.ts <= until && x.ts > until - 86400 * 3);
        ctx.globalAlpha = dim(s.id) || dim(d.id) ? 0.04 : on || fresh ? 0.95 : l.kind === "other" ? 0.25 : 0.55;
        ctx.strokeStyle = lc;
        ctx.lineWidth = (l.width + (on || fresh ? 0.8 : 0)) / k2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        const a = (4 + l.width * 0.6) / k2;
        ctx.fillStyle = lc;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - ux * a * 1.7 - uy * a, y1 - uy * a * 1.7 + ux * a);
        ctx.lineTo(x1 - ux * a * 1.7 + uy * a, y1 - uy * a * 1.7 - ux * a);
        ctx.closePath();
        ctx.fill();
        if (u.flows && l.edge.usd >= 1 && !(dim(s.id) || dim(d.id)) && (!replay || fresh)) {
          const n = l.edge.usd >= 1000 ? 2 : 1;
          const speed = 0.00016 + Math.min(0.00035, l.edge.count * 0.00002);
          ctx.globalAlpha = on ? 1 : 0.85;
          for (let i = 0; i < n; i++) {
            const k = (t * speed + i / n + (l.edge.first % 97) / 97) % 1;
            ctx.beginPath();
            ctx.arc(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, (1.8 + l.width * 0.3) / k2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // bubbles: solid, so lines stop at their edge instead of showing through
      const order = [...ns].sort((a, b) => Number(a.mine) - Number(b.mine) || b.r - a.r);
      for (const n of order) {
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        const c = col(n.id);
        const notYet = replay && !n.mine && !live.has(n.id);
        const hot = n.id === focus;
        ctx.globalAlpha = dim(n.id) ? 0.14 : notYet ? 0.07 : n.empty ? 0.6 : 1;
        if ((n.mine && !n.empty) || hot) {
          ctx.shadowColor = c;
          ctx.shadowBlur = (hot ? 28 : 18) * v.k;
        }
        ctx.fillStyle = "#0a0d1a";
        ctx.beginPath();
        ctx.arc(x, y, n.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        const fill = ctx.createRadialGradient(x - n.r * 0.35, y - n.r * 0.35, n.r * 0.1, x, y, n.r);
        fill.addColorStop(0, `${c}${n.mine ? "66" : "44"}`);
        fill.addColorStop(1, `${c}${n.mine ? "26" : "18"}`);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = (n.mine ? 2.6 : hot ? 2.2 : 1.5) / k2;
        ctx.strokeStyle = c;
        ctx.setLineDash(n.contract || n.empty ? [4 / v.k, 3 / v.k] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        if (n.mine && !n.empty) {
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(x, y, Math.max(2.5, n.r * 0.13), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Labels, in screen space, placed most important first and skipped
      // whenever they would land on one already drawn.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.font = u.font;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const placed: [number, number, number, number][] = [];
      const want = ns
        .filter((n) => !dim(n.id) && !(replay && !n.mine && !live.has(n.id)) && (n.mine || n.known || n.id === focus || near.has(n.id) || n.r * v.k >= 11))
        .sort((a, b) => prio(b) - prio(a));
      function prio(n: GNode) {
        return (n.id === focus ? 1e9 : 0) + (n.mine ? 1e8 : 0) + (n.known ? 1e7 : 0) + n.r;
      }
      for (const n of want) {
        const sx = v.x + (n.x ?? 0) * v.k;
        const sy = v.y + ((n.y ?? 0) + n.r) * v.k + 4;
        const name = n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label;
        const worth = n.mine ? (n.empty ? "empty · never used" : `holds ${u.money(n.heldUsd)}`) : n.flowUsd >= 0.01 ? `moved ${u.money(n.flowUsd)}` : "";
        const w = Math.max(ctx.measureText(name).width, worth ? ctx.measureText(worth).width : 0) + 10;
        const h = worth ? 29 : 16;
        const box: [number, number, number, number] = [sx - w / 2, sy - 1, sx + w / 2, sy + h];
        const forced = n.mine || n.id === focus;
        if (!forced && placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
        placed.push(box);
        ctx.fillStyle = "rgba(5,6,12,0.82)";
        ctx.fillRect(box[0], box[1], w, h);
        ctx.fillStyle = n.mine ? col(n.id) : n.id === focus ? "#ece9df" : "#b8bfdc";
        ctx.fillText(name, sx, sy + 1);
        if (worth) {
          ctx.fillStyle = n.mine ? "#ece9df" : "#8a877e";
          ctx.fillText(worth, sx, sy + 14);
        }
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("pointerleave", leave);
      cv.removeEventListener("wheel", wheel);
    };
  }, []);

  const refit = () => (wrapRef.current as (HTMLDivElement & { fit?: () => void }) | null)?.fit?.();
  const relayout = () => (wrapRef.current as (HTMLDivElement & { tidy?: () => void }) | null)?.tidy?.();
  const center = (id: string) => {
    const n = nodesRef.current.find((x) => x.id === id);
    const v = view.current;
    if (!n) return;
    v.k = Math.max(v.k, 1.3);
    v.x = v.w / 2 - (n.x ?? 0) * v.k;
    v.y = v.h / 2 - (n.y ?? 0) * v.k;
    ui.current.dirty = true;
  };
  const go = (id: string) => {
    setSelected(id);
    setNaming("");
    center(id);
  };

  function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const lower = q.toLowerCase();
    if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
      if (graph.index.has(lower)) go(lower);
      else expand(q).then(() => setSelected(lower));
    } else {
      const hitNode = graph.nodes.find((n) => n.label.toLowerCase().includes(lower));
      if (hitNode) go(hitNode.id);
    }
    setQuery("");
  }

  // ---------------------------------------------------------------- panels
  const sel = selected ? graph.index.get(selected) : undefined;
  const detail = useMemo(() => {
    if (!sel) return null;
    const touching = graph.links.map((l) => l.edge).filter((e) => e.from === sel.id || e.to === sel.id);
    let inUsd = 0;
    let outUsd = 0;
    const peers = new Map<string, { usd: number; dir: Set<"in" | "out"> }>();
    const txs: { hash: string; ts: number; asset: string; amount: number; usd: number | null; dir: "in" | "out"; peer: string; chain: ChainId }[] = [];
    for (const e of touching) {
      const dir = e.to === sel.id ? "in" : "out";
      const peer = dir === "in" ? e.from : e.to;
      const v = edgeUsd(e, until);
      if (dir === "in") inUsd += v;
      else outUsd += v;
      const p = peers.get(peer) ?? { usd: 0, dir: new Set() };
      p.usd += v;
      p.dir.add(dir);
      peers.set(peer, p);
      for (const t of e.txs) if (until === null || t.ts <= until) txs.push({ ...t, dir, peer, chain: e.chain });
    }
    return {
      inUsd,
      outUsd,
      peers: [...peers.entries()].filter(([, p]) => p.usd > 0 || until === null).sort((a, b) => b[1].usd - a[1].usd).slice(0, 10),
      txs: txs.sort((a, b) => b.ts - a.ts).slice(0, 40),
    };
  }, [sel, graph, until]);

  const list = useMemo(() => [...graph.nodes].sort((a, b) => Number(b.mine) - Number(a.mine) || (a.mine ? b.heldUsd - a.heldUsd : b.flowUsd - a.flowUsd)), [graph]);
  const tip = hoverTip ? graph.index.get(hoverTip.id) : undefined;
  const watching = sel ? wallets.some((w) => w.address.toLowerCase() === sel.id) : false;
  const dot = (id: string) => paint.node.get(id) ?? C.none;

  return (
    <div className="space-y-3">
      <div className="bm-sum">
        <Stat k="in your wallets" v={money(totals.held)} d={`${totals.used} of ${totals.mine} wallets used`} tone="acc" />
        <Stat k={until ? `came in · to ${day(until)}` : "came in"} v={money(totals.inUsd)} d={totals.topIn ? `most from ${totals.topIn.node.label}` : "from outside your wallets"} tone="ok" onClick={totals.topIn ? () => go(totals.topIn!.node.id) : undefined} />
        <Stat k={until ? `went out · to ${day(until)}` : "went out"} v={money(totals.outUsd)} d={totals.topOut ? `most to ${totals.topOut.node.label}` : "to outside your wallets"} tone="err" onClick={totals.topOut ? () => go(totals.topOut!.node.id) : undefined} />
        <Stat k="between your wallets" v={money(totals.between)} d="moved, not spent" tone="acc" />
      </div>

      {locked.length > 0 && maps[0] && !maps[0].keyed && (
        <div className="bm-note">
          <b className="partial">{`🔒 ${locked.map((c) => CHAIN[c].name).join(", ")}`}</b>
          {` · ${locked.reduce((s, c) => s + (status?.[c].active ?? 0), 0)} of your wallets live here, but its explorer only answers apps with a key. Their balances are shown; their transfers appear once a free Etherscan API key is added.`}
        </div>
      )}

      <div className="bm-bar">
        <form onSubmit={search} className="bm-search">
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="find a name or paste any 0x address" aria-label="Find or add an address" />
        </form>
        <div className="bm-seg" role="group" aria-label="Colour the map by">
          {(
            [
              ["money", "in / out"],
              ["wallet", "by wallet"],
              ["chain", "by chain"],
            ] as [ColorBy, string][]
          ).map(([id, label]) => (
            <button key={id} className={colorBy === id ? "on" : ""} onClick={() => setColorBy(id)}>
              {label}
            </button>
          ))}
        </div>
        {present.length > 1 &&
          present.map((c) => (
            <button
              key={c}
              className={`btn ${off.has(c) ? "ghost" : ""}`}
              onClick={() =>
                setOff((o) => {
                  const n = new Set(o);
                  if (n.has(c)) n.delete(c);
                  else n.add(c);
                  return n;
                })
              }
              title={status?.[c].note}
            >
              <i className="dot" style={{ background: off.has(c) ? "transparent" : CHAIN[c].color, border: `1px solid ${CHAIN[c].color}` }} />
              {CHAIN[c].name}
              {locked.includes(c) ? <span className="partial">{" 🔒"}</span> : null}
            </button>
          ))}
        <select className="input bm-sel" value={minUsd} onChange={(e) => setMinUsd(Number(e.target.value))} aria-label="Smallest link shown">
          {[0, 1, 10, 100, 1000].map((v) => (
            <option key={v} value={v}>
              {v ? `≥ $${v}` : "any amount"}
            </option>
          ))}
        </select>
        <button className={`btn ${flows ? "acc" : "ghost"}`} onClick={() => setFlows((f) => !f)}>
          {flows ? "● flows" : "○ flows"}
        </button>
        <button className="btn ghost" onClick={refit}>
          {"⤢ fit"}
        </button>
        <button className="btn ghost" onClick={relayout} title="put every bubble back on its island">
          {"↺ tidy"}
        </button>
        <button className={`btn ${listOpen ? "pri" : "ghost"}`} onClick={() => setListOpen((o) => !o)}>
          {"☰ list"}
        </button>
        {hidden.size > 0 && (
          <button className="btn ghost" onClick={() => setHidden(new Set())}>
            {`show ${hidden.size} hidden`}
          </button>
        )}
      </div>

      <div className="bm-stage">
        <div ref={wrapRef} className="bm-canvas">
          <canvas ref={canvasRef} />
          {(loading || error) && <div className="bm-empty">{loading ? "reading every chain your wallets use… (about 25 s the first time)" : `couldn't read the chains: ${error}`}</div>}
          {tip && hoverTip && !narrow && (
            <div className="bm-tip" style={{ left: hoverTip.x + 14, top: hoverTip.y + 14 }}>
              <b style={{ color: dot(tip.id) }}>{tip.label}</b>
              <span className="faint">{short(tip.address)}</span>
              {tip.mine ? <span>{`holds ${money(tip.heldUsd)}`}</span> : null}
              {tip.toYou > 0 && <span className="ok">{`paid you ${money(tip.toYou)}`}</span>}
              {tip.fromYou > 0 && <span className="err">{`you paid ${money(tip.fromYou)}`}</span>}
              {!tip.mine && <span className="faint">{`holds ${money(tip.heldUsd)}${tip.contract ? " · contract" : ""}`}</span>}
            </div>
          )}
          <Legend colorBy={colorBy} chains={present} />
          <div className="bm-status faint">
            {`${graph.nodes.length} addresses · ${graph.links.length} links`}
            {maps[0]?.poisoned ? ` · ${maps[0].poisoned} poisoning addresses dropped` : ""}
          </div>
        </div>

        {listOpen && (
          <aside className="bm-panel bm-list">
            <div className="pane-h mb-2">
              <span className="t">{"addresses"}</span>
              <span className="rule" />
              <button className="btn ghost" onClick={() => setListOpen(false)}>
                {"✕"}
              </button>
            </div>
            <ul>
              {list.map((n) => (
                <li key={n.id} className={n.id === selected ? "on" : ""}>
                  <button
                    onClick={() => {
                      go(n.id);
                      if (narrow) setListOpen(false);
                    }}
                  >
                    <i className="dot" style={{ background: dot(n.id) }} />
                    <span className="ell flex-1">{n.label}</span>
                    <span className={n.mine ? "txt" : "faint"}>{n.mine ? (n.empty ? "empty" : compact(n.heldUsd)) : `↔ ${compact(n.flowUsd)}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}

        {sel && detail && (
          <aside className="bm-panel">
            <div className="pane-h mb-2">
              <span className="t" style={{ color: dot(sel.id) }}>
                {sel.label}
              </span>
              <span className="rule" />
              <button className="btn ghost" onClick={() => setSelected(null)}>
                {"✕"}
              </button>
            </div>
            <div className="flex flex-wrap gap-1 text-[11px]">
              {sel.mine && <span className="bm-tag acc">{sel.empty ? "your wallet · never used" : "your wallet"}</span>}
              {sel.known && <span className="bm-tag info">{"known"}</span>}
              {sel.contract && <span className="bm-tag">{"contract / app"}</span>}
              {sel.shared && <span className="bm-tag">{"deals with several of your wallets"}</span>}
              {sel.chains.map((c) => (
                <span key={c} className="bm-tag" style={{ color: CHAIN[c].color }}>
                  {CHAIN[c].name}
                </span>
              ))}
            </div>
            <button className="mt-2 block w-full truncate text-left text-xs text-muted hover:text-foreground" onClick={() => navigator.clipboard?.writeText(sel.address)} title="copy">
              {`${sel.address} ⧉`}
            </button>

            <div className="eyebrow mb-1 mt-3">{`holds now · ${money(sel.heldUsd)}`}</div>
            {sel.holdings.length === 0 ? (
              <p className="text-xs text-muted">{sel.mine ? "nothing on any chain the app reads" : "nothing on the chains it was seen on"}</p>
            ) : (
              <ul className="bm-rows">
                {sel.holdings.slice(0, 8).map((h, i) => (
                  <li key={i} className="flex items-center gap-2 px-1 text-xs">
                    <i className="dot" style={{ background: chainOf(h.chain).color }} />
                    <span className="flex-1">{`${h.qty !== undefined ? `${qty(h.qty)} ` : ""}${h.symbol}`}</span>
                    <span className="faint">{chainOf(h.chain).name}</span>
                    <span>{money(h.usd)}</span>
                  </li>
                ))}
              </ul>
            )}

            <dl className="defs" style={{ gridTemplateColumns: "max-content minmax(0,1fr)" }}>
              <dt>{sel.mine ? "received" : "paid you"}</dt>
              <dd className="v ok">{money(sel.mine ? detail.inUsd : sel.toYou)}</dd>
              <dt>{sel.mine ? "sent" : "you paid it"}</dt>
              <dd className="v err">{money(sel.mine ? detail.outUsd : sel.fromYou)}</dd>
              {sel.mine && (
                <>
                  <dt>{"net"}</dt>
                  <dd className={`v ${detail.inUsd - detail.outUsd >= 0 ? "ok" : "err"}`}>{money(detail.inUsd - detail.outUsd)}</dd>
                </>
              )}
            </dl>

            {!sel.mine && (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setAddressLabel(sel.id, naming);
                  setNaming("");
                }}
              >
                <input className="input" value={naming} onChange={(e) => setNaming(e.target.value)} placeholder={names[sel.id] ? `rename "${names[sel.id]}"` : "name it (e.g. Binance, my friend)"} />
                <button className="btn" type="submit">
                  {"save"}
                </button>
              </form>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {!sel.mine && !expanded.includes(sel.id) && (
                <button className="btn acc" onClick={() => expand(sel.id)} disabled={expanding === sel.id}>
                  {expanding === sel.id ? "reading…" : "⊕ expand"}
                </button>
              )}
              <button className="btn" onClick={() => center(sel.id)}>
                {"◎ center"}
              </button>
              {!sel.mine && !sel.contract && !watching && (
                <button className="btn" onClick={() => addWallet(names[sel.id] ?? "Wallet", sel.address)} title="add it to your wallets and count it in net worth">
                  {"+ it's mine"}
                </button>
              )}
              {!sel.mine && (
                <button
                  className="btn ghost"
                  onClick={() => {
                    setHidden((h) => new Set([...h, sel.id]));
                    setSelected(null);
                  }}
                >
                  {"hide"}
                </button>
              )}
              {sel.chains.map((c) => (
                <a key={c} className="btn ghost" href={`${CHAIN[c].explorer}/address/${sel.address}`} target="_blank" rel="noreferrer">
                  {`${CHAIN[c].scan} ↗`}
                </a>
              ))}
              {!sel.address.startsWith("0x") && (
                <a className="btn ghost" href={`https://solscan.io/account/${sel.address}`} target="_blank" rel="noreferrer">
                  {"solscan ↗"}
                </a>
              )}
            </div>

            {detail.peers.length > 0 && (
              <>
                <div className="eyebrow mb-1 mt-4">{"money moved with"}</div>
                <ul className="bm-rows">
                  {detail.peers.map(([id, p]) => {
                    const n = graph.index.get(id);
                    return (
                      <li key={id}>
                        <button onClick={() => go(id)}>
                          <i className="dot" style={{ background: dot(id) }} />
                          <span className="faint">{p.dir.size === 2 ? "⇄" : p.dir.has("in") ? "←" : "→"}</span>
                          <span className="ell flex-1">{n?.label ?? short(id)}</span>
                          <span>{money(p.usd)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {detail.txs.length > 0 && (
              <>
                <div className="eyebrow mb-1 mt-4">{"transfers"}</div>
                <ul className="bm-rows">
                  {detail.txs.map((t, i) => (
                    <li key={`${t.hash}-${i}`}>
                      <a href={`${CHAIN[t.chain].explorer}/tx/${t.hash}`} target="_blank" rel="noreferrer">
                        <span className="faint">{day(t.ts)}</span>
                        <span className={t.dir === "in" ? "ok" : "err"}>{t.dir === "in" ? "←" : "→"}</span>
                        <span>{`${qty(t.amount)} ${t.asset}`}</span>
                        <span className="ell flex-1 faint">{graph.index.get(t.peer)?.label ?? short(t.peer)}</span>
                        <span className="faint">{t.usd != null ? money(t.usd) : ""}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        )}
      </div>

      {graph.span && (
        <div className="bm-time">
          <button className="btn acc" onClick={() => (playing ? setPlaying(false) : (setUntil((u) => u ?? graph.span!.from), setPlaying(true)))}>
            {playing ? "❚❚ pause" : "▶ replay"}
          </button>
          <input
            type="range"
            min={graph.span.from}
            max={graph.span.to}
            step={3600}
            value={until ?? graph.span.to}
            onChange={(e) => {
              setPlaying(false);
              const v = Number(e.target.value);
              setUntil(v >= graph.span!.to ? null : v);
            }}
            aria-label="Show the map as it was on"
          />
          <span className="bm-when">{until ? day(until) : "now"}</span>
          {until !== null && (
            <button
              className="btn ghost"
              onClick={() => {
                setPlaying(false);
                setUntil(null);
              }}
            >
              {"live"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// What the colours mean in the view that is on.
function Legend({ colorBy, chains }: { colorBy: ColorBy; chains: ChainId[] }) {
  const rows: [string, string, string?][] =
    colorBy === "money"
      ? [
          [C.in, "paid you"],
          [C.out, "you paid"],
          [C.both, "both ways"],
          [C.own, "between your wallets", "line"],
          [C.known, "Solcard"],
        ]
      : colorBy === "chain"
        ? chains.map((c) => [CHAIN[c].color, CHAIN[c].name] as [string, string])
        : [["#8a93b8", "each colour = the wallet it deals with most"]];
  return (
    <div className="bm-legend" aria-hidden>
      <span>
        <i className="dot ring" />
        {"your wallets: big ring, sized by what they hold"}
      </span>
      {rows.map(([c, label, kind]) => (
        <span key={label}>
          <i className={kind === "line" ? "bar" : "dot"} style={{ background: c }} />
          {label}
        </span>
      ))}
      <span>
        <i className="dot dash" />
        {"dashed = contract / app"}
      </span>
    </div>
  );
}

function Stat({ k, v, d, tone, onClick }: { k: string; v: string; d: string; tone: string; onClick?: () => void }) {
  const body = (
    <>
      <div className="rg-k">{k}</div>
      <div className={`rg-v ${tone}`}>{v}</div>
      <div className="rg-d ell">{d}</div>
    </>
  );
  return onClick ? (
    <button className="rg text-left" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="rg">{body}</div>
  );
}
