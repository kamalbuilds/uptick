import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Address } from "viem";
import { MULTICALL3 } from "./scan.ts";
import { readMultipliers, stockLegOfShares } from "./hedge-chain.ts";
import { PROPOSAL_VALID_MINUTES, PROTECTIVE_BUFFER_BP, agentInstruction, carryBp, carryUsd, hedgeable, isWeekendHour, marginCarryBp, midOf, planHedge, proposeExecution, roundTripBp, sizeShares, walkBook, weekendWindow, worstPrice, type PlanInput } from "./hedge.ts";
import {
  fetchAssetDetails,
  fetchFundings,
  fetchOrderBookDetails,
  fetchOrderBookOrders,
  LIGHTER_RH,
  parseAssetDetails,
  parseFundings,
  parseOrderBook,
  parseOrderBookDetails,
  parseWad,
  type Sourced,
} from "./lighter.ts";

// Recorded keyless GETs against https://api.rh.lighter.xyz, each file carrying its URL and UTC capture time in `_source`.
const fx = (f: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), "utf8"));
const universe: { vaults: { symbol: string; token: string }[] } = JSON.parse(readFileSync(new URL("./vault-universe.json", import.meta.url), "utf8"));

const obdFx = fx("lighter-orderbookdetails.json");
const assetFx = fx("lighter-assetdetails.json");
const bookFx = fx("lighter-orderbookorders-nvda.json");
const aaplFx = fx("lighter-fundings-aapl-short.json");
const nvdaFundFx = fx("lighter-fundings-nvda.json");

const perps = parseOrderBookDetails(obdFx);
const assets = parseAssetDetails(assetFx);
const book = parseOrderBook(bookFx);
const nvda = perps.find((p) => p.symbol === "NVDA")!;
const wad = (s: string) => parseWad(s);

test("the fixtures are real captures with a source and a time, and none is empty", () => {
  for (const f of [obdFx, assetFx, bookFx, aaplFx, nvdaFundFx]) {
    assert.match(f._source.url, /^https:\/\/api\.rh\.lighter\.xyz\/api\/v1\//);
    assert.match(f._source.fetchedAt, /^2026-10-2\dT\d\d:\d\d:\d\dZ$/);
  }
  assert.ok(perps.length >= 15 && assets.length >= 17 && book.bids.length > 100 && book.asks.length > 100);
  assert.ok(parseFundings(aaplFx).some((r) => r.direction === "short"));
});

// ---- sizing ----------------------------------------------------------------------------------------------------------------

test("NVDA 1.41469 tokens at the multiplier 1.000775159164630595 sizes 1.4157 shares: floored to size_decimals, never above the holding", () => {
  const balance = 1_414_690_000_000_000_000n;
  const mult = wad("1.000775159164630595");
  assert.equal(nvda.sizeDecimals, 4);
  const s = sizeShares(balance, 18, mult, nvda.sizeDecimals, nvda.minBaseAmount);
  assert.ok("units" in s);
  // exact holding x multiplier is 1.41578661...; rounding to nearest would say 1.4158
  assert.equal(s.shares, "1.4157");
  assert.equal(s.units, 14157n);
  assert.ok(s.units * 10n ** 14n <= (balance * mult) / 10n ** 18n, "shares never exceed holding x multiplier");
  assert.match(s.shares, /^\d+\.\d{4}$/, "a multiple of 1e-4");
});

test("no balance is sized above holding x multiplier", () => {
  let n = 0;
  for (let i = 1; i < 400; i++) {
    const balance = BigInt(i) * 7_919_000_000_000_001n + BigInt(i * i);
    const mult = wad("1.000775159164630595") + BigInt(i);
    const s = sizeShares(balance, 18, mult, 4, "0.0001");
    if ("reason" in s) continue;
    n++;
    assert.ok(s.units * 10n ** 14n <= (balance * mult) / 10n ** 18n);
    assert.ok((balance * mult) / 10n ** 18n - s.units * 10n ** 14n < 10n ** 14n, "the floor loses less than one size step");
  }
  assert.ok(n > 300);
});

test("under min_base_amount there is nothing to place, at the edge and below it", () => {
  const mult = wad("1.000775159164630595");
  assert.equal(nvda.minBaseAmount, "0.0400");
  assert.deepEqual(sizeShares(39_000_000_000_000_000n, 18, mult, 4, nvda.minBaseAmount), { reason: "below_min" });
  assert.deepEqual(sizeShares(0n, 18, mult, 4, nvda.minBaseAmount), { reason: "below_min" });
  const edge = sizeShares(40_000_000_000_000_000n, 18, wad("1"), 4, nvda.minBaseAmount);
  assert.ok("shares" in edge && edge.shares === "0.0400");
});

test("a min_base_amount with more places than size_decimals still compares exactly", () => {
  assert.deepEqual(sizeShares(1_000_000_000_000_000n, 18, wad("1"), 3, "0.0020"), { reason: "below_min" });
  assert.ok("shares" in sizeShares(2_000_000_000_000_000n, 18, wad("1"), 3, "0.0020"));
});

// ---- the book --------------------------------------------------------------------------------------------------------------

const MID = 211.17; // best bid 211.16, best ask 211.18 in the recorded NVDA book

test("walkBook over the real NVDA bids matches the hand-walked cost vs mid", () => {
  assert.ok(Math.abs((midOf(book) ?? 0) - MID) < 1e-9);
  // hand-walked from the 197 recorded bids: $1,000 and $10,000 sold into them
  const w1 = walkBook(book.bids, 1_000, MID, "sell");
  const w10 = walkBook(book.bids, 10_000, MID, "sell");
  assert.ok(typeof w1 === "number" && Math.abs(w1 - 0.4735521) < 1e-4, `got ${w1}`);
  assert.ok(typeof w10 === "number" && Math.abs(w10 - 0.6931358) < 1e-4, `got ${w10}`);
  // buying from the asks costs 0.8529759 bp at $10,000: the asks are not the bids
  const b10 = walkBook(book.asks, 10_000, MID, "buy");
  assert.ok(typeof b10 === "number" && Math.abs(b10 - 0.8529759) < 1e-4, `got ${b10}`);
  assert.ok(Math.abs((b10 as number) - (w10 as number)) > 0.1);
  const rt = roundTripBp(book.bids, book.asks, 10_000);
  assert.ok(typeof rt === "number" && Math.abs(rt - (0.6931358 + 0.8529759)) < 2e-4, `got ${rt}`);
});

test("an empty book, a one-level book and a size beyond 250 levels are unfillable, never 0", () => {
  assert.equal(walkBook([], 10_000, MID, "sell"), "unfillable");
  assert.equal(walkBook([{ price: 211.16, size: 1 }], 10_000, MID, "sell"), "unfillable");
  assert.equal(walkBook(book.bids, 50_000_000, MID, "sell"), "unfillable");
  assert.equal(walkBook([{ price: 211.16, size: 0 }], 100, MID, "sell"), "unfillable");
  assert.equal(roundTripBp([], book.asks, 1_000), "unfillable");
  assert.equal(roundTripBp(book.bids, [], 1_000), "unfillable");
  assert.equal(midOf({ bids: [], asks: book.asks }), null);
  // the same walk fills when the book is deep enough: the checks above are not just always-unfillable
  assert.equal(walkBook([{ price: 211.16, size: 100 }], 10_000, MID, "sell") !== "unfillable", true);
});

test("levels arrive in any order and are walked best first", () => {
  const shuffled = [...book.bids].reverse();
  assert.equal(walkBook(shuffled, 10_000, MID, "sell"), walkBook(book.bids, 10_000, MID, "sell"));
});

// ---- carry -----------------------------------------------------------------------------------------------------------------

const aaplRows = parseFundings(aaplFx);
const aaplMark = perps.find((p) => p.symbol === "AAPL")!.markPrice;

test("AAPL rows paid in direction 'short' give a negative carry for a short over 65.5 h; 'long' rows give a positive one", () => {
  const shortRows = aaplRows.filter((r) => r.direction === "short");
  const longRows = aaplRows.filter((r) => r.direction === "long");
  assert.ok(shortRows.length >= 30 && longRows.length >= 30);
  const neg = carryBp(shortRows, 65.5, aaplMark);
  const pos = carryBp(longRows, 65.5, aaplMark);
  assert.ok(neg < 0 && Math.abs(neg - -8.935484) < 1e-3, `short rows ${neg}`);
  assert.ok(pos > 0 && Math.abs(pos - 4.17588) < 1e-3, `long rows ${pos}`);
  const all = carryBp(aaplRows, 65.5, aaplMark);
  assert.ok(Math.abs(all - 2.121767) < 1e-3, `all rows ${all}`);
  assert.equal(carryUsd(all, 10_000), (all / 1e4) * 10_000);
  assert.throws(() => carryBp([], 65.5, aaplMark));
});

test("margin interest is the borrowed share of the notional at the borrow rate for the hours held", () => {
  const m = marginCarryBp(10_000, 5, 25, 65);
  assert.ok(Math.abs(m.usd - (2_000 * 0.25 * 65) / 8760) < 1e-9);
  assert.ok(Math.abs(m.bp - 3.7100) < 1e-3);
  assert.throws(() => marginCarryBp(10_000, 0.5, 25, 65));
});

// ---- the weekend -----------------------------------------------------------------------------------------------------------

test("weekendWindow follows New York's clock: close 20:00Z in EDT and 21:00Z in EST", () => {
  const a = weekendWindow(new Date("2026-10-23T12:00:00Z"));
  assert.equal(a.closeAt.toISOString(), "2026-10-23T20:00:00.000Z");
  assert.equal(a.openAt.toISOString(), "2026-10-26T13:30:00.000Z");
  assert.equal(a.unwindAt.toISOString(), "2026-10-26T13:00:00.000Z");
  assert.equal(a.hours, 65);
  const b = weekendWindow(new Date("2026-11-06T12:00:00Z"));
  assert.equal(b.closeAt.toISOString(), "2026-11-06T21:00:00.000Z");
  assert.equal(b.openAt.toISOString(), "2026-11-09T14:30:00.000Z");
  assert.equal(b.unwindAt.toISOString(), "2026-11-09T14:00:00.000Z");
  assert.equal(b.hours, 65);
  // the week the clocks go back: Friday still EDT, Monday already EST, so the weekend is an hour longer
  const c = weekendWindow(new Date("2026-10-30T12:00:00Z"));
  assert.equal(c.closeAt.toISOString(), "2026-10-30T20:00:00.000Z");
  assert.equal(c.unwindAt.toISOString(), "2026-11-02T14:00:00.000Z");
  assert.equal(c.hours, 66);
});

test("weekendWindow stays on the current weekend until its unwind has passed", () => {
  assert.equal(weekendWindow(new Date("2026-10-24T15:00:00Z")).closeAt.toISOString(), "2026-10-23T20:00:00.000Z");
  assert.equal(weekendWindow(new Date("2026-10-26T12:59:00Z")).unwindAt.toISOString(), "2026-10-26T13:00:00.000Z");
  assert.equal(weekendWindow(new Date("2026-10-26T13:01:00Z")).closeAt.toISOString(), "2026-10-30T20:00:00.000Z");
  assert.equal(weekendWindow(new Date("2026-10-23T12:00:00Z"), 0).unwindAt.toISOString(), "2026-10-26T13:30:00.000Z");
});

test("after Friday's close the hours run from now, not from the close", () => {
  // Saturday 00:08Z: 4 h 8 min after the close, so 65 - 4.1333 = 60.8667 h to Monday 13:00Z
  const sat = weekendWindow(new Date("2026-10-24T00:08:00Z"));
  assert.equal(sat.closeAt.toISOString(), "2026-10-23T20:00:00.000Z");
  assert.equal(sat.startAt.toISOString(), "2026-10-24T00:08:00.000Z");
  assert.equal(sat.unwindAt.toISOString(), "2026-10-26T13:00:00.000Z");
  assert.ok(Math.abs(sat.hours - (65 - (4 + 8 / 60))) < 1e-9, `hours ${sat.hours}`);
  // Sunday 18:00Z: 19 h left
  const sun = weekendWindow(new Date("2026-10-25T18:00:00Z"));
  assert.equal(sun.startAt.toISOString(), "2026-10-25T18:00:00.000Z");
  assert.equal(sun.hours, 19);
  // before the close the start is the close itself, and a weekend that has not begun is the full 65 h
  const thu = weekendWindow(new Date("2026-10-22T12:00:00Z"));
  assert.equal(thu.startAt.toISOString(), thu.closeAt.toISOString());
  assert.equal(thu.hours, 65);
});

test("the funding and margin interest of a plan are priced for the hours left, not the hours since the close", () => {
  const sat = planHedge(input({ now: new Date("2026-10-24T00:08:00Z"), borrowApr: { pct: 25, source: "Morpho borrowRateView via aprPct", fetchedAt: "2026-10-24T00:08:00Z" } }));
  const thu = planHedge(input({ now: new Date("2026-10-23T12:00:00Z"), borrowApr: { pct: 25, source: "Morpho borrowRateView via aprPct", fetchedAt: "2026-10-23T12:00:00Z" } }));
  assert.ok(sat.status === "ok" && thu.status === "ok");
  if (sat.status !== "ok" || thu.status !== "ok") return;
  assert.equal(thu.window.hours, 65);
  assert.ok(Math.abs(sat.window.hours - 60.8667) < 1e-3);
  const ratio = sat.window.hours / thu.window.hours;
  assert.ok(Math.abs((sat.carry.value!.bp / thu.carry.value!.bp) - ratio) < 1e-9, "funding scales with the hours held");
  assert.ok(Math.abs((sat.marginCarry.value.bp / thu.marginCarry.value.bp) - ratio) < 1e-9, "margin interest scales with the hours held");
});

test("isWeekendHour picks the Friday close to the Monday unwind hours", () => {
  const h = (iso: string) => isWeekendHour(Date.parse(iso) / 1000);
  assert.equal(h("2026-10-23T19:00:00Z"), false);
  assert.equal(h("2026-10-23T20:00:00Z"), true);
  assert.equal(h("2026-10-25T03:00:00Z"), true);
  assert.equal(h("2026-10-26T12:00:00Z"), true);
  assert.equal(h("2026-10-26T13:00:00Z"), false);
  assert.equal(h("2026-11-06T20:00:00Z"), false);
  assert.equal(h("2026-11-06T21:00:00Z"), true);
});

// ---- which tokens ----------------------------------------------------------------------------------------------------------

test("hedgeable over the real universe: 15 of 17 have a perp, GME and MSTR none, TSLA a perp without margin, NVDA with", () => {
  assert.equal(universe.vaults.length, 17);
  const rows = hedgeable(universe.vaults, perps, assets);
  assert.ok(rows.length > 0);
  assert.equal(rows.length, 17);
  assert.equal(rows.filter((r) => r.perp !== "no_perp").length, 15);
  const by = (s: string) => rows.find((r) => r.symbol === s)!;
  assert.equal(by("GME").perp, "no_perp");
  assert.equal(by("MSTR").perp, "no_perp");
  assert.equal(by("TSLA").perp, 16);
  assert.equal(by("TSLA").marginEligible, false);
  assert.equal(by("NVDA").perp, 15);
  assert.equal(by("NVDA").marginEligible, true);
  assert.equal(by("NVDA").userCapTokens, 60);
  assert.ok(Math.abs((by("NVDA").globalRoom ?? 0) - (500 - 80.84234878)) < 1e-6);
  assert.equal(by("GME").marginEligible, false);
  assert.equal(by("GME").userCapTokens === null || typeof by("GME").userCapTokens === "number", true);
  // a perp that is not active is not hedgeable
  const frozen = hedgeable(universe.vaults, perps.map((p) => (p.symbol === "NVDA" ? { ...p, status: "frozen" } : p)), assets);
  assert.equal(frozen.find((r) => r.symbol === "NVDA")!.perp, "no_perp");
});

// ---- the plan --------------------------------------------------------------------------------------------------------------

const src = (f: { _source: { url: string; fetchedAt: string } }) => ({ url: f._source.url, fetchedAt: f._source.fetchedAt });
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  symbol: "NVDA",
  token: universe.vaults.find((v) => v.symbol === "NVDA")!.token,
  balanceRaw: 47_000_000_000_000_000_000n,
  tokenDecimals: 18,
  uiMultiplier: wad("1.000775159164630595"),
  uiMultiplierRead: { source: "eth_call uiMultiplier() on the NVDA Stock Token", fetchedAt: "2026-10-23T23:23:03Z" },
  now: new Date("2026-10-23T23:25:00Z"),
  perps: { data: perps, ...src(obdFx) },
  assets: { data: assets, ...src(assetFx) },
  book: { data: book, ...src(bookFx) },
  fundings: { data: parseFundings(nvdaFundFx), ...src(nvdaFundFx) },
  ...over,
});

test("planHedge for 47 NVDA: sized, priced at that size, every line carries its source and time", () => {
  const p = planHedge(input());
  assert.equal(p.status, "ok");
  if (p.status !== "ok") return;
  assert.equal(p.marketId, 15);
  assert.equal(p.side, "short");
  assert.equal(p.size.value.shares, "47.0364");
  // the default read time, Friday 23:25Z, is after the 20:00Z close: the hours left to Monday 13:00Z, not the 65 from the close
  assert.equal(p.window.startAt, "2026-10-23T23:25:00.000Z");
  assert.equal(p.window.closeAt, "2026-10-23T20:00:00.000Z");
  assert.ok(Math.abs(p.window.hours - (61 + 35 / 60)) < 1e-9, `hours ${p.window.hours}`);
  assert.ok(p.notionalUsd.value > 9_900 && p.notionalUsd.value < 9_960, `notional ${p.notionalUsd.value}`);
  assert.ok(typeof p.slippage.value.roundTripBp === "number" && p.slippage.value.roundTripBp > 1 && p.slippage.value.roundTripBp < 3);
  assert.equal(p.fees.value.bp, 0);
  assert.equal(p.stockMargin.value.eligible, true);
  assert.ok(p.marginUsdg.value > 1_900 && p.marginUsdg.value < 2_000);
  assert.ok(p.carry.value !== null && p.carry.value.weekendRows >= 24);
  assert.ok(typeof p.netBp === "number" && p.netUsd !== null);
  for (const l of [p.size, p.notionalUsd, p.marginUsdg, p.stockMargin, p.slippage, p.fees, p.carry, p.marginCarry]) {
    assert.ok(l.source.length > 0 && /^\d{4}-\d\d-\d\dT/.test(l.fetchedAt));
  }
  assert.equal(p.carry.source, nvdaFundFx._source.url);
  assert.equal(p.slippage.source, bookFx._source.url);
  assert.equal(p.marginCarry.value.borrowed, false);
});

test("a borrower's plan is cheaper by exactly the margin interest, read from the Morpho rate it is given", () => {
  const own = planHedge(input());
  const borrowed = planHedge(input({ borrowApr: { pct: 25, source: "Morpho borrowRateView via aprPct", fetchedAt: "2026-10-23T23:24:00Z" } }));
  assert.ok(own.status === "ok" && borrowed.status === "ok");
  if (own.status !== "ok" || borrowed.status !== "ok") return;
  assert.equal(borrowed.marginCarry.value.borrowed, true);
  assert.equal(borrowed.marginCarry.source, "Morpho borrowRateView via aprPct");
  const bp = marginCarryBp(own.notionalUsd.value, 5, 25, own.window.hours).bp;
  assert.ok(Math.abs(borrowed.marginCarry.value.bp - bp) < 1e-9);
  assert.ok(Math.abs((own.netBp as number) - (borrowed.netBp as number) - bp) < 1e-9);
});

test("a short over min_base_amount but worth under min_quote_amount ($10) is below_min, and at $10 it is placed", () => {
  const nvda = perps.find((m) => m.symbol === "NVDA")!;
  assert.equal(nvda.minQuoteAmount, 10);
  const mid = midOf(book)!;
  // 0.0450 shares passes the 0.0400 base minimum and is worth about $9.5
  const under = planHedge(input({ balanceRaw: 45_000_000_000_000_000n, uiMultiplier: wad("1") }));
  assert.ok(under.status === "below_min", under.status);
  if (under.status !== "below_min") return;
  assert.equal(under.limit, "min_quote_amount");
  assert.equal(under.minQuoteUsd.value, 10);
  assert.ok(0.045 * mid < 10 && 0.045 >= Number(nvda.minBaseAmount));
  // 0.0500 shares is worth about $10.6
  const over = planHedge(input({ balanceRaw: 50_000_000_000_000_000n, uiMultiplier: wad("1") }));
  assert.ok(0.05 * mid > 10);
  assert.equal(over.status, "ok");
});

test("planHedge refuses what it cannot size or price: no perp, below the minimum, leverage over the market's, a thin history, a nonzero fee of unknown unit", () => {
  assert.deepEqual(planHedge(input({ symbol: "GME" })), { status: "no_perp", symbol: "GME" });
  const small = planHedge(input({ balanceRaw: 10_000_000_000_000_000n }));
  assert.equal(small.status, "below_min");
  assert.ok(small.status === "below_min" && small.limit === "min_base_amount");
  assert.throws(() => planHedge(input({ leverage: 50 })), /allows 1x to 20x/);
  const thin = planHedge(input({ fundings: { data: parseFundings(nvdaFundFx).slice(-10), ...src(nvdaFundFx) } }));
  assert.ok(thin.status === "ok" && thin.carry.value === null && thin.netBp === null);
  const fee = planHedge(input({ perps: { data: perps.map((m) => (m.symbol === "NVDA" ? { ...m, takerFee: "0.0200" } : m)), ...src(obdFx) } }));
  assert.ok(fee.status === "ok" && fee.fees.value.bp === null && fee.netBp === null);
  const empty = () => planHedge(input({ book: { data: { bids: [], asks: book.asks }, ...src(bookFx) } }));
  assert.throws(empty, /empty side/);
  const thick = planHedge(input({ balanceRaw: 100_000_000_000_000_000_000_000n }));
  assert.ok(thick.status === "ok" && thick.slippage.value.roundTripBp === "unfillable" && thick.netBp === null);
});

// ---- the hand-off to the holder's own agent ------------------------------------------------------------------------------------

/** The deepest bid a sell of `usd` reaches, walked here from the recorded book and not by the planner. */
function deepestBid(usd: number): number {
  let rem = usd;
  let last = NaN;
  for (const l of [...book.bids].sort((a, b) => b.price - a.price)) {
    rem -= l.price * l.size;
    last = l.price;
    if (rem <= 0) return last;
  }
  throw new Error("recorded book too thin for this size");
}

const okPlan = (over: Partial<PlanInput> = {}) => {
  const p = planHedge(input(over));
  assert.ok(p.status === "ok", p.status);
  return p;
};

test("the proposal carries the plan's size, leverage, costs and exit time unchanged, and names the market the way lighter-agent-kit does", () => {
  const p = okPlan();
  const x = p.proposal;
  assert.ok(x !== null);
  assert.equal(x.status, "proposed");
  assert.equal(x.venue, "lighter-robinhood-chain");
  assert.equal(x.api_host, "https://api.rh.lighter.xyz");
  // the kit takes a perp as the bare ticker Lighter lists; a spot pair would carry a slash
  assert.deepEqual(x.market, { symbol: "NVDA", market_id: 15, type: "perp" });
  assert.ok(!x.market.symbol.includes("/"));
  assert.equal(x.side, "sell");
  assert.equal(x.size.base, p.size.value.shares);
  assert.equal(x.size.base, "47.0364");
  assert.equal(x.size.notional_usd, Math.round(p.notionalUsd.value * 100) / 100);
  assert.deepEqual(x.leverage, { suggested: 5, max: 20, margin_mode: "cross" });
  assert.equal(x.margin_usdg, Math.round(p.marginUsdg.value * 100) / 100);
  assert.equal(x.exit_by, p.window.unwindAt);
  assert.equal(x.exit_by, "2026-10-26T13:00:00.000Z");
  assert.deepEqual(x.exit, { side: "buy", reduce_only: true, size: "47.0364" });
  const c = x.estimated_costs;
  assert.equal(c.slippage_bp, Math.round((p.slippage.value.roundTripBp as number) * 100) / 100);
  assert.equal(c.fees_bp, 0);
  assert.equal(c.funding_bp, Math.round(p.carry.value!.bp * 100) / 100);
  assert.equal(c.funding_direction, p.carry.value!.bp >= 0 ? "earns" : "pays");
  assert.equal(c.margin_borrow_bp, 0);
  assert.equal(c.net_bp, Math.round(p.netBp! * 100) / 100);
  assert.ok(Math.abs(c.net_bp! - (c.funding_bp! - c.slippage_bp - c.fees_bp! - c.margin_borrow_bp)) < 0.02);
});

test("the protective limit is the deepest bid the order walks less the buffer, floored to the tick, and sits below the expected fill", () => {
  const p = okPlan();
  const x = p.proposal!;
  const worst = deepestBid(p.notionalUsd.value);
  const expected = (Math.floor(worst * (1 - PROTECTIVE_BUFFER_BP / 1e4) * 100 + 1e-6) / 100).toFixed(2);
  assert.equal(x.order.limit_price, expected);
  assert.match(x.order.limit_price, /^\d+\.\d{2}$/, "NVDA quotes two price decimals");
  assert.equal(worstPrice(book.bids, p.notionalUsd.value, "sell"), worst);
  const mid = midOf(book)!;
  assert.equal(x.order.reference_mid, mid.toFixed(2));
  assert.ok(Number(x.order.limit_price) < Number(x.order.expected_avg_fill_price));
  assert.ok(Number(x.order.expected_avg_fill_price) <= mid);
  // the average fill is the one slippage.openBp prices: mid less open bp
  const openBp = p.slippage.value.openBp as number;
  assert.ok(Math.abs(Number(x.order.expected_avg_fill_price) - mid * (1 - openBp / 1e4)) < 0.006);
  assert.equal(x.order.type, "limit");
  assert.equal(x.order.reduce_only, false);
});

test("a size that walks many levels gets a deeper limit than a size that fits in the first one", () => {
  const small = okPlan({ balanceRaw: 1_000_000_000_000_000_000n }).proposal!;
  const big = okPlan({ balanceRaw: 1_200_000_000_000_000_000_000n });
  assert.ok(big.slippage.value.roundTripBp !== "unfillable", "the recorded 250 levels cover about 1,200 shares");
  const b = big.proposal!;
  const bestBid = Math.max(...book.bids.map((l) => l.price));
  assert.ok(Number(small.order.limit_price) > Number(b.order.limit_price));
  assert.ok(Number(b.order.limit_price) < bestBid * (1 - PROTECTIVE_BUFFER_BP / 1e4) - 0.005, "deeper than the buffer alone");
  assert.equal(b.order.limit_price, (Math.floor(deepestBid(big.notionalUsd.value) * (1 - PROTECTIVE_BUFFER_BP / 1e4) * 100 + 1e-6) / 100).toFixed(2));
  assert.ok(b.estimated_costs.slippage_bp > small.estimated_costs.slippage_bp);
});

test("the liquidation estimate is above the entry for a short, solves equity = maintenance margin, and falls as leverage rises", () => {
  const five = okPlan().proposal!;
  const ten = okPlan({ leverage: 10 }).proposal!;
  const one = okPlan({ leverage: 1 }).proposal!;
  const entry = Number(five.order.expected_avg_fill_price);
  const m = perps.find((q) => q.symbol === "NVDA")!.maintenanceMarginFraction / 1e4;
  assert.equal(m, 0.03);
  // equity at the liquidation price: margin less the loss on the short, against maintenance margin on the position then worth
  const equity = (liq: number, lev: number) => entry / lev - (liq - entry);
  assert.ok(Math.abs(equity(five.estimated_liquidation_price, 5) - m * five.estimated_liquidation_price) < 0.01);
  assert.ok(five.estimated_liquidation_price > entry * 1.15 && five.estimated_liquidation_price < entry * 1.25);
  assert.ok(ten.estimated_liquidation_price < five.estimated_liquidation_price);
  assert.ok(one.estimated_liquidation_price > five.estimated_liquidation_price);
  assert.equal(ten.leverage.suggested, 10);
  assert.ok(five.risk_notes.some((n) => n.includes(five.estimated_liquidation_price.toFixed(2))));
});

test("valid_until is ten minutes after the book was read, and never later than the exit", () => {
  const x = okPlan().proposal!;
  assert.equal(PROPOSAL_VALID_MINUTES, 10);
  assert.equal(x.market_data_at, bookFx._source.fetchedAt);
  assert.equal(Date.parse(x.valid_until) - Date.parse(x.market_data_at), 10 * 60_000);
  const late = "2026-10-26T12:55:00Z";
  const l = okPlan({ now: new Date(late), book: { data: book, url: bookFx._source.url, fetchedAt: late } }).proposal!;
  assert.equal(l.valid_until, "2026-10-26T13:00:00.000Z");
  assert.equal(l.valid_until, l.exit_by);
});

test("risk notes say it is a proposal, give the funding sign and the exit, and a nonzero fee string leaves the fee figure null", () => {
  const x = okPlan().proposal!;
  assert.match(x.risk_notes[0], /not an executed hedge/);
  assert.match(x.risk_notes[0], /holds no keys/);
  assert.ok(x.risk_notes.some((n) => n.startsWith("Funding: past weekends") && /paid a short|charged a short/.test(n)));
  assert.ok(x.risk_notes.some((n) => n.includes(x.exit_by)));
  const fee = okPlan({ perps: { data: perps.map((m) => (m.symbol === "NVDA" ? { ...m, takerFee: "0.0200" } : m)), ...src(obdFx) } }).proposal!;
  assert.equal(fee.estimated_costs.fees_bp, null);
  assert.equal(fee.estimated_costs.fees_usd, null);
  assert.equal(fee.estimated_costs.net_bp, null);
  assert.ok(!agentInstruction(fee).includes("--tier standard"), "paper keeps its own fee tier when Lighter's fee is not zero");
});

test("no proposal where there is nothing to place: below the minimum has no proposal field at all, a book that cannot fill the size has a null one", () => {
  const small = planHedge(input({ balanceRaw: 10_000_000_000_000_000n }));
  assert.equal(small.status, "below_min");
  assert.ok(!("proposal" in small));
  const quote = planHedge(input({ balanceRaw: 45_000_000_000_000_000n, uiMultiplier: wad("1") }));
  assert.equal(quote.status, "below_min");
  assert.ok(!("proposal" in quote));
  assert.deepEqual(planHedge(input({ symbol: "GME" })), { status: "no_perp", symbol: "GME" });
  const thick = planHedge(input({ balanceRaw: 100_000_000_000_000_000_000_000n }));
  assert.ok(thick.status === "ok" && thick.proposal === null);
  // only the close side too thin: the sell fills but the buy back does not, so the cost and the proposal are both withheld
  const noAsks = planHedge(input({ book: { data: { bids: book.bids, asks: book.asks.slice(0, 1) }, ...src(bookFx) } }));
  assert.ok(noAsks.status === "ok" && noAsks.slippage.value.roundTripBp === "unfillable" && noAsks.proposal === null);
});

test("a symbol that is not a bare ticker is refused before it can reach an instruction", () => {
  const p = okPlan();
  for (const bad of ["NVDA/USDG", "NVDA; rm -rf ~", "nvda", "", "A".repeat(13)]) {
    assert.throws(() => proposeExecution({ ...p, symbol: bad }, perps.find((q) => q.symbol === "NVDA")!, input().book), /bare ticker/, JSON.stringify(bad));
  }
});

test("the agent instruction names market, side, size, leverage, limit and the exit, tells the agent to paper trade first, and claims nothing was executed", () => {
  const x = okPlan().proposal!;
  const t = agentInstruction(x);
  for (const must of [
    "lighter-agent-kit",
    "LIGHTER_HOST=https://api.rh.lighter.xyz",
    "NVDA perp (market_id 15)",
    "Side: sell (short)",
    `Size: ${x.size.base} NVDA`,
    `limit sell at ${x.order.limit_price} or higher`,
    `Leverage: 5x cross (the market allows up to 20x)`,
    `Valid until: ${x.valid_until}`,
    `Exit by: ${x.exit_by}. Check the position every few hours and close by ${x.exit_by}`,
    "Paper trade it first",
    `scripts/paper.py init --collateral ${x.margin_usdg} --tier standard`,
    `scripts/paper.py order ioc NVDA --side short --amount ${x.size.base} --price ${x.order.limit_price}`,
    `scripts/trade.py order limit NVDA --side short --amount ${x.size.base} --price ${x.order.limit_price}`,
    "--reduce_only",
    "only after I confirm",
    "not an executed hedge",
    "Uptick placed nothing and holds no keys",
  ]) assert.ok(t.includes(must), `missing: ${must}`);
  assert.ok(!/\bwas executed\b|\bhas been placed\b|\bfilled\b/i.test(t));
  assert.ok(!t.includes(" \u2014 ") && !t.includes(" -- "), "no dash punctuation");
  assert.equal(agentInstruction(x), t, "deterministic");
});

// ---- the reads -------------------------------------------------------------------------------------------------------------

const respond = (body: unknown, ok = true, status = 200) => async () => ({ ok, status, json: async () => body }) as Response;

test("fetchers call Lighter RH's keyless GETs and return the URL and the time they arrived", async () => {
  const urls: string[] = [];
  const now = () => Date.parse("2026-10-23T23:30:00Z");
  const mk = (body: unknown) => async (u: string | URL | Request) => {
    urls.push(String(u));
    return respond(body)();
  };
  const o = await fetchOrderBookDetails({ fetch: mk(obdFx), now });
  assert.equal(o.url, `${LIGHTER_RH.api}/api/v1/orderBookDetails`);
  assert.equal(o.fetchedAt, "2026-10-23T23:30:00.000Z");
  assert.equal(o.data.find((p) => p.symbol === "NVDA")?.marketId, 15);
  assert.equal((await fetchAssetDetails({ fetch: mk(assetFx), now })).data.length, assets.length);
  const b = await fetchOrderBookOrders(15, { fetch: mk(bookFx), now });
  assert.equal(b.url, `${LIGHTER_RH.api}/api/v1/orderBookOrders?market_id=15&limit=250`);
  const f = await fetchFundings(10, { fetch: mk(aaplFx), now });
  assert.match(f.url, /\/api\/v1\/fundings\?market_id=10&resolution=1h&start_timestamp=\d+&end_timestamp=1792798200&count_back=0$/);
  assert.equal(urls.length, 4);
  assert.equal(f.data.length, 300);
});

test("a changed shape, a non-200 answer or an HTTP error throws and nothing defaults to zero", async () => {
  const drop = (k: string) => ({ ...obdFx, order_book_details: obdFx.order_book_details.map((m: Record<string, unknown>) => Object.fromEntries(Object.entries(m).filter(([key]) => key !== k))) });
  for (const k of ["min_base_amount", "min_quote_amount", "size_decimals", "mark_price", "market_id", "taker_fee"]) assert.throws(() => parseOrderBookDetails(drop(k)), /Lighter RH orderBookDetails/, k);
  assert.throws(() => parseAssetDetails({ asset_details: [{ ...assetFx.asset_details[0], loan_to_value: undefined }] }), /loan_to_value/);
  assert.throws(() => parseAssetDetails({ asset_details: [{ ...assetFx.asset_details[0], multiplier: "1,5" }] }), /multiplier/);
  assert.throws(() => parseFundings({ fundings: [{ timestamp: 1, value: "0.1", rate: "0.1", direction: "flat" }] }), /direction/);
  assert.throws(() => parseOrderBook({ bids: [{ price: "1" }], asks: [] }), /remaining_base_amount/);
  assert.throws(() => parseOrderBook({ asks: [] }), /bids/);
  await assert.rejects(fetchOrderBookDetails({ fetch: respond({ code: 500 }) }), /code 500/);
  await assert.rejects(fetchOrderBookDetails({ fetch: respond({}, false, 429) }), /HTTP 429/);
  await assert.rejects(fetchOrderBookDetails({ fetch: respond({ code: 200, order_book_details: "x" }) }), /expected an array/);
});

// ---- on chain ---------------------------------------------------------------------------------------------------------------

test("readMultipliers reads every token in one Multicall3 at the scan block; a revert or a zero leaves that token unsized with its reason", async () => {
  const tokens = ["0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", "0x322F0929c4625eD5bAd873c95208D54E1c003b2d"] as Address[];
  const calls: { n: number; block: bigint | undefined; to: unknown }[] = [];
  const client = {
    multicall: (async (a: { contracts: unknown[]; allowFailure: boolean; blockNumber?: bigint; multicallAddress?: Address }) => {
      calls.push({ n: a.contracts.length, block: a.blockNumber, to: a.multicallAddress });
      assert.equal(a.allowFailure, true);
      return [
        { status: "success", result: 1_000_775_159_164_630_595n },
        { status: "failure", error: new Error("execution reverted") },
        { status: "success", result: 0n },
      ];
    }) as never,
  };
  const r = await readMultipliers(client, tokens, 93_100_000n);
  assert.deepEqual(calls, [{ n: 3, block: 93_100_000n, to: MULTICALL3 }]);
  assert.deepEqual(r[0], { ok: true, multiplier: 1_000_775_159_164_630_595n });
  assert.ok(!r[1].ok && /reverted/.test(r[1].reason));
  assert.ok(!r[2].ok && /zero/.test(r[2].reason));
  assert.deepEqual(await readMultipliers(client, [], 1n), []);
});

test("stockLegOfShares is the stock half of redeemInKind: idle, in the position and in fees, pro rata", () => {
  const h = { supply: 1000n, idleStock: 100n, idleUsdg: 40n, positionStock: 500n, positionUsdg: 300n, feesStock: 10n, feesUsdg: 20n };
  assert.equal(stockLegOfShares(h, 100n), 61n);
  assert.equal(stockLegOfShares(h, 0n), null);
  assert.equal(stockLegOfShares(h, 1001n), null);
  assert.equal(stockLegOfShares({ ...h, supply: 0n }, 1n), null);
});
