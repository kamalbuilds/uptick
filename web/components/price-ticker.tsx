"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TokenLogo } from "./token-logo";
import { priceLabel } from "@/lib/price-math";
import { usePrices } from "@/lib/prices";
import { ago } from "@/lib/format";
import { BY_KEEP } from "@/lib/vaults";

/** How long ago the multicall answered, ticking once a second. */
function ReadStamp({ readAt }: { readAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="figure">{ago(readAt, now)}</span>;
}

function Items({ prices, hidden }: { prices: Map<string, { usd: number }> | undefined; hidden?: boolean }) {
  return (
    <ul className={hidden ? "ticker-dup flex shrink-0" : "flex shrink-0"} aria-hidden={hidden || undefined}>
      {BY_KEEP.map((v) => {
        const p = prices?.get(v.id);
        return (
          <li key={v.id}>
            <Link href={`/vault/${v.id}`} tabIndex={hidden ? -1 : undefined} className="flex h-9 items-center gap-2 px-4 text-[13px] hover:bg-panel">
              <TokenLogo symbol={v.symbol} size={20} />
              <span className="font-medium">{v.symbol}</span>
              <span className="figure text-mute">{p ? priceLabel(p.usd) : "n/a"}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The bottom strip: every vault's Chainlink price, read from Robinhood Chain every 30 seconds. It scrolls, pauses on hover and focus, and
 *  under prefers-reduced-motion it stands still and scrolls by hand. */
export function PriceTicker() {
  const q = usePrices();
  return (
    <div className="ticker fixed inset-x-0 bottom-0 z-30 flex h-9 border-t border-hairline bg-canvas text-[13px]" role="region" aria-label="Chainlink prices">
      <div className="flex shrink-0 items-center gap-2 border-r border-hairline px-4 text-mute">
        <span className={q.isError ? "size-1.5 rounded-full bg-loss" : "size-1.5 rounded-full bg-kept"} aria-hidden />
        {q.isError ? (
          <span>
            Chainlink did not answer{" "}
            <button type="button" className="text-fg underline underline-offset-4" onClick={() => void q.refetch()}>Retry</button>
          </span>
        ) : q.data ? (
          <span>Chainlink, <ReadStamp readAt={q.dataUpdatedAt} /></span>
        ) : (
          <span>Chainlink</span>
        )}
      </div>
      {!q.isError && (
        <div className="ticker-viewport min-w-0 flex-1 overflow-hidden">
          <div className="ticker-track flex w-max">
            <Items prices={q.data?.byId} />
            <Items prices={q.data?.byId} hidden />
          </div>
        </div>
      )}
    </div>
  );
}
