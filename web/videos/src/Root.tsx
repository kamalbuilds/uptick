import "./styles.css";
import { Composition } from "remotion";

import "./fonts";
import { FeeLoop } from "./films/fee-loop/FeeLoop";
import { DURATION as FEE_LOOP_SECONDS } from "./films/fee-loop/cues";
import { Launch } from "./films/launch/Launch";
import { DURATION as LAUNCH_SECONDS } from "./films/launch/cues";

export type FilmProps = { fps: number; debug: boolean };
const defaultProps: FilmProps = { fps: 60, debug: false };

/** fps comes from props: 60 in Studio and for stills, 240 for the final render (motion blur, scripts/render.ts). */
export function Root() {
  return (
    <>
      <Composition
        id="Launch"
        component={Launch}
        width={1920}
        height={1080}
        fps={60}
        durationInFrames={LAUNCH_SECONDS * 60}
        defaultProps={defaultProps}
        calculateMetadata={({ props }) => ({ fps: props.fps, durationInFrames: Math.round(LAUNCH_SECONDS * props.fps) })}
      />
      <Composition
        id="FeeLoop"
        component={FeeLoop}
        width={1080}
        height={1080}
        fps={60}
        durationInFrames={FEE_LOOP_SECONDS * 60}
        defaultProps={defaultProps}
        calculateMetadata={({ props }) => ({ fps: props.fps, durationInFrames: Math.round(FEE_LOOP_SECONDS * props.fps) })}
      />
    </>
  );
}
