import { STOCK_DECIMALS, USDG_DECIMALS } from "./config.ts";

const DEC = 10 ** (STOCK_DECIMALS - USDG_DECIMALS);

/** raw token1/token0 price -> USD per stock token */
function toUsd(rawToken1PerToken0: number, stockIsToken0: boolean): number {
  return stockIsToken0 ? rawToken1PerToken0 * DEC : DEC / rawToken1PerToken0;
}

export function priceFromSqrt(sqrtPriceX96: bigint, stockIsToken0: boolean): number {
  const s = Number(sqrtPriceX96) / 2 ** 96;
  return toUsd(s * s, stockIsToken0);
}

export function priceFromTick(tick: number, stockIsToken0: boolean): number {
  return toUsd(1.0001 ** tick, stockIsToken0);
}

/** (poolUsd - clUsd) / clUsd in basis points, signed */
export function deviationBps(poolUsd: number, clUsd: number): number {
  return ((poolUsd - clUsd) / clUsd) * 1e4;
}
