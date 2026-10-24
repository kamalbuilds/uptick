/** What the vault holds, read live: loose balances plus the position's principal and uncollected fees. */
export type VaultHoldings = {
  supply: bigint;
  /** Stock Token balance of the vault less totalStockOwed, as _idleStock() in StockVault.sol. */
  idleStock: bigint;
  idleUsdg: bigint;
  positionStock: bigint;
  positionUsdg: bigint;
  feesStock: bigint;
  feesUsdg: bigint;
};

/** The pro-rata slice of both tokens `shares` take out of the vault: holdings * shares / supply, the same split
 *  redeemInKind's _release makes (loose balances and the position's liquidity are both cut by shares / supply). */
export function inKindSlice(shares: bigint, h: VaultHoldings): { stock: bigint; usdg: bigint } | null {
  if (shares <= 0n || h.supply <= 0n || shares > h.supply) return null;
  return {
    stock: ((h.idleStock + h.positionStock + h.feesStock) * shares) / h.supply,
    usdg: ((h.idleUsdg + h.positionUsdg + h.feesUsdg) * shares) / h.supply,
  };
}
