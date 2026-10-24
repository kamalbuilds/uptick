import json,math,bisect,statistics as st,datetime as dt
from basis import *
def hopen(sym): return {c['t']//1000:c['o'] for c in perp1h[sym]}
def p_last(T,P,t):
    j=bisect.bisect_left(T,t); return (P[j-1],t-T[j-1]) if j else (None,None)
res={}
for key in [("NVDA","0.05%"),("AAPL","0.05%"),("TSLA","0.05%"),("TSLA","0.3%"),("PLTR","0.3%")]:
    sym,lab=key; T,P=load(sym,lab); ho=hopen(sym)
    rows={}
    x=dt.datetime(2026,8,21,tzinfo=U)   # Fridays (20:00 UTC) with pool coverage start
    while x<dt.datetime(2026,10,17,tzinfo=U):
        F=x.date(); a=int(dt.datetime(x.year,x.month,x.day,20,tzinfo=U).timestamp()); x+=dt.timedelta(days=7)
        pa,aa=p_last(T,P,a); 
        if pa is None or a not in ho: continue
        for lab2,off in (("Mon12:00",64),("Mon13:00",65),("Mon13:30",None),("Mon14:00",66),("Mon15:00",67)):
            rows.setdefault(lab2,[])
            mon=int(dt.datetime(F.year,F.month,F.day,0,tzinfo=U).timestamp())+3*86400
            tt={"Mon12:00":mon+12*3600,"Mon13:00":mon+13*3600,"Mon13:30":mon+13*3600+1800,"Mon14:00":mon+14*3600,"Mon15:00":mon+15*3600}[lab2]
            q0=perp_at(sym,F,"fri")[0]
            qb=perp_at(sym,F,"mon")[0] if lab2=="Mon13:30" else ho.get(tt)
            pb,ab=p_last(T,P,tt)
            if qb is None or pb is None or q0 is None: continue
            # friday: use 1m close for perp, last swap for pool, consistent with Mon
            rows[lab2].append((math.log(pb/pa)-math.log(qb/q0))*1e4)
    res[key]=rows
    print(f"{sym} {lab}")
    for k,v in rows.items():
        print(f"   {k}: n={len(v)} mean {st.mean(v):6.1f}  sd {st.pstdev(v):5.1f}  mean|d| {st.mean(abs(a) for a in v):5.1f}  max|d| {max(abs(a) for a in v):5.1f}")
json.dump({f"{k[0]}|{k[1]}":v for k,v in res.items()},open('closetime.json','w'))
