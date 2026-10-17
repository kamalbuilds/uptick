"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { BandChart } from "./band-chart";
import { FetchError, Skeleton } from "./status";
import { WhyThisPool } from "./why-this-pool";
import { useVaultStats } from "@/lib/hooks";
import { pct, usd } from "@/lib/format";
import { sourceLabel } from "@/lib/keeper";
import type { VaultConfig } from "@/lib/vaults";

export function VaultStatus({ cfg }: { cfg: VaultConfig }) {
  return cfg.vault ? (
    <span className="rounded-full bg-primary-pale px-3 py-1 text-sm font-semibold text-positive-deep">Open for deposits</span>
  ) : (
    <span className="rounded-full bg-ink px-3 py-1 text-sm font-semibold text-primary">Opening</span>
  );
}

/** The featured vault: fee APR leads, with its window and source on the next line. */
export function FeaturedVaultCard({ cfg }: { cfg: VaultConfig }) {
  const q = useVaultStats(cfg.id);
  return (
    <div className="rounded-xl bg-canvas p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl leading-none sm:text-3xl">{cfg.symbol} vault</h2>
        <VaultStatus cfg={cfg} />
      </div>
      <p className="mt-1 text-sm text-body">{cfg.symbol} / USDG pool, {cfg.feeTier} fee tier</p>

      {q.isError ? (
        <div className="mt-6"><FetchError what={`${cfg.symbol}`} onRetry={() => q.refetch()} /></div>
      ) : !q.data ? (
        <div className="mt-6 space-y-3"><Skeleton className="h-20 w-48" /><Skeleton className="h-5 w-72" /><Skeleton className="h-24 w-full" /></div>
      ) : (
        <>
          <p className="mt-5 flex items-baseline gap-3 whitespace-nowrap" aria-label={`Fee APR ${pct(q.data.feeAprPct)}`}>
            <span className="display text-[clamp(3.75rem,13vw,5.5rem)] text-ink">{pct(q.data.feeAprPct)}</span>
            <span className="text-lg font-semibold text-body">fee APR</span>
          </p>
          <p className="mt-2 text-sm text-body">
            {q.data.source === "replay" ? "Replay: " : ""}
            <strong className="font-semibold text-ink">{sourceLabel(q.data)}</strong>.
          </p>
          {q.data.chart ? (
            <div className="mt-6 border-t border-sage-line pt-4">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <p className="font-semibold text-ink">{cfg.symbol} price and its band, 14 days</p>
                <p className="figure text-body">{q.data.chart.inBand ? "In band" : "Outside band"}</p>
              </div>
              <div className="mt-2"><BandChart symbol={cfg.symbol} chart={q.data.chart} compact /></div>
            </div>
          ) : (
            <p className="mt-6 border-t border-sage-line pt-4 text-sm text-body">The price chart is waiting on the pool and Chainlink reads.</p>
          )}
        </>
      )}
      <WhyThisPool id={cfg.id} symbol={cfg.symbol} compact />
      <Button asChild size="lg" className="mt-6 w-full">
        <Link href={`/vault/${cfg.id}`}>Open the {cfg.symbol} vault <ArrowRight size={20} weight="bold" aria-hidden /></Link>
      </Button>
    </div>
  );
}

/** A compact vault row for lists. */
export function VaultRow({ cfg }: { cfg: VaultConfig }) {
  const q = useVaultStats(cfg.id);
  return (
    <Link
      href={`/vault/${cfg.id}`}
      className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 rounded-lg px-4 py-4 transition-colors duration-150 hover:bg-canvas sm:grid-cols-[1.2fr_1fr_1fr_auto]"
    >
      <div>
        <p className="display text-3xl">{cfg.symbol}</p>
        <p className="text-sm text-body">{cfg.name}, {cfg.feeTier} pool</p>
      </div>
      <p className="figure text-right text-xl font-medium sm:text-left">
        {q.data ? pct(q.data.feeAprPct) : q.isError ? "Unavailable" : <Skeleton className="inline-block h-6 w-16 align-middle" />}
        <span className="block text-xs font-normal text-body">{q.data ? `fee APR, ${q.data.aprWindowDays}-day ${q.data.source}` : "fee APR"}</span>
      </p>
      <p className="figure hidden text-xl font-medium sm:block">
        {q.data ? (q.data.tvlUsd === null ? "Opening" : usd(q.data.tvlUsd)) : q.isError ? "Unavailable" : <Skeleton className="inline-block h-6 w-20 align-middle" />}
        <span className="block text-xs font-normal text-body">TVL</span>
      </p>
      <span className="col-span-2 justify-self-start sm:col-span-1 sm:justify-self-end"><VaultStatus cfg={cfg} /></span>
    </Link>
  );
}
