import { SectionTitle } from "@/components/ledger";
import { pct, signed } from "@/lib/format";
import { leakBar } from "@/lib/leak";

import { isoDay, REPLAY_WINDOW, type Vault } from "../data";
import { enter } from "../motion";

/**
 * Frame-driven twin of web/components/leak-bar.tsx (LeakFigure). Same markup, classes and geometry (lib/leak.ts leakBar);
 * the difference is the clock: every segment, label and legend entry is drawn from the 0..1 values in `a`.
 * The fee total fills first as one neutral bar (`bg-line`, the control border), then each part takes its colour left to right.
 * At a = ALL_IN the output matches LeakFigure. `overdrawn` vaults (kept below zero) are not handled: NVDA keeps +6.9%.
 */
export type Triple = readonly [number, number, number];
export type LeakAnim = {
  /** Fee total filling the bar and the figure counting: 0..1. */
  fill: number;
  /** Colour wipe per part (kept, recentring, informed traders): 0..1. */
  paint: Triple;
  /** Label inside each part: 0..1. */
  label: Triple;
  /** Legend entry: 0..1. */
  legend: Triple;
  /** Opacity multiplier per part, for an emphasis pass. */
  focus?: Triple;
  /** Opacity of everything that moves (figure, bar, legend); the heading and the label stay. Default 1. */
  fade?: number;
};

export const ALL_IN: LeakAnim = { fill: 1, paint: [1, 1, 1], label: [1, 1, 1], legend: [1, 1, 1] };

/** leak-bar.tsx TONE: copied because the original is module-private. */
const TONE = {
  kept: { bar: "bg-kept text-canvas", swatch: "bg-kept", name: "Kept over the full 30 days", text: "What stays with depositors after both losses, over the whole window." },
  cost: { bar: "bg-loss-dim text-loss", swatch: "bg-loss-dim ring-1 ring-loss", name: "Recentring cost", text: "The reposition at 02:00 UTC after each NYSE session." },
  markout: { bar: "bg-loss text-canvas", swatch: "bg-loss", name: "Lost to informed traders", text: "Trades from people who knew the price was about to move." },
} as const;

const KEYS = ["kept", "cost", "markout"] as const;

export function LeakFigureTwin({ cfg, a, stacked = false }: { cfg: Vault; a: LeakAnim; stacked?: boolean }) {
  const { feeApr, markoutApr, costApr, keptApr } = cfg.keep;
  const bar = leakBar({ feeApr, markoutApr, costApr, keptApr });
  if (bar.overdrawn) throw new Error(`${cfg.symbol} kept less than nothing; the twin draws the kept-positive bar only`);
  const value = { kept: keptApr, cost: costApr, markout: markoutApr };
  const focus = a.focus ?? [1, 1, 1];
  const fade = a.fade ?? 1;
  let offset = 0;
  const parts = bar.segments.map((s) => {
    const index = KEYS.indexOf(s.key);
    const part = { s, index, left: offset };
    offset += s.widthPct;
    return part;
  });
  const labelOf = (s: (typeof parts)[number]["s"]) =>
    s.widthPct < 9 ? null : s.key === "markout" ? signed(-s.value) : s.key === "cost" ? (s.widthPct >= 18 ? <>Recentring {pct(s.value)}</> : pct(s.value)) : signed(s.value);

  return (
    <section>
      <SectionTitle aside={<>{REPLAY_WINDOW.days} days to {isoDay(REPLAY_WINDOW.end)}</>}>Where a year of fees goes</SectionTitle>
      <div className="mt-6 flex items-baseline justify-between gap-4 text-[13px] text-mute">
        <span>Fees the pool paid, a year</span>
        <span className="figure text-[17px] font-medium text-fg" style={{ opacity: Math.min(1, a.fill * 12) * fade }}>{signed(feeApr * a.fill)}</span>
      </div>
      <div className="relative mt-3">
        <div className="relative h-14 w-full overflow-hidden rounded-sm" role="img" style={{ opacity: fade }}>
          <div className="absolute inset-y-0 left-0 bg-line" style={{ width: `${a.fill * 100}%` }} />
          {parts.map(({ s, index, left }) => (
            <div key={s.key} className="absolute inset-y-0 overflow-hidden bg-canvas" style={{ left: `${left}%`, width: `${s.widthPct * a.paint[index]}%` }}>
              <div className={`absolute inset-y-0 left-0 flex items-center whitespace-nowrap ${TONE[s.key].bar}`} style={{ width: `${(100 / Math.max(a.paint[index], 0.0001))}%`, opacity: focus[index] }}>
                <span className="px-3 text-[15px] font-semibold" style={{ opacity: a.label[index] }}>{labelOf(s)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={`mt-4 grid gap-x-10 gap-y-3 text-[13px] leading-5 ${stacked ? "" : "sm:grid-cols-3"}`}>
        {KEYS.map((k, index) => (
          <div key={k} style={{ ...enter(a.legend[index], 10), opacity: a.legend[index] * focus[index] * fade }}>
            <span className={`mr-2 inline-block size-2.5 rounded-[2px] ${k === "kept" ? (keptApr >= 0 ? "bg-kept" : "bg-loss") : TONE[k].swatch}`} aria-hidden />
            <span className="font-medium">{TONE[k].name}</span>
            <span className="figure ml-2 text-mute">{k === "kept" ? signed(value[k]) : pct(value[k])}</span>
            <div className="pl-[18px] text-mute">{TONE[k].text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
