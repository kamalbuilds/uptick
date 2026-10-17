import { describe, expect, test } from "bun:test";
import { evaluateGuards } from "../src/guards.ts";
import { priceFromSqrt, priceFromTick } from "../src/price.ts";

const base = { clUsd: 200, clUpdatedAt: 1_000_000, now: 1_003_600, maxDevBps: 200, clMaxAgeS: 87_000 };

describe("guards", () => {
  test("rejects a 3% pool vs Chainlink gap (both directions)", () => {
    const hi = evaluateGuards({ ...base, poolUsd: 206 });
    const lo = evaluateGuards({ ...base, poolUsd: 194 });
    expect(hi.ok).toBe(false);
    expect(hi.devBps).toBeCloseTo(300, 6);
    expect(hi.reasons[0]).toContain("pool_chainlink_deviation");
    expect(lo.ok).toBe(false);
  });
  test("passes a 1% gap and fresh feed", () => {
    const r = evaluateGuards({ ...base, poolUsd: 202 });
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });
  test("rejects a stale feed", () => {
    const r = evaluateGuards({ ...base, poolUsd: 200, now: base.clUpdatedAt + 90_000 });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain("chainlink_stale");
  });
  test("rejects zero or NaN prices", () => {
    expect(evaluateGuards({ ...base, poolUsd: 200, clUsd: 0 }).ok).toBe(false);
    expect(evaluateGuards({ ...base, poolUsd: NaN }).ok).toBe(false);
  });
});

describe("price math", () => {
  test("NVDA pool (USDG is token0) at the live sqrtPrice reads ~214.5", () => {
    // sqrt(1e12 / 214.5) * 2^96 for USDG = token0
    const s = BigInt(Math.floor(Math.sqrt(1e12 / 214.5) * 2 ** 48)) * 2n ** 48n;
    expect(priceFromSqrt(s, false)).toBeCloseTo(214.5, 2);
  });
  test("tick of the real NVDA fixture position maps to ~217 USD, orderings are reciprocal", () => {
    const p = priceFromTick(222495, false);
    expect(p).toBeGreaterThan(210); expect(p).toBeLessThan(225);
    expect(priceFromTick(222495, true) * p / 1e24).toBeCloseTo(1, 9);
  });
});
