"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { robinhoodChain } from "./chain";
import { feedUsd } from "./price-math.ts";
import { VAULTS } from "./vaults";

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

/** Multicall3 at its canonical address; Robinhood Chain has it deployed (eth_getCode is non-empty). */
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || robinhoodChain.rpcUrls.default.http[0], { retryCount: 2, retryDelay: 400 }),
});

export type FeedPrice = { usd: number; /** Unix seconds of the feed's latest round. */ updatedAt: number };
export type Prices = { byId: Map<string, FeedPrice>; /** Wall-clock ms the multicall answered. */ readAt: number };

/** One multicall reads latestRoundData and decimals for every vault's Chainlink proxy. A feed that fails or answers a broken round is left out, never defaulted. */
export async function fetchPrices(): Promise<Prices> {
  const contracts = VAULTS.flatMap((v) => [
    { address: v.feed, abi: feedAbi, functionName: "latestRoundData" as const },
    { address: v.feed, abi: feedAbi, functionName: "decimals" as const },
  ]);
  const res = await client.multicall({ contracts, allowFailure: true, multicallAddress: MULTICALL3 });
  const byId = new Map<string, FeedPrice>();
  VAULTS.forEach((v, i) => {
    const round = res[2 * i];
    const dec = res[2 * i + 1];
    if (round.status !== "success" || dec.status !== "success") return;
    const [, answer, , updatedAt] = round.result as readonly [bigint, bigint, bigint, bigint, bigint];
    const usd = feedUsd(answer, Number(dec.result));
    if (usd !== null) byId.set(v.id, { usd, updatedAt: Number(updatedAt) });
  });
  if (byId.size === 0) throw new Error("Chainlink multicall answered no usable round");
  return { byId, readAt: Date.now() };
}

/** Live Chainlink price per vault id, refreshed every 30 seconds and shared by the rows, the panel and the ticker. */
export const usePrices = () => useQuery({ queryKey: ["chainlink-prices"], queryFn: fetchPrices, refetchInterval: 30_000, staleTime: 15_000 });
