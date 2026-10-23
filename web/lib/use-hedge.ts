"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { hedgeable, planHedge, type HedgePlan } from "./hedge.ts";
import { readMultipliers } from "./hedge-chain.ts";
import { BORROW_APR_QUERY, MORPHO_API, parseBorrowApr } from "./hedge-view.ts";
import { fetchAssetDetails, fetchFundings, fetchOrderBookDetails, fetchOrderBookOrders, type Sourced } from "./lighter.ts";
import { READ_LAG } from "./scan.ts";
import { client as rhcClient } from "./use-scan";
import { USDG } from "./vaults";

export type BorrowRate = { pct: number; source: string; fetchedAt: string };

/** How the margin of the short is priced on this panel. */
export type MarginBasis =
  /** The holder borrowed USDG on Morpho already, at the rate the loan screen reads. */
  | { kind: "loan"; rate: BorrowRate }
  /** Lighter counts the token itself as margin: no borrow interest enters the cost. */
  | { kind: "stock"; loanToValue: number | null; capTokens: number | null; roomTokens: number | null }
  /** The margin is USDG borrowed on the token's deepest Morpho market at its live rate. */
  | { kind: "borrow"; rate: BorrowRate; marketId: string }
  /** No Morpho market holds supply for this token, or the API did not answer: margin is the holder's own USDG and no interest is counted. */
  | { kind: "own"; why: "no_market" | "api_error" };

export type HedgeInput = {
  symbol: string;
  token: Address;
  /** The Stock Token to cover, raw 18-decimal units: a wallet balance, or the stock leg of vault shares. Undefined while it is still being read. */
  balanceRaw: bigint | undefined;
  /** The block the balance was read at; the multiplier is read at the same block. Undefined reads a few blocks behind the head. */
  block?: bigint;
  /** The rate a borrower already pays, from the loan screen. Present means the margin is that loan. */
  loanRate?: BorrowRate;
  enabled: boolean;
};

export type HedgeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "unsized"; reason: string }
  | { status: "ready"; plan: HedgePlan; margin: MarginBasis; multiplierBlock: bigint; readAt: string };

const LIVE = { staleTime: 30_000, retry: 1 } as const;

async function fetchBorrow(token: Address): Promise<Sourced<ReturnType<typeof parseBorrowApr>>> {
  const res = await fetch(MORPHO_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: BORROW_APR_QUERY, variables: { c: [token], l: [USDG] } }),
  });
  if (!res.ok) throw new Error(`Morpho API answered HTTP ${res.status}`);
  return { data: parseBorrowApr(await res.json()), url: MORPHO_API, fetchedAt: new Date().toISOString() };
}

/** Everything one hedge panel needs, fetched only once `enabled` is true (the panel is open): Lighter RH's markets, assets, book and funding with keyless GETs from the browser,
 *  the token's uiMultiplier from the chain, and the Morpho rate when the margin would be borrowed. The plan is lib/hedge.ts planHedge on those reads and nothing else. */
export function useHedgePlan(i: HedgeInput): HedgeState {
  const on = i.enabled;
  const perps = useQuery({ queryKey: ["lighter", "orderBookDetails"], queryFn: () => fetchOrderBookDetails(), enabled: on, ...LIVE });
  const assets = useQuery({ queryKey: ["lighter", "assetDetails"], queryFn: () => fetchAssetDetails(), enabled: on, ...LIVE });
  const perp = perps.data?.data.find((m) => m.symbol.toUpperCase() === i.symbol.toUpperCase() && m.status === "active");
  const marketId = perp?.marketId;
  const book = useQuery({ queryKey: ["lighter", "book", marketId], queryFn: () => fetchOrderBookOrders(marketId as number), enabled: on && marketId !== undefined, ...LIVE, staleTime: 10_000 });
  const fundings = useQuery({ queryKey: ["lighter", "fundings", marketId], queryFn: () => fetchFundings(marketId as number), enabled: on && marketId !== undefined, ...LIVE });
  const mult = useQuery({
    queryKey: ["hedge", "uiMultiplier", i.token, i.block?.toString() ?? "head"],
    enabled: on && marketId !== undefined,
    ...LIVE,
    queryFn: async () => {
      const block = i.block ?? (await rhcClient.getBlockNumber()) - READ_LAG;
      const [read] = await readMultipliers(rhcClient, [i.token], block);
      return { read, block, fetchedAt: new Date().toISOString() };
    },
  });

  const eligible = assets.data ? hedgeable([{ symbol: i.symbol, token: i.token }], perps.data?.data ?? [], assets.data.data)[0] : undefined;
  const wantsBorrow = on && marketId !== undefined && i.loanRate === undefined && eligible !== undefined && !eligible.marginEligible;
  const morpho = useQuery({ queryKey: ["morpho", "borrow", i.token], queryFn: () => fetchBorrow(i.token), enabled: wantsBorrow, ...LIVE, retry: 0 });

  const queries = [perps, assets, book, fundings, mult, ...(wantsBorrow ? [morpho] : [])];
  const failed = [perps, assets, book, fundings, mult].find((q) => q.isError);
  const retry = () => { for (const q of queries) if (q.isError) void q.refetch(); };

  return useMemo<HedgeState>(() => {
    if (!on) return { status: "idle" };
    if (failed) return { status: "error", message: failed.error instanceof Error ? failed.error.message : "The read failed", retry };
    if (!perps.data || !assets.data || i.balanceRaw === undefined || eligible === undefined) return { status: "loading" };
    if (perp === undefined) return { status: "ready", plan: { status: "no_perp", symbol: i.symbol }, margin: { kind: "own", why: "no_market" }, multiplierBlock: 0n, readAt: perps.data.fetchedAt };
    if (!book.data || !fundings.data || !mult.data) return { status: "loading" };
    const read = mult.data.read;
    if (!read.ok) return { status: "unsized", reason: read.reason };
    if (wantsBorrow && morpho.isLoading) return { status: "loading" };

    let margin: MarginBasis;
    if (i.loanRate) margin = { kind: "loan", rate: i.loanRate };
    else if (eligible.marginEligible) {
      const a = assets.data.data.find((x) => x.l1Address.toLowerCase() === i.token.toLowerCase());
      margin = { kind: "stock", loanToValue: a?.loanToValue ?? null, capTokens: eligible.userCapTokens, roomTokens: eligible.globalRoom };
    } else if (morpho.isError) margin = { kind: "own", why: "api_error" };
    else if (morpho.data?.data) {
      const m = morpho.data.data;
      margin = { kind: "borrow", marketId: m.marketId, rate: { pct: m.pct, source: `${morpho.data.url} market ${m.marketId}, observed ${m.observedAt}`, fetchedAt: morpho.data.fetchedAt } };
    } else margin = { kind: "own", why: "no_market" };

    try {
      const plan = planHedge({
        symbol: i.symbol,
        token: i.token,
        balanceRaw: i.balanceRaw,
        tokenDecimals: 18,
        uiMultiplier: read.multiplier,
        uiMultiplierRead: { source: `eth_call uiMultiplier() on ${i.token} at block ${mult.data.block}`, fetchedAt: mult.data.fetchedAt },
        borrowApr: margin.kind === "loan" || margin.kind === "borrow" ? margin.rate : undefined,
        now: new Date(book.data.fetchedAt),
        perps: perps.data,
        assets: assets.data,
        book: book.data,
        fundings: fundings.data,
      });
      return { status: "ready", plan, margin, multiplierBlock: mult.data.block, readAt: book.data.fetchedAt };
    } catch (e) {
      return { status: "error", message: e instanceof Error ? e.message : "The plan could not be built", retry };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, failed?.error, perps.data, assets.data, book.data, fundings.data, mult.data, morpho.data, morpho.isLoading, morpho.isError, i.balanceRaw, i.loanRate?.pct, i.symbol, i.token, eligible?.marginEligible, wantsBorrow, perp]);
}
