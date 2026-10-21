import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { KEEP_FLOOR_APR } from "../src/evidence.ts";
import { DYNAMIC_FEE, V4_HOOK_FLAGS } from "../src/v4.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const replayPy = read("../replay/replay.py");

/** The right-hand side of `NAME = <expr>` in replay.py, evaluated as a JS integer expression (the shifts and ors read the same in both languages). */
const pyConst = (name: string): number => {
  const m = new RegExp(`^${name}\\s*=\\s*([^#\\n]+)`, "m").exec(replayPy);
  if (!m) throw new Error(`${name} not found in replay/replay.py`);
  return new Function(`return (${m[1].trim()})`)() as number;
};

test("replay.py and deploy-list.mjs gate on the same KEEP_FLOOR_APR as keeper/src/evidence.ts", () => {
  expect(KEEP_FLOOR_APR).toBeLessThan(0);
  expect(pyConst("KEEP_FLOOR_APR")).toBe(KEEP_FLOOR_APR);
  const mjs = /^const KEEP_FLOOR_APR = (-?\d+);/m.exec(read("../../scripts/deploy-list.mjs"));
  expect(mjs).not.toBeNull();
  expect(Number(mjs![1])).toBe(KEEP_FLOOR_APR);
});

test("replay.py mirrors the v4 hook flag mask and the dynamic fee flag of keeper/src/v4.ts", () => {
  expect(V4_HOOK_FLAGS).toBe(0x30f);
  expect(pyConst("V4_HOOK_FLAGS")).toBe(V4_HOOK_FLAGS);
  expect(pyConst("DYNAMIC_FEE")).toBe(DYNAMIC_FEE);
});

test("replay.py sizes a v4 vault by the 20% share of keeper/src/universe.ts", () => {
  expect(pyConst("MAX_VAULT_SHARE")).toBe(0.2);
});
