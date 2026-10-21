import { BaseError, ContractFunctionRevertedError, type Address, type PublicClient } from "viem";
import { vaultAbi, vaultV4Abi } from "./abi.ts";

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
 * eth_call of rebalance() as `from`. A revert (SpotOffTwap while spot sits off the TWAP, TwapOffOracle while the TWAP sits off Chainlink, OracleUnhealthy, TooSoon, ...)
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

/** What the keeper does with a simulated poke(): send only when the simulation returned true. false = the oracle wrote nothing (rate-limited or no usable Chainlink answer), a thrown simulation = log it and move on. */
export function pokeDue(simulatedResult: boolean | undefined, error?: unknown): { send: boolean; skip: "failed" | "no_write" | null } {
  if (error !== undefined) return { send: false, skip: "failed" };
  if (simulatedResult === true) return { send: true, skip: null };
  return { send: false, skip: "no_write" };
}

/** eth_call of poke(). `result` is the vault's own bool: true when a transaction would write an observation. `error` is set when the simulation reverted. `from` is optional because poke() is permissionless. */
export async function simulatePoke(c: PublicClient, vault: Address, from?: Address): Promise<{ result?: boolean; error?: string; request?: unknown }> {
  try {
    const { request, result } = await c.simulateContract({ address: vault, abi: vaultV4Abi, functionName: "poke", account: from });
    return { result, request };
  } catch (e) {
    return { error: revertName(e) };
  }
}
