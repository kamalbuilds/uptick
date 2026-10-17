import { Easing, interpolate, useCurrentFrame } from "remotion";
import T from "./timings.json";

export const FPS = 30;
export const W = 1920;
export const H = 1080;

export type Seg = { id: string; text: string; cap?: string; start: number; end: number };
export const SEGS = T.segments as Seg[];
export const DURATION = T.duration as number;

export const seg = (id: string): Seg => {
  const s = SEGS.find((x) => x.id === id);
  if (!s) throw new Error(`no segment ${id}`);
  return s;
};

export const useSec = () => useCurrentFrame() / FPS;

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export const ease = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  inOut: Easing.bezier(0.65, 0, 0.15, 1),
  in: Easing.bezier(0.7, 0, 0.84, 0),
  soft: Easing.bezier(0.4, 0, 0.2, 1),
  back: Easing.bezier(0.34, 1.45, 0.64, 1),
  lin: (x: number) => x,
};

// Eased progress of t over [a, b].
export const p = (t: number, a: number, b: number, e: (x: number) => number = ease.out) => e(clamp01((t - a) / (b - a)));

export const range = (t: number, a: number, b: number, from: number, to: number, e = ease.out) => lerp(from, to, p(t, a, b, e));

export const kf = (t: number, pts: [number, number][], e = ease.inOut) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], e(clamp01((t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]))));
  }
  return pts[pts.length - 1][1];
};

export { interpolate };
