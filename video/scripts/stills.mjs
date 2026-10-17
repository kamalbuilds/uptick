// Bundle once, render stills at the given times (seconds) to out/stills/. Usage: node scripts/stills.mjs 3 8 12.5
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const times = process.argv.slice(2).map(Number);
const serveUrl = await bundle({ entryPoint: `${root}/src/index.ts`, publicDir: `${root}/public` });
const comp = await selectComposition({ serveUrl, id: "Film" });
fs.mkdirSync(`${root}/out/stills`, { recursive: true });
for (const t of times) {
  const frame = Math.round(t * comp.fps);
  const output = `${root}/out/stills/t${String(t).padStart(5, "0")}.png`;
  await renderStill({ composition: comp, serveUrl, frame, output, scale: 0.5 });
  console.log("still", t, output);
}
console.log("duration frames", comp.durationInFrames, "fps", comp.fps);
