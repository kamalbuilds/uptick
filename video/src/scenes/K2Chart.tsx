import React from "react";
import { C, F } from "../theme";
import { clamp01, ease, lerp, p, seg, useSec } from "../lib";
import { Abs, Big, Label, Mono, Pill, Rise } from "../ui";
import { DAYS } from "./K0Week";

const X0 = 140;
const CW = 1500;
const DW = CW / 7;
const BASE = 760;
const TOPH = 560;
const yv = (v: number) => BASE - (TOPH * Math.log(v / 0.5)) / Math.log(50);
const hx = (d: number, h: number) => X0 + (d + h / 24) * DW;

type Bar = { x: number; w: number; lo: number; hi: number; kind: "nyse" | "night" | "wknd"; d: number };
const bars: Bar[] = [];
const NYSE: [number, number] = [0.78, 1.21];
const NIGHT: [number, number] = [1.23, 3.02];
const WKND: [number, number] = [3.83, 19.53];
for (let d = 0; d < 5; d++) {
  bars.push({ x: hx(d, 0) + 4, w: hx(d, 9.5) - hx(d, 0) - 8, lo: NIGHT[0], hi: NIGHT[1], kind: "night", d });
  bars.push({ x: hx(d, 9.5) + 2, w: hx(d, 16) - hx(d, 9.5) - 4, lo: NYSE[0], hi: NYSE[1], kind: "nyse", d });
  bars.push({ x: hx(d, 16) + 4, w: hx(d, 24) - hx(d, 16) - 8, lo: NIGHT[0], hi: NIGHT[1], kind: "night", d });
}
for (let d = 5; d < 7; d++) bars.push({ x: hx(d, 0) + 6, w: DW - 12, lo: WKND[0], hi: WKND[1], kind: "wknd", d });

const fillOf = { nyse: C.ink, night: "#a3b09b", wknd: C.lime } as const;

const Dots: React.FC<{ t: number; a: number; b: number }> = ({ t, a, b }) => {
  const vis = p(t, a, a + 0.3, ease.lin) * (1 - p(t, b, b + 0.3, ease.lin));
  if (vis <= 0) return null;
  const N = 90;
  return (
    <>
      {Array.from({ length: N }).map((_, i) => {
        const speed = 380 + (i % 7) * 70;
        const span = 1900;
        const x = ((t * speed + i * 211) % span) - 80;
        const y = 640 + 130 * Math.sin(i * 1.7) + (i % 5) * 14;
        const edge = clamp01(Math.min(x / 160, (span - 80 - x) / 160));
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: 12, height: 12, borderRadius: 6, background: i % 4 === 0 ? C.lime : C.ink, opacity: vis * edge * 0.55 }} />;
      })}
    </>
  );
};

export const K2Chart: React.FC = () => {
  const t = useSec();
  const s6 = seg("s06");
  const s7 = seg("s07");
  const s8 = seg("s08");

  const count = 5.1 * p(t, s6.start + 0.2, s6.end - 0.2, ease.soft);
  const introOut = p(t, s6.end + 0.05, s6.end + 0.55, ease.in);
  const chartIn = p(t, s7.start - 0.15, s7.start + 0.45, ease.out);

  const nyseAt = s7.start + 0.9;
  const nightAt = s8.start + 0.1;
  const wkndAt = s8.start + (s8.end - s8.start) * 0.44;
  const grow = (b: Bar, i: number) => {
    const base = b.kind === "nyse" ? nyseAt + b.d * 0.14 : b.kind === "night" ? nightAt + (i % 15) * 0.045 : wkndAt + (b.d - 5) * 0.18;
    return p(t, base, base + (b.kind === "wknd" ? 0.9 : 0.45), b.kind === "wknd" ? ease.out : ease.out);
  };
  const lineHit = p(t, s7.start + 2.2, s7.start + 2.6, ease.out) * (1 - p(t, s7.start + 3.4, s7.start + 3.9, ease.lin));

  return (
    <div style={{ position: "absolute", inset: 0, background: C.canvas }}>
      {/* intro: counter and source card */}
      <div style={{ opacity: 1 - introOut, transform: `translateX(${-introOut * 260}px)` }}>
        <Rise t={t} at={s6.start - 0.1} dur={0.6} dy={40} style={{ position: "absolute", left: 160, top: 150 }}>
          <Big size={400}>{count.toFixed(1)}M</Big>
        </Rise>
        <Rise t={t} at={s6.start + 0.2} dur={0.5} dy={20} style={{ position: "absolute", left: 168, top: 520 }}>
          <div style={{ fontFamily: F.sans, fontSize: 42, fontWeight: 600, color: C.ink, lineHeight: 1.15 }}>real swaps replayed on<br />Robinhood Chain pools</div>
        </Rise>
        <Rise t={t} at={s6.start + 0.5} dur={0.6} dx={80} dy={0} style={{ position: "absolute", left: 1080, top: 190, width: 680 }}>
          <div style={{ background: C.white, borderRadius: 28, padding: "30px 36px", boxShadow: "0 18px 50px rgba(14,15,12,0.10)" }}>
            <Mono size={21} color={C.mute}>spikes/stock-vaults/FINDINGS.md</Mono>
            <div style={{ height: 18 }} />
            <Mono size={27}>Robinhood Chain 4663</Mono>
            <div style={{ height: 8 }} />
            <Mono size={27}>54 days, 2026-08-24 to 10-17</Mono>
            <div style={{ height: 8 }} />
            <Mono size={27} style={{ background: C.lime, display: "inline-block", padding: "2px 10px", margin: "0 -10px", borderRadius: 8 }}>5.1M swaps replayed</Mono>
            <div style={{ height: 8 }} />
            <Mono size={27}>NVDA, SPCX, TSLA pools</Mono>
          </div>
        </Rise>
      </div>
      <Dots t={t} a={s6.start} b={s7.start + 0.3} />

      {/* chart */}
      <div style={{ opacity: chartIn, transform: `translateX(${(1 - chartIn) * 220}px)` }}>
        <Abs x={X0} y={96} style={{}}>
          <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 34, color: C.ink }}>Fees earned per $1 lost to informed traders</div>
          <div style={{ marginTop: 6 }}><Mono size={21} color={C.mute}>range across NVDA, SPCX, TSLA pools, 1 hour markout</Mono></div>
        </Abs>
        <Abs x={X0} y={196} style={{ display: "flex", gap: 22 }}>
          {([["NYSE open", C.ink], ["Weeknight", "#a3b09b"], ["Weekend", C.lime]] as const).map(([l, c]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: F.sans, fontWeight: 600, fontSize: 24, color: C.ink }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, background: c }} />
              {l}
            </div>
          ))}
        </Abs>
        {/* grid */}
        <Abs x={X0} y={BASE} w={CW} h={3} style={{ background: C.ink }} />
        <Abs x={X0} y={yv(10)} w={CW} h={2} style={{ background: "rgba(14,15,12,0.16)" }} />
        <Abs x={X0 + CW + 14} y={yv(10) - 16} style={{}}><Mono size={24} color={C.mute}>$10</Mono></Abs>
        <Abs x={X0} y={yv(1) - 1.5} w={CW} h={3} style={{ background: `repeating-linear-gradient(90deg, ${C.ink} 0 14px, transparent 14px 24px)`, opacity: 0.85 + lineHit * 0.15 }} />
        <Abs x={X0 + CW + 14} y={yv(1) - 34} w={250} style={{ transform: `scale(${1 + lineHit * 0.08})`, transformOrigin: "0 50%" }}>
          <div style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 26, color: C.ink, lineHeight: 1.1 }}>$1 earned<br />= $1 lost</div>
        </Abs>
        {DAYS.map((d, i) => (
          <Abs key={d} x={X0 + i * DW} y={BASE + 18} w={DW} style={{ textAlign: "center" }}><Mono size={24} color={C.mute}>{d}</Mono></Abs>
        ))}
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Abs key={i} x={X0 + i * DW - 1} y={yv(25)} w={2} h={BASE - yv(25)} style={{ background: "rgba(14,15,12,0.07)" }} />
        ))}
        {/* bars, floating from low to high of the range */}
        {bars.map((b, i) => {
          const k = grow(b, i);
          if (k <= 0) return null;
          const top = lerp(yv(b.lo), yv(b.hi), k);
          return (
            <Abs key={i} x={b.x} y={top} w={b.w} h={yv(b.lo) - top + 2} style={{ background: fillOf[b.kind], borderRadius: 8, border: b.kind === "wknd" ? `3px solid ${C.ink}` : undefined, boxSizing: "border-box" }} />
          );
        })}
        {/* range labels */}
        <Abs x={hx(2, 9.5) - 110} y={yv(NYSE[1]) - 128} w={300} style={{ opacity: p(t, s7.start + 2.4, s7.start + 2.9), textAlign: "center" }}>
          <Pill bg={C.ink} color={C.white} size={28}>0.78 to 1.21</Pill>
        </Abs>
        <Abs x={hx(3, 16) - 110} y={yv(NIGHT[1]) - 74} w={300} style={{ opacity: p(t, nightAt + 0.9, nightAt + 1.3), textAlign: "center" }}>
          <Pill bg={C.white} color={C.ink} size={28} border={C.ink}>1.23 to 3.02</Pill>
        </Abs>
        <Abs x={hx(5, 0)} y={yv(WKND[1]) - 110} w={2 * DW} style={{ opacity: p(t, wkndAt + 0.7, wkndAt + 1.1), textAlign: "center" }}>
          <Big size={84}>3.83 to 19.53</Big>
        </Abs>
        <Abs x={hx(5, 0)} y={yv(WKND[0]) + 24} w={2 * DW} style={{ opacity: p(t, wkndAt + 1.1, wkndAt + 1.5), textAlign: "center" }}>
          <Pill bg={C.white} color={C.ink} size={26}>stock market closed</Pill>
        </Abs>
      </div>
    </div>
  );
};
