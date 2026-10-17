import type { Address } from "viem";

export type VaultConfig = {
  id: string;
  symbol: string;
  name: string;
  token: Address;
  pool: Address;
  feeTier: string;
  /** Deployed vault address; undefined while the vault is opening. */
  vault: Address | undefined;
};

const asAddress = (v: string | undefined): Address | undefined =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined;

export const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

// process.env.NEXT_PUBLIC_* must be referenced literally so Next inlines them.
export const VAULTS: VaultConfig[] = [
  {
    id: "nvda",
    symbol: "NVDA",
    name: "NVIDIA Stock Token",
    token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    pool: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3",
    feeTier: "0.05%",
    vault: asAddress(process.env.NEXT_PUBLIC_VAULT_NVDA),
  },
  {
    id: "spcx",
    symbol: "SPCX",
    name: "SPCX Stock Token",
    token: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
    pool: "0xc61284332117c3FB23A2A56cceFFD07F7aF60029",
    feeTier: "0.05%",
    vault: asAddress(process.env.NEXT_PUBLIC_VAULT_SPCX),
  },
];

export const getVault = (id: string) => VAULTS.find((v) => v.id === id);
