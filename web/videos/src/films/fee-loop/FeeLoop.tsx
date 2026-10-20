import { AbsoluteFill } from "remotion";

import type { FilmProps } from "../../Root";
import { AAPL } from "../../data";
import { TargetLog } from "../../kit/debug";
import { useTime } from "../../kit/time";
import { fall, rise } from "../../motion";
import { StateChip } from "@/components/ledger";
import { LeakFigureTwin, type LeakAnim, type Triple } from "../../twins/leak-figure";
import { cue } from "./cues";

const WIDTH = 480; // design px of the page column
const ZOOM = 2; // 480 design px -> 960 screen px, 60 px margin each side
const PASS_LENGTH = 0.5;
const DIM = 0.45;

/** Fee-loop film: 1:1, 8 s, seamless. Only the AAPL "Where a year of fees goes" figure moves; its heading and label sit still, so the loop closes on frame 0. */
export function FeeLoop({ debug }: FilmProps) {
  const t = useTime();
  // After the exit the figure is reset to the empty state it starts from, so the last frame equals the first.
  const tl = t < cue.out ? t : t < cue.out + cue.outLength ? cue.out : -1;
  const part = (index: number) => {
    const starts = cue.passes.filter((_, i) => i % 3 === index);
    const lit = starts.reduce((u, start) => Math.max(u, rise(tl, start, 0.15) * (1 - rise(tl, start + PASS_LENGTH - 0.15, 0.15))), 0);
    const inPass = rise(tl, cue.passes[0], 0.15) * (1 - rise(tl, cue.out - 0.15, 0.15));
    return 1 - inPass * (1 - DIM) * (1 - lit);
  };
  const a: LeakAnim = {
    fill: rise(tl, cue.fill, 1.0),
    paint: cue.paint.map((start, i) => rise(tl, start, [0.4, 0.3, 0.6][i])) as unknown as Triple,
    label: cue.label.map((start) => rise(tl, start, 0.3)) as unknown as Triple,
    legend: cue.legend.map((start) => rise(tl, start, 0.4)) as unknown as Triple,
    focus: [part(0), part(1), part(2)],
    fade: fall(t, cue.out, cue.outLength),
  };

  return (
    <AbsoluteFill style={{ background: "#0a0b0c", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: WIDTH, transformOrigin: "0 0", translate: `${(1080 - WIDTH * ZOOM) / 2}px 130px`, scale: String(ZOOM) }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-[32px] font-medium leading-10 tracking-[-0.33px]">{AAPL.symbol} vault</h1>
          <StateChip state={AAPL.gate.state} />
        </div>
        <div className="mt-12" data-target="leak">
          <LeakFigureTwin cfg={AAPL} a={a} stacked barPx={WIDTH} />
        </div>
      </div>
      {debug ? <TargetLog /> : null}
    </AbsoluteFill>
  );
}
