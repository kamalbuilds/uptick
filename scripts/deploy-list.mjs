#!/usr/bin/env node
// Deploy list for contracts/script/DeployAll.s.sol: one entry per eligible token in keeper/data/universe.json.
// The pool follows the keeper's registry rule (the replay's chosen v3 pool, else the universe's deepest) so the
// factory's (stock, pool) key matches what the keeper looks up. depositCapTokens = cap_usd / Chainlink price in
// Stock Token wei (floor), 0 (uncapped) when the universe carries no cap_usd.
// --open-only keeps tokens whose evidence gate (web/lib/vault-universe.json) is open or reduced: mainnet deploys only
// vaults that take deposits; a closed token stays evidence-only until its gate flips.
// Usage: node scripts/deploy-list.mjs [--open-only] [out.json]   (stdout when no path)
import { readFileSync, writeFileSync } from "node:fs";

const data = (f) => JSON.parse(readFileSync(new URL(`../keeper/data/${f}`, import.meta.url), "utf8"));
const universe = data("universe.json");
const replay = data("replay.json");
const args = process.argv.slice(2);
const openOnly = args.includes("--open-only");
const outPath = args.find((a) => !a.startsWith("--"));
const gates = Object.fromEntries(
  JSON.parse(readFileSync(new URL("../web/lib/vault-universe.json", import.meta.url), "utf8")).vaults.map((v) => [v.symbol, v.gate?.state]),
);

const list = universe.tokens.filter((t) => t.eligible && (!openOnly || ["open", "reduced"].includes(gates[t.symbol]))).map((t) => {
  const chosen = replay.tokens?.[t.symbol]?.chosen;
  const pool = chosen ? { address: chosen.id, fee_tier: chosen.fee_tier } : t.pool;
  const answer = BigInt(Math.round(t.feed.usd * 10 ** t.feed.decimals));
  if (answer <= 0n) throw new Error(`${t.symbol}: no Chainlink price in universe.json`);
  const capUsd = BigInt(Math.round(t.cap_usd ?? 0));
  const depositCapTokens = (capUsd * 10n ** BigInt(t.decimals) * 10n ** BigInt(t.feed.decimals)) / answer;
  return {
    symbol: t.symbol, token: t.token, pool: pool.address, feeTier: pool.fee_tier, feed: t.feed.address,
    capUsd: Number(capUsd), depositCapTokens: depositCapTokens.toString(),
  };
});
if (!list.length) throw new Error("universe.json has no eligible token");

const out = JSON.stringify(list, null, 2) + "\n";
if (outPath) writeFileSync(outPath, out);
else process.stdout.write(out);
