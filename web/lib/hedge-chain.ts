import { parseAbi, type Address, type PublicClient } from "viem";
import { inKindSlice, type VaultHoldings } from "./in-kind.ts";
import { MULTICALL3 } from "./scan.ts";

/** The on-chain half of the hedge: the ERC-8056 multiplier of each held Stock Token, read in one Multicall3 at the block a wallet scan used, and the stock leg of vault shares. */

const multiplierAbi = parseAbi(["function uiMultiplier() view returns (uint256)"]);

export type MultiplierRead = { ok: true; multiplier: bigint } | { ok: false; reason: string };

/** uiMultiplier() of every token in one eth_call at `block`. A call that reverts, or answers zero, leaves that token unsized with its reason; no token is given a default 1. */
export async function readMultipliers(client: Pick<PublicClient, "multicall">, tokens: readonly Address[], block: bigint): Promise<MultiplierRead[]> {
  if (tokens.length === 0) return [];
  const res = await client.multicall({
    contracts: tokens.map((address) => ({ address, abi: multiplierAbi, functionName: "uiMultiplier" as const })),
    allowFailure: true,
    multicallAddress: MULTICALL3,
    batchSize: 1 << 20,
    blockNumber: block,
  });
  return res.map((r) => {
    if (r.status !== "success") return { ok: false, reason: "uiMultiplier() reverted, so the share count is unknown" };
    if (r.result <= 0n) return { ok: false, reason: "uiMultiplier() answered zero" };
    return { ok: true, multiplier: r.result };
  });
}

/** The Stock Token a vault share position is worth: the pro-rata slice redeemInKind would hand back (idle, in the position and in uncollected fees), raw 18-decimal units.
 *  Null when the shares are zero, above supply, or the vault is empty. */
export function stockLegOfShares(vault: VaultHoldings, shares: bigint): bigint | null {
  return inKindSlice(shares, vault)?.stock ?? null;
}
