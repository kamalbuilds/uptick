import { useQuery } from "@tanstack/react-query";
import { KEEPER_BASE, parseVaultStats, type VaultStats } from "./keeper";

/** The stats API's /vaults list: every eligible vault with its fee APR, no price charts. */
export async function fetchVaultList(): Promise<VaultStats[]> {
  const res = await fetch(`${KEEPER_BASE}/vaults`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`stats API /vaults answered ${res.status}`);
  const body: unknown = await res.json();
  const vaults = typeof body === "object" && body !== null ? (body as { vaults?: unknown }).vaults : undefined;
  if (!Array.isArray(vaults)) throw new Error("stats API /vaults carried no vaults array");
  return vaults.map(parseVaultStats);
}

export const useVaultList = () => useQuery({ queryKey: ["vaults"], queryFn: fetchVaultList, refetchInterval: 30_000 });
