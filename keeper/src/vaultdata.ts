import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { vaultAbi } from "./abi.ts";
import { feeAprPct, feesInWindow, windowApr, type FeeEvent } from "./apr.ts";
import { blockTs, boundedLogs, client, retry, snapshot } from "./chain.ts";
import type { Ticker } from "./config.ts";
import { priceFromTick } from "./price.ts";

const ev = (name: string) => vaultAbi.find((x) => x.type === "event" && x.name === name)! as any;

/** Realized fee events per vault, scanned incrementally from the deploy block. One event per tx: FeesCollected wins over the fees inside Rebalanced. */
class EventStore {
  events: (FeeEvent & { tx: string; kind: string })[] = [];
  private cursor: bigint;
  constructor(private t: Ticker) { this.cursor = t.deployBlock!; }
  async refresh() {
    const head = await client.getBlockNumber();
    if (head < this.cursor) return;
    const [col, reb] = await Promise.all([
      boundedLogs({ address: this.t.vault!, event: ev("FeesCollected"), from: this.cursor, to: head }),
      boundedLogs({ address: this.t.vault!, event: ev("Rebalanced"), from: this.cursor, to: head }),
    ]);
    const seen = new Set(col.map((l) => l.transactionHash));
    const rows = [
      ...col.map((l: any) => ({ l, a0: l.args.amount0 as bigint, a1: l.args.amount1 as bigint, kind: "FeesCollected" })),
      ...reb.filter((l) => !seen.has(l.transactionHash)).map((l: any) => ({ l, a0: l.args.fees0 as bigint, a1: l.args.fees1 as bigint, kind: "Rebalanced" })),
    ];
    for (const r of rows) this.events.push({ ts: await blockTs(r.l.blockNumber!), amount0: r.a0, amount1: r.a1, tx: r.l.transactionHash!, kind: r.kind });
    this.events.sort((a, b) => a.ts - b.ts);
    this.cursor = head + 1n;
  }
}
const stores = new Map<string, EventStore>();
const store = (t: Ticker) => stores.get(t.id) ?? (stores.set(t.id, new EventStore(t)), stores.get(t.id)!);

export function ppsFile(t: Ticker) { return new URL(`../data/pps-${t.id}.jsonl`, import.meta.url).pathname; }

export async function samplePps(t: Ticker) {
  const [pps, snap] = await Promise.all([
    retry(() => client.readContract({ address: t.vault!, abi: vaultAbi, functionName: "pricePerShare" })),
    snapshot(t),
  ]);
  const f = ppsFile(t);
  if (!existsSync(dirname(f))) mkdirSync(dirname(f), { recursive: true });
  appendFileSync(f, JSON.stringify({ ts: snap.ts, block: Number(snap.block), pps: pps.toString() }) + "\n");
}

export function ppsHistory(t: Ticker, max = 1000) {
  const f = ppsFile(t);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").trim().split("\n").filter(Boolean).slice(-max).map((l) => JSON.parse(l));
}

export async function onchainVault(t: Ticker) {
  const s = store(t);
  const [snap, tvl, pps, life, range] = await Promise.all([
    snapshot(t),
    retry(() => client.readContract({ address: t.vault!, abi: vaultAbi, functionName: "totalValueInUSDG" })),
    retry(() => client.readContract({ address: t.vault!, abi: vaultAbi, functionName: "pricePerShare" })),
    retry(() => client.readContract({ address: t.vault!, abi: vaultAbi, functionName: "feesEarnedLifetime" })),
    retry(() => client.readContract({ address: t.vault!, abi: vaultAbi, functionName: "currentRange" })),
    s.refresh(),
  ]);
  const tvlUsd = Number(tvl) / 1e6; // totalValueInUSDG is USDG (6 dp)
  const startS = await blockTs(t.deployBlock!);
  const now = snap.ts;
  const sum = (w: number) => windowApr(s.events, now, w, startS, tvlUsd, t.stockIsToken0, snap.poolUsd);
  const all = feesInWindow(s.events, now, now - startS + 1, t.stockIsToken0, snap.poolUsd);
  const open = range[0] !== 0 || range[1] !== 0; // a vault with no position reports ticks 0,0
  const [lo, hi] = [priceFromTick(Number(range[0]), t.stockIsToken0), priceFromTick(Number(range[1]), t.stockIsToken0)].sort((a, b) => a - b);
  const d1 = sum(86400), d7 = sum(7 * 86400);
  return {
    id: t.id, ticker: t.symbol, source: "onchain" as const, vault: t.vault, pool: t.pool, fee_tier: t.feeTier,
    block: Number(snap.block), as_of: snap.ts,
    tvl_usd: tvlUsd,
    fees_lifetime_usd: all,
    fees_lifetime_view_raw: life.toString(),
    fees_24h_usd: d1.feesUsd, fees_7d_usd: d7.feesUsd,
    fee_apr_pct: { "24h": d1.aprPct, "7d": d7.aprPct, lifetime: feeAprPct(all, tvlUsd, now - startS) },
    fee_apr_basis: "realized FeesCollected/Rebalanced fees, stock leg valued at the current pool price, divided by current TVL, window clamped to vault age",
    range: !open ? null : { tick_lower: Number(range[0]), tick_upper: Number(range[1]), price_lower_usd: lo, price_upper_usd: hi, pool_price_usd: snap.poolUsd, chainlink_price_usd: snap.clUsd, in_range: snap.tick >= Number(range[0]) && snap.tick < Number(range[1]) },
    price_per_share_raw: pps.toString(),
    share_price_history: ppsHistory(t),
    deposited_at: startS,
  };
}
