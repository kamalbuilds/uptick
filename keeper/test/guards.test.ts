import { describe, expect, test } from "bun:test";
import { evaluateGuards, TWAP_FEED_MAX_BPS, twapOffFeed } from "../src/guards.ts";
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

describe("scheduled rebalance TWAP-to-feed deferral", () => {
  // The oracle's sqrt price in pool terms (price 100 -> sqrt 10 x 2^96) and a TWAP `bps` away from it, built the way the
  // vault compares them: prices are the squares, so the TWAP sqrt moves by sqrt(1 + bps/1e4).
  const sqrtOracle = 10n * 2n ** 96n;
  const twapAt = (bps: number) => (sqrtOracle * BigInt(Math.round(Math.sqrt(1 + bps / 1e4) * 1e12))) / 10n ** 12n;

  test("the threshold is 15 bp", () => {
    expect(TWAP_FEED_MAX_BPS).toBe(15n);
  });
  test("fires above 15 bp, in both directions", () => {
    for (const bps of [15.5, 16, 30, 95]) {
      expect(twapOffFeed(twapAt(bps), sqrtOracle).defer).toBe(true);
      expect(twapOffFeed(twapAt(-bps), sqrtOracle).defer).toBe(true);
    }
  });
  test("does not fire below 15 bp", () => {
    for (const bps of [0, 5, 14, 14.5, 14.9]) {
      expect(twapOffFeed(twapAt(bps), sqrtOracle).defer).toBe(false);
      expect(twapOffFeed(twapAt(-bps), sqrtOracle).defer).toBe(false);
    }
  });
  test("reports the gap in bp", () => {
    expect(twapOffFeed(twapAt(20), sqrtOracle).bps).toBeCloseTo(20, 1);
  });
  test("an unreadable feed or TWAP (zero sqrt) defers rather than sends", () => {
    expect(twapOffFeed(0n, sqrtOracle).defer).toBe(true);
    expect(twapOffFeed(sqrtOracle, 0n).defer).toBe(true);
  });
});

