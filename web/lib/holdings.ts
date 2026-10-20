"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { erc20Abi } from "./abis";
import { robinhoodChain } from "./chain";
import { VAULTS } from "./vaults";

const STOCK_DECIMALS = 18; // Stock Tokens are 18-decimal ERC-20s.

export type Holdings =
  | { status: "disconnected" }
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; address: `0x${string}`; /** Stock Token balance by vault id, zero balances left out. */ held: Map<string, number> };

/** The connected wallet's balance of every vault's Stock Token, read straight from Robinhood Chain in one multicall. */
export function useHoldings(): Holdings {
  const { address } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const r = useReadContracts({
    allowFailure: false,
    query: { enabled: Boolean(address), refetchInterval: 30_000 },
    contracts: address ? VAULTS.map((v) => ({ address: v.token, abi: erc20Abi, functionName: "balanceOf" as const, args: [address] as const, chainId: robinhoodChain.id })) : [],
  });
  if (!mounted || !address) return { status: "disconnected" };
  if (r.isError) return { status: "error", retry: () => void r.refetch() };
  if (!r.data) return { status: "loading" };
  const held = new Map<string, number>();
  VAULTS.forEach((v, i) => {
    const n = Number(formatUnits(r.data[i] as bigint, STOCK_DECIMALS));
    if (n > 0) held.set(v.id, n);
  });
  return { status: "ready", address, held };
}
