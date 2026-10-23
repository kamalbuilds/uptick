import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { STRESS_FALL_PCT, driftFor, earnsOrPays, healthAfterFall, lighterTradeUrl, orderLines, orderText, parseBorrowApr, utcStamp } from "./hedge-view.ts";

const fixture = (f: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), "utf8")) as Record<string, unknown>;

test("health factor falls in proportion to the stock, and is null with no debt", () => {
  assert.equal(healthAfterFall(1.6, STRESS_FALL_PCT), 1.6 * 0.9);
  assert.equal(healthAfterFall(1.25, 20), 1.0);
  assert.equal(healthAfterFall(null, 10), null);
  assert.equal(healthAfterFall(2, 0), 2);
  assert.throws(() => healthAfterFall(1.6, 100), RangeError);
  assert.throws(() => healthAfterFall(1.6, -1), RangeError);
});

test("the order block names market, side, order type, size and leverage, and the link carries only the symbol", () => {
  assert.deepEqual(orderLines("NVDA", "96.7655", 5), [["Market", "NVDA"], ["Side", "Sell"], ["Order", "Market"], ["Size", "96.7655"], ["Leverage", "5x"]]);
  assert.equal(orderText("NVDA", "96.7655", 5), "Market: NVDA\nSide: Sell\nOrder: Market\nSize: 96.7655\nLeverage: 5x");
  assert.equal(lighterTradeUrl("NVDA"), "https://robinhoodchain.lighter.xyz/trade/NVDA");
  assert.ok(!lighterTradeUrl("NVDA").includes("?"), "no size or side is passed in the link");
});

test("residual drift is the spike's measured range for the three symbols it measured, and none for the rest", () => {
  const nvda = driftFor("NVDA");
  assert.ok(nvda);
  assert.equal(nvda.unwind.sdBp, 6.4);
  assert.equal(nvda.open.sdBp, 17.8);
  assert.equal(nvda.unwind.n, 9);
  assert.equal(driftFor("nvda")?.unwind.sdBp, 6.4);
  assert.equal(driftFor("AAPL")?.unwind.sdBp, 9.5);
  assert.equal(driftFor("TSLA")?.unwind.n, 7);
  assert.equal(driftFor("GME"), null);
  assert.equal(driftFor("MSTR"), null);
  const file = JSON.parse(readFileSync(new URL("./hedge-drift.json", import.meta.url), "utf8")) as { _source: string };
  assert.match(file._source, /closetime\.json/);
});

test("a time prints as weekday and UTC clock", () => {
  assert.equal(utcStamp("2026-10-23T20:00:00.000Z"), "Fri 20:00 UTC");
  assert.equal(utcStamp("2026-10-26T13:00:00.000Z"), "Mon 13:00 UTC");
  assert.throws(() => utcStamp("nope"), RangeError);
});

test("funding earns when positive, pays when negative", () => {
  assert.equal(earnsOrPays(4.8), "earns");
  assert.equal(earnsOrPays(-0.1), "pays");
  assert.equal(earnsOrPays(0), "settles at zero");
});

test("the borrow rate is the deepest USDG market for the token, as the continuous APR of its APY", () => {
  const f = fixture("morpho-nvda-usdg-borrow.json");
  assert.match(String(f._source), /blue-api\.morpho\.org/);
  const items = (f as { data: { markets: { items: Array<{ marketId: string; state: { supplyAssetsUsd: number; borrowApy: number } }> } } }).data.markets.items;
  assert.ok(items.length > 3, "the fixture holds the real list, not one row");
  const deepest = items.reduce((a, b) => (b.state.supplyAssetsUsd > a.state.supplyAssetsUsd ? b : a));
  const got = parseBorrowApr(f);
  assert.ok(got);
  assert.equal(got.marketId, deepest.marketId);
  assert.equal(got.supplyUsd, deepest.state.supplyAssetsUsd);
  assert.ok(Math.abs(got.pct - Math.log1p(deepest.state.borrowApy) * 100) < 1e-12);
  assert.ok(got.pct < deepest.state.borrowApy * 100, "an APR is below the APY it compounds into");
  assert.match(got.observedAt, /^2026-10-2\dT/);
});

test("a market with no supply is not a price, and a bad answer is an error", () => {
  const mk = (supply: number, apy: number) => ({ marketId: "0xab", state: { borrowApy: apy, supplyAssetsUsd: supply, timestamp: 1792796733 } });
  assert.equal(parseBorrowApr({ data: { markets: { items: [mk(0, 0.2)] } } }), null);
  assert.equal(parseBorrowApr({ data: { markets: { items: [] } } }), null);
  assert.equal(parseBorrowApr({ data: { markets: { items: [{ marketId: "0xab", state: null }] } } }), null);
  assert.equal(parseBorrowApr({ data: { markets: { items: [mk(10, -0.1)] } } }), null);
  assert.throws(() => parseBorrowApr({ errors: [{ message: "x" }] }), /no markets list/);
});
