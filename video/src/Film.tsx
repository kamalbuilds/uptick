import React from "react";
import { Audio, continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import { C, F, display } from "./theme";
import { DURATION, ease, FPS, p, seg, SEGS, W } from "./lib";
import { K0Week } from "./scenes/K0Week";
import { K1Pool } from "./scenes/K1Pool";
import { K2Chart } from "./scenes/K2Chart";
import { K3Pools } from "./scenes/K3Pools";
import { K4Cap } from "./scenes/K4Cap";
import { K5App } from "./scenes/K5App";
import { K6Close } from "./scenes/K6Close";

const SCENES = [
  { C: K0Week, first: "s01" },
  { C: K1Pool, first: "s03" },
  { C: K2Chart, first: "s06" },
  { C: K3Pools, first: "s09" },
  { C: K4Cap, first: "s15" },
  { C: K5App, first: "s17" },
  { C: K6Close, first: "s19" },
];
// The camera pans left through the strip; each pan starts just before the first line of the next scene.
const PAN = { lead: 0.4, dur: 0.8 };
const panAt = (k: number) => seg(SCENES[k].first).start - PAN.lead;

const camera = (t: number) => {
  let c = 0;
  for (let k = 1; k < SCENES.length; k++) c += p(t, panAt(k), panAt(k) + PAN.dur, ease.inOut);
  return c;
};

// Slow push-in over each scene so every second has the camera travelling (the app scene runs its own camera).
const pushScale = (k: number, t: number) => {
  if (k === 5) return 1;
  const a = k === 0 ? 0 : panAt(k);
  const b = k === SCENES.length - 1 ? DURATION : panAt(k + 1) + PAN.dur;
  return 1 + 0.06 * p(t, a, b, ease.lin);
};

const useFonts = () => {
  const [h] = React.useState(() => delayRender("fonts"));
  React.useEffect(() => {
    const faces = [
      new FontFace("Archivo", `url(${staticFile("fonts/archivo.woff2")})`, { weight: "100 900", stretch: "62% 125%" }),
      new FontFace("Figtree", `url(${staticFile("fonts/figtree.woff2")})`, { weight: "300 900" }),
      new FontFace("Geist Mono", `url(${staticFile("fonts/geistmono.woff2")})`, { weight: "100 900" }),
    ];
    Promise.all(faces.map((f) => f.load())).then((l) => {
      l.forEach((f) => document.fonts.add(f));
      continueRender(h);
    });
  }, [h]);
};

const Captions: React.FC<{ t: number; cam: number }> = ({ t, cam }) => {
  const s = SEGS.find((x) => t >= x.start - 0.05 && t <= x.end + 0.25);
  if (!s || cam > SCENES.length - 1.5) return null;
  const k = Math.min(p(t, s.start - 0.05, s.start + 0.2, ease.out), 1 - p(t, s.end + 0.05, s.end + 0.25, ease.lin));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, display: "flex", justifyContent: "center", opacity: k, transform: `translateY(${(1 - k) * 12}px)` }}>
      <div style={{ background: C.white, color: C.ink, borderRadius: 26, padding: "14px 34px", fontFamily: F.sans, fontWeight: 600, fontSize: 38, maxWidth: 1560, textAlign: "center", lineHeight: 1.18, boxShadow: "0 8px 30px rgba(14,15,12,0.10)" }}>
        {s.cap ?? s.text}
      </div>
    </div>
  );
};

export const Film: React.FC = () => {
  useFonts();
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const cam = camera(t);
  const word = 1 - p(cam, SCENES.length - 2, SCENES.length - 1.2, ease.lin);
  return (
    <div style={{ position: "absolute", inset: 0, background: C.canvas, overflow: "hidden" }}>
      <Audio src={staticFile("narration.wav")} />
      <div style={{ position: "absolute", left: -cam * W, top: 0, width: W * SCENES.length, height: 1080 }}>
        {SCENES.map((S, k) =>
          Math.abs(cam - k) < 1.05 ? (
            <div key={k} style={{ position: "absolute", left: k * W, top: 0, width: W, height: 1080, overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, transformOrigin: "50% 50%", transform: `scale(${pushScale(k, t)})` }}><S.C /></div>
            </div>
          ) : null
        )}
      </div>
      <div style={{ position: "absolute", left: 56, top: 36, opacity: word }}>
        <div style={{ ...display, fontSize: 46, color: C.ink, lineHeight: 1 }}>Uptick</div>
        <div style={{ fontFamily: F.sans, fontWeight: 600, fontSize: 21, color: C.body, marginTop: 6 }}>Yield on Stock Tokens</div>
      </div>
      <div style={{ position: "absolute", left: 300, top: 42, opacity: 1 - p(cam, 0.05, 0.6, ease.lin) }}>
        <div style={{ display: "inline-block", background: C.lime, color: C.ink, borderRadius: 999, padding: "10px 26px", fontFamily: F.sans, fontWeight: 700, fontSize: 28 }}>Stock Token yield, chosen by the chain's own data</div>
      </div>
      <Captions t={t} cam={cam} />
    </div>
  );
};
