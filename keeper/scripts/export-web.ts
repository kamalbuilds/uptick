import { readFileSync } from "node:fs";
/** Writes web/lib/vault-universe.json: the eligible Stock Tokens with the pool the replay chose, sorted by 30-day fee APR.
 *  The web app builds its routes and vault list from this file. Run: bun scripts/export-web.ts */
import { writeFileSync } from "node:fs";
import { buildEvidence, feeLabel, replayFeeApr } from "../src/evidence.ts";
import { eligibleTickers, readReplay, readUniverse } from "../src/registry.ts";

// The published cap is the on-chain cap: a token with a liveness_share in data/params.json deploys at the largest vault that
// holds at most that share of the pool's in-range depth (same rule as scripts/deploy-list.mjs), so the app never shows a
// cap the vault will not accept.
const params = JSON.parse(readFileSync(new URL("../data/params.json", import.meta.url), "utf8"));
function liveCapUsd(symbol: string, capUsd: number): number {
  const share = params[symbol]?.liveness_share;
  if (!share) return capUsd;
  const depth = universe.tokens.find((x: any) => x.symbol === symbol)?.pool?.depth_usd_5pct;
  if (!(depth > 0)) throw new Error(`${symbol}: liveness_share needs pool.depth_usd_5pct in universe.json`);
  return Math.min(capUsd, Math.floor((depth * share) / (1 - share)));
}

const universe = readUniverse(), replay = readReplay();
const v4Pools = JSON.parse(readFileSync(new URL("../data/v4-pools.json", import.meta.url), "utf8")).pools;
/** What a swap costs in a v4 pool, in pips: the LP fee combined with the PoolManager's protocol fee, the larger direction (StockVaultV4.swapFee). */
function v4SwapFee(poolId: string): number {
  const p = v4Pools[poolId];
  if (!p) throw new Error(`${poolId}: no entry in data/v4-pools.json`);
  const proto = Math.max(p.protocolFee & 0xfff, p.protocolFee >> 12);
  return proto + p.fee - Math.floor((proto * p.fee) / 1e6);
}
/** The pool each vault is gated on, deploys on and shows: the replay's chosen v3 pool, or for a token whose venue is v4 its chosen v4 pool (the pool id, lowercase). */
function gatePool(t: any) {
  if (t.venue !== "v4") return { venue: "v3" as const, pool: t.pool as string, feeTier: t.feeTier as number, entryFeePips: Math.max(t.feeTier, 3500), capUsd: undefined };
  const c = replay.tokens[t.symbol].chosen_v4;
  return { venue: "v4" as const, pool: c.id.toLowerCase() as string, feeTier: c.fee_tier as number, entryFeePips: Math.max(v4SwapFee(c.id), 3500), capUsd: c.cap_usd as number };
}
const vaults = eligibleTickers(universe, replay)
  .map((t) => {
    const ev: any = buildEvidence(replay.tokens[t.symbol], replay);
    const g = gatePool(t);
    return { id: t.id, symbol: t.symbol, name: t.name, token: t.stock, venue: g.venue, pool: g.pool, feeTierPips: g.feeTier, feeTier: feeLabel(g.feeTier), entryFeeBps: g.entryFeePips / 100, feed: t.feed, bandBps: t.rangeBps, depositCapUsd: g.capUsd ?? liveCapUsd(t.symbol, t.capUsd), refPriceUsd: universe.tokens.find((x: any) => x.symbol === t.symbol).feed.usd, open: ev?.open ?? false, gate: ev?.gate ?? null, keep: ev?.keep ?? null, feeAprPct: ev?.keep.fee_apr_pct ?? null, keptAprPct: ev?.keep.kept_second_half ?? null, keptAprUpperPct: ev?.keep.kept_second_half_upper ?? null, _apr: replayFeeApr(replay.tokens[t.symbol]) ?? -1 };
  })
  .sort((a, b) => b._apr - a._apr)
  .map(({ _apr, ...v }) => v);
const out = new URL("../../web/lib/vault-universe.json", import.meta.url);
writeFileSync(out, JSON.stringify({ chainId: 4663, source: "keeper/data/universe.json + keeper/data/replay.json", universeBlock: universe.block, window: replay.window, vaults }, null, 2) + "\n");
console.log(`wrote ${vaults.length} vaults: ${vaults.map((v) => v.symbol).join(", ")}`);

// Fee totals the pages show per pool (web/lib/summary.ts sums them over the vault list): the replay's LP income on each vault's gate pool.
const poolFees: Record<string, number> = {};
for (const v of vaults) {
  const row = replay.tokens[v.symbol].pools.find((p: any) => p.id.toLowerCase() === v.pool.toLowerCase());
  if (!row) throw new Error(`${v.symbol}: the gate pool ${v.pool} is not in replay.json`);
  poolFees[v.pool.toLowerCase()] = Math.round(row.pool_fees_usd * 100) / 100;
}
writeFileSync(new URL("../../web/lib/pool-fees.json", import.meta.url), JSON.stringify({
  source: "keeper/data/replay.json tokens[SYMBOL].pools[id == vault pool].pool_fees_usd, one entry per vault in vault-universe.json (keeper/scripts/export-web.ts)",
  replayGeneratedAt: replay.generated_at, window: replay.window, feesUsdByPool: poolFees,
}, null, 2) + "\n");
