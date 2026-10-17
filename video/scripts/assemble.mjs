// Level each voiceb clip, lay the clips on one timeline with designed gaps, write public/narration.wav and src/timings.json.
// Audio is the clock: every scene in src/ is timed from src/timings.json.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const vo = JSON.parse(fs.readFileSync(`${root}/vo.json`, "utf8")).segments;
const TEMPO = Number(process.env.TEMPO ?? 1.05);
const LEAD = 0.35;
const GAP = { default: 0.22, s02: 0.45, s05: 0.5, s08: 0.5, s10: 0.25, s12: 0.3, s14: 0.45, s16: 0.5, s18: 0.7 };
fs.mkdirSync(`${root}/vo/norm`, { recursive: true });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());

let t = LEAD;
const segs = [];
for (const s of vo) {
  const raw = `${root}/vo/raw/${s.id}.wav`;
  const out = `${root}/vo/norm/${s.id}.wav`;
  // strip leading/trailing silence, speed up slightly, level to -19 LUFS
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-af",
    `silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,atempo=${TEMPO},loudnorm=I=-19:TP=-1.5:LRA=7`,
    "-ar", "24000", "-ac", "1", out]);
  const d = dur(out);
  segs.push({ id: s.id, text: s.text, ...(s.cap ? { cap: s.cap } : {}), start: +t.toFixed(3), end: +(t + d).toFixed(3) });
  t += d + (GAP[s.id] ?? GAP.default);
}
const duration = +(segs[segs.length - 1].end + 0.6).toFixed(3);

const inputs = segs.flatMap((s) => ["-i", `${root}/vo/norm/${s.id}.wav`]);
const filt = segs.map((s, i) => `[${i}]adelay=${Math.round(s.start * 1000)}|${Math.round(s.start * 1000)}[a${i}]`).join(";") + ";" + segs.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${segs.length}:normalize=0:duration=longest[o]`;
fs.mkdirSync(`${root}/public`, { recursive: true });
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filt, "-map", "[o]", "-ar", "24000", "-ac", "1", `${root}/public/narration.wav`]);
fs.writeFileSync(`${root}/src/timings.json`, JSON.stringify({ tempo: TEMPO, duration, segments: segs }, null, 1));
console.log(`segments ${segs.length}, narration ends ${segs[segs.length - 1].end}s, duration ${duration}s, wav ${dur(`${root}/public/narration.wav`).toFixed(2)}s`);
