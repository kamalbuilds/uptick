/** One realized fee collection by the vault (token units of the pool's token0/token1). */
export interface FeeEvent { ts: number; amount0: bigint; amount1: bigint }

export function feeUsd(e: FeeEvent, stockIsToken0: boolean, stockUsd: number, usdgDecimals = 6, stockDecimals = 18): number {
  const usdg = Number(stockIsToken0 ? e.amount1 : e.amount0) / 10 ** usdgDecimals;
  const stock = Number(stockIsToken0 ? e.amount0 : e.amount1) / 10 ** stockDecimals;
  return usdg + stock * stockUsd;
}

export function feesInWindow(events: FeeEvent[], nowS: number, windowS: number, stockIsToken0: boolean, stockUsd: number): number {
  return events.filter((e) => e.ts > nowS - windowS && e.ts <= nowS).reduce((a, e) => a + feeUsd(e, stockIsToken0, stockUsd), 0);
}

/** Simple (non compounded) annualised percentage: fees / tvl scaled from elapsedS to a year. */
export function feeAprPct(feesUsd: number, tvlUsd: number, elapsedS: number): number | null {
  if (!(tvlUsd > 0) || !(elapsedS > 0)) return null;
  return (feesUsd / tvlUsd) * (365 * 86400 / elapsedS) * 100;
}

/** Window fee APR. The elapsed time is clamped to the vault age so a young vault is not diluted by days that never existed. */
export function windowApr(events: FeeEvent[], nowS: number, windowS: number, vaultStartS: number, tvlUsd: number, stockIsToken0: boolean, stockUsd: number) {
  const elapsed = Math.min(windowS, nowS - vaultStartS);
  const fees = feesInWindow(events, nowS, windowS, stockIsToken0, stockUsd);
  return { feesUsd: fees, elapsedS: elapsed, aprPct: feeAprPct(fees, tvlUsd, elapsed) };
}
