import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DRIFT_SYMBOLS, STRESS_FALL_PCT, aprText, borrowCovers, driftFor, earnsOrPays, healthAfterFall, lighterTradeUrl, orderLines, orderText, parseBorrowApr, utcStamp } from "./hedge-view.ts";

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
  assert.equal(driftFor("TSLA")?.unwind.n, 9);
  assert.equal(driftFor("GME"), null);
  assert.equal(driftFor("MSTR"), null);
  const file = JSON.parse(readFileSync(new URL("./hedge-drift.json", import.meta.url), "utf8")) as { _source: string };
  assert.match(file._source, /closetime\.json/);
});

test("each drift row is the pool the vault trades in, and its figures are the ones closetime.json holds", () => {
  const universe = JSON.parse(readFileSync(new URL("./vault-universe.json", import.meta.url), "utf8")) as { vaults: Array<{ symbol: string; feeTier: string }> };
  const closetime = JSON.parse(readFileSync(new URL("../../spikes/stock-hedge/economics/closetime.json", import.meta.url), "utf8")) as Record<string, Record<string, number[]>>;
  assert.ok(DRIFT_SYMBOLS.length >= 3, "the loop below must read rows");
  for (const sym of DRIFT_SYMBOLS) {
    const d = driftFor(sym)!;
    const vault = universe.vaults.find((v) => v.symbol === sym)!;
    assert.equal(d.pool, vault.feeTier, `${sym} drift is measured on ${d.pool}, its vault trades in ${vault.feeTier}`);
    for (const [role, at] of [["unwind", "Mon13:00"], ["open", "Mon13:30"]] as const) {
      const v = closetime[`${sym}|${d.pool}`][at];
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
      assert.equal(d[role].n, v.length, `${sym} ${at} n`);
      assert.equal(d[role].sdBp, Math.round(sd * 10) / 10, `${sym} ${at} sd`);
      assert.equal(d[role].maxAbsBp, Math.round(Math.max(...v.map(Math.abs)) * 10) / 10, `${sym} ${at} max`);
    }
  }
  assert.equal(driftFor("TSLA")?.pool, "0.3%");
});

test("a yearly rate under 0.1% prints two decimals, never 0.0%", () => {
  assert.equal(aprText(20.2), "20.2%");
  assert.equal(aprText(0.76), "0.8%");
  assert.equal(aprText(0.0249), "0.02%");
  assert.equal(aprText(0.0004), "0.00%");
  assert.notEqual(aprText(0.0249), "0.0%");
});

test("a market covers the margin only when its supplied less borrowed USDG is at least that margin", () => {
  const got = parseBorrowApr(fixture("morpho-nvda-usdg-borrow.json"))!;
  const f = fixture("morpho-nvda-usdg-borrow.json") as { data: { markets: { items: Array<{ marketId: string; state: { supplyAssetsUsd: number; borrowAssetsUsd: number } }> } } };
  const row = f.data.markets.items.find((m) => m.marketId === got.marketId)!;
  assert.equal(got.liquidityUsd, row.state.supplyAssetsUsd - row.state.borrowAssetsUsd);
  assert.ok(got.liquidityUsd > 100_000 && got.liquidityUsd < got.supplyUsd);
  assert.equal(borrowCovers(got, 2_000), true);
  assert.equal(borrowCovers(got, got.liquidityUsd), true);
  assert.equal(borrowCovers(got, got.liquidityUsd + 1), false);
  assert.equal(borrowCovers({ ...got, liquidityUsd: 0 }, 1), false);
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
  const mk = (supply: number, apy: number) => ({ marketId: "0xab", state: { borrowApy: apy, supplyAssetsUsd: supply, borrowAssetsUsd: supply / 2, timestamp: 1792796733 } });
  assert.equal(parseBorrowApr({ data: { markets: { items: [mk(0, 0.2)] } } }), null);
  assert.equal(parseBorrowApr({ data: { markets: { items: [] } } }), null);
  assert.equal(parseBorrowApr({ data: { markets: { items: [{ marketId: "0xab", state: null }] } } }), null);
  assert.equal(parseBorrowApr({ data: { markets: { items: [mk(10, -0.1)] } } }), null);
  assert.throws(() => parseBorrowApr({ errors: [{ message: "x" }] }), /no markets list/);
});
