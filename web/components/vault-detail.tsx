"use client";

import Link from "next/link";
import { ArrowSquareOut, CopySimple } from "@phosphor-icons/react";
import { useState } from "react";
import { useAccount } from "wagmi";
import { BandChart, BandReadout } from "./band-chart";
import { DepositPanel } from "./deposit-panel";
import { ExitPreview } from "./exit-preview";
import { GateFigure } from "./gate-scale";
import { LeakFigure } from "./leak-bar";
import { SectionTitle, StateChip, toneClass } from "./ledger";
import { PriceLine } from "./price";
import { Term } from "./term";
import { PairLogo } from "./token-logo";
import { FetchError, Skeleton } from "./status";
import { WhyThisPool } from "./why-this-pool";
import { useVaultStats } from "@/lib/hooks";
import { addressUrl } from "@/lib/chain";
import { entryFeePct, perDepositLimitUsd, shortAddress, signed, usd, usdWhole } from "@/lib/format";
import { REPLAY_WINDOW, USDG, isoDay, type VaultConfig } from "@/lib/vaults";

function AddressRow({ label, address }: { label: string; address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline py-3">
      <dt className="text-mute">{label}</dt>
      <dd className="figure flex items-center gap-3">
        <span title={address}>{shortAddress(address)}</span>
        <button
          aria-label={`Copy ${label} address`}
          className="-m-2 p-2 text-mute hover:text-fg"
          onClick={async () => { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        >
          {copied ? <span className="text-xs">Copied</span> : <CopySimple size={16} aria-hidden />}
        </button>
        <a aria-label={`${label} on the explorer`} className="-m-2 p-2 text-mute hover:text-fg" href={addressUrl(address)} target="_blank" rel="noreferrer">
          <ArrowSquareOut size={16} aria-hidden />
        </a>
      </dd>
    </div>
  );
}

function Fact({ k, v }: { k: React.ReactNode; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-3">
      <dt className="text-mute">{k}</dt>
      <dd className="figure text-[17px] font-medium">{v}</dd>
    </div>
  );
}

/** The second sentence of the verdict: what the door is doing today. */
function doorSentence(cfg: VaultConfig): string {
  const live = Boolean(cfg.vault);
  if (cfg.gate.state === "closed") return "Deposits are closed.";
  if (cfg.gate.state === "reduced") {
    const limit = usdWhole(perDepositLimitUsd(cfg.depositCapUsd));
    return live ? `Deposits are reduced at ${limit} each.` : `Its vault is opening, with deposits reduced at ${limit} each.`;
  }
  return live ? "Deposits are open." : "Its vault is opening.";
}

export function VaultDetail({ cfg }: { cfg: VaultConfig }) {
  const q = useVaultStats(cfg.id);
  const { address } = useAccount();
  const worst = cfg.gate.worstHalfApr;

  return (
    <>
      <div className="mx-auto max-w-[1280px] px-6 pb-14 pt-8 lg:pt-10">
        <nav aria-label="Breadcrumb" className="text-[13px] text-mute">
          <Link href="/vaults" className="-my-2 inline-block py-2 hover:text-fg">Vaults</Link> / <span className="text-fg">{cfg.symbol}</span>
        </nav>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <PairLogo symbol={cfg.symbol} size={40} />
          <h1 className="text-[32px] font-medium leading-10 tracking-[-0.33px]">{cfg.symbol} vault</h1>
          <StateChip state={cfg.gate.state} term />
          <span className="figure inline-flex h-6 items-center rounded-full border border-hairline px-2.5 text-[13px] text-mute" title={`${cfg.gate.swaps.toLocaleString("en-US")} swaps, ${isoDay(REPLAY_WINDOW.start)} to ${isoDay(REPLAY_WINDOW.end)}`}>
            Replay to {isoDay(REPLAY_WINDOW.end)} · {cfg.gate.swaps.toLocaleString("en-US")} swaps
          </span>
        </div>
        <p className="mt-2 text-mute">{cfg.name} in the {cfg.symbol} / USDG pool, {cfg.feeTier} fee tier</p>
        <p className="mt-1"><PriceLine id={cfg.id} /></p>

        <p className="serif verdict mt-8 max-w-[900px] text-[30px] font-normal leading-[34px] sm:text-[44px] sm:leading-[48px]">
          {cfg.symbol} kept <span className={toneClass(worst)}>{signed(worst)}</span> a year in its <span className="whitespace-nowrap"><Term id="worstHalf">weaker half</Term>.</span> {doorSentence(cfg)}
        </p>

        <div className="mt-12 space-y-14">
          <LeakFigure cfg={cfg} />
          <GateFigure cfg={cfg} />
          <ExitPreview vault={cfg.vault} symbol={cfg.symbol} user={address} />

          <section aria-labelledby="band">
            <SectionTitle id="band">The band follows the price</SectionTitle>
            <p className="mt-4 max-w-[690px] text-mute">The vault holds {cfg.symbol} inside a plus or minus {cfg.bandBps / 100}% band around the Chainlink price and re-centres it at 02:00 UTC after each NYSE session. Fees accrue while the pool price is inside.</p>
            {q.isError ? (
              <div className="mt-4 max-w-xl"><FetchError what={cfg.symbol} onRetry={() => q.refetch()} /></div>
            ) : !q.data ? (
              <Skeleton className="mt-4 h-80 w-full" />
            ) : q.data.chart ? (
              <div className="mt-4">
                <BandChart symbol={cfg.symbol} chart={q.data.chart} />
                <BandReadout chart={q.data.chart} />
              </div>
            ) : (
              <p className="mt-4 text-mute">The price chart is waiting on the pool and Chainlink reads.</p>
            )}
          </section>

          <section aria-labelledby="fee">
            <SectionTitle id="fee">Why this pool</SectionTitle>
            <WhyThisPool id={cfg.id} symbol={cfg.symbol} />
          </section>

          <div className="grid gap-x-16 gap-y-14 lg:grid-cols-2">
            <section aria-labelledby="tvl">
              <SectionTitle id="tvl">Vault</SectionTitle>
              <dl className="border-t-0">
                <Fact k="Total value locked" v={!q.data ? "..." : q.data.tvlUsd === null ? "Opening" : usd(q.data.tvlUsd)} />
                <Fact k="Vault size" v={usdWhole(cfg.depositCapUsd)} />
                <Fact k="Fee tier" v={cfg.feeTier} />
                <Fact k={<Term id="entryFee" />} v={entryFeePct(cfg.entryFeeBps)} />
                <Fact k="Replay window" v={`${isoDay(REPLAY_WINDOW.start)} to ${isoDay(REPLAY_WINDOW.end)}`} />
              </dl>
            </section>
            <section aria-labelledby="chain">
              <SectionTitle id="chain" aside="Robinhood Chain 4663">On-chain</SectionTitle>
              <dl>
                {cfg.vault && <AddressRow label="Vault" address={cfg.vault} />}
                <AddressRow label={`${cfg.symbol} Stock Token`} address={cfg.token} />
                <AddressRow label="Pool" address={cfg.pool} />
                <AddressRow label="USDG" address={USDG} />
              </dl>
            </section>
          </div>
        </div>
      </div>

      <DepositPanel cfg={cfg} />
    </>
  );
}
