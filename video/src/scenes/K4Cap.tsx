import React from "react";
import { C, F, display } from "../theme";
import { clamp01, ease, lerp, p, seg, useSec } from "../lib";
import { Abs, Big, Label, Mono, Person, Pill, Rise } from "../ui";

const GATE_X = 1050;
const GATE_W = 52;
const SLOT_Y = 485;
const SLOT_H = 150;
const MID = SLOT_Y + SLOT_H / 2;
const START_X = 470;
const BOUNCER_H = 196;
const PASS_H = 140;
const PW = 150;

const TERM = [
  { text: "[PASS] test_cap250_reverts_on_every_swap()", color: C.lime },
  { text: "  N swaps: 200", color: C.white },
  { text: "  reverted with TakeExceedsCap: 200", color: C.white },
  { text: "  reverted for another reason: 0", color: C.white },
];

const Puck: React.FC<{ x: number; y: number; h: number; fill: string; color: string; label: string; sx?: number; sy?: number; rot?: number; opacity?: number }> = ({ x, y, h, fill, color, label, sx = 1, sy = 1, rot = 0, opacity = 1 }) => (
  <div style={{ position: "absolute", left: x - PW / 2, top: y - h / 2, width: PW, height: h, borderRadius: 34, background: fill, color, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.sans, fontWeight: 700, fontSize: 28, opacity, transform: `scale(${sx},${sy}) rotate(${rot}deg)`, boxSizing: "border-box", border: `4px solid ${C.ink}` }}>
    {label}
  </div>
);

export const K4Cap: React.FC = () => {
  const t = useSec();
  const s15 = seg("s15");
  const s16 = seg("s16");

  const gateK = p(t, s15.start - 0.25, s15.start + 0.45, ease.out);
  const labelK = p(t, s15.start + 0.3, s15.start + 0.8, ease.back);

  // single pass puck
  const passA = s15.start + 0.55;
  const kp = p(t, passA, passA + 0.9, ease.inOut);
  const passX = lerp(START_X, 1500, kp);
  const passOn = kp > 0 && kp < 1;
  const passFade = 1 - p(t, passA + 0.7, passA + 0.9, ease.lin);

  // first bounce
  const bA = s15.start + 1.75;
  const hit = bA + 0.5;
  const kb = p(t, bA, hit, ease.in);
  const kr = p(t, hit, hit + 0.65, ease.out);
  const bx = t < hit ? lerp(START_X, GATE_X - PW / 2 - 6, kb) : lerp(GATE_X - PW / 2 - 6, START_X + 40, kr);
  const squash = t >= hit && t < hit + 0.16 ? 1 - (t - hit) / 0.16 : 0;
  const bOn = t >= bA && t < hit + 0.75;
  const stamp = p(t, hit, hit + 0.18, ease.back) * (1 - p(t, hit + 1.2, hit + 1.6, ease.lin));

  // stream
  const sA = s15.start + 3.0;
  const sB = s16.start + 0.9;
  const n = Math.round(200 * p(t, sA, sB, ease.in));
  const done = t >= sB;
  const stream: React.ReactNode[] = [];
  if (t >= sA && t < sB + 0.7) {
    const period = 0.14;
    const j0 = Math.floor((t - sA) / period);
    for (let j = Math.max(0, j0 - 5); j <= j0; j++) {
      const a = sA + j * period;
      const dt = t - a;
      const jitter = ((j * 37) % 5) * 10 - 20;
      const x = dt < 0.22 ? lerp(START_X + 150, GATE_X - PW / 2 - 6, ease.in(dt / 0.22)) : lerp(GATE_X - PW / 2 - 6, START_X + 40, ease.out(clamp01((dt - 0.22) / 0.35)));
      const sq = dt >= 0.22 && dt < 0.34 ? 1 - (dt - 0.22) / 0.12 : 0;
      stream.push(<Puck key={j} x={x} y={MID + jitter} h={BOUNCER_H - 40} fill={C.ink} color={C.lime} label="3%" sx={1 - sq * 0.22} sy={1 + sq * 0.1} opacity={0.9 * (1 - clamp01((dt - 0.45) / 0.15))} />);
    }
  }
  const flash = (() => {
    if (t < sA) return 0;
    const ph = ((t - sA) % 0.14) / 0.14;
    return ph < 0.3 ? 1 - ph / 0.3 : 0;
  })();

  const cntOn = p(t, sA - 0.1, sA + 0.4, ease.out);
  const termAt = s15.start + 2.2;

  return (
    <div style={{ position: "absolute", inset: 0, background: C.canvas }}>
      <Person x={190} y={720} label="Trader" opacity={gateK} />

      {/* gate with the maximum slot */}
      <Abs x={GATE_X} y={lerp(-360, 200, gateK)} w={GATE_W} h={SLOT_Y - 200} style={{ background: C.ink, borderRadius: "14px 14px 0 0" }} />
      <Abs x={GATE_X} y={lerp(1440, SLOT_Y + SLOT_H, gateK)} w={GATE_W} h={880 - (SLOT_Y + SLOT_H)} style={{ background: C.ink, borderRadius: "0 0 14px 14px" }} />
      <Abs x={GATE_X - 4} y={SLOT_Y - 3} w={GATE_W + 8} h={SLOT_H + 6} style={{ opacity: flash * 0.9, background: C.lime, borderRadius: 6 }} />
      <Abs x={GATE_X - 130} y={130} w={GATE_W + 260} style={{ textAlign: "center", opacity: labelK, transform: `scale(${0.8 + 0.2 * labelK})` }}>
        <Pill bg={C.ink} color={C.lime} size={32}>2.5% maximum</Pill>
      </Abs>

      {/* pool */}
      <Abs x={1330} y={440} w={380} h={270} style={{ background: C.white, border: `5px solid ${C.ink}`, borderRadius: 36, boxSizing: "border-box", opacity: gateK }} />
      <Abs x={1330} y={725} w={380} style={{ textAlign: "center", opacity: gateK }}><Label>Pool</Label></Abs>

      {passOn ? <Puck x={passX} y={MID} h={PASS_H} fill={C.lime} color={C.ink} label="2.5% take" opacity={passFade} /> : null}
      {p(t, passA + 0.7, passA + 1.1, ease.out) > 0 && t < bA ? (
        <Abs x={1330} y={380} w={380} style={{ textAlign: "center", opacity: p(t, passA + 0.7, passA + 1.0) }}><Pill bg={C.limePale} color={C.limeDeep} size={26}>passes</Pill></Abs>
      ) : null}
      {bOn ? <Puck x={bx} y={MID} h={BOUNCER_H} fill={C.ink} color={C.lime} label="3% take" sx={1 - squash * 0.26} sy={1 + squash * 0.1} rot={t >= hit ? -(1 - kr) * 14 * Math.sin(kr * 9) : 0} /> : null}
      {stamp > 0 ? (
        <Abs x={GATE_X - 330} y={MID + 120} w={520} style={{ textAlign: "center", opacity: stamp, transform: `scale(${0.7 + 0.3 * stamp}) rotate(-5deg)` }}>
          <div style={{ display: "inline-block", border: `4px solid ${C.neg}`, color: C.neg, borderRadius: 14, padding: "8px 22px", fontFamily: F.mono, fontWeight: 700, fontSize: 36, background: C.canvas }}>TakeExceedsCap</div>
        </Abs>
      ) : null}
      {stream}

      {/* counter */}
      <div style={{ opacity: cntOn }}>
        <Abs x={150} y={160}><Big size={done ? 170 : 210}>{done ? "200 of 200" : n}</Big></Abs>
        <Abs x={160} y={done ? 350 : 380}>
          <div style={{ fontFamily: F.sans, fontSize: 36, fontWeight: 600, color: C.ink }}>{done ? "over-maximum trades rejected" : "over-maximum trades rejected so far"}</div>
        </Abs>
        <Abs x={160} y={done ? 408 : 430} style={{ opacity: done ? p(t, sB + 0.1, sB + 0.5) : 0 }}>
          <Pill bg={C.lime} color={C.ink} size={28}>0 rejected for any other reason</Pill>
        </Abs>
      </div>

      {/* terminal with the real evidence lines */}
      <Rise t={t} at={termAt} dur={0.5} dx={80} dy={0} style={{ position: "absolute", left: 1240, top: 130, width: 575 }}>
        <div style={{ background: C.ink, borderRadius: 24, padding: "24px 30px 28px", boxShadow: "0 20px 50px rgba(14,15,12,0.18)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <Mono size={19} color="#8d9488">spikes/capped-hooks/evidence/claim2-enforce.txt</Mono>
          </div>
          <div style={{ marginBottom: 14 }}><Pill bg={C.lime} color={C.ink} size={20}>mainnet fork</Pill></div>
          {TERM.map((l, i) => {
            const a = termAt + 0.5 + i * 0.5;
            const k = p(t, a, a + 0.3, ease.lin);
            const shown = Math.floor(l.text.length * k);
            return <div key={i} style={{ fontFamily: F.mono, fontSize: 20, fontWeight: 500, color: l.color, height: 32, whiteSpace: "pre" }}>{l.text.slice(0, shown)}</div>;
          })}
        </div>
      </Rise>
    </div>
  );
};
