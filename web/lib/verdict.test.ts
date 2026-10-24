import test from "node:test";
import assert from "node:assert/strict";
import { money, verdict, weakerHalf } from "./verdict.ts";
import { tokenBalance } from "./format.ts";

type Totals = Parameters<typeof verdict>[0]["totals"];
const totals = (over: Partial<Totals> = {}): Totals => ({
  idleUsd: 2_438_135,
  putToWork: { tokens: 1, usd: 100_000, holdingUsd: 2_438_135, keptPerYearUsd: 3_100, borrowRoomUsd: null },
  refused: { tokens: 0, usd: 0, reasons: [] },
  unpriced: [],
  ...over,
});

test("money is whole dollars from a thousand up and cents below", () => {
  assert.equal(money(0), "$0");
  assert.equal(money(2_438_135), "$2,438,135");
  assert.equal(money(12.5), "$12.50");
});

test("a vault that keeps a gain is put to work", () => {
  assert.equal(verdict({ totals: totals() }), "$2,438,135 of Stock Tokens sit idle. Uptick can put $100,000 to work.");
});

test("a vault whose weaker half lost money takes the deposit, never promises work, and keeps the loss out of the headline", () => {
  const loss = totals({ putToWork: { tokens: 1, usd: 100_000, holdingUsd: 2_438_135, keptPerYearUsd: -6_822, borrowRoomUsd: null } });
  const v = verdict({ totals: loss });
  assert.equal(v, "$2,438,135 of Stock Tokens sit idle. Uptick can take $100,000 of it.");
  assert.doesNotMatch(v, /to work|-\$|6,822/);
  assert.deepEqual(weakerHalf({ totals: loss }), { gain: false, usd: 6_822 });
  assert.deepEqual(weakerHalf({ totals: totals() }), { gain: true, usd: 3_100 });
  assert.equal(weakerHalf({ totals: totals({ putToWork: { tokens: 0, usd: 0, holdingUsd: 0, keptPerYearUsd: 0, borrowRoomUsd: null } }) }), null);
});

test("closed vaults and unpriced feeds each get their own line", () => {
  const closedOne = verdict({ totals: totals({ putToWork: { tokens: 0, usd: 0, holdingUsd: 0, keptPerYearUsd: 0, borrowRoomUsd: null }, refused: { tokens: 1, usd: 5_000, reasons: [] } }) });
  assert.match(closedOne, /Its vault is closed, so Uptick puts none of it to work/);
  const closedMany = verdict({ totals: totals({ putToWork: { tokens: 0, usd: 0, holdingUsd: 0, keptPerYearUsd: 0, borrowRoomUsd: null }, refused: { tokens: 3, usd: 5_000, reasons: [] } }) });
  assert.match(closedMany, /Every vault is closed/);
  assert.match(verdict({ totals: totals({ idleUsd: 0, unpriced: ["NVDA"] }) }), /no usable price/);
});

test("a token balance keeps four decimals under a thousand and two above, so a six-figure holding fits beside its logo", () => {
  assert.equal(tokenBalance(11_515.5963), "11,515.6");
  assert.equal(tokenBalance(11_515.5), "11,515.5");
  assert.equal(tokenBalance(1_234.567), "1,234.57");
  assert.equal(tokenBalance(0.123456), "0.1235");
  assert.equal(tokenBalance(999.99999), "1,000");
  assert.ok(tokenBalance(11_515.5963).length < "11,515.5963".length);
});
