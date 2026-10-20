import { Term } from "./term";
import { usd, swapsLabel } from "@/lib/format";
import { summaryFigures } from "@/lib/summary";
import poolFees from "@/lib/pool-fees.json";
import universe from "@/lib/vault-universe.json";
import { cn } from "@/lib/utils";

const s = summaryFigures(universe, poolFees);

function Metric({ label, value, unit, note, className }: { label: React.ReactNode; value: string; unit?: string; note: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[13px] leading-5 text-mute">{label}</dt>
      <dd className="figure mt-0.5 text-[24px] font-medium leading-8">{value}{unit ? <span className="ml-1.5 text-[15px] font-normal text-mute">{unit}</span> : null}</dd>
      <dd className="mt-0.5 text-[13px] leading-5 text-mute">{note}</dd>
    </div>
  );
}

/** Four facts from the replay and the vault list, each with its window under it. No deposits or TVL: no vault is on mainnet yet, so there is no figure to show. */
export function SummaryRow({ className }: { className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-4 border-y border-hairline py-4 lg:py-5 lg:grid-cols-4 lg:gap-x-0 lg:[&>div+div]:border-l lg:[&>div+div]:border-hairline lg:[&>div+div]:pl-6", className)}>
      <Metric label={<Term id="taking" />} value={String(s.taking)} unit={`of ${s.tracked}`} note={`${s.open} open, ${s.reduced} reduced`} />
      <Metric label="Swaps replayed" value={swapsLabel(s.swapsReplayed).replace(" million", "M")} note={`${s.windowDays} days to ${s.windowEnd}`} />
      <Metric className="col-span-2 lg:col-span-1" label="Fees paid to liquidity providers" value={usd(s.lpFeesUsd, { compact: true })} note={`On the ${s.tracked} vault pools, ${s.windowDays} days`} />
      <Metric className="hidden lg:block" label="Stock Tokens tracked" value={String(s.tracked)} note="Chainlink priced, USDG pools" />
    </dl>
  );
}
