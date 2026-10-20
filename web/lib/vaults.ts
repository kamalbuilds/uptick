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
  /** Chainlink proxy that prices the vault. */
  feed: Address;
  /** Deployed vault address; undefined while the vault is opening. */
  vault: Address | undefined;
  /** Deposits open when the lower kept APR of the replay's two halves clears the keeper's floor. */
  open: boolean;
  /** 30-day fee APR of the chosen pool, percent. */
  feeAprPct: number;
  /** Kept APR (fees less losses to informed traders and rebalancing cost) over the held-out 15 days, percent. */
  keptAprPct: number;
};

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
  feed: v.feed as Address,
  vault: asAddress(fromEnv[v.symbol]),
  open: v.open,
  feeAprPct: v.feeAprPct,
  keptAprPct: v.keptAprPct,
}));

export const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

/** UptickRouter, the USDG on-ramp. Unset or malformed keeps the USDG option hidden rather than pointing at a wrong contract. */
export const ROUTER: `0x${string}` | undefined =
  process.env.NEXT_PUBLIC_ROUTER && isAddress(process.env.NEXT_PUBLIC_ROUTER)
    ? (process.env.NEXT_PUBLIC_ROUTER as `0x${string}`)
    : undefined;

export const getVault = (id: string) => VAULTS.find((v) => v.id === id);

/** Vault share decimals: the 18-decimal Stock Token plus StockVault._decimalsOffset() = 6 (ERC-4626 inflation guard). */
export const SHARE_DECIMALS = 24;
