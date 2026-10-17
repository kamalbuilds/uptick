import React from "react";
import { C, F, display } from "../theme";
import { ease, p, seg, useSec } from "../lib";
import { Abs } from "../ui";

export const K6Close: React.FC = () => {
  const t = useSec();
  const s19 = seg("s19");
    const letters = "Uptick".split("");
  const words = "Stock Token yield, chosen by the chain's own data.".split(" ");
  const lineStart = s19.start + 0.75;
  const span = Math.max(1.2, s19.end - lineStart - 0.6);
  const line = p(t, lineStart, s19.end + 0.6, ease.soft);
  return (
    <div style={{ position: "absolute", inset: 0, background: C.ink }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 250, display: "flex", justifyContent: "center" }}>
        {letters.map((ch, i) => {
          const k = p(t, s19.start - 0.05 + i * 0.07, s19.start + 0.55 + i * 0.07, ease.out);
          return (
            <div key={i} style={{ ...display, fontSize: 380, color: C.lime, opacity: k, transform: `translateY(${(1 - k) * 120}px)` }}>{ch}</div>
          );
        })}
      </div>
      {[words.slice(0, 3), words.slice(3)].map((row, r) => (
        <div key={r} style={{ position: "absolute", left: 0, right: 0, top: 690 + r * 88, display: "flex", justifyContent: "center", gap: 18 }}>
          {row.map((w, i) => {
            const idx = r === 0 ? i : 3 + i;
            const a = lineStart + (idx / words.length) * span;
            const k = p(t, a, a + 0.35, ease.out);
            return <div key={idx} style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 64, color: C.white, opacity: k, transform: `translateY(${(1 - k) * 24}px)` }}>{w}</div>;
          })}
        </div>
      ))}
      <Abs x={560} y={900} w={800} h={8} style={{ background: C.ink }}>
        <div style={{ width: `${line * 100}%`, height: "100%", background: C.lime, borderRadius: 4 }} />
      </Abs>
    </div>
  );
};
