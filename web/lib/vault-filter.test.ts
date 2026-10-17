import test from "node:test";
import assert from "node:assert/strict";
import { countLine, filterVaults, matchesQuery, tiersOf } from "./vault-filter.ts";

const v = [
  { symbol: "NVDA", name: "NVIDIA Stock Token", feeTier: "0.05%" },
  { symbol: "GOOGL", name: "Alphabet Class A Stock Token", feeTier: "0.05%" },
  { symbol: "CRCL", name: "Circle Internet Group Stock Token", feeTier: "0.3%" },
  { symbol: "SPCX", name: "SpaceX Stock Token", feeTier: "0.05%" },
];

test("ticker prefix and company word prefix both match, a mid-word fragment does not", () => {
  assert.deepEqual(filterVaults(v, "nv", "all").map((x) => x.symbol), ["NVDA"]);
  assert.deepEqual(filterVaults(v, "circle", "all").map((x) => x.symbol), ["CRCL"]);
  assert.deepEqual(filterVaults(v, "alph", "all").map((x) => x.symbol), ["GOOGL"]);
  assert.equal(matchesQuery(v[0], "vid"), false);
  assert.deepEqual(filterVaults(v, "  ", "all").length, 4);
});

test("tier filter narrows and combines with search", () => {
  assert.deepEqual(filterVaults(v, "", "0.3%").map((x) => x.symbol), ["CRCL"]);
  assert.deepEqual(filterVaults(v, "s", "0.05%").map((x) => x.symbol), ["SPCX"]);
  assert.deepEqual(filterVaults(v, "nvda", "0.3%"), []);
});

test("tiers sort by fee, not as strings", () => {
  assert.deepEqual(tiersOf([...v, { symbol: "X", name: "x", feeTier: "1%" }, { symbol: "Y", name: "y", feeTier: "0.01%" }]), ["0.01%", "0.05%", "0.3%", "1%"]);
});

test("count line", () => {
  assert.equal(countLine(4, 4), "4 Stock Token vaults");
  assert.equal(countLine(1, 4), "1 of 4 Stock Token vaults");
  assert.equal(countLine(1, 1), "1 Stock Token vault");
});
