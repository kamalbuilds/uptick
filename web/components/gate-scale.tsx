import { SectionTitle, toneClass } from "./ledger";
import { GATE_AXIS, gateScale } from "@/lib/leak";
import { REDUCED_CAP_STOCK_USD } from "@/lib/evidence";
import { signed, usdWhole } from "@/lib/format";
import { REPLAY_WINDOW, isoDay, type VaultConfig } from "@/lib/vaults";
import { cn } from "@/lib/utils";

const TITLE = { open: "Why it is open", reduced: "Why deposits are capped", closed: "Why it is closed" } as const;

/** The gate drawn as a scale: Closed below the floor, Reduced up to zero, Open from zero. The weaker half of the replay is the marker. */
export function GateFigure({ cfg }: { cfg: VaultConfig }) {
  const { gate, keep } = cfg;
  const worstIsFirst = keep.keptFirstHalf <= keep.keptSecondHalf;
  const other = worstIsFirst ? keep.keptSecondHalf : keep.keptFirstHalf;
  const s = gateScale(gate.worstHalfApr, other, gate.floorApr);
  const edge = s.worstPct < 18 ? "left" : s.worstPct > 82 ? "right" : "mid";
  return (
    <section aria-labelledby="gate">
      <SectionTitle id="gate" aside={<span className="figure">{gate.swaps.toLocaleString("en-US")} swaps replayed, {isoDay(REPLAY_WINDOW.start)} to {isoDay(REPLAY_WINDOW.end)}</span>}>{TITLE[gate.state]}</SectionTitle>

      <div className="relative mt-12 h-16" role="img" aria-label={`The weaker half kept ${signed(gate.worstHalfApr)} a year. Closed below ${gate.floorApr}%, reduced up to 0%, open from 0%.`}>
        <div className="absolute inset-x-0 top-6 flex h-8 overflow-hidden rounded-sm">
          <div className="bg-hairline" style={{ width: `${s.floorPct}%` }} />
          <div className="bg-caution-dim" style={{ width: `${s.zeroPct - s.floorPct}%` }} />
          <div className="bg-kept-dim" style={{ width: `${100 - s.zeroPct}%` }} />
        </div>
        <span
          className={cn("absolute top-0 whitespace-nowrap text-[13px] font-medium", edge === "mid" && "-translate-x-1/2", edge === "right" && "-translate-x-full")}
          style={{ left: edge === "left" ? 0 : `${s.worstPct}%` }}
        >
          Worst half <span className={cn("figure", toneClass(gate.worstHalfApr))}>{signed(gate.worstHalfApr)}</span>
        </span>
        <span className="absolute top-[22px] h-12 w-0.5 -translate-x-1/2 bg-fg" style={{ left: `${s.worstPct}%` }} aria-hidden />
        <span className="absolute top-[34px] size-3 -translate-x-1/2 rounded-full border-2 border-fg bg-canvas" style={{ left: `${s.otherPct}%` }} aria-hidden />
      </div>

      <div className="relative mt-2 flex text-[13px] font-medium" aria-hidden>
        <span className="text-center text-mute" style={{ width: `${s.floorPct}%` }}>Closed</span>
        <span className="text-center text-caution" style={{ width: `${s.zeroPct - s.floorPct}%` }}>Reduced</span>
        <span className="text-center text-kept" style={{ width: `${100 - s.zeroPct}%` }}>Open</span>
      </div>
      <div className="relative mt-1 h-5 text-[13px] text-mute" aria-hidden>
        <span className="absolute left-0">{GATE_AXIS.min}%</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${s.floorPct}%` }}>Floor {gate.floorApr}%</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${s.zeroPct}%` }}>0</span>
        <span className="absolute right-0">+{GATE_AXIS.max}%</span>
      </div>

      <div className="mt-6 grid max-w-[690px] gap-3 text-mute">
        <p>{gate.reason}</p>
        <p className="text-[13px] leading-5">
          Worst half is the lower of the replay&rsquo;s two 15-day halves, the {worstIsFirst ? "first" : "last"} 15 days here, marked by the line. The {worstIsFirst ? "last" : "first"} 15 days kept{" "}
          <span className={cn("figure", toneClass(other))}>{signed(other)}</span>, the dot. 30-day is the whole window, {signed(keep.keptApr)}.
          {gate.state === "reduced" ? ` While capped, one deposit adds up to ${usdWhole(REDUCED_CAP_STOCK_USD)} of ${cfg.symbol}.` : ""}
        </p>
      </div>
    </section>
  );
}

