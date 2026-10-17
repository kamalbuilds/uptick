import React from "react";
import { C, F, display } from "./theme";
import { ease, p } from "./lib";

export const Rise: React.FC<{
  t: number;
  at: number;
  dur?: number;
  dy?: number;
  dx?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ t, at, dur = 0.5, dy = 28, dx = 0, style, children }) => {
  const k = p(t, at, at + dur, ease.out);
  return <div style={{ opacity: k, transform: `translate(${(1 - k) * dx}px,${(1 - k) * dy}px)`, ...style }}>{children}</div>;
};

export const Abs: React.FC<{ x: number; y: number; w?: number; h?: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({ x, y, w, h, style, children }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, ...style }}>{children}</div>
);

export const Coin: React.FC<{ x: number; y: number; r?: number; fill?: string; stroke?: string; opacity?: number; scale?: number }> = ({ x, y, r = 26, fill = C.ink, stroke = C.ink, opacity = 1, scale = 1 }) => (
  <div
    style={{
      position: "absolute",
      left: x - r,
      top: y - r,
      width: r * 2,
      height: r * 2,
      borderRadius: "50%",
      background: fill,
      border: `4px solid ${stroke}`,
      boxSizing: "border-box",
      opacity,
      transform: `scale(${scale})`,
    }}
  />
);

export const Pill: React.FC<{ bg?: string; color?: string; size?: number; border?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ bg = C.lime, color = C.ink, size = 28, border, style, children }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      padding: `${size * 0.32}px ${size * 0.8}px`,
      borderRadius: 999,
      background: bg,
      color,
      border: border ? `3px solid ${border}` : undefined,
      fontFamily: F.sans,
      fontWeight: 700,
      fontSize: size,
      lineHeight: 1.1,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </div>
);

export const Person: React.FC<{ x: number; y: number; s?: number; color?: string; head?: string; label?: string; opacity?: number }> = ({ x, y, s = 1, color = C.ink, head, label, opacity = 1 }) => (
  <div style={{ position: "absolute", left: x - 70 * s, top: y - 170 * s, width: 140 * s, opacity }}>
    <svg width={140 * s} height={170 * s} viewBox="0 0 140 170">
      <circle cx="70" cy="42" r="34" fill={head ?? color} stroke={color} strokeWidth="6" />
      <path d="M10 170 C10 108 40 88 70 88 C100 88 130 108 130 170 Z" fill={color} />
    </svg>
    {label ? (
      <div style={{ position: "absolute", top: 178 * s, left: 0, width: "100%", textAlign: "center", fontFamily: F.mono, fontSize: 24, fontWeight: 600, color: C.body }}>{label}</div>
    ) : null}
  </div>
);

export const Cursor: React.FC<{ x: number; y: number; s?: number; down?: number }> = ({ x, y, s = 1, down = 0 }) => (
  <svg
    width={64 * s}
    height={80 * s}
    viewBox="0 0 64 80"
    style={{ position: "absolute", left: x, top: y, transform: `scale(${1 - down * 0.12})`, transformOrigin: "6px 4px", filter: "drop-shadow(0 6px 10px rgba(14,15,12,0.25))" }}
  >
    <path d="M6 4 L6 62 L21 48 L32 74 L42 69 L31 44 L52 44 Z" fill={C.ink} stroke={C.white} strokeWidth="5" strokeLinejoin="round" />
  </svg>
);

export const Big: React.FC<{ size: number; color?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ size, color = C.ink, style, children }) => (
  <div style={{ ...display, fontSize: size, color, whiteSpace: "nowrap", ...style }}>{children}</div>
);

export const Label: React.FC<{ color?: string; size?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({ color = C.body, size = 26, style, children }) => (
  <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: size, letterSpacing: "0.12em", textTransform: "uppercase", color, ...style }}>{children}</div>
);

export const Mono: React.FC<{ size?: number; color?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ size = 24, color = C.ink, style, children }) => (
  <div style={{ fontFamily: F.mono, fontSize: size, fontWeight: 500, color, letterSpacing: "-0.01em", ...style }}>{children}</div>
);
