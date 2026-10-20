#!/usr/bin/env node
// Deploy list for contracts/script/DeployAll.s.sol: one entry per eligible token in keeper/data/universe.json.
// The pool follows the keeper's registry rule (the replay's chosen v3 pool, else the universe's deepest) so the
// factory's (stock, pool) key matches what the keeper looks up. depositCapTokens = cap_usd / Chainlink price in
// Stock Token wei (floor), 0 (uncapped) when the universe carries no cap_usd.
// Usage: node scripts/deploy-list.mjs [out.json]   (stdout when no path)
import { readFileSync, writeFileSync } from "node:fs";

const data = (f) => JSON.parse(readFileSync(new URL(`../keeper/data/${f}`, import.meta.url), "utf8"));
const universe = data("universe.json");
const replay = data("replay.json");

const list = universe.tokens.filter((t) => t.eligible).map((t) => {
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
if (process.argv[2]) writeFileSync(process.argv[2], out);
else process.stdout.write(out);
