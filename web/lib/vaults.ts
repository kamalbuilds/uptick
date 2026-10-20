import { isAddress, type Address } from "viem";
import universe from "./vault-universe.json";

export type VaultConfig = {
  id: string;
  symbol: string;
  name: string;
  token: Address;
  pool: Address;
  /** Pool fee tier as shown, e.g. "0.05%". */
  feeTier: string;
  /** Vault size in USD, sized to the pool depth so the vault stays within 20% of in-range liquidity; the vault is created with this deposit cap. */
  depositCapUsd: number;
  /** Chainlink price (USD per stock) read when the universe was built. */
  refPriceUsd: number;
  /** Chainlink proxy that prices the vault. */
  feed: Address;
  /** Deployed vault address; undefined while the vault is opening. */
  vault: Address | undefined;
  /** Deposits are taken (open or reduced) when the lower kept APR of the replay's two halves clears the keeper's floor. */
  open: boolean;
  /** The deposit gate as the replay wrote it: state, the sentence, and the weaker half of the replay in percent a year. */
  gate: VaultGate;
  /** What the pool paid and what leaked, percent a year over the replay window. */
  keep: VaultKeep;
  /** 30-day fee APR of the chosen pool, percent. */
  feeAprPct: number;
};

export type GateState = "open" | "reduced" | "closed";
/** `worstHalfApr` is what a holder keeps a year in the weaker 15-day half: the one "you keep" figure on every page. */
export type VaultGate = { state: GateState; reason: string; floorApr: number; worstHalfApr: number; swaps: number; days: number };
export type VaultKeep = { feeApr: number; markoutApr: number; costApr: number; keptApr: number; keptFirstHalf: number; keptSecondHalf: number };

/** The replay window every gate figure was measured over. */
export const REPLAY_WINDOW = universe.window as { start: string; end: string; days: number };
/** "2026-10-17" from an ISO timestamp. */
export const isoDay = (iso: string): string => iso.slice(0, 10);

const asAddress = (v: string | undefined): Address | undefined =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined;

/** `NEXT_PUBLIC_VAULTS` is a JSON map of ticker to vault address, e.g. {"GOOGL":"0x..."}. Anything unparsable is ignored,
 *  and the vault stays "Opening" rather than pointing a deposit at a wrong address. */
function parseVaultMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const m: unknown = JSON.parse(raw);
    return typeof m === "object" && m !== null ? (m as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// process.env.NEXT_PUBLIC_* must be referenced literally so Next inlines them.
const mapped = parseVaultMap(process.env.NEXT_PUBLIC_VAULTS);
const fromEnv: Record<string, string | undefined> = {
  ...mapped,
  NVDA: process.env.NEXT_PUBLIC_VAULT_NVDA ?? mapped.NVDA,
  SPCX: process.env.NEXT_PUBLIC_VAULT_SPCX ?? mapped.SPCX,
};

/** Every Stock Token the keeper's eligibility rule admits, best 30-day fee APR first, each with its open or closed gate (web/lib/vault-universe.json). */
export const VAULTS: VaultConfig[] = universe.vaults.map((v) => ({
  id: v.id,
  symbol: v.symbol,
  name: v.name,
  token: v.token as Address,
  pool: v.pool as Address,
  feeTier: v.feeTier,
  depositCapUsd: v.depositCapUsd,
  refPriceUsd: v.refPriceUsd,
  feed: v.feed as Address,
  vault: asAddress(fromEnv[v.symbol]),
  open: v.open,
  gate: { state: v.gate.state as GateState, reason: v.gate.reason, floorApr: v.gate.floor_apr, worstHalfApr: v.gate.worst_half_apr, swaps: v.gate.swaps, days: v.gate.days },
  keep: { feeApr: v.keep.fee_apr_pct, markoutApr: v.keep.markout_apr_pct, costApr: v.keep.cost_apr_pct, keptApr: v.keep.kept_apr_pct, keptFirstHalf: v.keep.kept_first_half, keptSecondHalf: v.keep.kept_second_half },
  feeAprPct: v.feeAprPct,
}));

/** Vaults best-kept first: the order every list uses. */
export const BY_KEEP: VaultConfig[] = [...VAULTS].sort((a, b) => b.gate.worstHalfApr - a.gate.worstHalfApr);

export const GATE_COUNTS = {
  open: VAULTS.filter((v) => v.gate.state === "open").length,
  reduced: VAULTS.filter((v) => v.gate.state === "reduced").length,
  closed: VAULTS.filter((v) => v.gate.state === "closed").length,
};

/** Swaps replayed across every vault in the list, from each vault's own gate, all over REPLAY_WINDOW. */
export const REPLAYED_SWAPS = universe.vaults.reduce((n, v) => n + (v.gate?.swaps ?? 0), 0);

export const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

/** UptickRouter, the USDG on-ramp. Unset or malformed keeps the USDG option hidden rather than pointing at a wrong contract. */
export const ROUTER: `0x${string}` | undefined =
  process.env.NEXT_PUBLIC_ROUTER && isAddress(process.env.NEXT_PUBLIC_ROUTER)
    ? (process.env.NEXT_PUBLIC_ROUTER as `0x${string}`)
    : undefined;

export const getVault = (id: string) => VAULTS.find((v) => v.id === id);

/** Vault share decimals: the 18-decimal Stock Token plus StockVault._decimalsOffset() = 6 (ERC-4626 inflation guard). */
export const SHARE_DECIMALS = 24;
