import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const load = (f: string) => JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), "utf8"));
const moment = load("moment.json");
const swap = load("real-swap.json");
const universe = load("vault-universe.json");
const SESSIONS = ["nyse_hours", "weeknight", "weekend"];

test("the moment: shares add up and the off-hours figure is the two off-hours sessions", () => {
  assert.equal(moment.vaults, universe.vaults.length);
  assert.ok(moment.swaps > 1_000_000, "an empty replay would make every share below trivially consistent");
  for (const key of ["swapsPct", "feesPct", "clockPct"]) {
    const sum = SESSIONS.reduce((n, s) => n + moment.sessions[s][key], 0);
    assert.ok(Math.abs(sum - 100) < 0.3, `${key} sums to ${sum}`);
  }
  assert.ok(Math.abs(moment.offHours.swapsPct - (moment.sessions.weeknight.swapsPct + moment.sessions.weekend.swapsPct)) < 0.2);
  assert.ok(Math.abs(moment.offHours.feesPct - (moment.sessions.weeknight.feesPct + moment.sessions.weekend.feesPct)) < 0.2);
  assert.ok(moment.offHours.clockPct > moment.offHours.swapsPct, "swaps concentrate in the NYSE session relative to its share of the clock");
  assert.ok(moment.sessions.weekend.feePerDollarLost > moment.sessions.nyse_hours.feePerDollarLost);
});

test("the real swap belongs to a vault the app lists, inside the replay window, and its fee matches its size", () => {
  const v = universe.vaults.find((x: { symbol: string }) => x.symbol === swap.symbol);
  assert.ok(v, `${swap.symbol} is not in vault-universe.json`);
  // the swap is read from PLTR's Uniswap v4 1% pool, which the replay prices whichever pool the vault is gated on
  const replay = load("../../keeper/data/replay.json");
  const row = replay.tokens[swap.symbol].pools.find((p: { id: string }) => p.id.toLowerCase() === swap.pool.toLowerCase());
  assert.ok(row, `${swap.pool} is not one of ${swap.symbol}'s replayed pools`);
  assert.equal(row.kind, swap.venue);
  assert.equal(row.fee_tier, swap.poolFeePips);
  assert.equal(swap.vault.capUsd, row.cap_usd);
  assert.match(swap.tx, /^0x[0-9a-f]{64}$/);
  const t = Date.parse(swap.time);
  assert.ok(t >= Date.parse(universe.window.start) && t < Date.parse(universe.window.end));
  const rate = swap.poolFeeUsd / swap.sizeUsd;
  assert.ok(rate > 0.0095 && rate <= swap.poolFeePips / 1e6, `pool fee is ${rate} of the swap, the tier is ${swap.poolFeePips / 1e6}`);
  assert.ok(swap.markoutLossUsd > 0, "an informed trade costs the pool's providers");
  assert.ok(Math.abs(Math.log(swap.priceAfter / swap.chainlink)) < Math.abs(Math.log(swap.priceBefore / swap.chainlink)), "the swap moved the pool toward Chainlink");
  assert.ok(swap.vault.feeUsd > 0 && swap.vault.feeUsd < swap.poolFeeUsd, "the vault's take is part of the pool's");
});

test("the deck slide and the handout quote the figures the JSON files hold", () => {
  const deck = readFileSync(new URL("../../deck/index.html", import.meta.url), "utf8");
  const handout = readFileSync(new URL("../../deck/handout/index.html", import.meta.url), "utf8");
  const slide = deck.slice(deck.indexOf('data-t="Evidence: one real swap"'));
  const slideBody = slide.slice(0, slide.indexOf("</section>")).replace(/<!--[\s\S]*?-->/g, "");
  const d = (n: number) => `$${n.toFixed(2)}`;
  for (const want of [d(swap.priceBefore), d(swap.chainlink), d(swap.priceHourLater), d(swap.poolFeeUsd), d(swap.markoutLossUsd), d(swap.poolFeeUsd / swap.markoutLossUsd), swap.tx, `${swap.routedSwaps} pool swaps`]) {
    assert.ok(slideBody.includes(want), `deck slide lacks ${want}`);
  }
  assert.ok(slideBody.includes(d(moment.sessions.weekend.feePerDollarLost)) && slideBody.includes(d(moment.sessions.nyse_hours.feePerDollarLost)));
  assert.ok(handout.includes(`${Math.round(moment.offHours.swapsPct)}% of their swaps`));
});
