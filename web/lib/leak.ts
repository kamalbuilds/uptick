import { dollars } from "./format.ts";

// Geometry for the to-scale figures on the vault and home pages.

export type Leak = { feeApr: number; markoutApr: number; costApr: number; keptApr: number };
export type LeakSegment = { key: "kept" | "cost" | "markout"; value: number; widthPct: number };
export type LeakBar = {
  segments: LeakSegment[];
  /** Where the fees run out, as a percent of the bar. 100 when the fees cover both losses; less when losses exceed them. */
  feesEndPct: number;
  /** True when the vault kept less than nothing: the bar is as wide as the losses and the kept segment is absent. */
  overdrawn: boolean;
};

/** One bar for a year of fees. Kept, recentring cost and the loss to informed traders are drawn to one scale: the larger of the fees
 *  and the two losses together. A vault that kept less than nothing has no kept segment, and a tick marks where the fees ran out. */
export function leakBar({ feeApr, markoutApr, costApr, keptApr }: Leak): LeakBar {
  const losses = markoutApr + costApr;
  const scale = Math.max(feeApr, losses);
  if (!(scale > 0)) return { segments: [], feesEndPct: 100, overdrawn: false };
  const w = (n: number) => (Math.max(n, 0) / scale) * 100;
  const kept = Math.max(keptApr, 0);
  return {
    segments: [
      { key: "kept", value: keptApr, widthPct: w(kept) },
      { key: "cost", value: costApr, widthPct: w(costApr) },
      { key: "markout", value: markoutApr, widthPct: w(markoutApr) },
    ].filter((s) => s.widthPct > 0) as LeakSegment[],
    feesEndPct: (feeApr / scale) * 100,
    overdrawn: keptApr < 0,
  };
}

export const ROW_AXIS = { min: -20, max: 5 } as const;

export type RowBar = { zeroPct: number; leftPct: number; widthPct: number; clipped: boolean };

/** A row's bar on the axis from the -20% floor to +5%: what the holder keeps a year in the weaker half. A value past the floor is
 *  drawn to the floor and flagged, so the bar can never claim a length it was not measured at. */
export function rowBar(keep: number, axis: { min: number; max: number } = ROW_AXIS): RowBar {
  const span = axis.max - axis.min;
  const at = (n: number) => ((n - axis.min) / span) * 100;
  const zeroPct = at(0);
  const clipped = keep < axis.min || keep > axis.max;
  const end = Math.min(Math.max(keep, axis.min), axis.max);
  const leftPct = Math.min(at(end), zeroPct);
  return { zeroPct, leftPct, widthPct: Math.max(Math.abs(at(end) - zeroPct), 0.6), clipped };
}

export const GATE_AXIS = { min: -40, max: 20 } as const;

export type GateScale = { floorPct: number; zeroPct: number; worstPct: number; otherPct: number; worstClamped: boolean };

/** The gate scale: Closed below the floor, Reduced between the floor and zero, Open from zero. Both halves of the replay are placed on
 *  it; a half past the left edge sits on the edge and is flagged. */
export function gateScale(worstHalf: number, otherHalf: number, floor: number, axis: { min: number; max: number } = GATE_AXIS): GateScale {
  const span = axis.max - axis.min;
  const at = (n: number) => Math.min(Math.max(((n - axis.min) / span) * 100, 0), 100);
  return { floorPct: at(floor), zeroPct: at(0), worstPct: at(worstHalf), otherPct: at(otherHalf), worstClamped: worstHalf < axis.min || worstHalf > axis.max };
}

/** Dollars a year that `amountUsd` earns (or loses) at a yearly rate in percent. */
export const yearlyUsd = (amountUsd: number, ratePct: number): number => (amountUsd * ratePct) / 100;

/** The yearly dollar outcome as the ticket and a row print it: "+$32.40" or "-$1,204", on the same money rule as every other figure there (whole dollars from $1,000, cents below). */
export function usdSigned(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  const abs = Math.abs(n);
  if (abs < 0.005) return n === 0 ? "$0" : `${n > 0 ? "+" : "-"}under $0.01`;
  return `${n > 0 ? "+" : "-"}${dollars(abs)}`;
}
