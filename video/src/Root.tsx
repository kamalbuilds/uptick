import React from "react";
import { Composition } from "remotion";
import { Film } from "./Film";
import { DURATION, FPS } from "./lib";

export const Root: React.FC = () => (
  <Composition id="Film" component={Film} durationInFrames={Math.ceil((DURATION + 1.2) * FPS)} fps={FPS} width={1920} height={1080} />
);
