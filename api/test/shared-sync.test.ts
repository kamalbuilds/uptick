import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const here = import.meta.dir;
const read = (p: string) => readFileSync(resolve(here, p), "utf8");

/** The pairs `npm run sync` copies for the wallet scan: web/lib is the one source, api/src/shared and api/data hold the copies the Worker bundles. */
const PAIRS: Array<[string, string]> = [
  ["../../web/lib/scan.ts", "../src/shared/scan.ts"],
  ["../../web/lib/price-math.ts", "../src/shared/price-math.ts"],
  ["../../web/lib/morpho.ts", "../src/shared/morpho.ts"],
  ["../../web/lib/loan.ts", "../src/shared/loan.ts"],
  ["../../web/lib/abis.ts", "../src/shared/abis.ts"],
  ["../../web/lib/collateral-markets.json", "../data/collateral-markets.json"],
];

/** Pairs whose copy differs from the source, by name. */
const drifted = (pairs: Array<[string, string]>, sourceOf: (p: string) => string = read): string[] =>
  pairs.filter(([src, copy]) => sourceOf(src) !== read(copy)).map(([src]) => src.split("/").pop() as string);

describe("the Worker's copies of web/lib match their source", () => {
  test("scan, price-math, morpho, loan, abis and the collateral markets are byte for byte the web files", () => {
    expect(PAIRS.length).toBe(6);
    expect(drifted(PAIRS)).toEqual([]);
  });

  test("the check can fail: a source edited after the copy is reported by name", () => {
    expect(drifted(PAIRS, (p) => (p.endsWith("scan.ts") ? read(p) + "\n// edited\n" : read(p)))).toEqual(["scan.ts"]);
  });
});
