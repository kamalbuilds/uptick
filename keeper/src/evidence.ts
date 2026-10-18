/** What the stats API shows about a pool choice. Built from data/replay.json (replay/replay.py). */

export const feeLabel = (pips: number): string => pips === 0x800000 ? "dynamic" : `${+(pips / 10_000).toFixed(4)}%`;
const poolLabel = (p: any) => p.fee_tier === 0x800000 ? `${p.kind} dynamic, avg ${+(effectiveTier(p) / 10_000).toFixed(4)}%` : `${p.kind} ${feeLabel(p.fee_tier)}`;
const hookLabel = (h: string | null) => h ?? "none";

/** A vault takes deposits at all only when the lower of its two half-window kept APRs (edge_apr_pct) is at least this. Any floor
 *  between -7.8 and -98.2 gives the same open set on the current replay. */
export const KEEP_FLOOR_APR = -20;

/** Break-even: the lower half at or above this means LPs kept money in both halves, so deposits carry no cap. */
export const KEEP_FULL_APR = 0;

/** A vault between the floor and break-even still takes deposits, but a single deposit is capped at this many dollars of stock token. */
export const REDUCED_CAP_STOCK_USD = 25_000;

/** Table floor: a pool below this 30-day volume has too little flow for its replay to mean anything. */
export const MIN_TABLE_VOLUME_USD = 250_000;

/** A dynamic-fee pool has no fee tier; it is shown at the average fee its swaps actually paid, in pips. */
const effectiveTier = (p: any): number => p.fee_tier === 0x800000 ? Math.round((p.pool_fees_usd / p.volume_usd) * 1e6) : p.fee_tier;

/** Percent to one decimal with its own sign: -0.4161 to "-0.4%". */
const apr1 = (n: number) => `${n.toFixed(1)}%`;

/** Deposit gate: the weaker of the replay's two half-window kept APRs, in a plain sentence, in one of three states. At or above
 *  break-even is open, no cap. Between the floor and break-even is reduced: deposits are allowed but a single ticket is capped.
 *  Below the floor is closed. Built from the numbers the replay already carries (per-token swap count, window days) so the vault
 *  page can state why deposits are open, capped or shut. */
export function depositGate(worstHalfApr: number, swaps: number, days: number, floorApr: number = KEEP_FLOOR_APR, fullApr: number = KEEP_FULL_APR) {
  const state = worstHalfApr >= fullApr ? "open" as const : worstHalfApr >= floorApr ? "reduced" as const : "closed" as const;
  const reason =
    state === "open"
      ? `Open: the weaker half of the ${days}-day replay kept ${apr1(worstHalfApr)} a year, at or above break-even, across ${swaps.toLocaleString("en-US")} swaps.`
      : state === "reduced"
        ? `Reduced: the weaker half of the ${days}-day replay kept ${apr1(worstHalfApr)} a year, between the ${floorApr}% floor and break-even, across ${swaps.toLocaleString("en-US")} swaps. Deposits are capped at $${REDUCED_CAP_STOCK_USD.toLocaleString("en-US")} per transaction.`
        : `Closed: the weaker half kept ${apr1(worstHalfApr)} a year, below the ${floorApr}% floor.`;
  return { state, reason, floor_apr: floorApr, worst_half_apr: worstHalfApr, swaps, days };
}

/** Shape read by web/lib/evidence.ts: chosen_pool, chosen_fee_tier, pools[{pool, fee_tier, fee_apr_pct}], fee_per_loss{regular,night,weekend},
 *  swaps_replayed, window{start,end}. Extra keys describe each pool (kind, hooks, volume) and the held-out half. */
export function buildEvidence(tok: any, replay: any) {
  const chosen = tok.chosen;
  if (!chosen) return null;
  const row = tok.pools.find((p: any) => p.id === chosen.id);
  const s = tok.sessions;
  const lost = { regular: s.nyse_hours.fee_per_dollar_lost, night: s.weeknight.fee_per_dollar_lost, weekend: s.weekend.fee_per_dollar_lost };
  if (![lost.regular, lost.night, lost.weekend].every(Number.isFinite)) return null;
  const pools = tok.pools
    .filter((p: any) => p.volume_usd >= MIN_TABLE_VOLUME_USD && Number.isFinite(p.full.fee_apr_pct))
    .map((p: any) => ({
      pool: p.id, fee_tier: effectiveTier(p), fee_apr_pct: p.full.fee_apr_pct,
      kind: p.kind, label: poolLabel(p), fee_label: feeLabel(p.fee_tier), hooks: hookLabel(p.hooks), vault_capable: p.vault_capable, chosen: p.id === chosen.id,
      volume_usd: p.volume_usd, swaps: p.swaps,
    }))
    .sort((a: any, b: any) => b.fee_apr_pct - a.fee_apr_pct);
  const f = row.full, first = row.calibration.edge_apr_pct, second = row.test.edge_apr_pct;
  const worst = Math.min(first, second);
  const keep = { fee_apr_pct: f.fee_apr_pct, markout_apr_pct: f.markout_apr_pct, cost_apr_pct: f.cost_apr_pct, kept_apr_pct: f.edge_apr_pct };
  return {
    keep: { ...keep, kept_first_half: first, kept_second_half: second },
    open: worst >= KEEP_FLOOR_APR,
    gate: depositGate(worst, tok.swaps_replayed, replay.window.days),
    chosen_pool: chosen.id, chosen_fee_tier: chosen.fee_tier, chosen_kind: chosen.kind, chosen_fee_apr_pct: row.full.fee_apr_pct,
    pools,
    fee_per_loss: lost,
    swaps_replayed: tok.swaps_replayed,
    window: { start: replay.window.start, end: replay.window.end, days: replay.window.days },
    strategy: replay.strategy, capital_usd: replay.capital_usd,
    out_of_sample: { window: { start: replay.window.calibration_end, end: replay.window.end, days: replay.window.days / 2 }, fee_apr_pct: row.test.fee_apr_pct, confirmed: chosen.confirmed_in_test },
    selection: "the v3 pool with the best first-half result, checked on the second half",
  };
}

/** 30-day fee APR of the chosen pool, the figure /vaults sorts by. */
export function replayFeeApr(tok: any): number | null {
  const row = tok?.chosen && tok.pools.find((p: any) => p.id === tok.chosen.id);
  return row ? row.full.fee_apr_pct : null;
}
