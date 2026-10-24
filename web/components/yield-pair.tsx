import { Kept, toneClass } from "./ledger";
import { Term } from "./term";
import { KEPT_AFTER, yieldOrder } from "@/lib/fee-lead";
import { pct, signed } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The yield of one vault, two lines. The fee leads where kept is zero or positive; where kept is negative the kept line is the headline and the fee is the smaller line under it
 *  (`yieldOrder`). Every surface that stacks the figures prints them through this pair, so the kept line cannot be left out.
 *  `hero` is the vault page's verdict block; `side` is the line pair in the list's deposit panel. */
export function YieldPair({ feeApr, keptApr, size, className }: { feeApr: number; keptApr: number; size: "hero" | "side"; className?: string }) {
  const order = yieldOrder(keptApr);
  if (size === "side") {
    const line = {
      fees: <><Term id="feesEarned" /> <span className="figure whitespace-nowrap font-medium">{pct(feeApr)} a year</span></>,
      kept: <><Term id="kept">{KEPT_AFTER}</Term> <span className="whitespace-nowrap"><Kept value={keptApr} className="font-medium" /> a year</span> in the <Term id="worstHalf">weaker half</Term> of the replay.</>,
    };
    return (
      <div className={className}>
        <p data-lead={order[0]} className="text-[15px] leading-6">{line[order[0]]}</p>
        <p className="text-[13px] leading-5 text-mute">{line[order[1]]}</p>
      </div>
    );
  }
  const line = {
    fees: <><Term id="feesEarned" /> <span className="whitespace-nowrap">{pct(feeApr)} a year</span></>,
    kept: <><Term id="kept">{KEPT_AFTER}</Term> <span className={cn("whitespace-nowrap", toneClass(keptApr))}>{signed(keptApr)} a year</span></>,
  };
  return (
    <p className={cn("serif verdict max-w-[900px]", className)}>
      <span data-lead={order[0]} className="block text-[30px] leading-[34px] sm:text-[44px] sm:leading-[48px]">{line[order[0]]}</span>
      <span className="mt-2 block text-[22px] leading-7 sm:text-[28px] sm:leading-9">{line[order[1]]}</span>
    </p>
  );
}
