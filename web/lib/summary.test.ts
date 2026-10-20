import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summaryFigures } from "./summary.ts";
import { TERMS } from "./terms.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), "utf8"));
const universe = load("vault-universe.json");
const fees = load("pool-fees.json");
type V = { symbol: string; pool: string; gate: { state: string; swaps: number } };

test("summary figures are the sums of the files the list is built from", () => {
  const s = summaryFigures(universe, fees);
  assert.equal(s.tracked, universe.vaults.length);
  assert.ok(s.tracked >= 10, "an empty universe would make every figure below trivially true");
  assert.equal(s.taking, universe.vaults.filter((v: V) => v.gate.state !== "closed").length);
  assert.equal(s.open + s.reduced, s.taking);
  assert.equal(s.swapsReplayed, universe.vaults.reduce((n: number, v: V) => n + v.gate.swaps, 0));
  const direct = Object.values(fees.feesUsdByPool as Record<string, number>).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(s.lpFeesUsd - direct) < 0.01);
  assert.ok(s.lpFeesUsd > 0);
});

test("every vault's pool has a fee entry in the replay window the list was built over", () => {
  const byPool = fees.feesUsdByPool as Record<string, number>;
  for (const v of universe.vaults as V[]) assert.ok(v.pool.toLowerCase() in byPool, `${v.symbol} pool missing`);
  assert.deepEqual(fees.window, universe.window);
});

test("a vault with no fee entry makes the summary throw instead of showing a smaller total", () => {
  const byPool = fees.feesUsdByPool as Record<string, number>;
  const key = universe.vaults[0].pool.toLowerCase();
  const kept = byPool[key];
  delete byPool[key];
  try {
    assert.throws(() => summaryFigures(universe, fees), /no fee total/);
  } finally {
    byPool[key] = kept;
  }
});

test("every term has a definition with no dash punctuation", () => {
  for (const [id, t] of Object.entries(TERMS)) {
    assert.ok(t.text.length > 40, id);
    assert.ok(!/[–—]| -- /.test(t.text), `${id} has a dash`);
  }
  assert.match(TERMS.reduced.text, /\$25,000/);
  assert.match(TERMS.closed.text, /-20%/);
});
