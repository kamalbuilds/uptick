"use client";

import Link from "next/link";
import { ArrowLeft, ArrowSquareOut, CopySimple } from "@phosphor-icons/react";
import { useState } from "react";
import { BandChart, BandReadout } from "./band-chart";
import { DepositPanel } from "./deposit-panel";
import { VaultStatus } from "./vault-card";
import { FetchError, Skeleton } from "./status";
import { FeeNow } from "./fee-now";
import { useVaultStats } from "@/lib/hooks";
import { addressUrl } from "@/lib/chain";
import { pct, shortAddress, usd } from "@/lib/format";
import { sourceLabel } from "@/lib/keeper";
import { VAULTS, USDG, type VaultConfig } from "@/lib/vaults";

function AddressRow({ label, address }: { label: string; address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-body">{label}</dt>
      <dd className="figure flex items-center gap-3 text-sm">
        <span title={address}>{shortAddress(address)}</span>
        <button
          aria-label={`Copy ${label} address`}
          className="text-body hover:text-ink"
          onClick={async () => { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        >
          {copied ? <span className="text-xs">Copied</span> : <CopySimple size={16} aria-hidden />}
        </button>
        <a aria-label={`${label} on the explorer`} className="text-body hover:text-ink" href={addressUrl(address)} target="_blank" rel="noreferrer">
          <ArrowSquareOut size={16} aria-hidden />
        </a>
      </dd>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-body">{k}</dt>
      <dd className="figure text-lg font-medium">{v}</dd>
    </div>
  );
}

export function VaultDetail({ cfg }: { cfg: VaultConfig }) {
  const q = useVaultStats(cfg.id);
  const other = VAULTS.find((v) => v.id !== cfg.id);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-8 pt-8 sm:px-6 lg:pt-12">
      <Link href="/" className="-my-2 inline-flex items-center gap-1.5 py-2 text-sm font-semibold hover:text-ink-deep">
        <ArrowLeft size={16} weight="bold" aria-hidden /> All vaults
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="display text-[clamp(3rem,8vw,6rem)]">{cfg.symbol} vault</h1>
        <VaultStatus cfg={cfg} />
      </div>
      <p className="mt-2 text-body">{cfg.name}, held in the {cfg.symbol}/USDG pool at the {cfg.feeTier} fee tier.</p>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-12">
        <div className="min-w-0 space-y-12">
          <section aria-labelledby="apr">
            <h2 id="apr" className="text-sm font-semibold uppercase tracking-[0.08em] text-body" style={{ fontFamily: "var(--font-sans)", fontStretch: "100%", letterSpacing: "0.08em" }}>Fee APR</h2>
            {q.isError ? (
              <div className="mt-3"><FetchError what={cfg.symbol} onRetry={() => q.refetch()} /></div>
            ) : !q.data ? (
              <div className="mt-3 space-y-3"><Skeleton className="h-24 w-64" /><Skeleton className="h-5 w-80" /></div>
            ) : (
              <>
                <p className="display text-[clamp(5rem,16vw,10rem)]">{pct(q.data.feeAprPct)}</p>
                <p className="mt-2 text-body">{q.data.source === "replay" ? "Replay. " : ""}{sourceLabel(q.data)}.</p>
              </>
            )}
          </section>

          <section aria-labelledby="fee">
            <h2 id="fee" className="text-3xl leading-none">The fee moves with the session</h2>
            <p className="mt-2 max-w-xl text-body">The Uptick hook sets the swap fee from the NYSE session, in the same transaction as the swap.</p>
            <div className="mt-4 rounded-xl bg-sage p-1"><FeeNow /></div>
          </section>

          <section aria-labelledby="band">
            <h2 id="band" className="text-3xl leading-none">The band follows the price</h2>
            <p className="mt-2 max-w-xl text-body">The vault holds {cfg.symbol} inside a band around the Chainlink price and re-centres it at each NYSE open. Fees accrue while the pool price is inside.</p>
            {q.isError ? (
              <div className="mt-4"><FetchError what={cfg.symbol} onRetry={() => q.refetch()} /></div>
            ) : !q.data ? (
              <Skeleton className="mt-4 h-80 w-full" />
            ) : q.data.chart ? (
              <div className="mt-4 rounded-xl bg-canvas p-4 sm:p-6">
                <BandChart symbol={cfg.symbol} chart={q.data.chart} />
                <BandReadout chart={q.data.chart} />
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-sage p-4 text-body">The price chart is waiting on the pool and Chainlink reads.</p>
            )}
          </section>

          <section aria-labelledby="tvl">
            <h2 id="tvl" className="text-3xl leading-none">Vault</h2>
            <dl className="mt-4 divide-y divide-sage-line border-y border-sage-line">
              <Fact k="Total value locked" v={!q.data ? "..." : q.data.tvlUsd === null ? "Opening" : usd(q.data.tvlUsd)} />
              <Fact k="Fee tier" v={cfg.feeTier} />
            </dl>
          </section>

          <section aria-labelledby="chain">
            <h2 id="chain" className="text-3xl leading-none">On-chain</h2>
            <dl className="mt-4 divide-y divide-sage-line border-y border-sage-line">
              {cfg.vault && <AddressRow label="Vault" address={cfg.vault} />}
              <AddressRow label={`${cfg.symbol} Stock Token`} address={cfg.token} />
              <AddressRow label="Pool" address={cfg.pool} />
              <AddressRow label="USDG" address={USDG} />
            </dl>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24" aria-label={`Deposit and withdraw ${cfg.symbol}`}>
          <DepositPanel cfg={cfg} />
          {other && (
            <p className="mt-4 text-sm text-body">
              Also open to view: <Link className="inline-block py-2 font-semibold underline underline-offset-4" href={`/vault/${other.id}`}>{other.symbol} vault</Link>
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
