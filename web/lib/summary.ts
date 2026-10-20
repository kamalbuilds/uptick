export type SummaryFigures = {
  tracked: number;
  open: number;
  reduced: number;
  taking: number;
  swapsReplayed: number;
  /** Fees the replay shows paid to liquidity providers on the 17 pools, over the window. */
  lpFeesUsd: number;
  windowDays: number;
  windowEnd: string;
};

type Universe = { window: { days: number; end: string }; vaults: { symbol: string; pool: string; gate: { state: string; swaps: number } }[] };
type PoolFees = { feesUsdByPool: Record<string, number> };

/** Every figure comes from the two files the vault list is built from (vault-universe.json, pool-fees.json). A pool with no fee entry throws,
 *  so a new vault cannot ship with a blank total. No imports, so node's test runner loads it directly. */
export function summaryFigures(universe: Universe, fees: PoolFees): SummaryFigures {
  const vaults = universe.vaults;
  const byPool = fees.feesUsdByPool;
  let lpFeesUsd = 0;
  for (const v of vaults) {
    const f = byPool[v.pool.toLowerCase()];
    if (typeof f !== "number" || !Number.isFinite(f)) throw new Error(`pool-fees.json has no fee total for the ${v.symbol} pool ${v.pool}`);
    lpFeesUsd += f;
  }
  const open = vaults.filter((v) => v.gate.state === "open").length;
  const reduced = vaults.filter((v) => v.gate.state === "reduced").length;
  return {
    tracked: vaults.length,
    open,
    reduced,
    taking: open + reduced,
    swapsReplayed: vaults.reduce((n, v) => n + (v.gate?.swaps ?? 0), 0),
    lpFeesUsd,
    windowDays: universe.window.days,
    windowEnd: universe.window.end.slice(0, 10),
  };
}
