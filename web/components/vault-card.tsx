"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { BandChart } from "./band-chart";
import { FetchError, Skeleton } from "./status";
import { WhyThisPool } from "./why-this-pool";
import { useVaultStats } from "@/lib/hooks";
import { pct, signed } from "@/lib/format";
import { sourceLabel } from "@/lib/keeper";
import type { VaultConfig } from "@/lib/vaults";
import universe from "@/lib/vault-universe.json";

type GateState = "open" | "reduced" | "closed";

/** The gate state the keeper wrote into vault-universe.json for this vault. Anything absent or unrecognised reads as closed. */
function gateState(id: string): GateState {
  const state = universe.vaults.find((v) => v.id === id)?.gate?.state;
  return state === "open" || state === "reduced" ? state : "closed";
}

export function VaultStatus({ cfg }: { cfg: VaultConfig }) {
  const state = gateState(cfg.id);
  if (state === "closed") return <span className="rounded-full bg-sage px-3 py-1 text-sm font-semibold text-body">Closed</span>;
  if (state === "reduced") return <span className="rounded-full bg-warning px-3 py-1 text-sm font-semibold text-ink">Reduced</span>;
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
            <span className="text-lg font-semibold text-body">fee APR 30d</span>
          </p>
          <p className="figure mt-2 text-sm text-body">
            Kept, held-out <span className="font-medium text-ink">{signed(cfg.keptAprPct)}</span>
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
