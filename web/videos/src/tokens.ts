/** DESIGN.md colours as hex (web/DESIGN.md front matter), for anything that animates. Classes in twins use the same names through @theme. */
export const color = {
  canvas: "#0a0b0c",
  hairline: "#2a2e31",
  line: "#42494d",
  fg: "#f4f5f5",
  mute: "#919fa6",
  kept: "#1fd16b",
  keptDim: "#0f3d24",
  loss: "#ec5e2a",
  lossDim: "#3a1d12",
  caution: "#f2b84b",
  cautionDim: "#352a12",
  closed: "#6b747a",
} as const;

/** The product's ease (--ease-out in app/globals.css). */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
