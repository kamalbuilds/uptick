import { createPublicClient, http, type AbiEvent, type Address, type Log } from "viem";
import { feedAbi, poolAbi, vaultV4Abi } from "./abi.ts";
import { LOG_MAX_PAGES, LOG_PAGE_BLOCKS, RPC_URL, USDG, robinhood, type Ticker } from "./config.ts";
import { priceFromSqrt } from "./price.ts";
import { STATE_VIEW, stateViewAbi } from "./v4.ts";

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

/** Spot price (USD per stock) and tick from a v3 slot0 or a v4 StateView getSlot0 tuple: both lead with (sqrtPriceX96, tick). A zero sqrt price is an uninitialised pool. */
export function spotFromSlot0(slot0: readonly [bigint, number, ...unknown[]], stockIsToken0: boolean): { poolUsd: number; tick: number } {
  if (slot0[0] === 0n) throw new Error("pool is not initialised (sqrtPriceX96 is 0)");
  return { poolUsd: priceFromSqrt(slot0[0], stockIsToken0), tick: slot0[1] };
}

export async function snapshot(t: Ticker): Promise<Snapshot> {
  const block = await retry(() => client.getBlock());
  const bn = block.number;
  const [slot0, round, dec] = await retry(() => Promise.all([
    t.venue === "v4"
      ? client.readContract({ address: STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [t.poolId], blockNumber: bn })
      : client.readContract({ address: t.pool, abi: poolAbi, functionName: "slot0", blockNumber: bn }),
    client.readContract({ address: t.feed, abi: feedAbi, functionName: "latestRoundData", blockNumber: bn }),
    client.readContract({ address: t.feed, abi: feedAbi, functionName: "decimals", blockNumber: bn }),
  ]));
  return {
    block: bn, ts: Number(block.timestamp),
    ...spotFromSlot0(slot0, t.stockIsToken0),
    clUsd: Number(round[1]) / 10 ** dec, clUpdatedAt: Number(round[3]),
  };
}

/** v3: the pool's token0 against the config. v4: the vault's own stockIsToken0() and poolId() when a vault address is set, else the address order against USDG (a v4 pool id has no token0() to read). */
export async function assertPoolOrdering(t: Ticker) {
  if (t.venue === "v4") {
    if (t.vault) {
      const [isStock0, id] = await retry(() => Promise.all([
        client.readContract({ address: t.vault!, abi: vaultV4Abi, functionName: "stockIsToken0" }),
        client.readContract({ address: t.vault!, abi: vaultV4Abi, functionName: "poolId" }),
      ])).catch((e) => { throw new Error(`${t.symbol}: the vault at ${t.vault} does not answer stockIsToken0()/poolId(); it is not a StockVaultV4 (${String(e.message).split("\n")[0]})`); });
      if (isStock0 !== t.stockIsToken0) throw new Error(`${t.symbol}: vault stockIsToken0 differs from config`);
      if (id.toLowerCase() !== t.poolId.toLowerCase()) throw new Error(`${t.symbol}: vault poolId ${id} differs from config ${t.poolId}`);
      return;
    }
    if ((BigInt(t.stock) < BigInt(USDG)) !== t.stockIsToken0) throw new Error(`${t.symbol}: v4 currency ordering differs from config`);
    return;
  }
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
