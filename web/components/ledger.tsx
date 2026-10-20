import type { ReactNode } from "react";
import { Term } from "./term";
import { rowBar, ROW_AXIS } from "@/lib/leak";
import { signed } from "@/lib/format";
import type { GateState } from "@/lib/vaults";
import { cn } from "@/lib/utils";

export const GATE_LABEL: Record<GateState, string> = { open: "Open", reduced: "Reduced", closed: "Closed" };

const CHIP: Record<GateState, string> = {
  open: "bg-kept-dim text-kept",
  reduced: "bg-caution-dim text-caution",
  closed: "bg-hairline text-mute",
};

/** The gate state as text on a tinted pill. The word is always there; colour never carries it alone. */
export function StateChip({ state, className, term }: { state: GateState; className?: string; /** Open the plain definition of the state from the chip. Leave off inside a row that is itself a button. */ term?: boolean }) {
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-[13px] font-medium", CHIP[state], className)}>{term ? <Term id={state} /> : GATE_LABEL[state]}</span>;
}

/** Colour is semantic: money kept is green, money lost is orange, zero is plain. */
export const toneClass = (n: number) => (n > 0 ? "text-kept" : n < 0 ? "text-loss" : "text-fg");

export function Kept({ value, digits = 1, className }: { value: number; digits?: number; className?: string }) {
  return <span className={cn("figure", toneClass(value), className)}>{signed(value, digits)}</span>;
}

/** Plain section title with its hairline: the only heading grammar below the verdict. */
export function SectionTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline pb-3">
      <h2 id={id} className="text-2xl font-semibold leading-8 tracking-[-0.2px]">{children}</h2>
      {aside ? <div className="text-[13px] text-mute">{aside}</div> : null}
    </div>
  );
}

/** A vault's weaker-half figure drawn to scale on the axis from the -20% floor to +5%. The left tick is the floor, the bright tick is zero. */
export function RowBar({ keep, label }: { keep: number; label: string }) {
  const b = rowBar(keep);
  return (
    <span className="relative block h-full" role="img" aria-label={label}>
      <span className="absolute inset-x-0 top-1/2 h-px bg-hairline" aria-hidden />
      <span className="absolute inset-y-2 left-0 w-px bg-closed" aria-hidden />
      <span className="absolute inset-y-2 w-px bg-mute" style={{ left: `${b.zeroPct}%` }} aria-hidden />
      <span
        className={cn("absolute top-1/2 h-2 -translate-y-1/2 rounded-[2px]", keep >= 0 ? "bg-kept" : "bg-loss")}
        style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%`, minWidth: 3 }}
        aria-hidden
      />
      {b.clipped ? <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 bg-fg" aria-hidden /> : null}
    </span>
  );
}

/** Axis labels for the row bars, laid on the same columns as the rows beneath. */
export function RowAxis() {
  const zero = rowBar(0).zeroPct;
  return (
    <span className="relative block h-5 text-[13px] text-mute" aria-hidden>
      <span className="absolute left-0 whitespace-nowrap">{ROW_AXIS.min}% floor</span>
      <span className="absolute -translate-x-1/2" style={{ left: `${zero}%` }}>0</span>
    </span>
  );
}
