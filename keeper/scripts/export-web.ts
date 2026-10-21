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
/** The web pages describe the v3 evidence pool (the gate in vault-universe.json is the v3 pool's); a token that deploys on a v4 pool keeps its chosen v3 pool here. */
const webPool = (t: any) => t.venue === "v4" ? { pool: replay.tokens[t.symbol].chosen.id, feeTier: replay.tokens[t.symbol].chosen.fee_tier } : { pool: t.pool, feeTier: t.feeTier };
const vaults = eligibleTickers(universe, replay)
  .map((t) => {
    const ev: any = buildEvidence(replay.tokens[t.symbol], replay);
    return { id: t.id, symbol: t.symbol, name: t.name, token: t.stock, pool: webPool(t).pool, feeTierPips: webPool(t).feeTier, feeTier: feeLabel(webPool(t).feeTier), entryFeeBps: Math.max(webPool(t).feeTier, 3500) / 100, feed: t.feed, bandBps: t.rangeBps, depositCapUsd: liveCapUsd(t.symbol, t.capUsd), refPriceUsd: universe.tokens.find((x: any) => x.symbol === t.symbol).feed.usd, open: ev?.open ?? false, gate: ev?.gate ?? null, keep: ev?.keep ?? null, feeAprPct: ev?.keep.fee_apr_pct ?? null, keptAprPct: ev?.keep.kept_second_half ?? null, keptAprUpperPct: ev?.keep.kept_second_half_upper ?? null, _apr: replayFeeApr(replay.tokens[t.symbol]) ?? -1 };
  })
  .sort((a, b) => b._apr - a._apr)
  .map(({ _apr, ...v }) => v);
const out = new URL("../../web/lib/vault-universe.json", import.meta.url);
writeFileSync(out, JSON.stringify({ chainId: 4663, source: "keeper/data/universe.json + keeper/data/replay.json", universeBlock: universe.block, window: replay.window, vaults }, null, 2) + "\n");
console.log(`wrote ${vaults.length} vaults: ${vaults.map((v) => v.symbol).join(", ")}`);
