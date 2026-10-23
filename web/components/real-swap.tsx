import { ArrowSquareOut } from "@phosphor-icons/react";
import { SectionTitle } from "./ledger";
import { txUrl } from "@/lib/chain";
import { num, shortAddress, usd } from "@/lib/format";
import swap from "@/lib/real-swap.json";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-3">
      <dt className="text-mute">{k}</dt>
      <dd className="figure text-[17px] font-medium">{children}</dd>
    </div>
  );
}

/** One swap from the replay window, read from the PoolManager's Swap log: the vault page of the token it belongs to shows it, no other page does. */
export function RealSwap({ symbol, pool }: { symbol: string; pool: string }) {
  if (symbol !== swap.symbol || pool.toLowerCase() !== swap.pool.toLowerCase()) return null;
  const perDollar = swap.poolFeeUsd / swap.markoutLossUsd;
  return (
    <section aria-labelledby="real-swap">
      <SectionTitle id="real-swap" aside={`Block ${swap.block.toLocaleString("en-US")}`}>One real swap</SectionTitle>
      <p className="mt-4 max-w-[690px] text-mute">
        {when(swap.time)} in New York, Nasdaq shut. A trade routed through {swap.routedSwaps} pool swaps sold {num(swap.amountToken, 1)} {swap.symbol} into this one at {usd(swap.priceBefore)} while Chainlink read {usd(swap.chainlink)}.
        An hour later the pool stood at {usd(swap.priceHourLater)}.
      </p>
      <dl className="mt-4 max-w-[690px] border-t border-hairline">
        <Row k="Transaction">
          <span className="inline-flex items-center gap-3">
            <span title={swap.tx}>{shortAddress(swap.tx)}</span>
            <a aria-label="Transaction on the explorer" className="-m-2 p-2 text-mute hover:text-fg" href={txUrl(swap.tx)} target="_blank" rel="noreferrer"><ArrowSquareOut size={16} aria-hidden /></a>
          </span>
        </Row>
        <Row k="Size">{usd(swap.sizeUsd)}</Row>
        <Row k="Fee the pool earned">{usd(swap.poolFeeUsd)}</Row>
        <Row k="Lost to liquidity providers after 1 hour">{usd(swap.markoutLossUsd)}</Row>
        <Row k="Fee per $1 lost">${perDollar.toFixed(2)}</Row>
      </dl>
    </section>
  );
}
