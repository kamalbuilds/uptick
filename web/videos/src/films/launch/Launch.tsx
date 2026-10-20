import { AbsoluteFill } from "remotion";

import type { FilmProps } from "../../Root";
import { NVDA } from "../../data";
import { TargetLog } from "../../kit/debug";
import { camera, worldTransform, type CameraKey } from "../../kit/camera";
import { step } from "../../kit/spring";
import { useTime } from "../../kit/time";
import { enter, fall, rise } from "../../motion";
import { GateFigureTwin } from "../../twins/gate-figure";
import { HomeTwin, type HomeAnim, type RowAnim } from "../../twins/home-view";
import { LeakFigureTwin, type LeakAnim } from "../../twins/leak-figure";
import { VaultHeaderTwin, VerdictTwin } from "../../twins/detail";
import { byState } from "../../data";
import { cue } from "./cues";
import { DETAIL_WIDTH, DETAIL_ZOOM, HOME_WIDTH, HOME_ZOOM } from "./layout";

/** The ticker traveler: NVDA in the row (screen px, measured at the zoomed home camera) flying to the title of the vault page (measured at the detail start camera). */
const TRAVEL = { from: { x: 608, y: 494, size: 39, weight: 600, tracking: -0.1 * 2.6 }, to: { x: 177, y: 356, size: 32 * DETAIL_ZOOM, weight: 500, tracking: -0.33 * DETAIL_ZOOM }, spring: { stiffness: 150, damping: 20, mass: 1 }, settle: 0.8 } as const;

function Traveler({ t }: { t: number }) {
  const local = t - cue.zoom.swap;
  if (local < 0 || local > TRAVEL.settle) return null;
  const u = step(local, TRAVEL.spring);
  const mix = (key: "x" | "y" | "size" | "weight" | "tracking") => TRAVEL.from[key] + (TRAVEL.to[key] - TRAVEL.from[key]) * u;
  return (
    <div style={{ position: "absolute", left: mix("x"), top: mix("y"), translate: "-50% -50%", fontSize: mix("size"), fontWeight: mix("weight"), letterSpacing: mix("tracking"), lineHeight: 1, whiteSpace: "nowrap", color: "#f4f5f5" }}>
      NVDA
    </div>
  );
}

const world = (view: ReturnType<typeof camera>, width: number) => ({ position: "absolute", left: 0, top: 0, width, transformOrigin: "0 0", transform: worldTransform(view) }) as const;

/** Inline styles on purpose: arbitrary-value classes here would be picked up by the web app's own Tailwind scan of this folder. */
function EndCard({ t }: { t: number }) {
  if (t < cue.end.start) return null;
  const left = 77;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left, top: 300, fontSize: 220, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.04em", ...enter(rise(t, cue.end.wordmark, 0.5), 40) }}>Uptick</div>
      <div className="bg-hairline" style={{ position: "absolute", left, top: 600, height: 1, width: 1766, transformOrigin: "0 0", scale: `${rise(t, cue.end.wordmark, 0.8)} 1` }} />
      <div style={{ position: "absolute", left, top: 640, fontSize: 44, fontWeight: 500, lineHeight: 1, letterSpacing: "-0.01em", ...enter(rise(t, cue.end.url, 0.4), 16) }}>uptick-fi.pages.dev</div>
    </div>
  );
}

export function Launch({ debug }: FilmProps) {
  const t = useTime();

  const row = (start: number): RowAnim => ({ show: rise(t, start, 0.35), grow: rise(t, start + 0.15, 0.8) });
  const reducedIds = byState("reduced").map((v) => v.id);
  const homeAnim: HomeAnim = {
    heading: [
      rise(t, cue.heading.groups[0], 0.4),
      rise(t, cue.heading.groups[1], 0.4),
      rise(t, cue.heading.groups[2], 0.4),
      rise(t, cue.heading.swap, 0.35),
      rise(t, cue.heading.and, 0.35),
      rise(t, cue.heading.how, 0.35),
      rise(t, cue.heading.keep, 0.35),
    ],
    intro: rise(t, cue.home.intro, 0.5),
    header: rise(t, cue.home.header, 0.4),
    open: rise(t, cue.home.open, 0.35),
    reduced: rise(t, cue.home.reduced, 0.35),
    closed: rise(t, cue.home.closed, 0.35),
    rows: {
      aapl: row(cue.home.rows.aapl),
      nvda: row(cue.home.rows.nvda),
      ...Object.fromEntries(reducedIds.map((id, i) => [id, row(cue.home.reducedRows[i])])),
    },
  };

  const homeKeys: CameraKey[] = [
    [0, 252, 70, 3.5],
    [cue.home.pullBack, HOME_WIDTH / 2, 320, HOME_ZOOM],
    [cue.zoom.start, 560, 190, 2.6],
  ];
  const detailKeys: CameraKey[] = [
    [cue.zoom.swap, DETAIL_WIDTH / 2, 120, DETAIL_ZOOM],
    [cue.zoom.swap + 0.9, DETAIL_WIDTH / 2, 360, DETAIL_ZOOM],
    [cue.verdict.camera, DETAIL_WIDTH / 2, 255, DETAIL_ZOOM],
    [cue.gate.camera, DETAIL_WIDTH / 2, 638, DETAIL_ZOOM],
  ];

  const leak: LeakAnim = {
    fill: rise(t, cue.leak.fill, 1.0),
    paint: [rise(t, cue.leak.paint[0], 0.4), rise(t, cue.leak.paint[1], 0.3), rise(t, cue.leak.paint[2], 0.6)],
    label: [rise(t, cue.leak.label[0], 0.3), rise(t, cue.leak.label[1], 0.3), rise(t, cue.leak.label[2], 0.3)],
    legend: [rise(t, cue.leak.legend[0], 0.4), rise(t, cue.leak.legend[1], 0.4), rise(t, cue.leak.legend[2], 0.4)],
  };

  const homeVisible = t < cue.zoom.swap + 0.6;
  const detailVisible = t >= cue.zoom.swap && t < cue.end.start + 0.3;
  const detailIn = rise(t, cue.zoom.swap + 0.25, 0.3);
  const travelling = t >= cue.zoom.swap && t < cue.zoom.swap + TRAVEL.settle;
  const detailExit = fall(t, cue.end.start, 0.3);
  const homeExit = fall(t, cue.zoom.swap, 0.3);

  return (
    <AbsoluteFill style={{ background: "#0a0b0c", overflow: "hidden" }}>
      {homeVisible ? (
        <div style={{ opacity: homeExit }}>
          <div style={world(camera(t, homeKeys), HOME_WIDTH)}>
            <HomeTwin a={{ ...homeAnim, dim: 1 - 0.8 * rise(t, cue.zoom.start, 0.6), keepLit: t >= cue.zoom.start ? "nvda" : undefined, tickerHidden: t >= cue.zoom.swap ? "nvda" : undefined }} />
          </div>
        </div>
      ) : null}
      {detailVisible ? (
        <div style={{ opacity: detailExit * detailIn }}>
          <div style={world(camera(t, detailKeys), DETAIL_WIDTH)}>
            <div style={{ opacity: fall(t, cue.gate.camera, 0.4) }}>
            <VaultHeaderTwin cfg={NVDA} a={{ rest: rise(t, cue.zoom.swap + 0.5, 0.4), tickerHidden: travelling }} />
            <div className="mt-8"><VerdictTwin cfg={NVDA} t={t} at={cue.verdict.words} /></div>
            <div className="mt-12" data-target="leak" style={{ opacity: rise(t, cue.zoom.swap + 0.6, 0.4) }}><LeakFigureTwin cfg={NVDA} a={leak} /></div>
            </div>
            <div className="mt-14" data-target="gate" style={{ opacity: rise(t, cue.gate.camera - 0.1, 0.3) }}>
              <GateFigureTwin cfg={NVDA} a={{ band: rise(t, cue.gate.band, 0.6), worst: rise(t, cue.gate.worst, 0.4), other: rise(t, cue.gate.other, 0.4), reason: rise(t, cue.gate.reason, 0.4) }} />
            </div>
          </div>
        </div>
      ) : null}
      <Traveler t={t} />
      <EndCard t={t} />
      {debug ? <TargetLog /> : null}
    </AbsoluteFill>
  );
}

