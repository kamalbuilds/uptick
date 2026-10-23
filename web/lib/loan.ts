import { encodeFunctionData, parseAbi, type Address } from "viem";
import {
  MORPHO_BLUE, VIRTUAL_ASSETS, VIRTUAL_SHARES, WAD, collateralValue, debtAssets, maxBorrowOf, morphoAbi, positionRisk,
  type MarketParams, type PositionRisk, type Step,
} from "./morpho.ts";
import { vaultAbi } from "./abis.ts";

// ---- Morpho's interest accrual, a port of Morpho._accrueInterest and MorphoBalancesLib.expectedMarketBalances --------------------------

/** The six words `Morpho.market(id)` returns, named as the IRM's `Market` struct names them so it can be passed to `borrowRateView` as is. */
export type MarketState = {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
};

export const marketStateOf = (t: readonly [bigint, bigint, bigint, bigint, bigint, bigint]): MarketState => ({
  totalSupplyAssets: t[0], totalSupplyShares: t[1], totalBorrowAssets: t[2], totalBorrowShares: t[3], lastUpdate: t[4], fee: t[5],
});

/** `MathLib.wMulDown`. */
export const wMulDown = (x: bigint, y: bigint): bigint => (x * y) / WAD;

/** `MathLib.wTaylorCompounded`: the first three terms of e^(x*n) - 1, which is how Morpho compounds a per-second rate over `n` seconds. */
export function wTaylorCompounded(x: bigint, n: bigint): bigint {
  const first = x * n;
  const second = (first * first) / (2n * WAD);
  const third = (second * first) / (3n * WAD);
  return first + second + third;
}

/** The market as Morpho would store it if `accrueInterest` ran at `now`. `borrowRate` is the IRM's `borrowRateView` for the stored state, a per-second WAD rate.
 *  Morpho accrues on every call that touches the market, so a position's debt is what this returns, not what `market()` holds. */
export function accrueInterest(m: MarketState, borrowRate: bigint, now: bigint): MarketState {
  const elapsed = now - m.lastUpdate;
  if (m.lastUpdate === 0n || elapsed <= 0n) return m;
  const interest = wMulDown(m.totalBorrowAssets, wTaylorCompounded(borrowRate, elapsed));
  const totalSupplyAssets = m.totalSupplyAssets + interest;
  let totalSupplyShares = m.totalSupplyShares;
  if (m.fee !== 0n) {
    const feeAmount = wMulDown(interest, m.fee);
    totalSupplyShares += (feeAmount * (totalSupplyShares + VIRTUAL_SHARES)) / (totalSupplyAssets - feeAmount + VIRTUAL_ASSETS);
  }
  return { ...m, totalBorrowAssets: m.totalBorrowAssets + interest, totalSupplyAssets, totalSupplyShares, lastUpdate: now };
}

// ---- the position ----------------------------------------------------------------------------------------------------------------

export type LoanInput = {
  collateral: bigint;
  borrowShares: bigint;
  market: MarketState;
  /** `borrowRateView(marketParams, market)` read now. */
  borrowRate: bigint;
  /** Unix seconds the debt is accrued to. */
  now: bigint;
  /** Oracle price, 1e36 scale. */
  price: bigint;
  lltv: bigint;
};

export type LoanView = {
  collateral: bigint;
  borrowShares: bigint;
  /** What the position owes at `now`, in loan units: its borrow shares at the accrued market, rounded up as Morpho rounds it. */
  debt: bigint;
  /** Loan-unit value of the collateral at the oracle price, rounded down. */
  collateralValue: bigint;
  /** Debt the position may carry before it is liquidatable. */
  maxBorrow: bigint;
  risk: PositionRisk;
  /** The market accrued to `now`. */
  state: MarketState;
};

export function loanView(p: LoanInput): LoanView {
  const state = accrueInterest(p.market, p.borrowRate, p.now);
  const debt = debtAssets(p.borrowShares, state.totalBorrowAssets, state.totalBorrowShares);
  return {
    collateral: p.collateral,
    borrowShares: p.borrowShares,
    debt,
    collateralValue: collateralValue(p.collateral, p.price),
    maxBorrow: maxBorrowOf(p.collateral, p.price, p.lltv),
    risk: positionRisk({ collateral: p.collateral, price: p.price, lltv: p.lltv, debt }),
    state,
  };
}

/** Whether the position holds a loan worth showing: collateral posted or debt owed. */
export const hasLoan = (collateral: bigint, borrowShares: bigint): boolean => collateral > 0n || borrowShares > 0n;

/** The stock price at which the position liquidates, reading the share as falling one for one with the stock. The share also holds USDG, so the real stock price sits lower: this figure is the earlier warning. */
export const liquidationInStock = (stockPrice: number, dropToLiquidation: number | null): number | undefined =>
  dropToLiquidation === null || stockPrice <= 0 ? undefined : stockPrice * (1 - dropToLiquidation);

// ---- "Make it safer" -------------------------------------------------------------------------------------------------------------

export const DEFAULT_TARGET_HEALTH = 1.6;
export const MIN_TARGET_HEALTH = 1.05;
export const MAX_TARGET_HEALTH = 5;
/** Seconds of interest added to the debt before sizing, so a batch that lands a few minutes after the quote still meets the target. */
export const EXEC_LAG_SECONDS = 600n;
/** Share of the in-kind USDG leg left in the wallet unspent. The leg moves with the pool between quote and block; the repay is sized to the rest, so a small drop never reverts the batch. */
export const IN_KIND_MARGIN_BPS = 50n;
/** The health factor a position never drops below between two calls of a batch: a sequential wallet signs them one at a time, and a price move in the gap must not liquidate it. */
export const MIN_STEP_HEALTH = 1.03;
/** Most withdraw, exit, repay rounds in one batch. */
export const MAX_ROUNDS = 6;
const BPS = 10_000n;

/** A health factor as a WAD, rounded to six places. Throws outside [MIN_TARGET_HEALTH, MAX_TARGET_HEALTH]. */
export function targetWad(target: number): bigint {
  if (!Number.isFinite(target) || target < MIN_TARGET_HEALTH || target > MAX_TARGET_HEALTH) {
    throw new Error(`target health must be between ${MIN_TARGET_HEALTH} and ${MAX_TARGET_HEALTH}`);
  }
  return toWad(target);
}
const toWad = (x: number): bigint => BigInt(Math.round(x * 1_000_000)) * 10n ** 12n;

/** `maxBorrow / debt >= target`, exactly, with no floating point. */
export const meetsTarget = (maxBorrow: bigint, debt: bigint, target: bigint): boolean => debt === 0n || maxBorrow * WAD >= target * debt;

/** The market and a borrower's shares after `Morpho.repay(assets)`: shares burn at `toSharesDown`, the market's borrow assets fall by the repaid assets (floored at zero). */
export function repayEffect(m: MarketState, borrowShares: bigint, assets: bigint): { market: MarketState; borrowShares: bigint; debt: bigint } {
  const burned = (assets * (m.totalBorrowShares + VIRTUAL_SHARES)) / (m.totalBorrowAssets + VIRTUAL_ASSETS);
  const market = {
    ...m,
    totalBorrowShares: m.totalBorrowShares - burned,
    totalBorrowAssets: m.totalBorrowAssets > assets ? m.totalBorrowAssets - assets : 0n,
  };
  const left = borrowShares - burned;
  return { market, borrowShares: left, debt: debtAssets(left, market.totalBorrowAssets, market.totalBorrowShares) };
}

/** What a simulated `redeemInKind(shares, ...)` returned. The plan scales it linearly to any smaller share count: the vault splits its holdings pro rata. */
export type InKindQuote = { shares: bigint; stock: bigint; usdg: bigint };

export type SaferInput = {
  symbol: string;
  market: MarketParams;
  vault: Address;
  account: Address;
  collateral: bigint;
  borrowShares: bigint;
  state: MarketState;
  borrowRate: bigint;
  now: bigint;
  price: bigint;
  /** The health factor to reach, for example 1.6. */
  target: number;
  usdgBalance: bigint;
  /** The wallet's USDG allowance to Morpho. */
  usdgAllowance: bigint;
  /** Absent when the vault could not be asked: the in-kind route is then not offered. */
  inKind?: InKindQuote;
};

export type SaferPlan =
  | { status: "no-position"; reason: string }
  | { status: "already-safe"; health: number | null }
  | { status: "unreachable"; reason: string }
  | {
      status: "ready";
      path: "repay" | "in-kind";
      steps: Step[];
      /** USDG repaid. */
      repay: bigint;
      /** Vault shares taken out of the collateral, zero when the wallet repays. */
      shares: bigint;
      /** Withdraw, exit and repay rounds the batch runs, zero when the wallet repays. */
      rounds: number;
      /** Stock Token returned to the wallet by the in-kind exit, zero when the wallet repays. */
      stock: bigint;
      before: PositionRisk;
      /** Where the position lands, with the debt projected EXEC_LAG_SECONDS ahead. At or above `target`. */
      after: PositionRisk;
      target: number;
    };

const erc20Approve = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

/** Largest `n` in [lo, hi] for which `ok(n)` holds when `ok` is true up to some point and false after it, or null if it is false at `lo`. */
function lastTrue(lo: bigint, hi: bigint, ok: (n: bigint) => boolean): bigint | null {
  if (!ok(lo)) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (ok(mid)) lo = mid; else hi = mid - 1n;
  }
  return lo;
}

/** Smallest `n` in [lo, hi] for which `ok(n)` holds when `ok` is false up to some point and true after it. The caller has checked `ok(hi)`. */
function firstTrue(lo: bigint, hi: bigint, ok: (n: bigint) => boolean): bigint {
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (ok(mid)) hi = mid; else lo = mid + 1n;
  }
  return lo;
}

/** The smallest action that takes the position to `target`: repay with the USDG the wallet holds, or, when the wallet cannot cover it, take shares out of the
 *  collateral, exit them in kind, and repay with the USDG leg while the stock leg goes back to the wallet. Sizes use the debt projected EXEC_LAG_SECONDS ahead
 *  and Morpho's own rounding; the result is the exact call list. */
export function planSafer(p: SaferInput): SaferPlan {
  if (!hasLoan(p.collateral, p.borrowShares)) return { status: "no-position", reason: "This wallet has no collateral or debt in this market." };
  const target = targetWad(p.target);
  const lltv = p.market.lltv;
  const now = loanView({ collateral: p.collateral, borrowShares: p.borrowShares, market: p.state, borrowRate: p.borrowRate, now: p.now, price: p.price, lltv });
  if (p.borrowShares === 0n || now.debt === 0n) return { status: "no-position", reason: "This position owes nothing, so there is nothing to make safer." };
  if (meetsTarget(now.maxBorrow, now.debt, target)) return { status: "already-safe", health: now.risk.healthFactor };

  // Everything below is sized on the market as it will be when the batch lands.
  const ahead = accrueInterest(p.state, p.borrowRate, p.now + EXEC_LAG_SECONDS);
  const debtAhead = debtAssets(p.borrowShares, ahead.totalBorrowAssets, ahead.totalBorrowShares);
  const maxBorrowAt = (collateral: bigint) => maxBorrowOf(collateral, p.price, lltv);
  const before = now.risk;
  const approveUsdg = (amount: bigint): Step[] =>
    p.usdgAllowance >= amount ? [] : [{ id: "approve-usdg", label: "Approve USDG to Morpho", call: { to: p.market.loanToken, data: encodeFunctionData({ abi: erc20Approve, functionName: "approve", args: [MORPHO_BLUE, amount] }) } }];
  const repayStep = (assets: bigint): Step => ({
    id: "repay", label: "Repay USDG",
    call: { to: MORPHO_BLUE, data: encodeFunctionData({ abi: morphoAbi, functionName: "repay", args: [p.market, assets, 0n, p.account, "0x"] }) },
  });
  const landing = (collateral: bigint, repay: bigint): PositionRisk => {
    const debt = repayEffect(ahead, p.borrowShares, repay).debt;
    return positionRisk({ collateral, price: p.price, lltv, debt });
  };

  // A repay never asks for more than the debt owes today, so it cannot exceed the debt when the batch lands.
  const cap = now.debt;
  // Route one: the wallet repays. The least USDG that meets the target.
  const clears = (r: bigint) => meetsTarget(maxBorrowAt(p.collateral), repayEffect(ahead, p.borrowShares, r).debt, target);
  if (!clears(cap)) return { status: "unreachable", reason: "The collateral is worth too little to reach this health factor, even with the whole loan repaid." };
  const wallet = firstTrue(1n, cap, clears);
  if (p.usdgBalance >= wallet) {
    return { status: "ready", path: "repay", steps: [...approveUsdg(wallet), repayStep(wallet)], repay: wallet, shares: 0n, stock: 0n, rounds: 0, before, after: landing(p.collateral, wallet), target: p.target };
  }
  if (!p.inKind || p.inKind.shares <= 0n) {
    const usdg = (n: bigint) => (Number(n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
    return { status: "unreachable", reason: `Repaying takes ${usdg(wallet)} USDG and the wallet holds ${usdg(p.usdgBalance)} USDG. The vault could not be asked for an in-kind exit quote, so add USDG to the wallet and repay.` };
  }

  // Route two: take shares out of the collateral, exit them in kind, repay with the USDG leg. Morpho checks health the moment shares leave, so a position well
  // short of the target cannot do it in one go: the plan works in rounds, each taking out what the floor allows, exiting it and repaying before the next.
  const q = p.inKind;
  const repayOf = (s: bigint, owed: bigint) => {
    const r = (((q.usdg * s) / q.shares) * (BPS - IN_KIND_MARGIN_BPS)) / BPS;
    return r > owed ? owed : r;
  };
  const outS = p.collateral < q.shares ? p.collateral : q.shares;
  // Past the share count whose USDG leg repays the whole debt, taking more out only gives collateral away.
  const maxS = repayOf(outS, cap) < cap ? outS : firstTrue(1n, outS, (s) => repayOf(s, cap) >= cap);
  // The total to take out is fixed by where the position must end, whatever the rounds: the least `s` whose USDG leg brings the debt under the target.
  const lands = (s: bigint) => meetsTarget(maxBorrowAt(p.collateral - s), repayEffect(ahead, p.borrowShares, repayOf(s, cap)).debt, target);
  if (!lands(maxS)) {
    return { status: "unreachable", reason: "Exiting shares in kind returns too little USDG for the collateral it gives up, so this route cannot reach the target. Add USDG to the wallet and repay." };
  }
  let total = firstTrue(1n, maxS, lands);
  const floor = toWad(MIN_STEP_HEALTH);
  for (let attempt = 0; attempt < 20; attempt++) {
    const rounds: { shares: bigint; repay: bigint }[] = [];
    let collateral = p.collateral;
    let aheadWorld = { market: ahead, borrowShares: p.borrowShares, debt: debtAhead };
    let nowWorld = { market: now.state, borrowShares: p.borrowShares, debt: now.debt };
    for (let left = total; left > 0n && rounds.length < MAX_ROUNDS;) {
      const keepsFloor = (s: bigint) => meetsTarget(maxBorrowAt(collateral - s), aheadWorld.debt, floor);
      const s = lastTrue(0n, left, keepsFloor);
      if (s === null || s === 0n) break;
      const repay = repayOf(s, nowWorld.debt);
      rounds.push({ shares: s, repay });
      collateral -= s;
      left -= s;
      aheadWorld = repayEffect(aheadWorld.market, aheadWorld.borrowShares, repay);
      nowWorld = repayEffect(nowWorld.market, nowWorld.borrowShares, repay);
    }
    const taken = rounds.reduce((a, r) => a + r.shares, 0n);
    if (taken === total && meetsTarget(maxBorrowAt(collateral), aheadWorld.debt, target)) {
      const repay = rounds.reduce((a, r) => a + r.repay, 0n);
      const steps: Step[] = [];
      rounds.forEach((r, i) => {
        steps.push(
          { id: "withdraw-collateral", label: "Take the shares out of Morpho", call: { to: MORPHO_BLUE, data: encodeFunctionData({ abi: morphoAbi, functionName: "withdrawCollateral", args: [p.market, r.shares, p.account, p.account] }) } },
          { id: "redeem-in-kind", label: `Exit the shares in kind, ${p.symbol} and USDG`, call: { to: p.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "redeemInKind", args: [r.shares, p.account, p.account] }) } },
        );
        if (i === 0) steps.push(...approveUsdg(repay));
        steps.push(repayStep(r.repay));
      });
      const after = positionRisk({ collateral, price: p.price, lltv, debt: aheadWorld.debt });
      return { status: "ready", path: "in-kind", steps, repay, shares: total, stock: (q.stock * total) / q.shares, rounds: rounds.length, before, after, target: p.target };
    }
    // Per-round rounding left the end a hair short of the target: take a little more out and split again.
    if (rounds.length >= MAX_ROUNDS && taken < total) break;
    total = total + total / 10_000n + 1n;
    if (total > maxS) break;
  }
  return { status: "unreachable", reason: `This position is too close to its limit to take shares out in kind and stay at least ${MIN_STEP_HEALTH} healthy between steps. Add USDG to the wallet and repay.` };
}
