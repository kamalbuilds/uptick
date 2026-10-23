import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, getAddress, parseUnits, type Address } from "viem";
import {
  BORROW_CAP_BPS, MORPHO_BLUE, borrowAtBps, borrowRoom, collateralFromQuote, collateralValue, debtAssets, earnAndBorrowSteps, marketId, marketLiquidity,
  isBatchUnsupported, maxBorrowOf, morphoAbi, parseMarkets, positionRisk, sharePriceUsd, supportsAtomicBatch, marketFor, type FlowPlan, type MarketParams,
} from "./morpho.ts";
import { erc20Abi, vaultAbi } from "./abis.ts";

const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const TOKEN: Address = "0x12f190a9F9d7D37a250758b26824B97CE941bF54";
const VAULT = getAddress("0x00000000000000000000000000000000000a11c3");
const ME = getAddress("0x00000000000000000000000000000000000b0b01");
const ORACLE: Address = "0xB1E9aE2B51875b5A0Af7290189Bdd77F9758eE3A";
const IRM: Address = "0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1";
const LLTV = 625_000_000_000_000_000n;

// The live USDG/AMZN market on Morpho Blue 4663, id read from the chain (blue-api marketId, idToMarketParams at block 95888686).
const AMZN_MARKET: MarketParams = { loanToken: USDG, collateralToken: TOKEN, oracle: ORACLE, irm: IRM, lltv: LLTV };
const AMZN_ID = "0xff762c8aee3849902b33d8ec6432668f19f88b755bf3dbf186f66a2cac7750ca";
// That oracle's price() at the same block: 250.6544 USDG per whole 18-decimal token, in the 1e36 scale.
const AMZN_PRICE = 250_654_400_000_000_000_000_000_000n;

const market: MarketParams = { loanToken: USDG, collateralToken: VAULT, oracle: ORACLE, irm: IRM, lltv: LLTV };
const plan = (over: Partial<FlowPlan> = {}): FlowPlan => ({
  symbol: "AMZN", token: TOKEN, vault: VAULT, market, account: ME,
  deposit: parseUnits("2", 18), collateral: parseUnits("1.99", 24), borrow: parseUnits("100", 6),
  tokenAllowance: 0n, shareAllowance: 0n, ...over,
});

test("market id of the live USDG/AMZN market matches the id Morpho holds on-chain", () => {
  assert.equal(marketId(AMZN_MARKET), AMZN_ID);
  assert.notEqual(marketId({ ...AMZN_MARKET, lltv: LLTV + 1n }), AMZN_ID);
});

test("the batch is approve token, deposit, approve shares, supplyCollateral, borrow, and every call decodes to the plan", () => {
  const p = plan();
  const steps = earnAndBorrowSteps(p);
  assert.deepEqual(steps.map((s) => s.id), ["approve-token", "deposit", "approve-shares", "supply-collateral", "borrow"]);
  assert.deepEqual(steps.map((s) => s.call.to), [TOKEN, VAULT, VAULT, MORPHO_BLUE, MORPHO_BLUE]);

  const a1 = decodeFunctionData({ abi: erc20Abi, data: steps[0].call.data });
  assert.equal(a1.functionName, "approve");
  assert.deepEqual(a1.args, [VAULT, p.deposit]);

  const dep = decodeFunctionData({ abi: vaultAbi, data: steps[1].call.data });
  assert.equal(dep.functionName, "deposit");
  assert.deepEqual(dep.args, [p.deposit, ME]);

  const a2 = decodeFunctionData({ abi: erc20Abi, data: steps[2].call.data });
  assert.deepEqual(a2.args, [MORPHO_BLUE, p.collateral]);

  const sup = decodeFunctionData({ abi: morphoAbi, data: steps[3].call.data });
  assert.equal(sup.functionName, "supplyCollateral");
  const [mp, assets, onBehalf, data] = sup.args as unknown as [MarketParams, bigint, Address, string];
  assert.equal(marketId(mp), marketId(market));
  assert.equal(assets, p.collateral);
  assert.equal(onBehalf, ME);
  assert.equal(data, "0x");

  const bor = decodeFunctionData({ abi: morphoAbi, data: steps[4].call.data });
  assert.equal(bor.functionName, "borrow");
  const [bmp, bAssets, bShares, bOnBehalf, receiver] = bor.args as unknown as [MarketParams, bigint, bigint, Address, Address];
  assert.equal(marketId(bmp), marketId(market));
  assert.equal(bAssets, p.borrow);
  assert.equal(bShares, 0n, "borrow is by assets, never by shares");
  assert.equal(bOnBehalf, ME);
  assert.equal(receiver, ME, "borrowed USDG lands in the borrower's wallet");
});

test("allowances that already cover an amount skip the approval, and a short one does not", () => {
  const ids = (o: Partial<FlowPlan>) => earnAndBorrowSteps(plan(o)).map((s) => s.id);
  assert.deepEqual(ids({ tokenAllowance: parseUnits("2", 18), shareAllowance: parseUnits("1.99", 24) }), ["deposit", "supply-collateral", "borrow"]);
  assert.deepEqual(ids({ tokenAllowance: parseUnits("2", 18) - 1n }), ["approve-token", "deposit", "approve-shares", "supply-collateral", "borrow"]);
  assert.deepEqual(ids({ shareAllowance: parseUnits("1.99", 24) - 1n, tokenAllowance: parseUnits("2", 18) }), ["deposit", "approve-shares", "supply-collateral", "borrow"]);
});

test("zero borrow is the earn-only deposit: no share approval, no collateral, no borrow", () => {
  assert.deepEqual(earnAndBorrowSteps(plan({ borrow: 0n })).map((s) => s.id), ["approve-token", "deposit"]);
});

test("the flow refuses a market whose collateral is not this vault's share, and a zero deposit", () => {
  assert.throws(() => earnAndBorrowSteps(plan({ market: { ...market, collateralToken: TOKEN } })), /not this vault/);
  assert.throws(() => earnAndBorrowSteps(plan({ deposit: 0n })), /deposit must be positive/);
  assert.throws(() => earnAndBorrowSteps(plan({ collateral: 0n })), /collateral must be positive/);
});

test("max borrow is collateral value times LLTV, rounded down, as Morpho computes it", () => {
  const collateral = parseUnits("2", 18);
  // 2 tokens at 250.6544 = 501.3088 USDG; 62.5% of that is 313.318 USDG.
  assert.equal(collateralValue(collateral, AMZN_PRICE), 501_308_800n);
  assert.equal(maxBorrowOf(collateral, AMZN_PRICE, LLTV), 313_318_000n);
  assert.equal(maxBorrowOf(0n, AMZN_PRICE, LLTV), 0n);
  assert.equal(maxBorrowOf(collateral, AMZN_PRICE, 0n), 0n);
});

test("a vault share at 24 decimals prices the same way: $200 a share, 3 shares, 62.5%", () => {
  const price = (200n * 10n ** 6n * 10n ** 36n) / 10n ** 24n; // the share oracle's scale comment: 2e20
  assert.equal(price, 2n * 10n ** 20n);
  assert.equal(sharePriceUsd(price, 24, 6), 200);
  assert.equal(maxBorrowOf(3n * 10n ** 24n, price, LLTV), 375_000_000n);
});

test("the borrow slider stops at 75% of the limit, less what is already owed, and at the market's liquidity", () => {
  const collateral = parseUnits("2", 18);
  const limit = 313_318_000n;
  const open = borrowRoom({ collateral, price: AMZN_PRICE, lltv: LLTV, debt: 0n, liquidity: 10n ** 12n });
  assert.equal(open.maxBorrow, limit);
  assert.equal(open.cap, (limit * BORROW_CAP_BPS) / 10_000n);
  assert.equal(open.liquidityBound, false);

  const owed = borrowRoom({ collateral, price: AMZN_PRICE, lltv: LLTV, debt: 100_000_000n, liquidity: 10n ** 12n });
  assert.equal(owed.cap, open.cap - 100_000_000n);

  const overOwed = borrowRoom({ collateral, price: AMZN_PRICE, lltv: LLTV, debt: limit, liquidity: 10n ** 12n });
  assert.equal(overOwed.cap, 0n);

  const thin = borrowRoom({ collateral, price: AMZN_PRICE, lltv: LLTV, debt: 0n, liquidity: 50_000_000n });
  assert.equal(thin.cap, 50_000_000n);
  assert.equal(thin.liquidityBound, true);

  assert.equal(marketLiquidity(100n, 100n), 0n);
  assert.equal(marketLiquidity(100n, 130n), 0n);
  assert.equal(marketLiquidity(130n, 100n), 30n);
});

test("slider positions map to loan amounts of the cap", () => {
  assert.equal(borrowAtBps(200_000_000n, 0), 0n);
  assert.equal(borrowAtBps(200_000_000n, 5_000), 100_000_000n);
  assert.equal(borrowAtBps(200_000_000n, 10_000), 200_000_000n);
});

test("liquidation price is where collateral value times LLTV equals the debt", () => {
  const collateral = parseUnits("2", 18);
  const debt = 200_000_000n;
  const r = positionRisk({ collateral, price: AMZN_PRICE, lltv: LLTV, debt });
  // 200 / (2 * 0.625) = 160 USDG a token, in the 1e36 scale.
  assert.equal(r.liquidationPrice, 160n * 10n ** 6n * 10n ** 18n);
  assert.ok(Math.abs(r.dropToLiquidation! - (1 - 160 / 250.6544)) < 1e-6);
  assert.ok(Math.abs(r.healthFactor! - 313.318 / 200) < 1e-6);
  // At exactly that price the position is still healthy, one tick lower it is not (Morpho: maxBorrow >= borrowed).
  assert.ok(maxBorrowOf(collateral, r.liquidationPrice, LLTV) >= debt);
  assert.ok(maxBorrowOf(collateral, r.liquidationPrice - 1n, LLTV) < debt);
});

test("a position that owes nothing has no liquidation price", () => {
  const r = positionRisk({ collateral: 10n ** 18n, price: AMZN_PRICE, lltv: LLTV, debt: 0n });
  assert.deepEqual(r, { debt: 0n, liquidationPrice: 0n, dropToLiquidation: null, healthFactor: null });
});

test("borrow shares convert to debt rounded up, with Morpho's virtual offsets", () => {
  assert.equal(debtAssets(0n, 0n, 0n), 0n);
  assert.equal(debtAssets(10n ** 6n, 0n, 0n), 1n);
  assert.equal(debtAssets(1_500_000n, 1_000_000n, 1_000_000_000_000n), 2n); // exactly 1.5, rounded up
  assert.equal(debtAssets(3n, 1n, 0n), 1n);
});

test("the collateral posted is the quote less a 0.5% margin", () => {
  assert.equal(collateralFromQuote(1_000_000n), 995_000n);
});

test("market config: empty is valid and means no borrow; an entry needs real addresses and an LLTV under 1", () => {
  assert.deepEqual(parseMarkets({ markets: {} }), {});
  const ok = parseMarkets({ markets: { pltr: { oracle: ORACLE.toLowerCase(), irm: IRM, lltv: "625000000000000000" } } });
  assert.deepEqual(ok.pltr, { oracle: getAddress(ORACLE), irm: IRM, lltv: LLTV });
  const bad = (e: object) => () => parseMarkets({ markets: { pltr: e } });
  assert.throws(bad({ oracle: "0x1234", irm: IRM, lltv: "1" }), /needs oracle/);
  assert.throws(bad({ oracle: ORACLE, irm: IRM, lltv: "1000000000000000000" }), /between 0 and 1e18/);
  assert.throws(bad({ oracle: ORACLE, irm: IRM, lltv: "0" }), /between 0 and 1e18/);
  assert.throws(bad({ oracle: ORACLE, irm: IRM, lltv: 0.625 }), /needs oracle/);
  assert.throws(() => parseMarkets({}), /missing markets/);
  assert.deepEqual(marketFor(ok.pltr, USDG, VAULT), market);
});

test("atomic batching is read from wallet_getCapabilities for the chain, supported or ready", () => {
  assert.equal(supportsAtomicBatch({ 4663: { atomic: { status: "supported" } } }, 4663), true);
  assert.equal(supportsAtomicBatch({ 4663: { atomic: { status: "ready" } } }, 4663), true);
  assert.equal(supportsAtomicBatch({ 4663: { atomic: { status: "unsupported" } } }, 4663), false);
  assert.equal(supportsAtomicBatch({ 1: { atomic: { status: "supported" } } }, 4663), false);
  assert.equal(supportsAtomicBatch({ 4663: {} }, 4663), false);
  assert.equal(supportsAtomicBatch(undefined, 4663), false);
});

test("a wallet that cannot batch falls back to single transactions; a rejection or a revert does not", () => {
  const rpc = (name: string, code: number, cause?: unknown) => Object.assign(new Error(name), { name, code, cause });
  assert.equal(isBatchUnsupported(rpc("UnsupportedProviderMethodError", 4200)), true);
  assert.equal(isBatchUnsupported(rpc("MethodNotSupportedRpcError", -32601)), true);
  assert.equal(isBatchUnsupported(rpc("TransactionExecutionError", 0, rpc("RpcRequestError", 5710))), true, "found through the cause chain");
  assert.equal(isBatchUnsupported(rpc("UserRejectedRequestError", 4001)), false);
  assert.equal(isBatchUnsupported(rpc("ContractFunctionRevertedError", 3)), false);
  assert.equal(isBatchUnsupported("boom"), false);
  assert.equal(isBatchUnsupported(undefined), false);
});
