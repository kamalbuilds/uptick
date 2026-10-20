import assert from "node:assert/strict";
import test from "node:test";
import type { Keep } from "./evidence.ts";
import { buildOutcomeRows } from "./outcome.ts";

const keep: Keep = { feeAprPct: 40.5574, markoutAprPct: 30.8976, costAprPct: 4.6234, keptAprPct: 5.0364, keptFirstHalf: 2.1, keptSecondHalf: 7.9 };

test("the waterfall reads fees, the two losses as negatives, then what is kept", () => {
  const rows = buildOutcomeRows(keep);
  assert.deepEqual(
    rows.map((r) => [r.key, r.label, r.value, r.tone]),
    [
      ["fees", "Trading fees earned", 40.5574, "earn"],
      ["markout", "Lost to informed traders, 1 hour markout", -30.8976, "lose"],
      ["cost", "Rebalancing cost", -4.6234, "lose"],
      ["kept", "Kept", 5.0364, "total"],
    ],
  );
});

test("a negative markout is a gain to the LP and is drawn as one", () => {
  const rows = buildOutcomeRows({ ...keep, markoutAprPct: -30.8976 });
  assert.equal(rows[1].value, 30.8976);
  assert.equal(rows[1].tone, "earn");
});

test("bar widths are proportional to the largest absolute value", () => {
  const rows = buildOutcomeRows({ ...keep, feeAprPct: 40, markoutAprPct: 30, costAprPct: 5, keptAprPct: 5 });
  assert.equal(rows[0].widthPct, 100);
  assert.equal(rows[1].widthPct, 75);
  assert.equal(rows[2].widthPct, 12.5);
  assert.equal(rows[3].widthPct, 12.5);
});

test("an all-zero replay draws no bars instead of dividing by zero", () => {
  const rows = buildOutcomeRows({ feeAprPct: 0, markoutAprPct: 0, costAprPct: 0, keptAprPct: 0, keptFirstHalf: 0, keptSecondHalf: 0 });
  assert.deepEqual(
    rows.map((r) => r.widthPct),
    [0, 0, 0, 0],
  );
});

test("rows add up to kept on a real NVDA replay row, and a markout gain shows as a gain", () => {
  const rows = buildOutcomeRows({ feeAprPct: 26.834, markoutAprPct: 20.730, costAprPct: 3.248, keptAprPct: 2.856, keptFirstHalf: 0, keptSecondHalf: 0 });
  const sum = rows.filter((r) => r.key !== "kept").reduce((s, r) => s + r.value, 0);
  assert.ok(Math.abs(sum - rows.find((r) => r.key === "kept")!.value) < 0.01);
  const gain = buildOutcomeRows({ feeAprPct: 5, markoutAprPct: -2, costAprPct: 1, keptAprPct: 6, keptFirstHalf: 0, keptSecondHalf: 0 });
  assert.ok(gain.find((r) => r.key === "markout")!.value > 0);
});
