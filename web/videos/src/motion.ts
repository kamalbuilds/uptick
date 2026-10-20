import { Easing } from "remotion";

import { clamp01 } from "./kit/time";
import { EASE_OUT } from "./tokens";

const land = Easing.bezier(...EASE_OUT);

/** 0 before `start`, 1 after `start + length`, on the product's ease-out. */
export const rise = (t: number, start: number, length = 0.4) => land(clamp01((t - start) / length));

/** Blur-swap entrance used between scenes: opacity, a short blur and a small lift, all from one 0..1 value. */
export function enter(u: number, lift = 18) {
  return { opacity: u, filter: u < 1 ? `blur(${(1 - u) * 14}px)` : undefined, translate: `0 ${(1 - u) * lift}px` } as const;
}

/** The matching exit: 1 until `from`, 0 at `from + length`. */
export const fall = (t: number, from: number, length = 0.25) => 1 - clamp01((t - from) / length);
