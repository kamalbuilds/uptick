"""shape.py IN.wav START_SEC OUT.wav [G2_DB] [G1_DB]  -> exactly 20.000 s, build shaped, -14 LUFS, limited, 1.5 s fade."""
import sys, subprocess, numpy as np, soundfile as sf, pyloudnorm as pln
from scipy.signal import butter, sosfilt
src, start, dst = sys.argv[1], float(sys.argv[2]), sys.argv[3]
G2 = float(sys.argv[4]) if len(sys.argv) > 4 else 4.0
G1 = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
x, sr = sf.read(src); x = x if x.ndim == 2 else np.stack([x, x], 1)
N = 20 * sr
x = x[int(round(start * sr)): int(round(start * sr)) + N]
assert len(x) == N, f"not enough audio after start: {len(x)/sr:.2f}s"
t = np.arange(N) / sr
lp = sosfilt(butter(2, 3500, fs=sr, output="sos"), x, axis=0)
r = np.clip((t - 6.0) / 7.0, 0, 1); r = r * r * (3 - 2 * r)          # smoothstep 6 s -> 13 s
g = np.where(t < 6.0, -G1, -G2 * (1 - r))                              # dB: section 2 sits G2 below the finale, rising
y = (lp * (1 - r)[:, None] + x * r[:, None]) * (10 ** (g / 20))[:, None]
y[:int(.01 * sr)] *= np.linspace(0, 1, int(.01 * sr))[:, None]
f = int(1.5 * sr); y[-f:] *= (np.cos(np.linspace(0, np.pi / 2, f)) ** 2)[:, None]
sf.write("./_shaped.wav", y.astype(np.float32), sr, subtype="FLOAT")
m = pln.Meter(sr)
def lim(db):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", "./_shaped.wav", "-af",
                    f"volume={db}dB,alimiter=limit=0.84:attack=5:release=80:level=disabled", "-c:a", "pcm_s24le", dst], check=True)
    z, _ = sf.read(dst); return m.integrated_loudness(z)
db = -14.0 - m.integrated_loudness(y)
for _ in range(4):
    l = lim(db)
    if abs(l + 14) < 0.1: break
    db += -14 - l
print(f"gain {db:.2f} dB -> {l:.2f} LUFS")
