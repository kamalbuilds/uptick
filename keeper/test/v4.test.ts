import { expect, test } from "bun:test";
import { DYNAMIC_FEE, V4_HOOK_FLAGS, v4KeyOk } from "../src/v4.ts";

const hook = (low: number) => `0x${"ab".repeat(18)}${low.toString(16).padStart(4, "0")}`;
const ZERO = "0x0000000000000000000000000000000000000000";

test("a static fee with no hook is accepted, a dynamic fee never", () => {
  expect(v4KeyOk(3000, ZERO, new Set())).toBe(true);
  expect(v4KeyOk(DYNAMIC_FEE, ZERO, new Set())).toBe(false);
  expect(v4KeyOk(DYNAMIC_FEE | 3000, hook(0), new Set([hook(0)]))).toBe(false);
});

test("a hook needs the allow-list and every fund-moving permission bit clear", () => {
  const allow = new Set([hook(0), hook(1 << 9), hook(1 << 3), hook(1 << 7), hook(1 << 13)]);
  expect(v4KeyOk(3000, hook(0), new Set())).toBe(false);
  expect(v4KeyOk(3000, hook(0), allow)).toBe(true);
  expect(v4KeyOk(3000, hook(1 << 13), allow)).toBe(true); // beforeInitialize alone moves no vault funds
  expect(v4KeyOk(3000, hook(1 << 7), allow)).toBe(false); // beforeSwap can sandwich the vault's own swap
  expect(v4KeyOk(3000, hook(1 << 9), allow)).toBe(false); // beforeRemoveLiquidity can block a withdrawal
  expect(v4KeyOk(3000, hook(1 << 3), allow)).toBe(false); // beforeSwapReturnsDelta takes a delta
  for (const bit of [11, 10, 9, 8, 7, 6, 3, 2, 1, 0]) expect(V4_HOOK_FLAGS & (1 << bit)).not.toBe(0);
  expect(v4KeyOk(3000, hook(0).toUpperCase().replace("0X", "0x"), allow)).toBe(true); // lookup is case-insensitive
});
