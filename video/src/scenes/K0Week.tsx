import React from "react";
import { C, F } from "../theme";
import { ease, p, seg, useSec } from "../lib";
import { Abs, Big, Label, Mono, Pill, Rise } from "../ui";

export const X0 = 160;
export const CW = 1600;
export const DW = CW / 7;
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const hx = (d: number, h: number) => X0 + (d + h / 24) * DW;

const HATCH = `repeating-linear-gradient(135deg, #cfd4cb 0 5px, ${C.white} 5px 11px)`;

export const K0Week: React.FC = () => {
  const t = useSec();
  const s1 = seg("s01");
  const s2 = seg("s02");
  const fill = CW * p(t, 0.2, s1.end + 0.3, ease.soft);
  const ribA = { y: 300, h: 110 };
  const ribB = { y: 670, h: 110 };
  const land = (d: number) => s2.start + 0.7 + d * 0.17;
  const lastLand = land(4) + 0.3;
  const bump = (d: number) => {
    const dt = t - (land(d) + 0.3);
    return dt > 0 && dt < 0.16 ? 1 - dt / 0.16 : 0;
  };
  const outline = p(t, lastLand + 0.35, lastLand + 0.8);
  const noPrice = p(t, lastLand + 0.7, lastLand + 1.2);

  return (
    <div style={{ position: "absolute", inset: 0, background: C.canvas }}>
      {/* row A: the token */}
      <Rise t={t} at={0.05} dur={0.5} dy={30} style={{ position: "absolute", left: X0, top: 118 }}>
        <Label>Robinhood Stock Token</Label>
      </Rise>
      <Rise t={t} at={0.1} dur={0.6} dy={40} style={{ position: "absolute", right: 1920 - X0 - CW, top: 78 }}>
        <Big size={150}>24/7</Big>
      </Rise>
      {DAYS.map((d, i) => (
        <Abs key={d} x={X0 + i * DW} y={262} w={DW} style={{ textAlign: "center" }}>
          <Rise t={t} at={0.15 + i * 0.04} dur={0.4} dy={10}>
            <Mono size={22} color={C.mute}>{d}</Mono>
          </Rise>
        </Abs>
      ))}
      <Abs x={X0} y={ribA.y} w={CW} h={ribA.h} style={{ borderRadius: 18, background: C.white, overflow: "hidden" }}>
        <div style={{ width: fill, height: "100%", background: C.lime }} />
      </Abs>
      {/* NYSE windows outlined on the token ribbon */}
      {DAYS.slice(0, 5).map((_, d) => (
        <Abs
          key={d}
          x={hx(d, 9.5)}
          y={ribA.y - 6}
          w={(6.5 / 24) * DW}
          h={ribA.h + 12}
          style={{ border: `4px solid ${C.ink}`, borderRadius: 10, opacity: outline, boxSizing: "border-box" }}
        />
      ))}

      {/* row B: the stock price */}
      <Rise t={t} at={s2.start + 0.05} dur={0.5} dy={30} style={{ position: "absolute", left: X0, top: 490 }}>
        <Label>Stock price</Label>
      </Rise>
      <Rise t={t} at={s2.start + 0.15} dur={0.6} dy={40} style={{ position: "absolute", right: 1920 - X0 - CW, top: 470 }}>
        <Big size={150}>6.5 h</Big>
      </Rise>
      <Abs x={X0} y={ribB.y} w={CW} h={ribB.h} style={{ borderRadius: 18, background: HATCH, opacity: p(t, s2.start, s2.start + 0.4), overflow: "hidden" }} />
      {DAYS.slice(0, 5).map((_, d) => {
        const k = p(t, land(d), land(d) + 0.3, ease.in);
        const sq = bump(d);
        return (
          <Abs
            key={d}
            x={hx(d, 9.5)}
            y={ribB.y - (1 - k) * 560}
            w={(6.5 / 24) * DW}
            h={ribB.h}
            style={{
              background: C.ink,
              borderRadius: 10,
              opacity: k > 0 ? 1 : 0,
              transformOrigin: "50% 100%",
              transform: `scale(${1 + sq * 0.22},${1 - sq * 0.22})`,
            }}
          />
        );
      })}
      {/* guides tying each window to the token ribbon */}
      {DAYS.slice(0, 5).map((_, d) => (
        <Abs key={d} x={hx(d, 9.5) + ((6.5 / 24) * DW) / 2 - 1.5} y={ribA.y + ribA.h + 8} w={3} h={ribB.y - ribA.y - ribA.h - 16} style={{ background: `repeating-linear-gradient(${C.ink} 0 8px, transparent 8px 16px)`, opacity: outline * 0.55 }} />
      ))}
      <Abs x={hx(5, 0)} y={ribB.y + 22} w={2 * DW} style={{ textAlign: "center", opacity: noPrice, transform: `translateY(${(1 - noPrice) * 12}px)` }}>
        <Pill bg={C.white} color={C.ink} size={30}>no stock price</Pill>
      </Abs>
      <Abs x={hx(1, 9.5) - 120} y={ribB.y + ribB.h + 22} w={400} style={{ opacity: noPrice }}>
        <Mono size={24} color={C.body}>NYSE open, 9:30 to 16:00 ET</Mono>
      </Abs>
    </div>
  );
};
