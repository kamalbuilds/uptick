import { BaseError, ContractFunctionRevertedError, type Address, type PublicClient } from "viem";
import { vaultAbi } from "./abi.ts";

/** The vault's custom error by name, e.g. "SpotOffTwap()" or "OracleUnhealthy(2)"; the first message line for anything else. */
export function revertName(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) {
      if (r.data) return `${r.data.errorName}(${(r.data.args ?? []).join(",")})`;
      return r.reason ?? r.shortMessage.split("\n")[0].slice(0, 300);
    }
  }
  return String((e as Error).message).split("\n")[0].slice(0, 300);
}

/**
 * eth_call of rebalance() as `from`. A revert (SpotOffTwap while spot sits off the TWAP, OracleUnhealthy, TooSoon, ...)
 * comes back as { ok: false, error } so the caller logs it, sends nothing and tries again on its next tick.
 */
export async function simulateRebalance(c: PublicClient, vault: Address, from: Address) {
  try {
    const { request } = await c.simulateContract({ address: vault, abi: vaultAbi, functionName: "rebalance", account: from });
    return { ok: true as const, request };
  } catch (e) {
    return { ok: false as const, error: revertName(e) };
  }
}
