import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

/**
 * Renders a composition to a video file through the Node API (bundle once, then renderMedia), the same path scripts/stills.ts takes.
 * The `remotion render` CLI hung at "Getting composition" on this machine while the API path rendered, so every render goes through here.
 *
 *   bun scripts/media.ts <CompositionId> <out file> [--fps 60] [--scale 0.5] [--crf 24] [--png] [--yuv444] [--prores]
 *
 * Muted always: the films are silent.
 */
const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
};
const fps = Number(flag("--fps", "60"));
const scale = Number(flag("--scale", "1"));
const crf = Number(flag("--crf", "24"));
const png = args.includes("--png");
const yuv444 = args.includes("--yuv444");
const prores = args.includes("--prores");
const [composition, output] = args.filter((a) => !a.startsWith("--"));
if (!composition || !output) throw new Error("Usage: bun scripts/media.ts <CompositionId> <out file> [--fps 60] [--scale 0.5] [--crf 24] [--png] [--yuv444]");

const root = resolve(import.meta.dirname, "..");
const webpackOverride = await import(join(root, "webpack-override.ts")).then((m) => m.webpackOverride);
const serveUrl = await bundle({ entryPoint: join(root, "src/index.ts"), webpackOverride, publicDir: join(root, "public") });
const inputProps = { fps, debug: false };
const selected = await selectComposition({ serveUrl, id: composition, inputProps });
const target = resolve(output);
mkdirSync(dirname(target), { recursive: true });
let last = -1;
await renderMedia({
  serveUrl,
  composition: selected,
  inputProps,
  outputLocation: target,
  codec: prores ? "prores" : "h264",
  ...(prores ? { proResProfile: "4444" as const } : { crf }),
  scale,
  muted: true,
  imageFormat: png ? "png" : "jpeg",
  pixelFormat: prores ? "yuva444p10le" : yuv444 ? "yuv444p" : "yuv420p",
  concurrency: Number(process.env.RENDER_CONCURRENCY ?? 4),
  onProgress: ({ progress }) => {
    const pct = Math.floor(progress * 10);
    if (pct !== last) { last = pct; console.log(`${pct * 10}%`); }
  },
});
console.log(target);
