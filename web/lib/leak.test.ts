import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gateScale, leakBar, rowBar, usdSigned, yearlyUsd } from "./leak.ts";

const universe = JSON.parse(readFileSync(new URL("./vault-universe.json", import.meta.url), "utf8"));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test("leak bar: NVDA fees split into kept, cost and informed-trader loss, widths sum to 100", () => {
  const b = leakBar({ feeApr: 40.868, markoutApr: 31.148, costApr: 2.783, keptApr: 6.937 });
  assert.deepEqual(b.segments.map((s) => s.key), ["kept", "cost", "markout"]);
  assert.ok(Math.abs(sum(b.segments.map((s) => s.widthPct)) - 100) < 0.01);
  assert.ok(Math.abs(b.segments[0].widthPct - (6.937 / 40.868) * 100) < 0.01);
  assert.equal(b.overdrawn, false);
  assert.ok(Math.abs(b.feesEndPct - 100) < 0.01);
});

test("leak bar: a vault that kept less than nothing has no kept segment and marks where fees ran out", () => {
  const b = leakBar({ feeApr: 175, markoutApr: 280, costApr: 9, keptApr: -114 });
  assert.equal(b.overdrawn, true);
  assert.ok(!b.segments.some((s) => s.key === "kept"));
  assert.ok(b.feesEndPct < 100 && b.feesEndPct > 0);
  assert.ok(Math.abs(sum(b.segments.map((s) => s.widthPct)) - 100) < 0.01);
});

test("leak bar: no fees and no losses draws nothing instead of dividing by zero", () => {
  assert.deepEqual(leakBar({ feeApr: 0, markoutApr: 0, costApr: 0, keptApr: 0 }).segments, []);
});

test("row bar: positive grows right of zero, negative grows left, past the floor is clipped and flagged", () => {
  const pos = rowBar(2.5), neg = rowBar(-10), past = rowBar(-114.2);
  assert.equal(pos.leftPct, pos.zeroPct);
  assert.ok(pos.widthPct > 0 && !pos.clipped);
  assert.ok(neg.leftPct < neg.zeroPct && Math.abs(neg.leftPct + neg.widthPct - neg.zeroPct) < 1e-9);
  assert.equal(past.leftPct, 0);
  assert.equal(past.clipped, true);
});

test("row bar: the floor row fills exactly the track", () => {
  const b = rowBar(-20);
  assert.equal(b.leftPct, 0);
  assert.ok(Math.abs(b.widthPct - b.zeroPct) < 1e-9);
  assert.equal(b.clipped, false);
});

test("gate scale: weaker half marks the Open zone for +1.8, the Reduced zone for -10, the left edge for CRCL", () => {
  const open = gateScale(1.8, 12.2, -20), reduced = gateScale(-10, 4, -20), crcl = gateScale(-114.2, -3, -20);
  assert.ok(open.worstPct > open.zeroPct);
  assert.ok(reduced.worstPct > reduced.floorPct && reduced.worstPct < reduced.zeroPct);
  assert.equal(crcl.worstPct, 0);
  assert.equal(crcl.worstClamped, true);
});

test("yearly dollars follow the rate with its sign", () => {
  assert.equal(yearlyUsd(1800, 1.8), 32.4);
  assert.equal(usdSigned(32.4), "+$32");
  assert.equal(usdSigned(-1204.4), "-$1,204");
  assert.equal(usdSigned(0.2), "+under $1");
});

test("universe: every vault's headline 'you keep' is the weaker half, and its fee split adds up", () => {
  assert.ok(universe.vaults.length >= 17);
  for (const v of universe.vaults) {
    const worst = Math.min(v.keep.kept_first_half, v.keep.kept_second_half);
    assert.ok(Math.abs(v.gate.worst_half_apr - worst) < 1e-9, `${v.id} gate.worst_half_apr is not the weaker half`);
    assert.ok(Math.abs(v.keep.fee_apr_pct - v.keep.markout_apr_pct - v.keep.cost_apr_pct - v.keep.kept_apr_pct) < 0.05, `${v.id} fees minus losses is not kept`);
    assert.equal(v.gate.state, v.gate.worst_half_apr >= 0 ? "open" : v.gate.worst_half_apr >= v.gate.floor_apr ? "reduced" : "closed", `${v.id} state disagrees with its weaker half`);
  }
  assert.ok(universe.window.end.startsWith("2026-"));
});
