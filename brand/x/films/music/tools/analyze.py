import sys, json, numpy as np, soundfile as sf, pyloudnorm as pln
from scipy.signal import stft
def an(path, bpm=120.0, t0=0.0, dur=None, secs=((0,6),(6,12),(12,20))):
    x, sr = sf.read(path); x = x if x.ndim == 2 else np.stack([x, x], 1)
    x = x[int(t0*sr):]; 
    if dur: x = x[:int(dur*sr)]
    m = pln.Meter(sr); out = {"file": path.split('/')[-1], "dur": round(len(x)/sr, 3)}
    out["lufs"] = round(m.integrated_loudness(x), 2)
    out["peak_db"] = round(20*np.log10(np.abs(x).max()+1e-12), 2)
    mono = x.mean(1)
    f, t, Z = stft(mono, sr, nperseg=2048, noverlap=1536); mag = np.abs(Z)
    flux = np.maximum(np.diff(mag, axis=1), 0).sum(0); tf = t[1:]
    cen = (mag*f[:, None]).sum(0)/(mag.sum(0)+1e-9)
    secs_out = []
    for a, b in secs:
        if a*sr >= len(x): continue
        seg = x[int(a*sr):int(b*sr)]
        rms = 20*np.log10(np.sqrt((seg**2).mean())+1e-12)
        try: l = m.integrated_loudness(seg)
        except Exception: l = None
        k = (tf >= a) & (tf < b)
        th = flux.mean()+1.0*flux.std()
        fl = flux[k]; on = int(((fl[1:-1] > fl[:-2]) & (fl[1:-1] > fl[2:]) & (fl[1:-1] > th)).sum())
        secs_out.append({"sec": f"{a}-{b}", "rms_db": round(rms, 2), "lufs": None if l is None else round(l, 2),
                         "onsets_per_s": round(on/(b-a), 2), "centroid_hz": int(cen[(t>=a)&(t<b)].mean())})
    out["sections"] = secs_out
    bar = 240.0/bpm; nb = int(len(x)/sr/bar)
    out["bar_rms_db"] = [round(20*np.log10(np.sqrt((x[int(i*bar*sr):int((i+1)*bar*sr)]**2).mean())+1e-12), 1) for i in range(nb)]
    out["head_0.3s_db"] = round(20*np.log10(np.sqrt((x[:int(.3*sr)]**2).mean())+1e-12), 1)
    return out
if __name__ == "__main__":
    for p in sys.argv[1:]: print(json.dumps(an(p)))
