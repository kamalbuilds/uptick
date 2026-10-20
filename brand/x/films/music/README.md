# Uptick launch film score

Score for `../uptick-launch-v2-music.mp4` (20.000 s, 1920x1080, 60 fps). Generated locally with open-source tools only.

## Model

| | |
|---|---|
| Model | ACE-Step 1.5 turbo DiT (`acestep-v15-turbo`, 8 steps), no language model, instrumental |
| Code | https://github.com/ACE-Step/ACE-Step-1.5 at commit `ca1e85fe9430179831e6bc6be790c332190a3866`, `uv sync --frozen` |
| Weights | https://huggingface.co/ACE-Step/Ace-Step1.5 at revision `19671f406d603126926c1b7e2adc169acbcade22` |
| License | MIT (code and weights), commercial use permitted |
| Hardware | Mac mini, Apple M4, 16 GB, torch MPS DiT with the MLX VAE disabled |
| Speed | 38 to 67 s per 24 s clip once loaded (about 35 s model load); first clip 111 s on the MLX path |
| Tempo and key hints | 120 BPM, C Major, 4/4, 24 s requested, seed per clip in the table |
| Measurement | earshot 0.3.0 (`Leonxlnx/earshot` @ `925ebe5`, MIT; CLAP `16c8cc3`, AST `f826b80`), ffmpeg ebur128, pyloudnorm |

## Prompts

- A: Calm modern fintech product film score, instrumental. Opens with sparse clean felt piano, curious and gentle... resolving cleanly on a sustained major chord.
- B: Minimal modern fintech underscore, instrumental, 120 BPM. Intro: solo dry piano... Middle: a gentle four-on-the-floor electronic pulse... Final section: warm deep bass line, light claps... clean sustained ending chord.
- B2: B with "very quiet", "restrained and soft", "clearly the fullest and warmest".
- C: Understated confident tech product launch music... soft marimba and glass pluck pattern with a subtle electronic heartbeat pulse...

The full text of each prompt sits in the `<tag>_s<seed>.json` beside each clip. D, E, F repeat B, A, C with section tags in the lyrics field.

## Candidates

Loudness is integrated LUFS of the raw 24 s clip; section values are LUFS over 0 to 6 s, 6 to 12 s, 12 to 20 s of the raw clip. Raw WAVs stay local (gitignored); `.m4a` previews are committed.

| clip | prompt | seed | gen s | LUFS | 0-6 | 6-12 | 12-20 | notes |
|---|---|---|---|---|---|---|---|---|
| A_s101 | A | 101 | 111.4 | -18.9 | -21.8 | -17.9 | -17.9 | |
| A_s202 | A | 202 | 39.7 | -17.9 | -18.1 | -17.9 | -17.8 | music ends at 19 s |
| **B_s303** | B | 303 | 47.5 | -16.0 | -19.9 | -15.3 | -15.0 | piano to 6.7 s, pulse enters on the bar line, 120 BPM clear pulse |
| C_s404 | C | 404 | 60.4 | -14.4 | -15.2 | -13.8 | -14.2 | house feel from the first bar, ends at 17 s |
| D_s11 | B+tags | 11 | 42.2 | -18.1 | -18.9 | -19.5 | -16.5 | |
| D_s22 | B+tags | 22 | 55.0 | -17.2 | -20.9 | -15.2 | -17.7 | |
| E_s33 | A+tags | 33 | 66.7 | -18.7 | -20.8 | -20.5 | -16.9 | pulse enters at 17 s |
| F_s44 | C+tags | 44 | 56.8 | -16.6 | -18.9 | -17.6 | -14.6 | |
| G_s311 | B | 311 | 39.2 | -17.4 | -17.2 | -17.0 | -17.8 | no intro contrast |
| G_s312 | B | 312 | 40.6 | -15.3 | -24.1 | -14.9 | -14.8 | pulse at 6.0 s, music ends at 18.5 s |
| H_s321 | B2 | 321 | 50.9 | -15.1 | -36.5 | -16.1 | -13.6 | 8 s near-silent intro |
| H_s322 | B2 | 322 | 54.1 | -17.4 | -16.9 | -17.9 | -18.2 | |
| H_s323 | B2 | 323 | 39.3 | -19.6 | -25.2 | -21.9 | -17.8 | |
| H_s324 | B2 | 324 | 38.3 | -17.4 | -22.5 | -18.0 | -16.7 | pulse at 8.0 s |

Every candidate peaks at -1.0 dBFS (ACE-Step output normalisation). earshot `match` reads all eight clips it was run on as instrumental (vocal probability under 1%).

## Selection

Three finalists were cut to 20.000 s on the bar grid and muxed with the film for `earshot critique` (7 launch films as reference):

| finalist | cut start | critique |
|---|---|---|
| B_s303 | 0.689 s (first downbeat, pulse lands at 6.0 s) | launch-grade, 21/22, one major (salient hit density 1.90/s, limit 1.86) |
| G_s312 | 0.000 s | launch-grade, 20/22, major: onset density; minor: closing level 20 LU under the body |
| H_s324 | 2.000 s | close, 19/22, major: onset density |

B_s303 is the score. Shaping (`tools/shape.py`): 6 s to 13 s smoothstep opens a 3.5 kHz low-pass and lifts the level by 8 dB (intro held 2 dB down), 10 ms fade in, 1.5 s cosine fade out, then +4.5 dB with a look-ahead limiter at -1.5 dBFS (`tools/mix.py`).

Energy by section of the finished 20 s score: -18.2, -14.7, -12.8 LUFS (0-6, 6-12, 12-20 s). Final film audio: -14.1 LUFS integrated, -1.1 dBTP, LRA 8.7 LU.

## Sound effects layer

A light non-tonal layer from the earshot calm kit (`sfx-kit/kit.json`, rendered with `earshot kit render`), mixed 8 dB under the kit's own role levels on the measured scene cuts of the film:

| time | cue | kit role |
|---|---|---|
| 2.00 s | question gives way to the vault rows | tick |
| 4.00 s, 5.00 s | groups build in | tick.crisp |
| 7.00 s | third group lands | pop |
| 8.90 s | fee bar splits | whoosh.short (apex on the cut) |
| 10.50 s | zoom to AAPL | land.light |
| 14.00 s | end card | land.light |

Measured onset of each effect in the final mix: within 7 ms of its cue. `earshot critique` of the final film: launch-grade, 22 of 22 metrics in range.

## Final file

`../uptick-launch-v2-music.mp4`: video stream copied untouched (frame MD5 identical to `uptick-launch-v2.mp4`), AAC LC 192 kbps 48 kHz stereo, faststart, audio and video both 20.000 s.
