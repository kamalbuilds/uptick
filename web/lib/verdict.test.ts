import test from "node:test";
import assert from "node:assert/strict";
import { money, names, plan, verdict } from "./verdict.ts";
import { dollars, tokenBalance } from "./format.ts";
import { usdSigned } from "./leak.ts";
import type { ScanRow, WalletScan } from "./scan.ts";

type Totals = WalletScan["totals"];
const row = (symbol: string, over: Partial<ScanRow> = {}): ScanRow =>
  ({ id: symbol.toLowerCase(), symbol, state: "open", vault: null, holdingUsd: 1000, putToWorkUsd: 1000, ...over }) as ScanRow;
const live = (symbol: string, usd: number, over: Partial<ScanRow> = {}) => row(symbol, { vault: "0x127eCb0e814EF0cC296910DFd5E946050d85534f", putToWorkUsd: usd, holdingUsd: usd * 2, ...over });
const totals = (over: Partial<Totals["putToWork"]> & { idleUsd?: number; refused?: Totals["refused"]; unpriced?: string[] } = {}): Totals => {
  const { idleUsd, refused, unpriced, ...w } = over;
  return {
    idleUsd: idleUsd ?? 424_797,
    putToWork: { tokens: 4, usd: 163_988, holdingUsd: 0, keptPerYearUsd: 3, borrowRoomUsd: null, live: { usd: 5_000, symbols: ["AAPL"] }, launching: { usd: 158_988, symbols: ["NVDA", "GOOGL", "MU"] }, full: [], ...w },
    refused: refused ?? { tokens: 0, usd: 0, reasons: [] },
    unpriced: unpriced ?? [],
  };
};
const rows = [row("NVDA", { putToWorkUsd: 100_000 }), live("AAPL", 5_000), row("GOOGL"), row("MU")];

test("money is whole dollars from $10 up and at most two decimals below, never four", () => {
  assert.equal(money(0), "$0");
  assert.equal(money(2_438_135), "$2,438,135");
  assert.equal(money(12.5), "$13");
  assert.equal(money(9.5), "$9.50");
  assert.equal(money(26), "$26");
  assert.equal(money(0.0123), "$0.01");
  assert.equal(money(388.99), "$389");
  assert.equal(money(999.996), "$1,000");
  assert.equal(money(1000.4), "$1,000");
  assert.equal(dollars(-1204.4), "-$1,204");
});

test("a row's signed yearly figure and the ticket's use one rule, so $388.99 reads $389 in both", () => {
  assert.equal(usdSigned(388.99), `+${money(388.99)}`);
  assert.equal(usdSigned(-388.99), "-$389");
  assert.equal(usdSigned(1204.4), "+$1,204");
  assert.equal(usdSigned(32), "+$32");
  assert.equal(usdSigned(0.002), "+under $0.01");
  assert.equal(usdSigned(0), "$0");
});

test("names lists tickers with and, and folds the tail past four", () => {
  assert.equal(names(["AAPL"]), "AAPL");
  assert.equal(names(["AAPL", "PLTR"]), "AAPL and PLTR");
  assert.equal(names(["NVDA", "GOOGL", "MU"]), "NVDA, GOOGL and MU");
  assert.equal(names(["A", "B", "C", "D", "E", "F", "G"]), "A, B, C, D and 3 more");
  assert.equal(names([]), "");
});

test("the headline and its second line are built from the live and launching figures the ticket reads", () => {
  const s = { rows, totals: totals() };
  const v = verdict(s);
  assert.equal(v.main, "$424,797 of Stock Tokens sit idle. $5,000 of AAPL can go to work today.");
  assert.equal(v.more, "$158,988 more (NVDA, GOOGL and MU) when their vaults launch.");
  assert.doesNotMatch(v.main + v.more, /take|\$163,988/, "the verb take is gone and launching dollars are not in the live figure");
  const p = plan(s);
  assert.equal(p.live.usd, 5_000);
  assert.equal(p.launching.usd, 158_988);
  assert.equal(p.lead?.symbol, "AAPL");
  assert.equal(p.tiny, false);
});

test("a vault whose weaker half lost money still reads 'go to work', and the loss stays out of the headline", () => {
  const v = verdict({ rows: [live("AAPL", 5_000, { keptPerYearUsd: -6_822 })], totals: totals({ keptPerYearUsd: -6_822, launching: { usd: 0, symbols: [] } }) });
  assert.equal(v.main, "$424,797 of Stock Tokens sit idle. $5,000 of AAPL can go to work today.");
  assert.equal(v.more, null);
  assert.doesNotMatch(v.main, /6,822|-\$|cost|kept/);
});

test("nothing live: the headline says none of it can go to work today and the launch line carries the dollars", () => {
  const v = verdict({ rows: [row("NVDA")], totals: totals({ live: { usd: 0, symbols: [] } }) });
  assert.equal(v.main, "$424,797 of Stock Tokens sit idle. None of it can go to work today.");
  assert.equal(v.more, "$158,988 (NVDA, GOOGL and MU) can go to work when their vaults launch.");
  assert.equal(plan({ rows: [row("NVDA")], totals: totals({ live: { usd: 0, symbols: [] } }) }).lead, undefined);
});

test("a live vault at its cap or paused is named, not counted", () => {
  const v = verdict({ rows: [live("AAPL", 0)], totals: totals({ live: { usd: 0, symbols: [] }, full: ["AAPL"], launching: { usd: 0, symbols: [] } }) });
  assert.equal(v.main, "$424,797 of Stock Tokens sit idle. AAPL is full or paused right now, so none of it can go to work today.");
  assert.equal(v.more, null);
});

test("a tiny live holding does not lead: under $100, or under 1% of the wallet", () => {
  const small = (usd: number, idle: number) => plan({ rows: [live("AAPL", usd)], totals: totals({ idleUsd: idle, live: { usd, symbols: ["AAPL"] } }) });
  assert.equal(small(26, 424_797).tiny, true, "$26 of $424,797");
  assert.equal(small(99.99, 500).tiny, true, "under the $100 floor even when it is a fifth of the wallet");
  assert.equal(small(4_000, 424_797).tiny, true, "$4,000 is under 1% of $424,797");
  assert.equal(small(5_000, 424_797).tiny, false, "$5,000 is over 1%");
  assert.equal(small(100, 424_797).tiny, true);
  assert.equal(small(300, 3_000).tiny, false, "a tenth of a small wallet leads");
  assert.equal(small(26, 424_797).lead?.symbol, "AAPL", "the live vault is still known, for the secondary row");
});

test("the lead is the open live vault that takes the most, a reduced one only when no open one takes anything", () => {
  const r = [live("PLTR", 9_000, { state: "reduced" }), live("AAPL", 2_000), row("NVDA", { putToWorkUsd: 50_000 })];
  assert.equal(plan({ rows: r, totals: totals() }).lead?.symbol, "AAPL");
  assert.equal(plan({ rows: [r[0], r[2]], totals: totals() }).lead?.symbol, "PLTR");
  assert.equal(plan({ rows: [r[2]], totals: totals() }).lead, undefined, "a launching vault is never the lead");
});

test("closed vaults and unpriced feeds each get their own line", () => {
  const none = { live: { usd: 0, symbols: [] }, launching: { usd: 0, symbols: [] } };
  const one = verdict({ rows: [], totals: totals({ ...none, refused: { tokens: 1, usd: 5_000, reasons: [] } }) });
  assert.match(one.main, /Its vault is closed, so none of it can go to work/);
  assert.match(verdict({ rows: [], totals: totals({ ...none, refused: { tokens: 3, usd: 5_000, reasons: [] } }) }).main, /Every vault is closed/);
  assert.match(verdict({ rows: [], totals: totals({ idleUsd: 0, unpriced: ["NVDA"] }) }).main, /no usable price/);
});

test("a token balance keeps four decimals under a thousand and two above, so a six-figure holding fits beside its logo", () => {
  assert.equal(tokenBalance(11_515.5963), "11,515.6");
  assert.equal(tokenBalance(11_515.5), "11,515.5");
  assert.equal(tokenBalance(1_234.567), "1,234.57");
  assert.equal(tokenBalance(0.123456), "0.1235");
  assert.equal(tokenBalance(999.99999), "1,000");
  assert.ok(tokenBalance(11_515.5963).length < "11,515.5963".length);
});

test("a tiny live holding never leads the headline: the launching rest does, and the live part moves to the second line", () => {
  const tinyRows = [row("NVDA", { putToWorkUsd: 77_682 }), live("AAPL", 26)];
  const s = { rows: tinyRows, totals: totals({ idleUsd: 118_384, live: { usd: 26, symbols: ["AAPL"] }, launching: { usd: 77_682, symbols: ["NVDA"] } }) };
  const v = verdict(s);
  assert.ok(plan(s).tiny);
  assert.match(v.main, /\$77,682 of NVDA can go to work when their vaults launch\.$/);
  assert.equal(v.more, "$26 of AAPL can go in today.");
});
