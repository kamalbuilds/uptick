import { getAddress, isAddress, type PublicClient } from "viem";
import { DEFAULT_TARGET_HEALTH, MAX_TARGET_HEALTH, MIN_TARGET_HEALTH, hasLoan } from "./shared/loan.ts";
import type { MarketEntry, Step } from "./shared/morpho.ts";
import { MARKETS, describeLoan, makeClient, marketOf, planFor, readMarketSide, readPosition, viewOf } from "./loan-chain";

export interface LoanToolEnv {
  VAULTS?: string;
  CHAIN_RPC_URL?: string;
}
export interface LoanToolDeps {
  client?: PublicClient;
  markets?: Record<string, MarketEntry>;
}
/** `payload` is the tool's structured answer; `steps` is the call list a prepare tool returns, empty otherwise; `isError` marks a refused request. */
export interface LoanToolResult {
  payload: Record<string, unknown>;
  steps: Step[];
  isError?: boolean;
}

const refuse = (message: string): LoanToolResult => ({ payload: { error: message }, steps: [], isError: true });

/** The shared front half of both tools: a valid wallet, a market for the vault, a deployed vault, a node to ask and a market that exists on-chain. */
async function open(env: LoanToolEnv, vaultId: string, rawAddress: unknown, deps: LoanToolDeps) {
  if (typeof rawAddress !== "string" || !isAddress(rawAddress)) return { kind: "fail" as const, result: refuse("address must be a valid 0x address") };
  const address = getAddress(rawAddress);
  const found = marketOf(parseVaultMap(env.VAULTS), vaultId, deps.markets ?? MARKETS);
  if (!found.ok) return { kind: "early" as const, fields: { address, has_market: false, has_position: false, reason: found.reason } };
  const client = deps.client ?? (env.CHAIN_RPC_URL ? makeClient(env.CHAIN_RPC_URL) : undefined);
  if (!client) return { kind: "fail" as const, result: refuse("chain reads are not configured on this server (CHAIN_RPC_URL)") };
  const side = await readMarketSide(client, found.market, found.vault).catch((e: Error) => e);
  if (side instanceof Error) return { kind: "fail" as const, result: refuse(`the chain did not answer: ${side.message.split("\n")[0].slice(0, 160)}`) };
  if (!side) return { kind: "early" as const, fields: { address, has_market: false, has_position: false, reason: `the Morpho market for vault ${vaultId} is configured but not created on-chain` } };
  return { kind: "ok" as const, address, client, side };
}

function parseVaultMap(raw: string | undefined): Record<string, string> {
  try {
    const m = raw ? (JSON.parse(raw) as unknown) : {};
    return typeof m === "object" && m !== null ? (m as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const NO_LOAN = "this wallet has no collateral or debt in the market";

export async function checkLoanHealth(env: LoanToolEnv, vaultId: string, rawAddress: unknown, deps: LoanToolDeps = {}): Promise<LoanToolResult> {
  const o = await open(env, vaultId, rawAddress, deps);
  if (o.kind === "fail") return o.result;
  if (o.kind === "early") return { payload: { vault: vaultId, ...o.fields }, steps: [] };
  const { address, client, side } = o;
  const pos = await readPosition(client, side, address).catch((e: Error) => e);
  if (pos instanceof Error) return refuse(`the chain did not answer: ${pos.message.split("\n")[0].slice(0, 160)}`);
  if (!hasLoan(pos.collateral, pos.borrowShares)) return { payload: { vault: vaultId, address, has_market: true, has_position: false, reason: NO_LOAN }, steps: [] };
  return {
    payload: { vault: vaultId, address, has_market: true, has_position: true, accrued_to: side.now.toString(), ...describeLoan(side, viewOf(side, pos)) },
    steps: [],
  };
}

export async function prepareMakeSafer(env: LoanToolEnv, vaultId: string, rawAddress: unknown, rawTarget: unknown, deps: LoanToolDeps = {}): Promise<LoanToolResult> {
  const target = rawTarget === undefined ? DEFAULT_TARGET_HEALTH : rawTarget;
  if (typeof target !== "number" || !Number.isFinite(target) || target < MIN_TARGET_HEALTH || target > MAX_TARGET_HEALTH) {
    return refuse(`target_health must be a number between ${MIN_TARGET_HEALTH} and ${MAX_TARGET_HEALTH}`);
  }
  const o = await open(env, vaultId, rawAddress, deps);
  if (o.kind === "fail") return o.result;
  if (o.kind === "early") return { payload: { vault: vaultId, ...o.fields, status: "no_market", target_health: target, transactions: [] }, steps: [] };
  const { address, client, side } = o;
  const pos = await readPosition(client, side, address).catch((e: Error) => e);
  if (pos instanceof Error) return refuse(`the chain did not answer: ${pos.message.split("\n")[0].slice(0, 160)}`);
  if (!hasLoan(pos.collateral, pos.borrowShares)) {
    return { payload: { vault: vaultId, address, has_market: true, has_position: false, status: "no_position", reason: NO_LOAN, target_health: target, transactions: [] }, steps: [] };
  }
  const plan = await planFor(client, side, address, pos, target).catch((e: Error) => e);
  if (plan instanceof Error) return refuse(`the chain did not answer: ${plan.message.split("\n")[0].slice(0, 160)}`);
  const head = { vault: vaultId, address, has_market: true, has_position: true, target_health: target };
  switch (plan.status) {
    case "no-position":
      return { payload: { ...head, has_position: false, status: "no_position", reason: plan.reason, transactions: [] }, steps: [] };
    case "already-safe":
      return { payload: { ...head, status: "already_safe", health_factor: plan.health, reason: "the position already meets the target health factor", transactions: [] }, steps: [] };
    case "unreachable":
      return { payload: { ...head, status: "unreachable", reason: plan.reason, transactions: [] }, steps: [] };
    case "ready":
      return {
        payload: {
          ...head,
          status: "ready",
          path: plan.path === "repay" ? "repay" : "in_kind",
          health_before: plan.before.healthFactor,
          health_after_estimate: plan.after.healthFactor,
          repay_usdg: plan.repay.toString(),
          shares_withdrawn: plan.shares.toString(),
          stock_returned: plan.stock.toString(),
          rounds: plan.rounds,
          note: plan.path === "repay"
            ? "Repays the least USDG that reaches the target, sized on the debt ten minutes ahead. The user signs and sends the calls in order."
            : "The wallet holds too little USDG. Each round takes shares out of Morpho, exits them in kind and repays with the USDG leg; the stock leg returns to the wallet. The calls must run in order, ideally as one atomic batch.",
        },
        steps: plan.steps,
      };
  }
}
