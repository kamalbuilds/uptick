#!/usr/bin/env node
// Deploy list for contracts/script/DeployAll.s.sol: one entry per eligible token in keeper/data/universe.json.
// The pool follows the keeper's registry rule (the replay's chosen v3 pool, else the universe's deepest) so the
// factory's (stock, pool) key matches what the keeper looks up. depositCapTokens = cap_usd / Chainlink price in
// Stock Token wei (floor), 0 (uncapped) when the universe carries no cap_usd.
// rangeBps is the token's band half-width in bps from keeper/data/params.json (500 where it has no entry): the
// value StockVault._checkParams takes, which DeployAll applies to that vault before createVault.
// deployable is true when the token's evidence gate (web/lib/vault-universe.json) is open or reduced. DeployAll refuses
// an entry that is not deployable (a closed vault cannot be deployed by accident), unless ALLOW_CLOSED=1 is set, which
// only the local fork script does.
// --open-only keeps only the deployable tokens: mainnet deploys only vaults that take deposits; a closed token stays
// evidence-only until its gate flips.
// LIVENESS_SHARE lowers the on-chain deposit cap of a token whose deploy swap cannot clear the Chainlink floor at the full
// 20% cap: the cap becomes the largest vault holding at most that share of the pool's in-range depth (the same
// V / (depth + V) <= share rule as keeper/src/universe.ts vaultCapUsd). META: a half-cap sell costs 102 to 106 bp at $24,118
// against the 129 bp the floor allows, so it stops filling once the feed sits 0 to 25 bp above the pool; at 15% ($17,025)
// it costs 80 to 83 bp and fills at every gap the 30 bp rebalance bound lets through, 16 to 19 bp short of the floor
// (6 to 9 after the 10 bp spot band)
// (contracts/test/security/Review4.t.sol test_R4_metaSellFloorThreshold, contracts/SECURITY.md R4-L2). The replay and the
// published vault size stay at the universe's cap_usd.
// Usage: node scripts/deploy-list.mjs [--open-only] [out.json]   (stdout when no path)
import { readFileSync, writeFileSync } from "node:fs";

const data = (f) => JSON.parse(readFileSync(new URL(`../keeper/data/${f}`, import.meta.url), "utf8"));
const universe = data("universe.json");
const replay = data("replay.json");
const params = data("params.json");
const DEFAULT_RANGE_BPS = 500;
const args = process.argv.slice(2);
const openOnly = args.includes("--open-only");
const outPath = args.find((a) => !a.startsWith("--"));
const gates = Object.fromEntries(
  JSON.parse(readFileSync(new URL("../web/lib/vault-universe.json", import.meta.url), "utf8")).vaults.map((v) => [v.symbol, v.gate?.state]),
);

const LIVENESS_SHARE = Object.fromEntries(Object.entries(params).filter(([, v]) => v.liveness_share).map(([k, v]) => [k, v.liveness_share]));

const isDeployable = (symbol) => ["open", "reduced"].includes(gates[symbol]);
const list = universe.tokens.filter((t) => t.eligible && (!openOnly || isDeployable(t.symbol))).map((t) => {
  const chosen = replay.tokens?.[t.symbol]?.chosen;
  const pool = chosen ? { address: chosen.id, fee_tier: chosen.fee_tier } : t.pool;
  const answer = BigInt(Math.round(t.feed.usd * 10 ** t.feed.decimals));
  if (answer <= 0n) throw new Error(`${t.symbol}: no Chainlink price in universe.json`);
  let capUsd = BigInt(Math.round(t.cap_usd ?? 0));
  const share = LIVENESS_SHARE[t.symbol];
  if (share !== undefined) {
    if (!(t.pool?.depth_usd_5pct > 0)) throw new Error(`${t.symbol}: LIVENESS_SHARE needs pool.depth_usd_5pct in universe.json`);
    const live = BigInt(Math.floor((t.pool.depth_usd_5pct * share) / (1 - share)));
    if (live < capUsd) capUsd = live;
  }
  const rangeBps = params[t.symbol]?.range_bps ?? DEFAULT_RANGE_BPS;
  if (!Number.isInteger(rangeBps) || rangeBps < 50 || rangeBps > 2000) throw new Error(`${t.symbol}: rangeBps ${rangeBps} outside [50, 2000]`);
  const depositCapTokens = (capUsd * 10n ** BigInt(t.decimals) * 10n ** BigInt(t.feed.decimals)) / answer;
  return {
    symbol: t.symbol, token: t.token, pool: pool.address, feeTier: pool.fee_tier, feed: t.feed.address,
    rangeBps, capUsd: Number(capUsd), depositCapTokens: depositCapTokens.toString(), deployable: isDeployable(t.symbol),
  };
});
if (!list.length) throw new Error("universe.json has no eligible token");

const out = JSON.stringify(list, null, 2) + "\n";
if (outPath) writeFileSync(outPath, out);
else process.stdout.write(out);
