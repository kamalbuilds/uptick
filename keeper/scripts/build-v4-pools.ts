/** Builds data/v4-pools.json: for every v4 USDG pool in data/swaps/v4-live-<SYM>.json that StockVaultV4 can hold (static fee, no hook or an
 *  allow-listed one in data/v4-hook-allowlist.json), its pool key, PoolManager protocol fee, price, in-range liquidity and the USD depth of the
 *  +-5% band, read from StateView at one pinned block. replay/replay.py sizes a v4 pool's vault from depth_usd_5pct.
 *  Read-only eth_calls through multicall, no logs. Public RPC only. Run: bun scripts/build-v4-pools.ts */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import { client, retry } from "../src/chain.ts";
import { log } from "../src/log.ts";
import { priceFromSqrt } from "../src/price.ts";
import { bandDepthUsd } from "../src/universe.ts";
import { STATE_VIEW, stateViewAbi, v4KeyOk } from "../src/v4.ts";

const DATA = new URL("../data/", import.meta.url);
const OUT = new URL("v4-pools.json", DATA);
const BATCH = 40; // pools per multicall (two calls each)

interface Live { id: Hex; currency0: Address; currency1: Address; fee: number; tick_spacing: number; hooks: Address; usdg_is_currency0: boolean }

async function main() {
  const allow = new Set<string>(JSON.parse(readFileSync(new URL("v4-hook-allowlist.json", DATA), "utf8")));
  const cands: (Live & { symbol: string })[] = [];
  for (const f of readdirSync(new URL("swaps/", DATA)).filter((f) => /^v4-live-.+\.json$/.test(f)).sort()) {
    const symbol = f.slice("v4-live-".length, -".json".length);
    for (const p of JSON.parse(readFileSync(new URL(`swaps/${f}`, DATA), "utf8")) as Live[]) if (v4KeyOk(p.fee, p.hooks, allow)) cands.push({ ...p, symbol });
  }
  if (!cands.length) throw new Error("no v4 candidate pools: run replay/pull.py first");
  const block = await retry(() => client.getBlockNumber());
  const pools: Record<string, unknown> = {};
  for (let i = 0; i < cands.length; i += BATCH) {
    const part = cands.slice(i, i + BATCH);
    const res = await retry(() => client.multicall({
      blockNumber: block, allowFailure: false,
      contracts: part.flatMap((p) => [
        { address: STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [p.id] } as const,
        { address: STATE_VIEW, abi: stateViewAbi, functionName: "getLiquidity", args: [p.id] } as const,
      ]),
    }));
    part.forEach((p, k) => {
      const [sqrtPriceX96, tick, protocolFee, lpFee] = res[2 * k] as readonly [bigint, number, number, number];
      const liquidity = res[2 * k + 1] as bigint;
      if (sqrtPriceX96 !== 0n && lpFee !== p.fee) throw new Error(`${p.symbol} ${p.id}: StateView lpFee ${lpFee} differs from the pool key fee ${p.fee}`);
      const price = sqrtPriceX96 === 0n ? null : priceFromSqrt(sqrtPriceX96, !p.usdg_is_currency0);
      pools[p.id] = {
        symbol: p.symbol, poolId: p.id, currency0: p.currency0, currency1: p.currency1, fee: p.fee, tickSpacing: p.tick_spacing, hooks: p.hooks.toLowerCase(),
        protocolFee, sqrtPriceX96: sqrtPriceX96.toString(), tick, liquidity_raw: liquidity.toString(), price_usd: price,
        depth_usd_5pct: price !== null && price > 0 && liquidity > 0n ? bandDepthUsd(liquidity, price) : 0, block: Number(block),
      };
    });
  }
  writeFileSync(OUT, JSON.stringify({ block: Number(block), source: `StateView ${STATE_VIEW} getSlot0 and getLiquidity at block ${block}`, pools }, null, 1) + "\n");
  log("done", { pools: cands.length, block: Number(block) });
}

main().catch((e) => { log("fatal", { error: String(e.message ?? e).slice(0, 400) }); process.exit(1); });
