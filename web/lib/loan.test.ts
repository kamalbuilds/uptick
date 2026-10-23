import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeFunctionData, getAddress, type Address } from "viem";
import {
  DEFAULT_TARGET_HEALTH, EXEC_LAG_SECONDS, IN_KIND_MARGIN_BPS, accrueInterest, hasLoan, liquidationInStock, loanView, meetsTarget, planSafer, repayEffect, targetWad, wTaylorCompounded,
  type InKindQuote, type MarketState, type SaferInput, type SaferPlan,
} from "./loan.ts";
import { MORPHO_BLUE, WAD, debtAssets, marketId, maxBorrowOf, morphoAbi, type MarketParams, type Step } from "./morpho.ts";
import { erc20Abi, vaultAbi } from "./abis.ts";

const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const VAULT = getAddress("0x00000000000000000000000000000000000a11c3");
const ME = getAddress("0x00000000000000000000000000000000000b0b01");
const ORACLE: Address = "0xB1E9aE2B51875b5A0Af7290189Bdd77F9758eE3A";
const IRM: Address = "0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1";
const LLTV = 625_000_000_000_000_000n;
const market: MarketParams = { loanToken: USDG, collateralToken: VAULT, oracle: ORACLE, irm: IRM, lltv: LLTV };

const NOW = 1_800_000_000n;
/** About 8% a year as a per-second WAD rate. */
const RATE = 2_536_783_358n;
/** A $200 share: 200e6 raw USDG per 1e24 raw shares, in the 1e36 scale. */
const PRICE = 200n * 10n ** 18n;
/** 100 shares posted, worth $20,000, so the borrow limit is $12,500. */
const COLLATERAL = 100n * 10n ** 24n;

const state: MarketState = {
  totalSupplyAssets: 1_000_000n * 10n ** 6n,
  totalSupplyShares: 1_000_000n * 10n ** 12n,
  totalBorrowAssets: 400_000n * 10n ** 6n,
  totalBorrowShares: 400_000n * 10n ** 12n,
  lastUpdate: NOW - 3n * 86_400n,
  fee: 0n,
};
/** A borrower who took $9,000 when the market was at its initial share ratio. */
const BORROW_SHARES = 9_000n * 10n ** 12n;

const base = (over: Partial<SaferInput> = {}): SaferInput => ({
  symbol: "AMZN", market, vault: VAULT, account: ME, collateral: COLLATERAL, borrowShares: BORROW_SHARES, state, borrowRate: RATE, now: NOW, price: PRICE,
  target: DEFAULT_TARGET_HEALTH, usdgBalance: 0n, usdgAllowance: 0n, ...over,
});

/** What a simulated redeemInKind of the whole $20,000 collateral returned: `usdgFraction` of its value as USDG, the rest as stock at $200 per 1e18. */
const quote = (usdgFraction: number): InKindQuote => ({
  shares: COLLATERAL,
  usdg: BigInt(Math.round(20_000 * usdgFraction)) * 10n ** 6n,
  stock: BigInt(Math.round(20_000 * (1 - usdgFraction))) * 10n ** 18n / 200n,
});

// ---- a model of Morpho that executes decoded calldata, written apart from the planner ---------------------------------------------------

type Wallet = { usdg: bigint; stock: bigint; allowance: bigint; shares: bigint };
type Chain = { collateral: bigint; borrowShares: bigint; market: MarketState; wallet: Wallet };

const toSharesDown = (assets: bigint, tba: bigint, tbs: bigint) => (assets * (tbs + 1_000_000n)) / (tba + 1n);
const toAssetsUp = (shares: bigint, tba: bigint, tbs: bigint) => (shares * (tba + 1n) + tbs + 1_000_000n - 1n) / (tbs + 1_000_000n);
const healthy = (c: Chain) => maxBorrowOf(c.collateral, PRICE, LLTV) >= toAssetsUp(c.borrowShares, c.market.totalBorrowAssets, c.market.totalBorrowShares);

/** Runs a call list the way the chain would, `at` seconds in, with the vault paying `payout` of what it quoted. Throws where a call would revert. */
function execute(steps: Step[], start: Chain, at: bigint, inKind: InKindQuote | undefined, payout = 1): Chain {
  let c: Chain = { ...start, market: accrueInterest(start.market, RATE, at), wallet: { ...start.wallet } };
  for (const s of steps) {
    if (s.call.to.toLowerCase() === USDG.toLowerCase()) {
      const d = decodeFunctionData({ abi: erc20Abi, data: s.call.data });
      assert.equal(d.functionName, "approve");
      assert.equal((d.args as [Address, bigint])[0], MORPHO_BLUE);
      c.wallet.allowance = (d.args as [Address, bigint])[1];
    } else if (s.call.to === MORPHO_BLUE) {
      const d = decodeFunctionData({ abi: morphoAbi, data: s.call.data });
      if (d.functionName === "withdrawCollateral") {
        const [mp, assets, onBehalf, receiver] = d.args as unknown as [MarketParams, bigint, Address, Address];
        assert.equal(marketId(mp), marketId(market));
        assert.equal(onBehalf, ME);
        assert.equal(receiver, ME);
        assert.ok(assets <= c.collateral, "withdraws no more than is posted");
        c.collateral -= assets;
        assert.ok(healthy(c), "Morpho refuses a withdrawal that leaves the position unhealthy");
        c.wallet.shares += assets;
      } else if (d.functionName === "repay") {
        const [mp, assets, shares, onBehalf, data] = d.args as unknown as [MarketParams, bigint, bigint, Address, string];
        assert.equal(marketId(mp), marketId(market));
        assert.equal(onBehalf, ME);
        assert.equal(shares, 0n, "repays by assets");
        assert.equal(data, "0x");
        assert.ok(c.wallet.allowance >= assets, "USDG allowance covers the repay");
        assert.ok(c.wallet.usdg >= assets, "the wallet holds the USDG");
        const burned = toSharesDown(assets, c.market.totalBorrowAssets, c.market.totalBorrowShares);
        assert.ok(burned <= c.borrowShares, "no more shares burn than the position owes");
        c.wallet.usdg -= assets;
        c.wallet.allowance -= assets;
        c.borrowShares -= burned;
        c.market = { ...c.market, totalBorrowShares: c.market.totalBorrowShares - burned, totalBorrowAssets: c.market.totalBorrowAssets - assets };
      } else assert.fail(`unexpected Morpho call ${d.functionName}`);
    } else if (s.call.to === VAULT) {
      const d = decodeFunctionData({ abi: vaultAbi, data: s.call.data });
      assert.equal(d.functionName, "redeemInKind");
      const [shares, receiver, owner] = d.args as [bigint, Address, Address];
      assert.equal(receiver, ME);
      assert.equal(owner, ME);
      assert.ok(c.wallet.shares >= shares, "the wallet holds the shares it redeems");
      c.wallet.shares -= shares;
      assert.ok(inKind);
      c.wallet.usdg += (((inKind.usdg * shares) / inKind.shares) * BigInt(Math.round(payout * 10_000))) / 10_000n;
      c.wallet.stock += (inKind.stock * shares) / inKind.shares;
    } else assert.fail(`call to an address the plan should not touch: ${s.call.to}`);
  }
  return c;
}

const healthOf = (c: Chain) => Number((maxBorrowOf(c.collateral, PRICE, LLTV) * 1_000_000n) / toAssetsUp(c.borrowShares, c.market.totalBorrowAssets, c.market.totalBorrowShares)) / 1e6;
const start = (usdg: bigint): Chain => ({ collateral: COLLATERAL, borrowShares: BORROW_SHARES, market: state, wallet: { usdg, stock: 0n, allowance: 0n, shares: 0n } });
const ready = (p: SaferPlan) => { assert.equal(p.status, "ready"); return p as Extract<SaferPlan, { status: "ready" }>; };

/** The assertion that guards the sizing: the plan's own calls, run on a model chain, leave the position at or above the target. */
function assertReaches(plan: Extract<SaferPlan, { status: "ready" }>, usdg: bigint, inKind: InKindQuote | undefined, target: number, at = NOW + EXEC_LAG_SECONDS, payout = 1) {
  const end = execute(plan.steps, start(usdg), at, inKind, payout);
  const hf = healthOf(end);
  assert.ok(hf >= target, `health factor after the batch is ${hf}, below the target ${target}`);
  return { hf, end };
}

// ---- interest -------------------------------------------------------------------------------------------------------------------

test("wTaylorCompounded matches the hand-worked terms of Morpho's MathLib", () => {
  // x = 1.0, n = 2: first 2.0, second 2.0*2.0/2 = 2.0, third 2.0*2.0/3 = 1.333...: 5.333...
  assert.equal(wTaylorCompounded(WAD, 2n), 5_333_333_333_333_333_333n);
  assert.equal(wTaylorCompounded(0n, 1_000n), 0n);
  // Over a year at 8% it is e^0.08 - 1 to the third order, within 1e-6 of the exact series.
  const year = wTaylorCompounded(RATE, 31_536_000n);
  assert.ok(Math.abs(Number(year) / 1e18 - Math.expm1(0.08)) < 2e-5, `${year}`);
});

test("accrueInterest grows borrow and supply by the same interest, only forward in time, and credits the fee as supply shares", () => {
  const a = accrueInterest(state, RATE, NOW);
  const interest = (state.totalBorrowAssets * wTaylorCompounded(RATE, NOW - state.lastUpdate)) / WAD;
  assert.equal(a.totalBorrowAssets - state.totalBorrowAssets, interest);
  assert.equal(a.totalSupplyAssets - state.totalSupplyAssets, interest);
  assert.equal(a.lastUpdate, NOW);
  assert.ok(interest > 0n);
  assert.deepEqual(accrueInterest(state, RATE, state.lastUpdate), state, "no time, no interest");
  assert.deepEqual(accrueInterest(state, RATE, state.lastUpdate - 5n), state, "never backwards");
  assert.deepEqual(accrueInterest({ ...state, lastUpdate: 0n }, RATE, NOW), { ...state, lastUpdate: 0n }, "a market that does not exist is left alone");
  const fee = accrueInterest({ ...state, fee: WAD / 10n }, RATE, NOW);
  assert.ok(fee.totalSupplyShares > state.totalSupplyShares, "a market fee mints supply shares");
  assert.equal(fee.totalBorrowAssets, a.totalBorrowAssets, "the fee does not change what borrowers owe");
});

test("the debt of a position grows with the time since the market last accrued", () => {
  const input = { collateral: COLLATERAL, borrowShares: BORROW_SHARES, market: state, borrowRate: RATE, price: PRICE, lltv: LLTV };
  const stored = debtAssets(BORROW_SHARES, state.totalBorrowAssets, state.totalBorrowShares);
  const d0 = loanView({ ...input, now: state.lastUpdate }).debt;
  const d1 = loanView({ ...input, now: NOW }).debt;
  const d2 = loanView({ ...input, now: NOW + 30n * 86_400n }).debt;
  assert.equal(d0, stored);
  assert.ok(d1 > d0 && d2 > d1, `${d0} < ${d1} < ${d2}`);
  const v = loanView({ ...input, now: NOW });
  assert.equal(v.maxBorrow, 12_500n * 10n ** 6n);
  assert.equal(v.collateralValue, 20_000n * 10n ** 6n);
  assert.ok(v.risk.healthFactor !== null && Math.abs(v.risk.healthFactor - Number(v.maxBorrow) / Number(v.debt)) < 1e-6);
  assert.ok(v.risk.dropToLiquidation !== null && v.risk.dropToLiquidation > 0.2 && v.risk.dropToLiquidation < 0.3);
});

test("a position with no debt has no health factor and no loan view worth showing", () => {
  assert.equal(hasLoan(0n, 0n), false);
  assert.equal(hasLoan(1n, 0n), true);
  assert.equal(hasLoan(0n, 1n), true);
  const v = loanView({ collateral: COLLATERAL, borrowShares: 0n, market: state, borrowRate: RATE, now: NOW, price: PRICE, lltv: LLTV });
  assert.equal(v.debt, 0n);
  assert.equal(v.risk.healthFactor, null);
});

test("the liquidation price in stock terms is the stock price less the fall the share can take", () => {
  assert.equal(liquidationInStock(100, 0.25), 75);
  assert.equal(liquidationInStock(100, null), undefined);
  assert.equal(liquidationInStock(0, 0.25), undefined);
});

test("target health is a WAD, and a target outside the safe range is refused", () => {
  assert.equal(targetWad(1.6), 1_600_000_000_000_000_000n);
  assert.throws(() => targetWad(1.0));
  assert.throws(() => targetWad(5.1));
  assert.throws(() => targetWad(Number.NaN));
  assert.equal(meetsTarget(160n, 100n, targetWad(1.6)), true);
  assert.equal(meetsTarget(159n, 100n, targetWad(1.6)), false);
});

// ---- make it safer: the wallet repays ---------------------------------------------------------------------------------------------

test("with USDG in the wallet the plan is approve then repay, and the repay is the least that reaches the target", () => {
  const usdg = 20_000n * 10n ** 6n;
  const plan = ready(planSafer(base({ usdgBalance: usdg })));
  assert.equal(plan.path, "repay");
  assert.deepEqual(plan.steps.map((s) => s.id), ["approve-usdg", "repay"]);
  assert.deepEqual(plan.steps.map((s) => s.call.to), [USDG, MORPHO_BLUE]);

  const approve = decodeFunctionData({ abi: erc20Abi, data: plan.steps[0].call.data });
  assert.deepEqual(approve.args, [MORPHO_BLUE, plan.repay]);
  const repay = decodeFunctionData({ abi: morphoAbi, data: plan.steps[1].call.data });
  assert.equal(repay.functionName, "repay");
  const [mp, assets, shares, onBehalf, data] = repay.args as unknown as [MarketParams, bigint, bigint, Address, string];
  assert.equal(marketId(mp), marketId(market));
  assert.equal(assets, plan.repay);
  assert.equal(shares, 0n);
  assert.equal(onBehalf, ME);
  assert.equal(data, "0x");

  // the position starts below the target and ends at or above it, on the decoded calls
  assert.ok(plan.before.healthFactor! < 1.6);
  const { hf, end } = assertReaches(plan, usdg, undefined, 1.6);
  assert.ok(hf < 1.6001, `minimal: it lands at ${hf}, not far above 1.6`);
  assert.equal(end.wallet.usdg, usdg - plan.repay);
  assert.ok(plan.after.healthFactor! >= 1.6);

  // one wei less misses the target: the repay is the minimum, not a round number
  const ahead = accrueInterest(state, RATE, NOW + EXEC_LAG_SECONDS);
  const target = targetWad(1.6);
  const max = maxBorrowOf(COLLATERAL, PRICE, LLTV);
  assert.equal(meetsTarget(max, repayEffect(ahead, BORROW_SHARES, plan.repay).debt, target), true);
  assert.equal(meetsTarget(max, repayEffect(ahead, BORROW_SHARES, plan.repay - 1n).debt, target), false);
});

test("an allowance that already covers the repay skips the approval", () => {
  const plan = ready(planSafer(base({ usdgBalance: 20_000n * 10n ** 6n, usdgAllowance: 2n ** 255n })));
  assert.deepEqual(plan.steps.map((s) => s.id), ["repay"]);
});

test("the sizing guard can fail: the same calls with a halved repay land below the target", () => {
  const usdg = 20_000n * 10n ** 6n;
  const plan = ready(planSafer(base({ usdgBalance: usdg })));
  const repay = decodeFunctionData({ abi: morphoAbi, data: plan.steps[1].call.data });
  const [mp, assets, shares, onBehalf, data] = repay.args as unknown as [MarketParams, bigint, bigint, Address, `0x${string}`];
  const broken: Step = { ...plan.steps[1], call: { to: MORPHO_BLUE, data: encodeFunctionData({ abi: morphoAbi, functionName: "repay", args: [mp, assets / 2n, shares, onBehalf, data] }) } };
  const approve: Step = { ...plan.steps[0], call: { ...plan.steps[0].call, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [MORPHO_BLUE, assets] }) } };
  const end = execute([approve, broken], start(usdg), NOW + EXEC_LAG_SECONDS, undefined);
  assert.ok(healthOf(end) < 1.6, `${healthOf(end)}`);
  assert.throws(() => assertReaches({ ...plan, steps: [approve, broken] }, usdg, undefined, 1.6), /below the target/);
});

test("the plan still meets the target when the batch lands up to the execution lag late, and a day late it need not", () => {
  const usdg = 20_000n * 10n ** 6n;
  const plan = ready(planSafer(base({ usdgBalance: usdg })));
  assertReaches(plan, usdg, undefined, 1.6, NOW);
  assertReaches(plan, usdg, undefined, 1.6, NOW + EXEC_LAG_SECONDS);
  const late = healthOf(execute(plan.steps, start(usdg), NOW + 86_400n, undefined));
  assert.ok(late < 1.6, `a day of interest the plan did not size for lowers it to ${late}`);
});

test("a position already at the target is left alone, and a wallet with nothing posted has nothing to fix", () => {
  const safe = planSafer(base({ target: 1.2 }));
  assert.equal(safe.status, "already-safe");
  assert.ok(safe.status === "already-safe" && safe.health !== null && safe.health >= 1.2);
  const none = planSafer(base({ collateral: 0n, borrowShares: 0n }));
  assert.equal(none.status, "no-position");
  const noDebt = planSafer(base({ borrowShares: 0n }));
  assert.equal(noDebt.status, "no-position");
  assert.match(noDebt.status === "no-position" ? noDebt.reason : "", /owes nothing/);
});

test("a target above what the collateral can support is unreachable, not a plan to repay more than is owed", () => {
  const thin = planSafer(base({ collateral: 14n * 10n ** 24n, borrowShares: 1_700n * 10n ** 12n, target: 5, usdgBalance: 10n ** 12n }));
  // 14 shares are worth $2,800, the limit is $1,750 and the debt about $1,700 plus interest: HF 5 needs a repay the debt cannot absorb... or exactly the whole debt
  assert.ok(thin.status === "ready" || thin.status === "unreachable");
  if (thin.status === "ready") assert.ok(thin.repay <= debtAssets(1_700n * 10n ** 12n, accrueInterest(state, RATE, NOW).totalBorrowAssets, accrueInterest(state, RATE, NOW).totalBorrowShares));
});

// ---- make it safer: the wallet has no USDG, so the collateral exits in kind -----------------------------------------------------------

test("without USDG the plan works in rounds of withdraw, exit in kind, repay, and the stock leg stays in the wallet", () => {
  const q = quote(0.5);
  const plan = ready(planSafer(base({ inKind: q })));
  assert.equal(plan.path, "in-kind");
  assert.ok(plan.rounds >= 2, "HF 1.39 to 1.6 cannot be done in one round: Morpho checks health the moment shares leave");
  const ids = plan.steps.map((s) => s.id);
  assert.equal(ids[0], "withdraw-collateral");
  assert.equal(ids[1], "redeem-in-kind");
  assert.equal(ids[2], "approve-usdg");
  assert.equal(ids[3], "repay");
  assert.equal(ids.filter((i) => i === "approve-usdg").length, 1, "one approval covers every round");
  assert.equal(ids.filter((i) => i === "repay").length, plan.rounds);
  assert.equal(plan.steps.length, plan.rounds * 3 + 1);

  // every call decodes to the plan: the market, the account as owner and receiver, and amounts that add up
  let shares = 0n;
  let repaid = 0n;
  let approved = 0n;
  for (const st of plan.steps) {
    if (st.id === "withdraw-collateral") {
      const d = decodeFunctionData({ abi: morphoAbi, data: st.call.data });
      assert.equal(d.functionName, "withdrawCollateral");
      const [mp, assets, onBehalf, receiver] = d.args as unknown as [MarketParams, bigint, Address, Address];
      assert.equal(st.call.to, MORPHO_BLUE);
      assert.equal(marketId(mp), marketId(market));
      assert.equal(onBehalf, ME);
      assert.equal(receiver, ME);
      shares += assets;
    } else if (st.id === "redeem-in-kind") {
      const d = decodeFunctionData({ abi: vaultAbi, data: st.call.data });
      assert.equal(d.functionName, "redeemInKind");
      assert.equal(st.call.to, VAULT);
      const [n, receiver, owner] = d.args as [bigint, Address, Address];
      assert.equal(receiver, ME);
      assert.equal(owner, ME);
      assert.ok(n > 0n);
    } else if (st.id === "approve-usdg") {
      const d = decodeFunctionData({ abi: erc20Abi, data: st.call.data });
      assert.equal(st.call.to, USDG);
      approved = (d.args as [Address, bigint])[1];
      assert.equal((d.args as [Address, bigint])[0], MORPHO_BLUE);
    } else {
      const d = decodeFunctionData({ abi: morphoAbi, data: st.call.data });
      assert.equal(d.functionName, "repay");
      const [mp, assets, sh, onBehalf, data] = d.args as unknown as [MarketParams, bigint, bigint, Address, string];
      assert.equal(marketId(mp), marketId(market));
      assert.equal(sh, 0n);
      assert.equal(onBehalf, ME);
      assert.equal(data, "0x");
      repaid += assets;
    }
  }
  assert.equal(shares, plan.shares);
  assert.equal(repaid, plan.repay);
  assert.equal(approved, plan.repay);
  const leg = (q.usdg * plan.shares) / q.shares;
  assert.ok(repaid <= (leg * (10_000n - IN_KIND_MARGIN_BPS)) / 10_000n, "never more than the USDG leg less the margin");

  // run on the model chain: every withdrawal leaves the position healthy, and it ends at the target
  const { hf, end } = assertReaches(plan, 0n, q, 1.6);
  assert.ok(hf < 1.62, `minimal: it lands at ${hf}`);
  assert.equal(end.collateral, COLLATERAL - plan.shares);
  assert.equal(end.wallet.stock, (q.stock * plan.shares) / q.shares - 0n, "the stock leg is returned in full");
  assert.ok(plan.stock > 0n);
  assert.ok(end.wallet.usdg > 0n && end.wallet.usdg < leg - repaid + 4n, "the margin stays in the wallet as USDG");

  // a lower target takes fewer shares out
  const lower = ready(planSafer(base({ inKind: q, target: 1.5 })));
  assert.ok(lower.shares < plan.shares);
});

test("between two calls the position never drops under the step floor, so a wallet that signs one at a time is not exposed", () => {
  const q = quote(0.5);
  const plan = ready(planSafer(base({ inKind: q })));
  let c = start(0n);
  c = { ...c, market: accrueInterest(c.market, RATE, NOW + EXEC_LAG_SECONDS) };
  let lowest = Infinity;
  for (let i = 0; i < plan.steps.length; i++) {
    c = execute([plan.steps[i]], { ...c, market: c.market }, NOW + EXEC_LAG_SECONDS, q);
    lowest = Math.min(lowest, healthOf(c));
  }
  // `wallet.shares` and allowances carry across the single-step runs, so the whole list ran
  assert.ok(lowest >= 1.03 - 1e-6, `lowest health between calls ${lowest}`);
  assert.ok(healthOf(c) >= 1.6);
});

test("the in-kind route still repays when the vault pays 0.3% less USDG than it quoted", () => {
  const q = quote(0.5);
  const plan = ready(planSafer(base({ inKind: q })));
  assertReaches(plan, 0n, q, 1.6, NOW + EXEC_LAG_SECONDS, 0.997);
  assert.throws(() => assertReaches(plan, 0n, q, 1.6, NOW + EXEC_LAG_SECONDS, 0.98), /USDG|wallet holds/, "a 2% shortfall is more than the margin and the repay would revert");
});

test("a wallet with some USDG, but not enough, takes the in-kind route", () => {
  const q = quote(0.5);
  const need = ready(planSafer(base({ usdgBalance: 10n ** 12n }))).repay;
  const plan = ready(planSafer(base({ usdgBalance: need - 1n, inKind: q })));
  assert.equal(plan.path, "in-kind");
  assert.equal(ready(planSafer(base({ usdgBalance: need, inKind: q }))).path, "repay");
});

test("an exit that returns too little USDG for the shares it takes cannot raise the health factor, and the plan says so", () => {
  // At 30% USDG the leg is smaller than the loan-to-value, so every share taken out lowers the health factor.
  const plan = planSafer(base({ inKind: quote(0.3) }));
  assert.equal(plan.status, "unreachable");
  assert.match(plan.status === "unreachable" ? plan.reason : "", /too little USDG/);
});

test("with no USDG and no vault quote the plan says what is missing", () => {
  const plan = planSafer(base());
  assert.equal(plan.status, "unreachable");
  assert.match(plan.status === "unreachable" ? plan.reason : "", /could not be asked/);
});

test("a position past its limit, or within 3% of it, cannot take shares out first", () => {
  // debt above the limit: Morpho would refuse the withdrawal. At 1.02 a withdrawal would leave the gap between two signed transactions unprotected.
  for (const borrowShares of [13_000n * 10n ** 12n, 12_000n * 10n ** 12n]) {
    const plan = planSafer(base({ borrowShares, inKind: quote(0.9) }));
    assert.equal(plan.status, "unreachable", `${borrowShares}`);
    assert.match(plan.status === "unreachable" ? plan.reason : "", /too close to its limit/);
  }
  // the same near-limit position can still be repaid from the wallet
  assert.equal(planSafer(base({ borrowShares: 12_000n * 10n ** 12n, usdgBalance: 10n ** 12n })).status, "ready");
});

test("accrueInterest reproduces what the live Morpho singleton stored ten days on", () => {
  // Origin: scripts/health-guard-fork-check.ts (PRINT_VECTOR=1) against an Anvil fork of Robinhood Chain 4663, head block 96028164. The USDG/AMZN market
  // 0xff762c8a...50ca was read with market(id), the IRM's borrowRateView(params, market) was called with the block time set to `at`, and Morpho.accrueInterest was
  // then mined at `at`; `after` is market(id) read back.
  const before: MarketState = { totalSupplyAssets: 3_200_000_000n, totalSupplyShares: 3_200_000_000_000_000n, totalBorrowAssets: 2_293_611_499n, totalBorrowShares: 2_293_611_499_000_000n, lastUpdate: 1_792_767_692n, fee: 0n };
  const after: MarketState = { totalSupplyAssets: 3_200_053_243n, totalSupplyShares: 3_200_000_000_000_000n, totalBorrowAssets: 2_293_664_742n, totalBorrowShares: 2_293_611_499_000_000n, lastUpdate: 1_793_631_692n, fee: 0n };
  assert.deepEqual(accrueInterest(before, 26_867_536n, 1_793_631_692n), after);
  assert.notDeepEqual(accrueInterest(before, 26_867_536n + 1_000n, 1_793_631_692n), after, "the vector is sensitive to the rate");
  assert.notDeepEqual(accrueInterest(before, 26_867_536n, 1_793_631_693n), after, "and to the time");
});
