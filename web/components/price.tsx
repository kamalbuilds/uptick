"use client";

import { Skeleton } from "./status";
import { feedAgeLabel, feedAgeSeconds, priceLabel } from "@/lib/price-math";
import { usePrices } from "@/lib/prices";
import { cn } from "@/lib/utils";

/** The vault's Chainlink price, right-aligned. The title carries how old the feed's latest round is, since a stock feed rests while the market is shut. */
export function PriceCell({ id, className }: { id: string; className?: string }) {
  const q = usePrices();
  const p = q.data?.byId.get(id);
  if (q.isPending) return <Skeleton className={cn("ml-auto h-4 w-14", className)} />;
  if (!p) return <span className={cn("text-mute", className)} title="The Chainlink read did not return this feed">n/a</span>;
  return (
    <span className={cn("figure", className)} title={`Chainlink on Robinhood Chain, latest round ${feedAgeLabel(feedAgeSeconds(p.updatedAt, Date.now()))} old`}>
      {priceLabel(p.usd)}
    </span>
  );
}

/** "$217.02" with the age of the feed's latest round beside it, for the panel where a depositor decides. */
export function PriceLine({ id }: { id: string }) {
  const q = usePrices();
  const p = q.data?.byId.get(id);
  if (q.isPending) return <Skeleton className="h-5 w-40" />;
  if (!p) return <span className="text-[13px] text-mute">The Chainlink read did not return this feed.</span>;
  return (
    <span className="figure text-[15px]">
      <span className="font-medium">{priceLabel(p.usd)}</span>
      <span className="ml-2 text-[13px] text-mute">Chainlink, round {feedAgeLabel(feedAgeSeconds(p.updatedAt, Date.now()))} old</span>
    </span>
  );
}
