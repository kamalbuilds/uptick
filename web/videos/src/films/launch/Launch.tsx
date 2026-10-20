import { AbsoluteFill } from "remotion";

import type { FilmProps } from "../../Root";
import { AAPL, byState } from "../../data";
import { TargetLog } from "../../kit/debug";
import { camera, worldTransform, type CameraKey } from "../../kit/camera";
import { step } from "../../kit/spring";
import { useTime } from "../../kit/time";
import { enter, fall, rise } from "../../motion";
import { GateFigureTwin } from "../../twins/gate-figure";
import { HomeTwin, type HomeAnim, type RowAnim } from "../../twins/home-view";
import { LeakFigureTwin, type LeakAnim } from "../../twins/leak-figure";
import { VaultHeaderTwin, VerdictTwin } from "../../twins/detail";
import { cue } from "./cues";
import { DETAIL_WIDTH, DETAIL_ZOOM, HOME_CAMERA, HOME_WIDTH, HOME_ZOOM, ROW_TARGET, TRAVEL_FROM, TRAVEL_TO } from "./layout";

/** The ticker traveler: the symbol in its row (screen px, measured at the zoomed home camera) flying to the title of the vault page (measured at the detail start camera). */
const TRAVEL = {
  from: { ...TRAVEL_FROM, weight: 600, tracking: -0.1 * ROW_TARGET.zoom },
  to: { ...TRAVEL_TO, size: 32 * DETAIL_ZOOM, weight: 500, tracking: -0.33 * DETAIL_ZOOM },
  spring: { stiffness: 150, damping: 20, mass: 1 },
  settle: 0.8,
} as const;

function Traveler({ t }: { t: number }) {
  const local = t - cue.zoom.swap;
  if (local < 0 || local > TRAVEL.settle) return null;
  const u = step(local, TRAVEL.spring);
  const mix = (key: "x" | "y" | "size" | "weight" | "tracking") => TRAVEL.from[key] + (TRAVEL.to[key] - TRAVEL.from[key]) * u;
  return (
    <div style={{ position: "absolute", left: mix("x"), top: mix("y"), translate: "-50% -50%", fontSize: mix("size"), fontWeight: mix("weight"), letterSpacing: mix("tracking"), lineHeight: 1, whiteSpace: "nowrap", color: "#f4f5f5" }}>
      {AAPL.symbol}
    </div>
  );
}

const world = (view: ReturnType<typeof camera>, width: number) => ({ position: "absolute", left: 0, top: 0, width, transformOrigin: "0 0", transform: worldTransform(view) }) as const;

/**
 * End card: the README's line in the site's serif, the wordmark and the address under one hairline.
 * Inline styles on purpose: arbitrary-value classes here would be picked up by the web app's own Tailwind scan of this folder.
 */
function EndCard({ t }: { t: number }) {
  if (t < cue.end.start) return null;
  const left = 77;
  const words = [["Put", "your", "stock"], ["tokens", "to", "work."]];
  const at = [cue.end.start + 0.1, cue.end.start + 0.3];
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div className="serif" style={{ position: "absolute", left, top: 215, fontSize: 138, lineHeight: "146px", fontWeight: 400 }}>
        {words.map((line, i) => (
          <div key={i} style={enter(rise(t, at[i], 0.5), 40)}>{line.join(" ")}</div>
        ))}
      </div>
      <div className="bg-hairline" style={{ position: "absolute", left, top: 640, height: 2, width: 1766, transformOrigin: "0 0", scale: `${rise(t, cue.end.line, 0.8)} 1` }} />
      <div style={{ position: "absolute", left, top: 690, fontSize: 150, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.04em", ...enter(rise(t, cue.end.wordmark, 0.5), 30) }}>Uptick</div>
      <div style={{ position: "absolute", right: 77, top: 745, fontSize: 60, fontWeight: 500, lineHeight: 1, letterSpacing: "-0.01em", ...enter(rise(t, cue.end.url, 0.5), 20) }}>uptick-fi.pages.dev</div>
    </div>
  );
}

export function Launch({ debug }: FilmProps) {
  const t = useTime();

  const row = (start: number): RowAnim => ({ show: rise(t, start, 0.35), grow: rise(t, start + 0.15, 0.8) });
  const reducedIds = byState("reduced").map((v) => v.id);
  const openIds = byState("open").map((v) => v.id);
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
    left: fall(t, cue.home.headingOut, 0.5),
    header: rise(t, cue.home.header, 0.4),
    open: rise(t, cue.home.open, 0.35),
    reduced: rise(t, cue.home.reduced, 0.35),
    closed: rise(t, cue.home.closed, 0.35),
    rows: {
      [openIds[0]]: row(cue.home.rows.aapl),
      [openIds[1]]: row(cue.home.rows.googl),
      ...Object.fromEntries(reducedIds.map((id, i) => [id, row(cue.home.reducedRows[i])])),
    },
  };

  const homeKeys: CameraKey[] = [
    [0, 252, 70, 3.5],
    [cue.home.pullBack, HOME_CAMERA.overview.x, HOME_CAMERA.overview.y, HOME_CAMERA.overview.zoom],
    [cue.home.pan[0], HOME_CAMERA.list.x, HOME_CAMERA.list.top, HOME_CAMERA.list.zoom],
    [cue.home.pan[1], HOME_CAMERA.list.x, HOME_CAMERA.list.bottom, HOME_CAMERA.list.zoom],
    [cue.zoom.start, ROW_TARGET.x, ROW_TARGET.y, ROW_TARGET.zoom],
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
            <HomeTwin a={{ ...homeAnim, dim: 1 - 0.8 * rise(t, cue.zoom.start, 0.6), keepLit: t >= cue.zoom.start ? openIds[0] : undefined, tickerHidden: t >= cue.zoom.swap ? openIds[0] : undefined }} />
          </div>
        </div>
      ) : null}
      {detailVisible ? (
        <div style={{ opacity: detailExit * detailIn }}>
          <div style={world(camera(t, detailKeys), DETAIL_WIDTH)}>
            <div style={{ opacity: fall(t, cue.gate.camera, 0.4) }}>
              <VaultHeaderTwin cfg={AAPL} a={{ rest: rise(t, cue.zoom.swap + 0.5, 0.4), tickerHidden: travelling }} />
              <div className="mt-8"><VerdictTwin cfg={AAPL} t={t} at={cue.verdict.words} /></div>
              <div className="mt-12" data-target="leak" style={{ opacity: rise(t, cue.zoom.swap + 0.6, 0.4) }}><LeakFigureTwin cfg={AAPL} a={leak} barPx={DETAIL_WIDTH} /></div>
            </div>
            <div className="mt-14" data-target="gate" style={{ opacity: rise(t, cue.gate.camera - 0.1, 0.3) }}>
              <GateFigureTwin cfg={AAPL} a={{ band: rise(t, cue.gate.band, 0.6), worst: rise(t, cue.gate.worst, 0.4), other: rise(t, cue.gate.other, 0.4), reason: rise(t, cue.gate.reason, 0.4) }} />
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
