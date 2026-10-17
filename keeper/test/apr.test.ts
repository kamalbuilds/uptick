import { describe, expect, test } from "bun:test";
import { feeAprPct, feeUsd, feesInWindow, windowApr, type FeeEvent } from "../src/apr.ts";
import fx from "./fixtures/collects.json";

// Real Collect events from the NVDA/USDG 0.05% pool (token0 = USDG 6 dp, token1 = NVDA 18 dp), first four of the fixture.
const ev: FeeEvent[] = fx.events.slice(0, 4).map((e) => ({ ts: e.ts, amount0: BigInt(e.amount0), amount1: BigInt(e.amount1) }));
const NVDA = 214.5; // USD per token, fixed for the hand calculation
const now = ev[3].ts;

describe("fee APR from realized collect events", () => {
  test("fixture is the real thing", () => {
    expect(ev.length).toBe(4);
    expect(fx.pool).toBe("0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3");
    expect(ev[0].amount0).toBe(7066492144n);
  });
  test("per event USD value (hand computed)", () => {
    // 7066.492144 USDG + 6.372803108... NVDA * 214.5
    expect(feeUsd(ev[0], false, NVDA)).toBeCloseTo(8433.458410684395, 6);
    expect(feeUsd(ev[2], false, NVDA)).toBeCloseTo(21561.95830372538, 6);
  });
  test("window sum and 1 day APR on 5,000,000 TVL = 450.41119%", () => {
    const fees = feesInWindow(ev, now, 86400, false, NVDA);
    expect(fees).toBeCloseTo(61700.16309428049, 6);
    expect(feeAprPct(fees, 5_000_000, 86400)!).toBeCloseTo(450.4111905882476, 6);
  });
  test("window excludes older events: 50 s window keeps events 3 and 4 -> 543758.51224%", () => {
    const r = windowApr(ev, now, 50, now - 10 * 86400, 5_000_000, false, NVDA);
    expect(r.feesUsd).toBeCloseTo(43106.17328, 4);
    expect(r.aprPct!).toBeCloseTo(543758.5122390199, 4);
  });
  test("young vault: elapsed clamps to vault age, not the 7d window -> 10809.8685741%", () => {
    const r = windowApr(ev, now, 7 * 86400, now - 3600, 5_000_000, false, NVDA);
    expect(r.elapsedS).toBe(3600);
    expect(r.aprPct!).toBeCloseTo(10809.868574117941, 4);
  });
  test("no TVL or no elapsed time gives null, never Infinity", () => {
    expect(feeAprPct(10, 0, 86400)).toBeNull();
    expect(feeAprPct(10, 100, 0)).toBeNull();
  });
});
