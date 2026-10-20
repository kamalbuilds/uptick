"use client";

import { CaretRight } from "@phosphor-icons/react";
import { RowAxis, SectionTitle, StateChip } from "./ledger";
import { RowHeader, VaultRow } from "./vault-row";
import { WalletButton } from "./wallet-button";
import { Skeleton } from "./status";
import { REDUCED_CAP_STOCK_USD } from "@/lib/evidence";
import { num, swapsLabel, usdWhole } from "@/lib/format";
import { useHoldings, type Holdings } from "@/lib/holdings";
import { BY_KEEP, GATE_COUNTS, REPLAYED_SWAPS, REPLAY_WINDOW, VAULTS, isoDay, type GateState } from "@/lib/vaults";
import { Button } from "@/components/ui/button";

const byState = (s: GateState) => BY_KEEP.filter((v) => v.gate.state === s);

/** Left column below the verdict: the connect call to action, then what the connected wallet holds across the 17 tokens. */
function Mine({ holdings }: { holdings: Holdings }) {
  if (holdings.status === "disconnected") {
    return <WalletButton size="lg" label="Connect wallet to find yours" className="mt-8 w-full sm:w-auto" />;
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
    </div>
  );
}

export function HomeView() {
  const holdings = useHoldings();
  const held = holdings.status === "ready" ? holdings.held : undefined;
  const open = byState("open"), reduced = byState("reduced"), closed = byState("closed");
  const groups = [
    { state: "open" as const, title: "Open", note: "No limit on a single deposit.", rows: open },
    { state: "reduced" as const, title: "Reduced", note: `A single deposit may add up to ${usdWhole(REDUCED_CAP_STOCK_USD)} of stock token.`, rows: reduced },
  ];

  return (
    <section className="mx-auto grid max-w-[1280px] gap-x-16 gap-y-10 px-6 pb-20 pt-10 lg:grid-cols-[340px_minmax(0,1fr)] lg:pt-12">
      <div className="lg:sticky lg:top-24 lg:self-start">
        <h1 className="serif verdict text-[30px] font-normal leading-[34px] sm:text-[40px] sm:leading-[44px]">Which of your stock tokens can earn, and how much you would keep.</h1>
        <p className="mt-5 text-mute">
          Every vault sits behind one of three doors, set by {swapsLabel(REPLAYED_SWAPS)} swaps replayed over the {REPLAY_WINDOW.days} days to {isoDay(REPLAY_WINDOW.end)}.{" "}
          {GATE_COUNTS.open} are open, {GATE_COUNTS.reduced} are capped, {GATE_COUNTS.closed} are closed.
        </p>
        <Mine holdings={holdings} />
      </div>

      <div>
        <div className="mb-4"><RowHeader left="You keep a year, weaker half" right="" axis={<RowAxis />} /></div>
        <div className="space-y-10">
          {groups.map((g) => (
            <div key={g.state}>
              <SectionTitle aside={g.note}>
                {g.title} <span className="ml-1 text-[17px] font-normal text-mute">{g.rows.length}</span>
              </SectionTitle>
              {g.rows.map((v) => <VaultRow key={v.id} cfg={v} held={held?.get(v.id)} />)}
            </div>
          ))}

          <details className="group">
            <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline pb-3 [&::-webkit-details-marker]:hidden">
              <h2 className="text-2xl font-semibold leading-8 tracking-[-0.2px]">
                {closed.length} closed
              </h2>
              <span className="flex items-center gap-2 text-[13px] text-mute">
                The weaker half kept less than the -20% floor
                <span className="inline-flex items-center gap-1 text-fg">
                  <span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span>
                  <CaretRight size={14} weight="bold" aria-hidden className="transition-transform duration-150 group-open:rotate-90" />
                </span>
              </span>
            </summary>
            {closed.map((v) => <VaultRow key={v.id} cfg={v} held={held?.get(v.id)} />)}
          </details>
        </div>
      </div>
    </section>
  );
}
