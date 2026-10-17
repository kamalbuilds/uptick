"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { FetchError, Skeleton } from "./status";
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
          <p className="display mt-5 text-[clamp(4.5rem,13vw,7rem)] text-ink" aria-label={`Fee APR ${pct(q.data.feeAprPct)}`}>
            {pct(q.data.feeAprPct)}
            <span className="ml-2 align-baseline text-lg font-semibold tracking-normal text-body" style={{ fontFamily: "var(--font-sans)" }}>fee APR</span>
          </p>
          <p className="mt-2 text-sm text-body">
            {q.data.source === "replay" ? "Replay: " : ""}
            <strong className="font-semibold text-ink">{sourceLabel(q.data)}</strong>.
          </p>
        </>
      )}
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
