import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { MARKS, monogram, monogramScale } from "./token-marks.ts";

const dir = new URL("../public/tokens/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).sort();
const universe = JSON.parse(readFileSync(new URL("./vault-universe.json", import.meta.url), "utf8")) as { vaults: { symbol: string }[] };

test("a mark file exists for exactly the symbols in MARKS", () => {
  assert.ok(files.length > 5);
  assert.deepEqual(files, [...MARKS].sort());
});

test("all 17 vault symbols are covered: a mark or a monogram that fits", () => {
  assert.equal(universe.vaults.length, 17);
  for (const { symbol } of universe.vaults) {
    if (MARKS.has(symbol)) continue;
    for (const size of [20, 28, 40]) {
      const text = monogram(symbol, size);
      assert.ok(text.length >= 2 && text.length <= 4, symbol);
      // glyph run is at most ~0.62em per capital; it must stay inside 80% of the tile
      assert.ok(text.length * 0.62 * monogramScale(text) <= 0.8, `${symbol}@${size}`);
    }
  }
});
