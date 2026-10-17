import { createPublicClient, http, type AbiEvent, type Address, type Log } from "viem";
import { feedAbi, poolAbi } from "./abi.ts";
import { LOG_MAX_PAGES, LOG_PAGE_BLOCKS, RPC_URL, robinhood, type Ticker } from "./config.ts";
import { priceFromSqrt } from "./price.ts";

export const client = createPublicClient({
  chain: robinhood,
  transport: http(RPC_URL, { retryCount: 5, retryDelay: 400, timeout: 30_000 }),
});

export async function sleep(ms: number) { await new Promise((r) => setTimeout(r, ms)); }

export async function retry<T>(fn: () => Promise<T>, tries = 5, baseMs = 500): Promise<T> {
  let err: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { err = e; await sleep(baseMs * 2 ** i); }
  }
  throw err;
}

/** eth_getLogs in fixed pages from `from` to `to`. Throws instead of silently truncating when the span needs more than LOG_MAX_PAGES. */
export async function boundedLogs<E extends AbiEvent>(p: { address: Address; event: E; from: bigint; to: bigint; pageBlocks?: bigint; maxPages?: number }): Promise<Log<bigint, number, false, E>[]> {
  const page = p.pageBlocks ?? LOG_PAGE_BLOCKS, maxPages = p.maxPages ?? LOG_MAX_PAGES;
  if (p.to < p.from) return [];
  const pages = Number((p.to - p.from) / page) + 1;
  if (pages > maxPages) throw new Error(`getLogs span needs ${pages} pages, cap is ${maxPages} (from ${p.from} to ${p.to})`);
  const out: Log<bigint, number, false, E>[] = [];
  for (let a = p.from; a <= p.to; a += page) {
    const b = a + page - 1n > p.to ? p.to : a + page - 1n;
    out.push(...(await retry(() => client.getLogs({ address: p.address, event: p.event, fromBlock: a, toBlock: b })) as any));
  }
  return out;
}

export interface Snapshot { block: bigint; ts: number; poolUsd: number; tick: number; clUsd: number; clUpdatedAt: number }

export async function snapshot(t: Ticker): Promise<Snapshot> {
  const block = await retry(() => client.getBlock());
  const bn = block.number;
  const [slot0, round, dec] = await retry(() => Promise.all([
    client.readContract({ address: t.pool, abi: poolAbi, functionName: "slot0", blockNumber: bn }),
    client.readContract({ address: t.feed, abi: feedAbi, functionName: "latestRoundData", blockNumber: bn }),
    client.readContract({ address: t.feed, abi: feedAbi, functionName: "decimals", blockNumber: bn }),
  ]));
  return {
    block: bn, ts: Number(block.timestamp),
    poolUsd: priceFromSqrt(slot0[0], t.stockIsToken0), tick: slot0[1],
    clUsd: Number(round[1]) / 10 ** dec, clUpdatedAt: Number(round[3]),
  };
}

export async function assertPoolOrdering(t: Ticker) {
  const t0 = await retry(() => client.readContract({ address: t.pool, abi: poolAbi, functionName: "token0" }));
  const isStock0 = t0.toLowerCase() === t.stock.toLowerCase();
  if (isStock0 !== t.stockIsToken0) throw new Error(`${t.symbol}: pool token0 ordering differs from config`);
}

const tsCache = new Map<bigint, number>();
export async function blockTs(n: bigint): Promise<number> {
  const hit = tsCache.get(n);
  if (hit) return hit;
  const b = await retry(() => client.getBlock({ blockNumber: n }));
  tsCache.set(n, Number(b.timestamp));
  return Number(b.timestamp);
}
