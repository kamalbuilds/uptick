export interface GuardInput {
  poolUsd: number;
  clUsd: number;
  clUpdatedAt: number; // unix s
  now: number; // unix s
  maxDevBps: number;
  clMaxAgeS: number;
}
export interface GuardResult { ok: boolean; reasons: string[]; devBps: number; clAgeS: number }

import { deviationBps } from "./price.ts";

export function evaluateGuards(g: GuardInput): GuardResult {
  const reasons: string[] = [];
  const clAgeS = g.now - g.clUpdatedAt;
  const devBps = deviationBps(g.poolUsd, g.clUsd);
  if (!(g.clUsd > 0) || !Number.isFinite(g.clUsd)) reasons.push("chainlink_answer_invalid");
  if (!(g.poolUsd > 0) || !Number.isFinite(g.poolUsd)) reasons.push("pool_price_invalid");
  if (clAgeS > g.clMaxAgeS) reasons.push(`chainlink_stale age=${clAgeS}s max=${g.clMaxAgeS}s`);
  if (!Number.isFinite(devBps) || Math.abs(devBps) > g.maxDevBps) reasons.push(`pool_chainlink_deviation ${devBps.toFixed(1)}bps max=${g.maxDevBps}bps`);
  return { ok: reasons.length === 0, reasons, devBps, clAgeS };
}

/** A scheduled rebalance waits while the pool's TWAP sits further than this from the Chainlink feed (the vault itself refuses at 30). */
export const TWAP_FEED_MAX_BPS = 15n;

const Q96 = 2n ** 96n;
const sqrtToPriceQ96 = (s: bigint) => (s * s) / Q96;

/** The vault's own deviation test (StockVault._deviates) on the two sqrt prices vault.health() returns: the TWAP and the
 *  Chainlink answer in pool terms. True when the prices are more than `maxBps` apart. A zero sqrt (feed unreadable, no
 *  TWAP) is not comparable, so it defers too. */
export function twapOffFeed(sqrtTwap: bigint, sqrtOracle: bigint, maxBps: bigint = TWAP_FEED_MAX_BPS): { defer: boolean; bps: number } {
  if (sqrtTwap <= 0n || sqrtOracle <= 0n) return { defer: true, bps: Number.POSITIVE_INFINITY };
  const [hi, lo] = sqrtTwap > sqrtOracle ? [sqrtToPriceQ96(sqrtTwap), sqrtToPriceQ96(sqrtOracle)] : [sqrtToPriceQ96(sqrtOracle), sqrtToPriceQ96(sqrtTwap)];
  return { defer: hi * 10_000n > lo * (10_000n + maxBps), bps: Number(((hi - lo) * 10_000n * 100n) / lo) / 100 };
}
