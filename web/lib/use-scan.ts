"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, fallback, http, type Address } from "viem";
import { robinhoodChain } from "./chain";
import { lltvById } from "./collateral-markets";
import { RHC_RPCS, scanWallet } from "./scan.ts";
import { VAULTS } from "./vaults";

/** The configured RPC first, then the keyless public endpoints for chain 4663: one rate-limited endpoint does not end a scan. */
const primary = process.env.NEXT_PUBLIC_RPC_URL || robinhoodChain.rpcUrls.default.http[0];
const urls = [primary, ...RHC_RPCS.filter((u) => u !== primary)];

export const client = createPublicClient({
  chain: robinhoodChain,
  transport: fallback(urls.map((u) => http(u, { retryCount: 1, retryDelay: 400, timeout: 12_000 }))),
});

/** What a pasted wallet holds across the tracked Stock Tokens, from one Multicall3 call. Disabled until there is an address. */
export const useWalletScan = (owner: Address | null) =>
  useQuery({
    queryKey: ["wallet-scan", owner],
    enabled: owner !== null,
    staleTime: 30_000,
    queryFn: () => scanWallet(client, owner as Address, VAULTS, lltvById),
  });
