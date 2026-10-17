import React from "react";
import { C, F } from "../theme";
import { clamp01, ease, lerp, p, seg, useSec } from "../lib";
import { Abs, Big, Coin, Label, Mono, Person, Pill, Rise } from "../ui";

const POOL = { x: 700, y: 290, w: 520, h: 410 };
const NV_X = 820;
const US_X = 1100;
const coinY = (i: number) => 660 - i * 54;
const TRADER = { x: 330, y: 650 };
const JAR = { x: 1480, y: 560, w: 130, h: 130 };
const STEP = 0.9;

export const K1Pool: React.FC = () => {
  const t = useSec();
  const s3 = seg("s03");
  const s4 = seg("s04");
  const s5 = seg("s05");

  const T0 = s3.start + 0.45;
  const nTrades = Math.floor((s5.start + 0.2 - T0) / STEP) + 1;

  // fee coins that reached the jar
  let jar = 0;
  const flying: React.ReactNode[] = [];
  const swaps: React.ReactNode[] = [];
  for (let n = 0; n < nTrades; n++) {
    const tA = T0 + n * STEP;
    // USDG coin trader -> pool
    const kIn = p(t, tA, tA + 0.45, ease.inOut);
    if (kIn > 0 && kIn < 1) {
      swaps.push(<Coin key={`in${n}`} x={lerp(TRADER.x + 80, 940, kIn)} y={lerp(540, 520, kIn)} r={24} fill={C.lime} stroke={C.ink} opacity={1 - p(t, tA + 0.38, tA + 0.45, ease.lin)} />);
    }
    // NVDA coin pool -> trader
    const kOut = p(t, tA + 0.4, tA + 0.9, ease.inOut);
    if (kOut > 0 && kOut < 1) {
      swaps.push(<Coin key={`out${n}`} x={lerp(900, TRADER.x + 90, kOut)} y={lerp(560, 580, kOut)} r={24} fill={C.ink} stroke={C.ink} opacity={p(t, tA + 0.4, tA + 0.48, ease.lin)} />);
    }
    // fee coin pool -> jar, only once the LP is on screen
    if (tA >= s4.start - 0.1) {
      const kf = p(t, tA + 0.45, tA + 1.05, ease.inOut);
      if (kf >= 1) jar++;
      else if (kf > 0) {
        const x = lerp(1150, JAR.x + 65, kf);
        const y = lerp(690, JAR.y - 30, kf) - Math.sin(kf * Math.PI) * 70;
        flying.push(<Coin key={`fee${n}`} x={x} y={y} r={13} fill={C.lime} stroke={C.limeDeep} />);
      }
    }
  }

  // informed trader phase
  const priceJump = p(t, s5.start + 0.1, s5.start + 0.7, ease.back);
  const informedIn = p(t, s5.start + 0.5, s5.start + 1.1, ease.out);
  const takeAt = (i: number) => s5.start + 1.25 + i * 0.2;
  const removed = [0, 1, 2, 3].filter((i) => t >= takeAt(i) + 0.45).length;
  const takers: React.ReactNode[] = [];
  [0, 1, 2, 3].forEach((i) => {
    const k = p(t, takeAt(i), takeAt(i) + 0.45, ease.in);
    if (k > 0 && k < 1) {
      takers.push(<Coin key={`tk${i}`} x={lerp(NV_X, TRADER.x + 90, k)} y={lerp(coinY(4 - i), 560, k)} r={26} fill={C.ink} stroke={C.ink} />);
    }
  });
  const lossK = p(t, takeAt(0) + 0.45, takeAt(0) + 0.85, ease.back);
  const nvCoins = 5 - removed;
  const stackShown = (i: number) => {
    const taking = [0, 1, 2, 3].some((j) => 4 - j === i && t >= takeAt(j) && t < takeAt(j) + 0.45);
    return i < nvCoins || taking ? (taking ? 0 : 1) : 0;
  };

  const poolIn = p(t, s3.start, s3.start + 0.6, ease.out);
  const lpIn = p(t, s4.start, s4.start + 0.6, ease.back);
  const traderIn = p(t, s3.start + 0.1, s3.start + 0.7, ease.out);
  const firstTraderOut = 1 - p(t, s5.start + 0.2, s5.start + 0.6, ease.in);

  return (
    <div style={{ position: "absolute", inset: 0, background: C.canvas }}>
      <Abs x={POOL.x} y={POOL.y} w={POOL.w} h={POOL.h} style={{ background: C.white, border: `5px solid ${C.ink}`, borderRadius: 40, boxSizing: "border-box", opacity: poolIn, transform: `translateY(${(1 - poolIn) * 40}px)` }} />
      <div style={{ opacity: poolIn }}>
        <Abs x={NV_X - 80} y={POOL.y + 26} w={160} style={{ textAlign: "center" }}><Big size={44}>NVDA</Big></Abs>
        <Abs x={US_X - 80} y={POOL.y + 26} w={160} style={{ textAlign: "center" }}><Big size={44}>USDG</Big></Abs>
        {[0, 1, 2, 3, 4].map((i) => (
          <Coin key={`n${i}`} x={NV_X} y={coinY(i)} r={26} fill={C.ink} opacity={stackShown(i)} />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <Coin key={`u${i}`} x={US_X} y={coinY(i)} r={26} fill={C.lime} stroke={C.ink} />
        ))}
      </div>
      <Abs x={POOL.x} y={POOL.y + POOL.h + 22} w={POOL.w} style={{ textAlign: "center", opacity: poolIn }}>
        <Label>Pool</Label>
      </Abs>

      <Person x={TRADER.x} y={TRADER.y} s={1} label={t > s5.start + 0.5 ? undefined : "Trader"} opacity={traderIn * firstTraderOut} />
      <Person x={TRADER.x} y={TRADER.y} s={1} color={C.ink} head={C.lime} label="Knows the new price" opacity={informedIn} />

      {swaps}
      {takers}

      {/* LP and jar */}
      <div style={{ opacity: lpIn, transform: `scale(${0.8 + 0.2 * lpIn})`, transformOrigin: "1700px 650px" }}>
        <Person x={1740} y={650} s={1} label="LP" />
        <Abs x={JAR.x} y={JAR.y} w={JAR.w} h={JAR.h} style={{ border: `5px solid ${C.ink}`, borderTop: "none", borderRadius: "0 0 28px 28px", boxSizing: "border-box", background: C.white }} />
        {Array.from({ length: Math.min(jar, 12) }).map((_, i) => (
          <Coin key={i} x={JAR.x + 26 + (i % 4) * 26} y={JAR.y + JAR.h - 22 - Math.floor(i / 4) * 24} r={13} fill={C.lime} stroke={C.limeDeep} />
        ))}
      </div>
      {flying}
      <Abs x={1330} y={190} w={500} style={{ opacity: lpIn, transform: `translateY(${(1 - lpIn) * 16}px)` }}>
        <Big size={64}>Liquidity provider</Big>
        <div style={{ fontFamily: F.sans, fontSize: 28, color: C.body, marginTop: 16, lineHeight: 1.25 }}>fills the pool, earns a fee on each trade</div>
      </Abs>

      {/* price tags */}
      <Abs x={POOL.x + 60} y={POOL.y - 74} w={400} style={{ opacity: p(t, s5.start, s5.start + 0.3), textAlign: "center" }}>
        <Pill bg={C.white} color={C.ink} size={28} border={C.ink}>Pool price: old</Pill>
      </Abs>
      <Abs x={POOL.x + 60} y={lerp(POOL.y - 74, 70, priceJump)} w={400} style={{ opacity: priceJump > 0 ? 1 : 0, textAlign: "center" }}>
        <Pill bg={C.ink} color={C.lime} size={30}>Real price: higher</Pill>
      </Abs>
      <Abs x={POOL.x + 60} y={POOL.y + POOL.h + 70} w={400} style={{ opacity: lossK, textAlign: "center", transform: `scale(${0.7 + 0.3 * lossK})` }}>
        <Pill bg={C.neg} color={C.white} size={34}>LP loss</Pill>
      </Abs>
    </div>
  );
};
