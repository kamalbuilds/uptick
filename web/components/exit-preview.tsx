"use client";

import type { ReactNode } from "react";
import { formatUnits, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "./ledger";
import { vaultAbi } from "@/lib/abis";
import { robinhoodChain } from "@/lib/chain";
import { num } from "@/lib/format";
import { Skeleton } from "./status";

const STOCK_DECIMALS = 18;
const FEED_OK = 0;

function Shell({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="exit-preview">
      <SectionTitle id="exit-preview">If you withdraw now</SectionTitle>
      {children}
    </section>
  );
}

/** Read-only view of the connected wallet's position: redeemable stock token value, feed state, and the in-kind exit that stays open. */
export function ExitPreview({ vault, symbol, user }: { vault?: Address; symbol: string; user?: Address }) {
  const reads = useReadContracts({
    allowFailure: true,
    query: { enabled: Boolean(vault && user), refetchInterval: 20_000 },
    contracts: vault && user ? [
      { address: vault, abi: vaultAbi, functionName: "balanceOf", args: [user], chainId: robinhoodChain.id },
      { address: vault, abi: vaultAbi, functionName: "health", chainId: robinhoodChain.id },
    ] : [],
  });

  const balanceRead = reads.data?.[0];
  const healthRead = reads.data?.[1];
  const shares = balanceRead?.status === "success" ? balanceRead.result : undefined;
  const health = healthRead?.status === "success" ? healthRead.result : undefined;

  const previews = useReadContracts({
    allowFailure: true,
    query: { enabled: Boolean(vault && shares !== undefined && shares > 0n), refetchInterval: 20_000 },
    contracts: vault && shares !== undefined && shares > 0n
      ? [{ address: vault, abi: vaultAbi, functionName: "previewRedeem", args: [shares], chainId: robinhoodChain.id }]
      : [],
  });
  const previewRead = previews.data?.[0];
  const preview = previewRead?.status === "success" ? previewRead.result : undefined;

  if (!vault || !user) return null;

  if (reads.isPending) {
    return (
      <Shell>
        <div aria-busy="true" className="mt-4 space-y-3">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
      </Shell>
    );
  }

  if (reads.isError || shares === undefined) {
    return (
      <Shell>
        <div role="alert" className="mt-4 max-w-xl rounded-lg border border-line p-4">
          <p className="font-semibold">The chain did not answer for your position.</p>
          <p className="mt-1 text-[13px] text-mute">Every figure here is read live. Retry asks again.</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => reads.refetch()}>Retry</Button>
        </div>
      </Shell>
    );
  }

  if (shares === 0n) return null;

  const fresh = health !== undefined && health[0] === FEED_OK;
  const statusKnown = health !== undefined;

  return (
    <Shell>
      <div className="grid gap-x-12 gap-y-6 pt-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="text-[13px] text-mute">Your shares are worth</p>
          {previews.isPending ? (
            <Skeleton className="mt-1 h-9 w-44" />
          ) : preview !== undefined ? (
            <p className="figure mt-1 text-[32px] font-medium leading-9" aria-live="polite">
              {num(Number(formatUnits(preview, STOCK_DECIMALS)), 6)} {symbol}
            </p>
          ) : (
            <p className="mt-1 text-[17px] font-semibold">Unavailable right now</p>
          )}
        </div>
        <div>
          {statusKnown ? (
            <>
              <p className="flex items-center gap-2 font-semibold">
                <span className={`size-2 shrink-0 rounded-full ${fresh ? "bg-kept" : "bg-caution"}`} aria-hidden />
                <span className={fresh ? "text-fg" : "text-caution"}>{fresh ? "Feed fresh" : "Feed paused"}</span>
              </p>
              <p className="mt-1 text-[13px] leading-5 text-mute">
                {fresh
                  ? "The Chainlink feed is current, so deposits and priced withdrawals are open."
                  : "Deposits and priced withdrawals pause while the Chainlink feed is stale; exit in kind still works"}
              </p>
            </>
          ) : (
            <p className="text-[13px] leading-5 text-mute">Feed status is unavailable right now, so the vault&rsquo;s priced exit cannot be confirmed. Exit in kind still works.</p>
          )}
          <p className="mt-3 text-[13px] leading-5 text-mute">
            <span className="font-semibold text-fg">Exit in kind (always available):</span> returns your share of both tokens, works even when the price feed is stale.
          </p>
        </div>
      </div>
    </Shell>
  );
}
