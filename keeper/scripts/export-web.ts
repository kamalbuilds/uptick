/** Writes web/lib/vault-universe.json: the eligible Stock Tokens with the pool the replay chose, sorted by 30-day fee APR.
 *  The web app builds its routes and vault list from this file. Run: bun scripts/export-web.ts */
import { writeFileSync } from "node:fs";
import { buildEvidence, feeLabel, replayFeeApr } from "../src/evidence.ts";
import { eligibleTickers, readReplay, readUniverse } from "../src/registry.ts";

const universe = readUniverse(), replay = readReplay();
const vaults = eligibleTickers(universe, replay)
  .map((t) => {
    const ev: any = buildEvidence(replay.tokens[t.symbol], replay);
    return { id: t.id, symbol: t.symbol, name: t.name, token: t.stock, pool: t.pool, feeTierPips: t.feeTier, feeTier: feeLabel(t.feeTier), feed: t.feed, depositCapUsd: t.capUsd, refPriceUsd: universe.tokens.find((x: any) => x.symbol === t.symbol).feed.usd, open: ev?.open ?? false, gate: ev?.gate ?? null, keep: ev?.keep ?? null, feeAprPct: ev?.keep.fee_apr_pct ?? null, keptAprPct: ev?.keep.kept_second_half ?? null, keptAprUpperPct: ev?.keep.kept_second_half_upper ?? null, _apr: replayFeeApr(replay.tokens[t.symbol]) ?? -1 };
  })
  .sort((a, b) => b._apr - a._apr)
  .map(({ _apr, ...v }) => v);
const out = new URL("../../web/lib/vault-universe.json", import.meta.url);
writeFileSync(out, JSON.stringify({ chainId: 4663, source: "keeper/data/universe.json + keeper/data/replay.json", universeBlock: universe.block, window: replay.window, vaults }, null, 2) + "\n");
console.log(`wrote ${vaults.length} vaults: ${vaults.map((v) => v.symbol).join(", ")}`);
