import test from "node:test";
import assert from "node:assert/strict";
import { feedAgeLabel, feedAgeSeconds, feedUsd, priceLabel } from "./price-math.ts";

test("feedUsd scales by the feed's decimals and refuses a broken round", () => {
  assert.equal(feedUsd(21_701_529_109n, 8), 217.01529109);
  assert.equal(feedUsd(100_000_000n, 8), 1);
  assert.equal(feedUsd(0n, 8), null);
  assert.equal(feedUsd(-5n, 8), null);
  assert.equal(feedUsd(1n, 99), null);
});

test("priceLabel keeps cents on a stock and four places under a dollar", () => {
  assert.equal(priceLabel(217.01529109), "$217.02");
  assert.equal(priceLabel(1234.5), "$1,234.50");
  assert.equal(priceLabel(0.0421), "$0.0421");
  assert.equal(priceLabel(NaN), "n/a");
});

test("feed age reads in the largest whole unit and never goes negative", () => {
  assert.equal(feedAgeSeconds(1_000, 1_012_000), 12);
  assert.equal(feedAgeSeconds(2_000, 1_000_000), 0);
  assert.equal(feedAgeLabel(12), "12s");
  assert.equal(feedAgeLabel(540), "9m");
  assert.equal(feedAgeLabel(32_400), "9h");
  assert.equal(feedAgeLabel(172_800), "2d");
});
