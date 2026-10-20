"""mix.py SHAPED_FLOAT.wav OUT.wav [--sfx DB]  : lay the kit takes on the film's measured cuts, then -14 LUFS + limiter."""
import sys, json, subprocess, numpy as np, soundfile as sf, pyloudnorm as pln
src, dst = sys.argv[1], sys.argv[2]
extra = float(sys.argv[sys.argv.index("--sfx") + 1]) if "--sfx" in sys.argv else None
y, sr = sf.read(src)
lock = json.load(open("./kit/takes/kit.lock.json"))["roles"]
CUES = [(2.00, "tick", 0), (4.00, "tick.crisp", 0), (5.00, "tick.crisp", 1), (7.00, "pop", 0),
        (8.90, "whoosh.short", 0), (10.50, "land.light", 0), (14.00, "land.light", 1)]   # measured scene cuts of uptick-launch-v2.mp4
if extra is not None:
    for cue, role, k in CUES:
        r = lock[role]; take = r["takes"][k]
        w, wsr = sf.read(f"./kit/takes/{take['file']}"); assert wsr == sr, (wsr, sr)
        w = w if w.ndim == 2 else np.stack([w, w], 1)
        pt = take["peak_s"] if r["align"] == "peak" else take["onset_s"]
        i = int(round((cue - pt) * sr)); w = w * 10 ** ((r["level_db"] + extra) / 20)
        y[i:i + len(w)] += w[: len(y) - i]
m = pln.Meter(sr)
def lim(db):
    sf.write("./_mixed.wav", y.astype(np.float32), sr, subtype="FLOAT")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", "./_mixed.wav", "-af",
                    f"volume={db}dB,alimiter=limit=0.84:attack=5:release=80:level=disabled", "-c:a", "pcm_s24le", dst], check=True)
    z, _ = sf.read(dst); return m.integrated_loudness(z)
db = -14.0 - m.integrated_loudness(y)
for _ in range(4):
    l = lim(db)
    if abs(l + 14) < 0.1: break
    db += -14 - l
print(f"gain {db:.2f} dB -> {l:.2f} LUFS")
