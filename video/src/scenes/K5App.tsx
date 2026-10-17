import React from "react";
import { Img, staticFile } from "remotion";
import { C, F } from "../theme";
import { ease, kf, lerp, p, seg, useSec } from "../lib";
import { Abs, Cursor, Pill } from "../ui";
import APP from "../app.json";

const FR = { x: 410, y: 34, w: 1100, h: 890 };
const PAGE_W = 1440;

// Camera over a real full-page capture: show page region starting at (fx, fy) at zoom z.
const Page: React.FC<{ src: string; fx: number; fy: number; z: number; ty?: number }> = ({ src, fx, fy, z, ty = 0 }) => (
  <div style={{ position: "absolute", left: 0, top: ty, width: FR.w, height: FR.h, overflow: "hidden" }}>
    <Img src={staticFile(src)} style={{ position: "absolute", left: 0, top: 0, width: PAGE_W, transformOrigin: "0 0", transform: `scale(${z}) translate(${-fx}px, ${-fy}px)` }} />
  </div>
);

export const K5App: React.FC = () => {
  const t = useSec();
  const s17 = seg("s17");
  const s18 = seg("s18");

  const cta = APP.cta as { x: number; y: number; w: number; h: number };
  const panel = APP.panel as { x: number; y: number; w: number; h: number };
  const why = APP.why as { x: number; y: number; w: number; h: number };
  const dep = (APP.input as { scrollY: number }).scrollY;

  // s17: home hero, cursor walks to the CTA and clicks, the vault page scrolls up into place
  const Z1 = 1.35;
  const HFX = 0;
  const HFY = 108;
  const ctaX = (cta.x + cta.w / 2 - HFX) * Z1;
  const ctaY = (cta.y + cta.h / 2 - HFY) * Z1;
  const clickAt = s17.start + 1.7;
  const curX = kf(t, [[s17.start - 0.1, 820], [clickAt - 0.15, ctaX + 10]], ease.inOut);
  const curY = kf(t, [[s17.start - 0.1, 330], [clickAt - 0.15, ctaY + 6]], ease.inOut);
  const down = t >= clickAt && t < clickAt + 0.18 ? 1 : 0;
  const push = p(t, clickAt + 0.12, clickAt + 0.7, ease.inOut);
  const showHome = push < 1;

  // s18: why-this-pool, drift in, pan to the deposit panel, swap to the typed frames
  const WFY = why.y - 34;
  const a = s18.start;
  const fx = kf(t, [[a, 190], [a + 1.7, 190], [a + 2.6, 846]], ease.inOut);
  const fy = kf(t, [[a, WFY], [a + 1.7, WFY + 30], [a + 2.6, panel.y - 18 + dep]], ease.inOut);
  const z = kf(t, [[a, 1.62], [a + 1.7, 1.68], [a + 2.6, 1.9]], ease.inOut);
  const typedAt = [a + 2.75, a + 3.1, a + 3.45];
  const stage = t < a + 2.65 ? -1 : typedAt.filter((x) => t >= x).length; // -1 = full capture, 0..3 = deposit-N
    const inCount = stage;

  const frameIn = p(t, s17.start - 0.5, s17.start - 0.05, ease.out);
  const pill1 = p(t, a + 0.25, a + 0.65, ease.back) * (1 - p(t, a + 1.9, a + 2.2, ease.lin));
  const pill2 = p(t, a + 0.7, a + 1.1, ease.back) * (1 - p(t, a + 1.9, a + 2.2, ease.lin));
  const pill3 = p(t, a + 2.9, a + 3.3, ease.back);

  return (
    <div style={{ position: "absolute", inset: 0, background: C.canvas }}>
      <div style={{ position: "absolute", left: FR.x, top: FR.y, width: FR.w, height: FR.h, borderRadius: 30, overflow: "hidden", background: C.white, boxShadow: "0 30px 80px rgba(14,15,12,0.22)", opacity: frameIn, transform: `scale(${1 + 0.035 * p(t, s17.start - 0.5, s17.end + 0.3, ease.lin)})` }}>
        {showHome ? <Page src="app/home-full.png" fx={HFX} fy={HFY} z={Z1} ty={-push * FR.h} /> : null}
        {push > 0 ? (
          <div style={{ position: "absolute", inset: 0, transform: `translateY(${(1 - push) * FR.h}px)` }}>
            {stage < 0 ? (
              <Page src="app/vault-full.png" fx={t < a ? 190 : fx} fy={t < a ? WFY : fy} z={t < a ? 1.62 : z} />
            ) : (
              <Page src={`app/deposit-${Math.min(inCount, 3)}.png`} fx={fx} fy={fy - dep} z={z} />
            )}
          </div>
        ) : null}
        {t < clickAt + 0.5 ? <Cursor x={curX} y={curY} s={1.3} down={down} /> : null}
      </div>
      <Abs x={30} y={300} w={350} style={{ opacity: pill1, transform: `translateX(${(1 - pill1) * -40}px)` }}>
        <Pill bg={C.lime} size={34} style={{ whiteSpace: "normal" }}>Every swap replayed</Pill>
      </Abs>
      <Abs x={1535} y={420} w={350} style={{ opacity: pill2, transform: `translateX(${(1 - pill2) * 40}px)` }}>
        <Pill bg={C.white} size={30} border={C.ink} style={{ whiteSpace: "normal", lineHeight: 1.15 }}>No fee-taking hook, or a declared on-chain cap</Pill>
      </Abs>
      <Abs x={30} y={420} w={350} style={{ opacity: pill3, transform: `translateX(${(1 - pill3) * -40}px)` }}>
        <Pill bg={C.ink} color={C.lime} size={40} style={{ whiteSpace: "normal" }}>One deposit</Pill>
      </Abs>
    </div>
  );
};
