import { encodeAbiParameters, encodeFunctionData, getAddress, isAddress, keccak256, parseAbi, type Address, type Hex } from "viem";

/** Morpho Blue singleton on Robinhood Chain (4663).
 *  Origin: blue-api.morpho.org/graphql `markets(where:{chainId_in:[4663]})`, field `morphoBlue.address`, read 2026-10-23.
 *  On-chain check, public RPC at block 95888686: `eth_getCode` returns 31 KB of runtime code and
 *  `idToMarketParams(0xff762c8a...50ca)` answers with the USDG/AMZN market (oracle 0xB1E9...eE3A, LLTV 0.625e18). */
export const MORPHO_BLUE: Address = "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010";

export const morphoAbi = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "function supplyCollateral(MarketParams marketParams, uint256 assets, address onBehalf, bytes data)",
  "function borrow(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsBorrowed, uint256 sharesBorrowed)",
  "function repay(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsRepaid, uint256 sharesRepaid)",
  "function withdrawCollateral(MarketParams marketParams, uint256 assets, address onBehalf, address receiver)",
  "function accrueInterest(MarketParams marketParams)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
]);

export const oracleAbi = parseAbi(["function price() view returns (uint256)"]);

/** The IRM reads the market state in Morpho's `Market` struct order. */
export const irmAbi = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "struct Market { uint128 totalSupplyAssets; uint128 totalSupplyShares; uint128 totalBorrowAssets; uint128 totalBorrowShares; uint128 lastUpdate; uint128 fee; }",
  "function borrowRateView(MarketParams marketParams, Market market) view returns (uint256)",
]);

export type MarketParams = { loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint };

export const WAD = 10n ** 18n;
/** Morpho prices collateral in loan units scaled by 1e36 (`Morpho.ORACLE_PRICE_SCALE`). */
export const ORACLE_PRICE_SCALE = 10n ** 36n;
/** Virtual offsets Morpho adds when it converts borrow shares to assets (`SharesMathLib`). */
export const VIRTUAL_SHARES = 10n ** 6n;
export const VIRTUAL_ASSETS = 1n;
const BPS = 10_000n;

/** The slider tops out at this share of the borrow limit, so the position starts at a health factor of at least 1.33. */
export const BORROW_CAP_BPS = 7_500n;
/** Shares of the previewed deposit left in the wallet, so a price move between quote and block cannot make `supplyCollateral` ask for more than the deposit minted. */
export const COLLATERAL_MARGIN_BPS = 50n;

/** `MarketParamsLib.id`: keccak256 of the five words, which is how Morpho keys every market. */
export function marketId(p: MarketParams): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
    [p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv],
  ));
}

// ---- borrow math, a line-for-line port of Morpho._isHealthy -------------------------------------------------------------------------

/** Loan-token value of `collateral`, rounded down: `collateral.mulDivDown(price, ORACLE_PRICE_SCALE)`. */
export const collateralValue = (collateral: bigint, price: bigint): bigint => (collateral * price) / ORACLE_PRICE_SCALE;

/** The most a position holding `collateral` may owe before it is liquidatable: `collateralValue.wMulDown(lltv)`. */
export const maxBorrowOf = (collateral: bigint, price: bigint, lltv: bigint): bigint => (collateralValue(collateral, price) * lltv) / WAD;

/** What `borrowShares` owe in loan units, rounded up: `SharesMathLib.toAssetsUp`. Interest accrued since the market's last update is not in it. */
export function debtAssets(borrowShares: bigint, totalBorrowAssets: bigint, totalBorrowShares: bigint): bigint {
  const num = borrowShares * (totalBorrowAssets + VIRTUAL_ASSETS);
  const den = totalBorrowShares + VIRTUAL_SHARES;
  return (num + den - 1n) / den;
}

/** USDG the market can still lend: supplied less borrowed. */
export const marketLiquidity = (totalSupplyAssets: bigint, totalBorrowAssets: bigint): bigint =>
  totalSupplyAssets > totalBorrowAssets ? totalSupplyAssets - totalBorrowAssets : 0n;

/** Shares to post as collateral from a deposit quote: the quote less the margin. */
export const collateralFromQuote = (quotedShares: bigint): bigint => (quotedShares * (BPS - COLLATERAL_MARGIN_BPS)) / BPS;

export type BorrowRoom = {
  /** The market's hard limit for the whole position: what Morpho calls `maxBorrow`. */
  maxBorrow: bigint;
  /** Most the slider offers: the safe share of the limit, less what the position already owes, and never more than the market can lend. */
  cap: bigint;
  /** True when the market's own liquidity, not the safe share of the limit, is the binding bound. */
  liquidityBound: boolean;
};

/** `collateral` is the position's whole collateral after this flow, `debt` what it already owes. */
export function borrowRoom(p: { collateral: bigint; price: bigint; lltv: bigint; debt: bigint; liquidity: bigint }): BorrowRoom {
  const maxBorrow = maxBorrowOf(p.collateral, p.price, p.lltv);
  const safe = (maxBorrow * BORROW_CAP_BPS) / BPS;
  const headroom = safe > p.debt ? safe - p.debt : 0n;
  const liquidityBound = p.liquidity < headroom;
  return { maxBorrow, cap: liquidityBound ? p.liquidity : headroom, liquidityBound };
}

/** The slider position `bps` (0 to 10000) as a loan amount of the cap. */
export const borrowAtBps = (cap: bigint, bps: number): bigint => (cap * BigInt(Math.round(bps))) / BPS;

export type PositionRisk = {
  /** Total owed after the borrow. */
  debt: bigint;
  /** Share price, in the oracle's 1e36 scale, at which the position becomes liquidatable. Zero when nothing is owed. */
  liquidationPrice: bigint;
  /** How far the share price may fall from `price` before liquidation, as a fraction of it. Null when nothing is owed. */
  dropToLiquidation: number | null;
  /** Borrow limit over debt. Null when nothing is owed. */
  healthFactor: number | null;
};

/** Where the position stands once `collateral` backs `debt`: the share price at which `collateralValue * lltv == debt`, rounded up so it is never optimistic. */
export function positionRisk(p: { collateral: bigint; price: bigint; lltv: bigint; debt: bigint }): PositionRisk {
  if (p.debt === 0n || p.collateral === 0n) return { debt: p.debt, liquidationPrice: 0n, dropToLiquidation: null, healthFactor: null };
  const den = p.collateral * p.lltv;
  const num = p.debt * ORACLE_PRICE_SCALE * WAD;
  const liquidationPrice = (num + den - 1n) / den;
  const drop = p.price > 0n ? 1 - Number((liquidationPrice * 1_000_000n) / p.price) / 1_000_000 : 0;
  const limit = maxBorrowOf(p.collateral, p.price, p.lltv);
  return {
    debt: p.debt,
    liquidationPrice,
    dropToLiquidation: Math.max(0, drop),
    healthFactor: Number((limit * 1_000_000n) / p.debt) / 1_000_000,
  };
}

/** A share's price in dollars (USDG) from the oracle's 1e36-scaled figure: loan raw units per collateral raw unit. */
export const sharePriceUsd = (price: bigint, shareDecimals: number, loanDecimals: number): number =>
  Number((price * 10n ** BigInt(shareDecimals)) / ORACLE_PRICE_SCALE) / 10 ** loanDecimals;

/** Per-second rate (WAD) to a yearly rate in percent, simple not compounded. */
export const aprPct = (ratePerSecond: bigint): number => (Number(ratePerSecond) * 31_536_000) / 1e18 * 100;

// ---- the batch --------------------------------------------------------------------------------------------------------------------

export type Call = { to: Address; data: Hex };
export type StepId = "approve-token" | "deposit" | "approve-shares" | "supply-collateral" | "borrow" | "withdraw-collateral" | "redeem-in-kind" | "approve-usdg" | "repay";
export type Step = { id: StepId; label: string; call: Call };

const erc20Approve = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const vault4626 = parseAbi(["function deposit(uint256 assets, address receiver) returns (uint256)"]);

export type FlowPlan = {
  symbol: string;
  token: Address;
  vault: Address;
  market: MarketParams;
  account: Address;
  /** Stock Token the vault takes. */
  deposit: bigint;
  /** Vault shares posted as collateral. */
  collateral: bigint;
  /** USDG to borrow; zero makes this the earn-only deposit. */
  borrow: bigint;
  /** Current allowances, so an approval already in place is not sent again. */
  tokenAllowance: bigint;
  shareAllowance: bigint;
};

/** The calls of the flow, in order: approve token, deposit, approve share, supplyCollateral, borrow. Approvals are for the exact amount and skipped when the allowance already covers it.
 *  Zero borrow stops after the deposit. */
export function earnAndBorrowSteps(p: FlowPlan): Step[] {
  if (p.deposit <= 0n) throw new Error("deposit must be positive");
  const steps: Step[] = [];
  if (p.tokenAllowance < p.deposit) {
    steps.push({ id: "approve-token", label: `Approve ${p.symbol}`, call: { to: p.token, data: encodeFunctionData({ abi: erc20Approve, functionName: "approve", args: [p.vault, p.deposit] }) } });
  }
  steps.push({ id: "deposit", label: `Deposit ${p.symbol} into the vault`, call: { to: p.vault, data: encodeFunctionData({ abi: vault4626, functionName: "deposit", args: [p.deposit, p.account] }) } });
  if (p.borrow === 0n) return steps;
  if (p.collateral <= 0n) throw new Error("collateral must be positive to borrow");
  if (p.market.collateralToken.toLowerCase() !== p.vault.toLowerCase()) throw new Error("market collateral is not this vault's share");
  if (p.shareAllowance < p.collateral) {
    steps.push({ id: "approve-shares", label: "Approve the shares to Morpho", call: { to: p.vault, data: encodeFunctionData({ abi: erc20Approve, functionName: "approve", args: [MORPHO_BLUE, p.collateral] }) } });
  }
  steps.push({ id: "supply-collateral", label: "Post the shares as collateral", call: { to: MORPHO_BLUE, data: encodeFunctionData({ abi: morphoAbi, functionName: "supplyCollateral", args: [p.market, p.collateral, p.account, "0x"] }) } });
  steps.push({ id: "borrow", label: "Borrow USDG", call: { to: MORPHO_BLUE, data: encodeFunctionData({ abi: morphoAbi, functionName: "borrow", args: [p.market, p.borrow, 0n, p.account, p.account] }) } });
  return steps;
}

/** EIP-5792 `wallet_getCapabilities` result for one chain: atomic batching is usable when the wallet reports it supported, or ready (a smart-account upgrade it offers on first use). */
export function supportsAtomicBatch(capabilities: unknown, chainId: number): boolean {
  if (typeof capabilities !== "object" || capabilities === null) return false;
  const forChain = (capabilities as Record<number, unknown>)[chainId];
  if (typeof forChain !== "object" || forChain === null) return false;
  const atomic = (forChain as { atomic?: { status?: unknown } }).atomic;
  return atomic?.status === "supported" || atomic?.status === "ready";
}

/** True when a `wallet_sendCalls` failure means "this wallet cannot batch here" (method unknown, chain or atomicity unsupported), so the flow falls back to
 *  one transaction per step. A user rejection (4001) or a revert is not in this set: those stop the flow instead of asking the wallet again. */
export function isBatchUnsupported(err: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const { name, code } = cur as { name?: unknown; code?: unknown };
    if (name === "UnsupportedProviderMethodError" || name === "MethodNotSupportedRpcError") return true;
    if (code === -32601 || code === 4200 || code === 5710 || code === 5760) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// ---- market config ----------------------------------------------------------------------------------------------------------------

export type MarketEntry = { oracle: Address; irm: Address; lltv: bigint };

/** Reads web/lib/collateral-markets.json. A vault with no entry, or a malformed one, has no borrow panel: nothing is guessed. */
export function parseMarkets(raw: unknown): Record<string, MarketEntry> {
  if (typeof raw !== "object" || raw === null || !("markets" in raw)) throw new Error("collateral markets: missing markets");
  const markets = (raw as { markets: unknown }).markets;
  if (typeof markets !== "object" || markets === null || Array.isArray(markets)) throw new Error("collateral markets: markets must be an object");
  const out: Record<string, MarketEntry> = {};
  for (const [id, e] of Object.entries(markets)) {
    const m = e as { oracle?: unknown; irm?: unknown; lltv?: unknown } | null;
    if (!m || typeof m.oracle !== "string" || !isAddress(m.oracle) || typeof m.irm !== "string" || !isAddress(m.irm) || typeof m.lltv !== "string" || !/^\d+$/.test(m.lltv)) {
      throw new Error(`collateral markets: ${id} needs oracle, irm and lltv`);
    }
    const lltv = BigInt(m.lltv);
    if (lltv <= 0n || lltv >= WAD) throw new Error(`collateral markets: ${id} lltv must be between 0 and 1e18`);
    out[id] = { oracle: getAddress(m.oracle), irm: getAddress(m.irm), lltv };
  }
  return out;
}

/** The market a vault's share is collateral in: USDG loan, the share as collateral, the configured oracle, IRM and LLTV. */
export const marketFor = (entry: MarketEntry, usdg: Address, vault: Address): MarketParams => ({
  loanToken: usdg,
  collateralToken: vault,
  oracle: entry.oracle,
  irm: entry.irm,
  lltv: entry.lltv,
});
