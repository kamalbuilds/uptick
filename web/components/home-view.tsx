"use client";

import { CaretRight } from "@phosphor-icons/react";
import Link from "next/link";
import { CheckForm } from "./check-form";
import { SectionTitle, StateChip } from "./ledger";
import { SummaryRow } from "./summary-row";
import { RowHeader, VaultRow } from "./vault-row";
import { WalletButton } from "./wallet-button";
import { Skeleton } from "./status";
import { REDUCED_CAP_STOCK_USD } from "@/lib/evidence";
import { liveSentence, num, usdWhole } from "@/lib/format";
import { useHoldings, type Holdings } from "@/lib/holdings";
import { BY_KEEP, GATE_COUNTS, LIVE_VAULTS, REPLAY_WINDOW, VAULTS, isoDay } from "@/lib/vaults";
import { Button } from "@/components/ui/button";
import moment from "@/lib/moment.json";

/** Left column below the verdict: the connect call to action, then what the connected wallet holds across the 17 tokens. */
function Mine({ holdings }: { holdings: Holdings }) {
  if (holdings.status === "disconnected") {
    return <WalletButton size="lg" variant="outline" label="Or connect a wallet" className="mt-4 w-full sm:w-auto" />;
  }
  if (holdings.status === "loading") return <Skeleton className="mt-8 h-24 w-full max-w-sm" />;
  if (holdings.status === "error") {
    return (
      <div role="alert" className="mt-8 max-w-sm border-t border-hairline pt-4">
        <p className="font-semibold">The chain did not answer for your balances.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={holdings.retry}>Retry</Button>
      </div>
    );
  }
  const mine = BY_KEEP.filter((v) => holdings.held.has(v.id));
  if (mine.length === 0) {
    return <p className="mt-8 max-w-sm border-t border-hairline pt-4 text-mute">This wallet holds none of the {VAULTS.length} stock tokens. Any of them can be bought on Robinhood Chain, then put to work here.</p>;
  }
  return (
    <div className="mt-8 max-w-sm border-t border-hairline pt-4">
      <p className="font-semibold">You hold {mine.length} of the {VAULTS.length}</p>
      <ul className="mt-2">
        {mine.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-4 border-b border-hairline py-2.5">
            <span><span className="font-semibold">{v.symbol}</span> <span className="text-mute">{num(holdings.held.get(v.id) ?? 0, 4)}</span></span>
            <StateChip state={v.gate.state} />
          </li>
        ))}
      </ul>
      <Link href={`/check?address=${holdings.address}`} className="press mt-3 inline-flex min-h-11 items-center text-fg underline underline-offset-4">See what you would keep</Link>
    </div>
  );
}

export function HomeView() {
  const holdings = useHoldings();
  const held = holdings.status === "ready" ? holdings.held : undefined;
  const taking = BY_KEEP.filter((v) => v.gate.state !== "closed");
  const closed = BY_KEEP.filter((v) => v.gate.state === "closed");

  return (
    <section className="mx-auto grid max-w-[1280px] gap-x-16 gap-y-10 px-6 pb-20 pt-10 lg:grid-cols-[340px_minmax(0,1fr)] lg:pt-12">
      <div className="lg:sticky lg:top-24 lg:self-start">
        <h1 className="serif verdict text-[30px] font-normal leading-[34px] sm:text-[40px] sm:leading-[44px]">Which of your stock tokens can earn, and how much you would keep.</h1>
        <p className="mt-5 text-mute">
          {Math.round(moment.offHours.swapsPct)}% of the swaps in these pools, and {Math.round(moment.offHours.feesPct)}% of the fees they pay liquidity providers, happen while the NYSE is shut, over the {REPLAY_WINDOW.days} days to {isoDay(REPLAY_WINDOW.end)}.
          {" "}{LIVE_VAULTS.length ? "Uptick runs" : "Uptick is launching"} vaults that pay Stock Token holders while Nasdaq sleeps, and shows what each one keeps after losses to fast traders. {liveSentence(LIVE_VAULTS.map((v) => v.symbol))}
        </p>
        <div className="mt-8 max-w-sm border-t border-hairline pt-5">
          <h2 className="text-[17px] font-semibold leading-6">Find your idle Stock Tokens</h2>
          <CheckForm stacked className="mt-3" />
        </div>
        <Mine holdings={holdings} />
      </div>

      <div>
        <SummaryRow className="mb-8" />
        <div className="space-y-10">
          <section aria-labelledby="taking">
            <SectionTitle id="taking" aside={<>Open takes any amount. Reduced takes up to {usdWhole(REDUCED_CAP_STOCK_USD)} a deposit, or the vault&rsquo;s size if smaller.</>}>
              Cleared to open <span className="ml-1 text-[17px] font-normal text-mute">{taking.length}</span>
            </SectionTitle>
            <RowHeader />
            {taking.map((v) => <VaultRow key={v.id} cfg={v} held={held?.get(v.id)} />)}
          </section>

          <details className="group">
            <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline pb-3 [&::-webkit-details-marker]:hidden">
              <h2 className="text-2xl font-semibold leading-8 tracking-[-0.2px]">
                Closed <span className="ml-1 text-[17px] font-normal text-mute">{closed.length}</span>
              </h2>
              <span className="flex items-center gap-2 text-[13px] text-mute">
                The worst half kept less than the -20% floor
                <span className="inline-flex items-center gap-1 text-fg">
                  <span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span>
                  <CaretRight size={14} weight="bold" aria-hidden className="transition-transform duration-150 group-open:rotate-90" />
                </span>
              </span>
            </summary>
            <RowHeader />
            {closed.map((v) => <VaultRow key={v.id} cfg={v} held={held?.get(v.id)} />)}
          </details>
        </div>
      </div>
    </section>
  );
}
