import type { CSSProperties } from "react";

// Tokens from stock-vaults-app/web/DESIGN.md (Wise-inspired): off-white canvas, ink, lime.
export const C = {
  canvas: "#e8ebe6",
  white: "#ffffff",
  ink: "#0e0f0c",
  lime: "#9fe870",
  limePale: "#e2f6d5",
  limeDeep: "#163300",
  body: "#454745",
  mute: "#868685",
  sage: "#b9c4b2",
  neg: "#d03238",
};

export const F = {
  display: 'Archivo, "Arial Narrow", sans-serif',
  sans: "Figtree, ui-sans-serif, sans-serif",
  mono: '"Geist Mono", ui-monospace, monospace',
};

export const display: CSSProperties = {
  fontFamily: F.display,
  fontWeight: 900,
  fontStretch: "86%",
  letterSpacing: "-0.035em",
  lineHeight: 0.9,
};
