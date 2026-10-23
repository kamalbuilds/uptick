import { createPublicClient, getAddress, http, isAddress, type Address, type PublicClient } from "viem";
import markets from "../data/collateral-markets.json";
import { erc20Abi, vaultAbi } from "./shared/abis.ts";
import { loanView, marketStateOf, planSafer, type InKindQuote, type LoanView, type MarketState, type SaferPlan } from "./shared/loan.ts";
import { MORPHO_BLUE, irmAbi, marketFor, marketId, morphoAbi, oracleAbi, parseMarkets, type MarketEntry, type MarketParams } from "./shared/morpho.ts";

export const USDG_ADDRESS: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
/** The same file the web app reads (web/lib/collateral-markets.json), copied by `npm run sync`. A vault with no entry has no loan to watch. */
export const MARKETS: Record<string, MarketEntry> = parseMarkets(markets);

/** Batched JSON-RPC: the reads of one step share one HTTP request, which keeps a scheduled run inside the Worker's subrequest limit. */
export const makeClient = (url: string): PublicClient => createPublicClient({ transport: http(url, { batch: true, retryCount: 1, timeout: 10_000 }) });

/** Why a vault has no loan to read, or its market and the deployed vault. */
export function marketOf(vaults: Record<string, string>, vaultId: string, markets: Record<string, MarketEntry> = MARKETS): { ok: true; market: MarketParams; vault: Address } | { ok: false; reason: string } {
  const entry = markets[vaultId];
  if (!entry) return { ok: false, reason: `no Morpho market is configured for vault ${vaultId}` };
  const raw = vaults[vaultId];
  if (!raw || !isAddress(raw)) return { ok: false, reason: `no deployed vault for ${vaultId} on this network` };
  const vault = getAddress(raw);
  return { ok: true, market: marketFor(entry, USDG_ADDRESS, vault), vault };
}

/** The market-wide half of a read: state, oracle price, rate and the chain's clock. One per vault, shared by every position in it. */
export type MarketSide = { market: MarketParams; vault: Address; id: `0x${string}`; state: MarketState; price: bigint; rate: bigint; now: bigint };

export async function readMarketSide(client: PublicClient, market: MarketParams, vault: Address): Promise<MarketSide | null> {
  const id = marketId(market);
  const [m, price, block] = await Promise.all([
    client.readContract({ address: MORPHO_BLUE, abi: morphoAbi, functionName: "market", args: [id] }),
    client.readContract({ address: market.oracle, abi: oracleAbi, functionName: "price" }),
    client.getBlock(),
  ]);
  const state = marketStateOf(m);
  if (state.lastUpdate === 0n) return null;
  const rate = await client.readContract({ address: market.irm, abi: irmAbi, functionName: "borrowRateView", args: [market, state] });
  return { market, vault, id, state, price, rate, now: block.timestamp };
}

export type Position = { collateral: bigint; borrowShares: bigint };
export async function readPosition(client: PublicClient, side: MarketSide, owner: Address): Promise<Position> {
  const [, borrowShares, collateral] = await client.readContract({ address: MORPHO_BLUE, abi: morphoAbi, functionName: "position", args: [side.id, owner] });
  return { collateral, borrowShares };
}

export const viewOf = (side: MarketSide, p: Position): LoanView =>
  loanView({ collateral: p.collateral, borrowShares: p.borrowShares, market: side.state, borrowRate: side.rate, now: side.now, price: side.price, lltv: side.market.lltv });

/** What a webhook and a tool report about a loan. Shares are 24-decimal vault shares, money is raw USDG (6 decimals), the price is the oracle's 1e36 scale per raw share. */
export function describeLoan(side: MarketSide, v: LoanView) {
  return {
    collateral_shares: v.collateral.toString(),
    collateral_value_usdg: v.collateralValue.toString(),
    debt_usdg: v.debt.toString(),
    health_factor: v.risk.healthFactor,
    drop_to_liquidation: v.risk.dropToLiquidation,
    liquidation_share_price: v.risk.liquidationPrice.toString(),
    share_price: side.price.toString(),
    lltv: side.market.lltv.toString(),
  };
}

/** The unsigned plan for one wallet: reads the wallet's USDG, its allowance to Morpho and, when it may be needed, what the vault would pay for an in-kind exit of all the collateral. */
export async function planFor(client: PublicClient, side: MarketSide, owner: Address, pos: Position, target: number): Promise<SaferPlan> {
  const [usdgBalance, usdgAllowance] = await Promise.all([
    client.readContract({ address: USDG_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    client.readContract({ address: USDG_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [owner, MORPHO_BLUE] }),
  ]);
  let inKind: InKindQuote | undefined;
  if (pos.collateral > 0n) {
    // The vault is asked as Morpho would ask it: Morpho holds the shares, so it can redeem them without an allowance. No signature, no state change.
    inKind = await client
      .simulateContract({ address: side.vault, abi: vaultAbi, functionName: "redeemInKind", args: [pos.collateral, owner, MORPHO_BLUE], account: MORPHO_BLUE })
      .then((r) => ({ shares: pos.collateral, stock: r.result[0], usdg: r.result[1] }), () => undefined);
  }
  return planSafer({
    symbol: "stock", market: side.market, vault: side.vault, account: owner, collateral: pos.collateral, borrowShares: pos.borrowShares, state: side.state,
    borrowRate: side.rate, now: side.now, price: side.price, target, usdgBalance, usdgAllowance, inKind,
  });
}
