import React from "react";
import { C, F, display } from "../theme";
import { clamp01, ease, kf, lerp, p, seg, useSec } from "../lib";
import { Abs, Big, Coin, Cursor, Label, Mono, Pill, Rise } from "../ui";

const CARDS = [
  { token: "NVDA", tier: "0.05%", v: [1.21, 1.23, 3.83] },
  { token: "SPCX", tier: "0.05%", v: [0.78, 3.02, 7.07] },
  { token: "TSLA", tier: "0.3%", v: [0.8, 2.07, 19.53] },
];
const ROWS = [
  { l: "NYSE hours", c: C.ink },
  { l: "Weeknights", c: "#a3b09b" },
  { l: "Weekends", c: C.lime },
];
const CX = [160, 710, 1260];
const CY = 130;
const CWD = 500;
const CH = 420;
const bar = (v: number) => (436 * Math.log(v / 0.5)) / Math.log(50);

const Check: React.FC = () => (
  <svg width="30" height="30" viewBox="0 0 30 30"><path d="M5 16 L12 23 L26 7" fill="none" stroke={C.ink} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export const K3Pools: React.FC = () => {
  const t = useSec();
  const s9 = seg("s09");
  const s10 = seg("s10");
  const s11 = seg("s11");
  const s12 = seg("s12");
  const s13 = seg("s13");
  const s14 = seg("s14");

  const veilAt = s9.start + (s9.end - s9.start) * 0.55;
  const veil = p(t, veilAt, veilAt + 0.5, ease.out);

  // scanner
  const scanA = s13.start + 0.5;
  const scanB = s13.end - 0.6;
  const scanX = lerp(110, 1790, p(t, scanA, scanB, ease.soft));
  const scanning = t >= scanA - 0.05 && t <= scanB + 0.3;
  const lift = (i: number) => clamp01((scanX - CX[i] - 40) / (CWD * 0.55)) * (t >= scanA ? 1 : 0);
  const picked = p(t, scanB + 0.15, scanB + 0.6, ease.out);
  const dimOthers = 1 - 0.55 * picked;
  const focusLower = p(t, s11.start + 0.3, s11.start + 0.8, ease.out) * (1 - p(t, s12.start - 0.15, s12.start + 0.3, ease.in));
  const cardsOpacity = (i: number) => (1 - 0.7 * focusLower) * (i === 0 ? 1 : dimOthers);

  // cursor hop in s10
  const cx0 = kf(t, [[s10.start - 0.2, 1900], [s10.start + 0.45, 410], [s10.start + 0.95, 1510], [s10.start + 1.45, 960], [s10.end + 0.1, 960]], ease.inOut);
  const cy0 = kf(t, [[s10.start - 0.2, 760], [s10.start + 0.45, 330], [s10.start + 0.95, 350], [s10.start + 1.45, 380], [s10.end + 0.1, 380]], ease.inOut);
  const cursorOn = t > s10.start - 0.25 && t < s11.start + 0.2;
  const ripples = [s10.start + 0.45, s10.start + 0.95, s10.start + 1.45];

  // uptick pill (carrier from s12 into the scan head)
  const pillX = kf(t, [[s12.start - 0.1, 2300], [s12.start + 0.6, 960], [s13.start + 0.1, 960], [scanA, 110]], ease.inOut);
  const pillX2 = t >= scanA ? scanX : pillX;
  const pillY = kf(t, [[s12.start + 0.6, 730], [s13.start + 0.1, 730], [scanA, 590]], ease.inOut);
  const pillS = kf(t, [[s12.start + 0.6, 1], [s13.start + 0.1, 1], [scanA, 0.34]], ease.inOut);
  const pillOn = t > s12.start - 0.12 && t < s14.start - 0.1;
  const pillFade = 1 - p(t, scanB + 0.2, scanB + 0.5, ease.lin);

  // hook diagram (s11)
  const hookOn = p(t, s11.start + 0.35, s11.start + 0.85, ease.out) * (1 - p(t, s12.start - 0.1, s12.start + 0.3, ease.in));
  const hookT0 = s11.start + 0.9;
  const hookCoins: React.ReactNode[] = [];
  let pocket = 0;
  for (let n = 0; n < 12; n++) {
    const a = hookT0 + n * 0.62;
    const k = p(t, a, a + 0.45, ease.inOut);
    if (k > 0 && k < 1) hookCoins.push(<Coin key={`h${n}`} x={lerp(110, 360, k)} y={780} r={20} fill={C.lime} stroke={C.ink} opacity={1 - p(t, a + 0.4, a + 0.45, ease.lin)} />);
    const kc = p(t, a + 0.42, a + 0.95, ease.inOut);
    if (kc >= 1) pocket++;
    else if (kc > 0) hookCoins.push(<Coin key={`c${n}`} x={lerp(420, 740, kc)} y={lerp(850, 800, kc) + Math.sin(kc * Math.PI) * 30} r={10} fill={C.neg} stroke={C.neg} />);
  }
  const eighty = p(t, s11.start + (s11.end - s11.start) * 0.55, s11.start + (s11.end - s11.start) * 0.55 + 0.6, ease.out);
  const eightyN = Math.round(80 * p(t, s11.start + (s11.end - s11.start) * 0.55, s11.start + (s11.end - s11.start) * 0.55 + 0.8, ease.out));

  const guess = p(t, s10.start + 0.1, s10.start + 0.6, ease.out) * (1 - p(t, s11.start + 0.1, s11.start + 0.5, ease.in));
  const vaultBig = p(t, scanB + 0.4, scanB + 0.9, ease.out);
  const badge1 = p(t, s14.start + 0.1, s14.start + 0.5, ease.back);
  const badge2 = p(t, s14.start + 1.2, s14.start + 1.6, ease.back);
  const labelOp = (1 - picked) * p(t, s9.start, s9.start + 0.4);

  return (
    <div style={{ position: "absolute", inset: 0, background: C.canvas }}>
      <Abs x={160} y={68} style={{ opacity: labelOp }}><Label>Fees earned per $1 lost, by pool</Label></Abs>

      {CARDS.map((c, i) => {
        const k = p(t, s9.start + i * 0.12, s9.start + i * 0.12 + 0.6, ease.out);
        const chosen = i === 0 ? picked : 0;
        const rowsIn = p(t, s9.start + 0.6 + i * 0.1, s9.start + 1.0 + i * 0.1);
        const veilOp = veil * (1 - lift(i));
        return (
          <div key={c.token} style={{ opacity: cardsOpacity(i) * k, transform: `translateY(${(1 - k) * 60}px)` }}>
            <Abs x={CX[i]} y={CY} w={CWD} h={CH} style={{ background: C.white, borderRadius: 28, boxSizing: "border-box", border: `${3 + chosen * 5}px solid ${chosen > 0.02 ? C.lime : "transparent"}`, boxShadow: chosen > 0.02 ? `0 0 0 ${chosen * 10}px rgba(159,232,112,0.35)` : "0 14px 40px rgba(14,15,12,0.08)" }} />
            <Abs x={CX[i] + 34} y={CY + 26}><Big size={80}>{c.token}</Big></Abs>
            <Abs x={CX[i] + 36} y={CY + 116}>
              <div style={{ fontFamily: F.sans, fontSize: 25, color: C.body }}>{c.token} / USDG, <b style={{ color: C.ink }}>{c.tier} fee tier</b></div>
            </Abs>
            {ROWS.map((r, j) => (
              <div key={r.l} style={{ opacity: rowsIn }}>
                <Abs x={CX[i] + 36} y={CY + 178 + j * 72}>
                  <div style={{ fontFamily: F.sans, fontSize: 24, fontWeight: 600, color: C.ink }}>{r.l}</div>
                </Abs>
                <Abs x={CX[i] + 36} y={CY + 178 + j * 72} w={CWD - 72} style={{ textAlign: "right" }}>
                  <Mono size={34} style={{ fontWeight: 600 }}>{c.v[j].toFixed(2)}</Mono>
                </Abs>
                <Abs x={CX[i] + 36} y={CY + 178 + j * 72 + 42} w={bar(c.v[j]) * rowsIn} h={10} style={{ background: r.c, borderRadius: 5 }} />
              </div>
            ))}
            {/* veil */}
            <Abs x={CX[i] + 14} y={CY + 160} w={CWD - 28} h={CH - 174} style={{ opacity: veilOp, background: "rgba(255,255,255,0.58)", backdropFilter: `blur(${14}px)`, borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ ...display, fontSize: 170, color: C.ink }}>?</div>
            </Abs>
          </div>
        );
      })}

      <Abs x={160} y={585} w={1600} style={{ opacity: veil * (1 - p(t, s11.start + 0.1, s11.start + 0.4, ease.lin)) * (1 - picked) }}>
        <Pill bg={C.white} color={C.ink} size={28} border={C.ink}>A holder sees a name and a fee tier</Pill>
      </Abs>

      {/* guesswork */}
      <Abs x={160} y={640} style={{ opacity: guess, transform: `translateY(${(1 - guess) * 40}px)` }}>
        <Big size={200}>Guesswork</Big>
      </Abs>
      {cursorOn ? <Cursor x={cx0} y={cy0} s={1.25} down={ripples.some((r) => Math.abs(t - r) < 0.08) ? 1 : 0} /> : null}
      {ripples.map((r, i) => {
        const k = p(t, r, r + 0.5, ease.out);
        return k > 0 && k < 1 ? <div key={i} style={{ position: "absolute", left: [410, 1510, 960][i] - 60 * k, top: [330, 350, 380][i] - 60 * k, width: 120 * k, height: 120 * k, borderRadius: "50%", border: `5px solid ${C.ink}`, opacity: 1 - k }} /> : null;
      })}

      {/* hooks */}
      <div style={{ opacity: hookOn }}>
        <Abs x={200} y={655} w={320} h={210} style={{ border: `5px solid ${C.ink}`, borderRadius: 32, background: C.white, boxSizing: "border-box" }} />
        <Abs x={225} y={620} w={270} style={{ textAlign: "center" }}><Pill bg={C.ink} color={C.lime} size={26}>HOOK</Pill></Abs>
        <Abs x={600} y={712} w={300} style={{ textAlign: "center" }}><Label color={C.neg} size={22}>hidden cut</Label></Abs>
        <Abs x={620} y={745} w={260} h={100} style={{ border: `4px solid ${C.neg}`, borderRadius: 24, boxSizing: "border-box" }} />
        {Array.from({ length: Math.min(pocket, 10) }).map((_, i) => (
          <Coin key={i} x={645 + (i % 5) * 44} y={820 - Math.floor(i / 5) * 30} r={13} fill={C.neg} stroke={C.neg} />
        ))}
        {hookCoins}
        <Abs x={160} y={888} w={760}><div style={{ fontFamily: F.sans, fontSize: 26, color: C.ink }}><b>Keeps 5 to 11%</b> while the pool quotes 0 to 1%</div></Abs>
        <div style={{ opacity: eighty, transform: `translateY(${(1 - eighty) * 30}px)` }}>
          <Abs x={1010} y={600}><Big size={270} color={C.ink}>{eightyN}%</Big></Abs>
          <Abs x={1020} y={850}><div style={{ fontFamily: F.sans, fontSize: 38, fontWeight: 600, color: C.ink }}>of 84K hooks flagged malicious</div></Abs>
          <Abs x={1020} y={902}><Mono size={22} color={C.mute}>source: 0x</Mono></Abs>
        </div>
      </div>

      {/* uptick pill and scan line */}
      {pillOn ? (
        <div style={{ position: "absolute", left: pillX2, top: pillY, transform: `translate(-50%,-50%) scale(${pillS})`, opacity: pillFade }}>
          <div style={{ ...display, fontSize: 130, background: C.lime, color: C.ink, borderRadius: 999, padding: "26px 80px 34px" }}>Uptick</div>
        </div>
      ) : null}
      {scanning ? (
        <>
          <Abs x={scanX - 5} y={110} w={10} h={470} style={{ background: C.lime, borderRadius: 5, boxShadow: "0 0 30px rgba(159,232,112,0.9)", opacity: pillFade }} />
          <Abs x={scanX - 150} y={640} w={300} style={{ textAlign: "center", opacity: pillFade }}><Mono size={22} color={C.body}>replaying every swap</Mono></Abs>
        </>
      ) : null}

      {/* the pick */}
      <Abs x={160} y={610} style={{ opacity: vaultBig, transform: `translateY(${(1 - vaultBig) * 40}px)` }}>
        <Big size={180}>NVDA vault</Big>
      </Abs>
      <Abs x={160} y={810} style={{ display: "flex", gap: 22 }}>
        <div style={{ opacity: badge1, transform: `scale(${0.8 + 0.2 * badge1})`, transformOrigin: "0 50%" }}>
          <Pill bg={C.lime} color={C.ink} size={32}><Check /> No fee-taking hook</Pill>
        </div>
        <div style={{ opacity: badge2, transform: `scale(${0.8 + 0.2 * badge2})`, transformOrigin: "0 50%" }}>
          <Pill bg={C.white} color={C.ink} size={32} border={C.ink}>or a maximum fee declared on chain</Pill>
        </div>
      </Abs>
    </div>
  );
};
