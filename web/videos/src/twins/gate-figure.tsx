import { SectionTitle, toneClass } from "@/components/ledger";
import { signed } from "@/lib/format";
import { GATE_AXIS, gateScale } from "@/lib/leak";
import { cn } from "@/lib/utils";

import { isoDay, REPLAY_WINDOW, type Vault } from "../data";
import { enter } from "../motion";

const TITLE = { open: "Why it is open", reduced: "Why deposits are reduced", closed: "Why it is closed" } as const;

export type GateAnim = {
  /** The three bands wiping in from the left, with their labels: 0..1. */
  band: number;
  /** The weaker-half marker and its label: 0..1. */
  worst: number;
  /** The other half's dot: 0..1. */
  other: number;
  /** The reason line: 0..1. */
  reason: number;
};

/**
 * Frame-driven twin of web/components/gate-scale.tsx (GateFigure). Same markup, classes and geometry (lib/leak.ts gateScale);
 * only the clock differs. The footnote paragraph is left out of the film. At every value 1 it matches GateFigure.
 */
export function GateFigureTwin({ cfg, a }: { cfg: Vault; a: GateAnim }) {
  const { gate, keep } = cfg;
  const worstIsFirst = keep.keptFirstHalf <= keep.keptSecondHalf;
  const other = worstIsFirst ? keep.keptSecondHalf : keep.keptFirstHalf;
  const s = gateScale(gate.worstHalfApr, other, gate.floorApr);
  const edge = s.worstPct < 18 ? "left" : s.worstPct > 82 ? "right" : "mid";
  return (
    <section>
      <SectionTitle aside={<span className="figure">{gate.swaps.toLocaleString("en-US")} swaps replayed, {isoDay(REPLAY_WINDOW.start)} to {isoDay(REPLAY_WINDOW.end)}</span>}>{TITLE[gate.state]}</SectionTitle>

      <div className="relative mt-12 h-16" role="img">
        <div className="absolute inset-x-0 top-6 flex h-8 overflow-hidden rounded-sm" style={{ clipPath: `inset(0 ${(1 - a.band) * 100}% 0 0)` }}>
          <div className="bg-hairline" style={{ width: `${s.floorPct}%` }} />
          <div className="bg-caution-dim" style={{ width: `${s.zeroPct - s.floorPct}%` }} />
          <div className="bg-kept-dim" style={{ width: `${100 - s.zeroPct}%` }} />
        </div>
        <span
          className={cn("absolute top-0 whitespace-nowrap text-[13px] font-medium", edge === "mid" && "-translate-x-1/2", edge === "right" && "-translate-x-full")}
          style={{ left: edge === "left" ? 0 : `${s.worstPct}%`, opacity: a.worst }}
        >
          Worst half <span className={cn("figure", toneClass(gate.worstHalfApr))}>{signed(gate.worstHalfApr)}</span>
        </span>
        <span className="absolute top-[22px] h-12 w-0.5 -translate-x-1/2 bg-fg" style={{ left: `${s.worstPct}%`, opacity: a.worst, scale: `1 ${a.worst}`, transformOrigin: "50% 100%" }} aria-hidden />
        <span className="absolute top-[34px] size-3 -translate-x-1/2 rounded-full border-2 border-fg bg-canvas" style={{ left: `${s.otherPct}%`, opacity: a.other, scale: String(0.4 + 0.6 * a.other) }} aria-hidden />
      </div>

      <div className="relative mt-2 flex text-[13px] font-medium" style={{ opacity: a.band }} aria-hidden>
        <span className="text-center text-mute" style={{ width: `${s.floorPct}%` }}>Closed</span>
        <span className="text-center text-caution" style={{ width: `${s.zeroPct - s.floorPct}%` }}>Reduced</span>
        <span className="text-center text-kept" style={{ width: `${100 - s.zeroPct}%` }}>Open</span>
      </div>
      <div className="relative mt-1 h-5 text-[13px] text-mute" style={{ opacity: a.band }} aria-hidden>
        <span className="absolute left-0">{GATE_AXIS.min}%</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${s.floorPct}%` }}>Floor {gate.floorApr}%</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${s.zeroPct}%` }}>0</span>
        <span className="absolute right-0">+{GATE_AXIS.max}%</span>
      </div>

      <p className="mt-6 max-w-[690px] text-mute" style={enter(a.reason, 10)}>{gate.reason}</p>
    </section>
  );
}
