import { Kept, toneClass } from "./ledger";
import { Term } from "./term";
import { KEPT_AFTER } from "@/lib/fee-lead";
import { pct, signed } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The yield of one vault, fee first and kept directly under it. Every surface that leads with the fee figure prints it through this pair, so the kept line cannot be left out.
 *  `hero` is the vault page's verdict block; `side` is the line pair in the list's deposit panel. */
export function YieldPair({ feeApr, keptApr, size, className }: { feeApr: number; keptApr: number; size: "hero" | "side"; className?: string }) {
  if (size === "side") {
    return (
      <div className={className}>
        <p className="text-[15px] leading-6">
          <Term id="feesEarned" /> <span className="figure whitespace-nowrap font-medium">{pct(feeApr)} a year</span>
        </p>
        <p className="text-[13px] leading-5 text-mute">
          <Term id="kept">{KEPT_AFTER}</Term> <span className="whitespace-nowrap"><Kept value={keptApr} className="font-medium" /> a year</span> in the <Term id="worstHalf">weaker half</Term> of the replay.
        </p>
      </div>
    );
  }
  return (
    <p className={cn("serif verdict max-w-[900px]", className)}>
      <span className="block text-[30px] leading-[34px] sm:text-[44px] sm:leading-[48px]">
        <Term id="feesEarned" /> <span className="whitespace-nowrap">{pct(feeApr)} a year</span>
      </span>
      <span className="mt-2 block text-[22px] leading-7 sm:text-[28px] sm:leading-9">
        <Term id="kept">{KEPT_AFTER}</Term> <span className={cn("whitespace-nowrap", toneClass(keptApr))}>{signed(keptApr)} a year</span>
      </span>
    </p>
  );
}
