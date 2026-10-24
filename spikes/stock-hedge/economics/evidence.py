"""The figures in spikes/stock-hedge/EVIDENCE.md, read from the output files in this folder. Run: python3 evidence.py"""
import json, os, statistics as st
H = os.path.dirname(os.path.abspath(__file__))
load = lambda f: json.load(open(os.path.join(H, f)))
basis, close, fund = load("basis_out.json"), load("closetime.json"), load("funding_weekends.json")

print("basis_out.json (basis.py): median absolute hourly gap between pool and perp, per weekend, then the median of those")
for k in ("NVDA|0.05%", "AAPL|0.05%", "TSLA|0.05%", "TSLA|0.3%"):
    m = [w["abs_med_nomult"] for w in basis[k] if w["abs_med_nomult"] is not None]
    print(f"  {k:11s} {len(m)} weekends  weekly medians {min(m):.1f} to {max(m):.1f} bp  median {st.median(m):.1f} bp")
print("basis_out.json: sd of the pool's own Friday-to-Monday move, the weekend an unhedged holder carries")
for k in ("NVDA|0.05%", "AAPL|0.05%", "TSLA|0.3%"):
    r = [w["pool_ret"] for w in basis[k]]
    print(f"  {k:11s} {len(r)} weekends  sd {st.pstdev(r):.1f} bp  mean absolute move {st.mean(abs(x) for x in r):.1f} bp")
print("closetime.json (closetime.py): sd of pool move less perp move, Friday close to the named Monday time")
for k in ("NVDA|0.05%", "AAPL|0.05%", "TSLA|0.3%"):
    for t in ("Mon13:00", "Mon13:30"):
        v = close[k][t]
        print(f"  {k:11s} {t}  n={len(v)}  sd {st.pstdev(v):.1f} bp  largest {max(abs(x) for x in v):.1f} bp")
f = [r[1] for r in fund["NVDA"] if r[3] == 65]
print(f"funding_weekends.json (funding.py): NVDA short earned a mean {st.mean(f):.2f} bp over {len(f)} complete weekends, range {min(f):.2f} to {max(f):.2f}")
