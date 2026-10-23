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
// venue: "v3" entries are the StockVault list above, unchanged. A token whose replay venue (keeper/data/replay.json, replay/replay.py venue_for) is "v4"
// is a v4 entry for StockVaultV4: {symbol, token, venue, poolId, feeTier (pool key fee, pips), tickSpacing, hooks, feed, rangeBps, capUsd, depositCapTokens, deployable}.
// Its pool is the replay's chosen_v4 and its capUsd is min(universe cap_usd, the largest vault holding at most 20% of that pool's in-range depth in
// keeper/data/v4-pools.json), which is the cap the replay ran the pool at. deployable comes from the replay's weaker-half edge against KEEP_FLOOR_APR,
// not from web/lib/vault-universe.json, which gates the v3 pool only.
// --v4-report prints, for every replayed token, the v3 and v4 verdicts side by side instead of the list.
// Usage: node scripts/deploy-list.mjs [--open-only] [--v4-report] [out.json]   (stdout when no path)
import { readFileSync, writeFileSync } from "node:fs";

const data = (f) => JSON.parse(readFileSync(new URL(`../keeper/data/${f}`, import.meta.url), "utf8"));
const universe = data("universe.json");
const replay = process.env.DEPLOY_REPLAY ? JSON.parse(readFileSync(process.env.DEPLOY_REPLAY, "utf8")) : data("replay.json"); // DEPLOY_REPLAY: a replay file to read instead of keeper/data/replay.json (tests use it for a v4-venue token)
const params = data("params.json");
const v4Depths = (() => { try { return data("v4-pools.json").pools; } catch { return {}; } })();
const DEFAULT_RANGE_BPS = 500;
const KEEP_FLOOR_APR = -20; // keeper/src/evidence.ts KEEP_FLOOR_APR (keeper/test/replay-floor.test.ts asserts they match)
const MAX_VAULT_SHARE = 0.2; // keeper/src/universe.ts RULE.maxVaultShare
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const gateOf = (worst) => (worst >= 0 ? "open" : worst >= KEEP_FLOOR_APR ? "reduced" : "closed");
const args = process.argv.slice(2);
const openOnly = args.includes("--open-only");
const v4Report = args.includes("--v4-report");
const outPath = args.find((a) => !a.startsWith("--"));
const gates = Object.fromEntries(
  JSON.parse(readFileSync(new URL("../web/lib/vault-universe.json", import.meta.url), "utf8")).vaults.map((v) => [v.symbol, v.gate?.state]),
);

const LIVENESS_SHARE = Object.fromEntries(Object.entries(params).filter(([, v]) => v.liveness_share).map(([k, v]) => [k, v.liveness_share]));

const isDeployable = (symbol) => ["open", "reduced"].includes(gates[symbol]);

/** The replay's weaker-half edge of the token's chosen v3 pool, or null. */
const v3Worst = (rt) => {
  const row = rt?.chosen && rt.pools.find((p) => p.id === rt.chosen.id);
  return row ? Math.min(row.calibration.edge_apr_pct, row.test.edge_apr_pct) : null;
};

if (v4Report) {
  const short = (id) => `${id.slice(0, 10)}`;
  const cols = ["symbol", "v3 worst-half", "v3 gate", "v4 pool (id, fee, hook)", "v4 cal", "v4 test", "v4 worst", "v4 gate", "v4 depth", "cap", "NEWLY QUALIFIES"];
  const rows = Object.entries(replay.tokens).map(([symbol, rt]) => {
    const w3 = v3Worst(rt), g3 = w3 === null ? "none" : gateOf(w3), c = rt.chosen_v4;
    if (!c) return [symbol, w3 === null ? "-" : w3.toFixed(1), g3, "none", "-", "-", "-", "-", "-", "-", ""];
    const row = rt.pools.find((p) => p.id === c.id), g4 = gateOf(c.worst_half);
    return [symbol, w3 === null ? "-" : w3.toFixed(1), g3, `${short(c.id)} ${c.fee_tier} ${c.hooks ? short(c.hooks) : "no hook"}`, row.calibration.edge_apr_pct.toFixed(1), row.test.edge_apr_pct.toFixed(1),
      c.worst_half.toFixed(1), g4, Math.round(v4Depths[c.id]?.depth_usd_5pct ?? NaN).toString(), String(c.cap_usd), g3 !== "open" && g3 !== "reduced" && g4 !== "closed" ? "YES" : ""];
  });
  const w = cols.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((x, i) => x.padEnd(w[i])).join(" | ").trimEnd();
  console.log([line(cols), w.map((n) => "-".repeat(n)).join("-+-"), ...rows.map(line)].join("\n"));
  process.exit(0);
}
const v4Entry = (t, rt) => {
  const c = rt.chosen_v4, pool = v4Depths[c.id];
  if (!pool) throw new Error(`${t.symbol}: chosen_v4 ${c.id} has no depth in keeper/data/v4-pools.json (bun keeper/scripts/build-v4-pools.ts)`);
  if (pool.fee !== c.fee_tier || pool.tickSpacing !== c.tick_spacing || (pool.hooks === ZERO_ADDRESS ? null : pool.hooks) !== (c.hooks?.toLowerCase() ?? null)) throw new Error(`${t.symbol}: v4-pools.json and replay.json disagree on pool ${c.id}`);
  if (LIVENESS_SHARE[t.symbol] !== undefined) throw new Error(`${t.symbol}: LIVENESS_SHARE was measured on the v3 pool, not the v4 pool`);
  const answer = BigInt(Math.round(t.feed.usd * 10 ** t.feed.decimals));
  if (answer <= 0n) throw new Error(`${t.symbol}: no Chainlink price in universe.json`);
  let capUsd = BigInt(Math.round(t.cap_usd ?? 0));
  const live = BigInt(Math.floor((pool.depth_usd_5pct * MAX_VAULT_SHARE) / (1 - MAX_VAULT_SHARE)));
  if (live < capUsd) capUsd = live;
  if (Number(capUsd) !== c.cap_usd) throw new Error(`${t.symbol}: deploy cap ${capUsd} differs from the cap the replay ran the v4 pool at (${c.cap_usd}); rerun replay/replay.py ${t.symbol}`);
  const rangeBps = params[t.symbol]?.range_bps ?? DEFAULT_RANGE_BPS;
  if (!Number.isInteger(rangeBps) || rangeBps < 50 || rangeBps > 2000) throw new Error(`${t.symbol}: rangeBps ${rangeBps} outside [50, 2000]`);
  const depositCapTokens = (capUsd * 10n ** BigInt(t.decimals) * 10n ** BigInt(t.feed.decimals)) / answer;
  return {
    symbol: t.symbol, token: t.token, venue: "v4", poolId: c.id, feeTier: c.fee_tier, tickSpacing: c.tick_spacing, hooks: c.hooks ?? ZERO_ADDRESS, feed: t.feed.address,
    rangeBps, capUsd: Number(capUsd), depositCapTokens: depositCapTokens.toString(), deployable: c.worst_half >= KEEP_FLOOR_APR,
  };
};
const list = universe.tokens.filter((t) => t.eligible && (!openOnly || replay.tokens?.[t.symbol]?.venue === "v4" || isDeployable(t.symbol))).map((t) => {
  if (replay.tokens?.[t.symbol]?.venue === "v4") return v4Entry(t, replay.tokens[t.symbol]);
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
    symbol: t.symbol, token: t.token, venue: "v3", pool: pool.address, feeTier: pool.fee_tier, feed: t.feed.address,
    rangeBps, capUsd: Number(capUsd), depositCapTokens: depositCapTokens.toString(), deployable: isDeployable(t.symbol),
  };
});
if (!list.length) throw new Error("universe.json has no eligible token");

const out = JSON.stringify(list, null, 2) + "\n";
if (outPath) writeFileSync(outPath, out);
else process.stdout.write(out);
