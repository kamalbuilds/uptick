import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Final render, adapted from the product-film skill (scripts/render.ts) for silent X films:
 * a 240 fps master (4 subframes per 60 fps frame), blended with ffmpeg tmix into 60 fps motion blur,
 * then one H.264 file X accepts (yuv420p, 60 fps, BT.709 tags, faststart), a poster and a loop-seam sheet.
 *
 *   bun scripts/render.ts <CompositionId> <file-name> --duration 20 --size 1920x1080 --poster 14.2 [--version v1]
 *
 * Output: out/<file-name>/<version>/<file-name>.mp4, poster.jpg, loop-seam.png
 * The composition takes `fps` as a prop (calculateMetadata sets fps and durationInFrames from it).
 * ffmpeg comes from imageio-ffmpeg through uv: Remotion's own build has no tmix, select or tile filters.
 */
const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const [composition, name] = args;
const duration = Number(flag("--duration"));
const posterSeconds = Number(flag("--poster") ?? duration / 2);
const size = flag("--size") ?? "1920x1080";
const version = flag("--version") ?? "v1";
const crf = flag("--qp") ?? "14";
const keep = args.includes("--keep");
if (!composition || !name || !duration) throw new Error("Usage: bun scripts/render.ts <CompositionId> <file-name> --duration <s> [--size 1920x1080] [--poster <s>] [--version v1] [--qp 14] [--keep]");
const [width, height] = size.split("x").map(Number);

const root = resolve(import.meta.dirname, "..");
const out = join(root, "out", name, version);
mkdirSync(out, { recursive: true });
const run = (command: string, list: string[]) => execFileSync(command, list, { cwd: root, stdio: "inherit" });
const ffmpeg = execFileSync("uv", ["run", "--quiet", "--with", "imageio-ffmpeg", "python3", "-c", "import imageio_ffmpeg as i; print(i.get_ffmpeg_exe())"], { encoding: "utf8" }).trim();

const master = join(out, "master-240.mov");
const blurred = join(out, "blurred-60.mov");
const frames = Math.round(duration * 60);
const file = join(out, `${name}.mp4`);

// 1. The 240 fps master: PNG frames into ProRes 4444 (intra only and near lossless: an h264 master made frame 0 and the last frame differ by up to 16 on static text, which a loop must not do). No audio. (Node API, not the CLI: see scripts/media.ts.)
run("bun", ["scripts/media.ts", composition, master, "--fps", "240", "--png", "--prores"]);

// 2. Motion blur: average each group of 4 subframes, keep one per group -> 60 fps.
//    The master is untagged LIMITED range with the BT.601 matrix. Say so: reading it as full range lifts every black
//    (#0a0b0c comes out lighter). Out: BT.709 limited range.
run(ffmpeg, [
  "-v", "error", "-y", "-i", master,
  "-vf", "tmix=frames=4:weights='1 1 1 1',select='not(mod(n+1\\,4))',setpts=N/(60*TB),scale=in_range=tv:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv444p10le",
  "-r", "60", "-c:v", "prores_ks", "-profile:v", "4444", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
  blurred,
]);

// 3. The deliverable: H.264 High, yuv420p, 60 fps, BT.709, faststart, no audio track.
//    Constant QP with a forced key frame on the last frame: the first and last frames are then both intra frames at one QP, so a loop's
//    identical first and last input frames decode identically instead of differing by rate-control noise.
run(ffmpeg, [
  "-v", "error", "-y", "-i", blurred,
  "-c:v", "libx264", "-preset", "slow", "-qp", crf, "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "60", "-force_key_frames", `expr:eq(n,${frames - 1})`,
  "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
  "-movflags", "+faststart", "-an", file,
]);
run(ffmpeg, ["-v", "error", "-y", "-ss", String(posterSeconds), "-i", blurred, "-frames:v", "1", "-q:v", "2", join(out, "poster.jpg")]);

// 4. Loop seam: the last 8 and first 8 frames, played twice back to back, in one sheet.
run(ffmpeg, ["-v", "error", "-y", "-stream_loop", "1", "-i", file, "-vf", `select='between(n\\,${frames - 8}\\,${frames + 7})',scale=${Math.round(width / 6)}:${Math.round(height / 6)},tile=8x2`, "-frames:v", "1", "-vsync", "vfr", join(out, "loop-seam.png")]);

rmSync(master);
if (!keep) rmSync(blurred);
for (const f of [`${name}.mp4`, "poster.jpg"]) console.log(`${join(name, version, f)}: ${(statSync(join(out, f)).size / 1e6).toFixed(2)} MB (${width}x${height})`);
