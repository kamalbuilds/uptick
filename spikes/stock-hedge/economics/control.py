import json,math,bisect,statistics as st,datetime as dt
from basis import *
def hopen(sym): return {c['t']//1000:c['o'] for c in perp1h[sym]}
def p_last(T,P,t):
    j=bisect.bisect_left(T,t); return P[j-1] if j else None
out={}
for key in [("NVDA","0.05%"),("AAPL","0.05%"),("TSLA","0.05%"),("TSLA","0.3%"),("PLTR","0.3%")]:
    sym,lab=key; T,P=load(sym,lab); ho=hopen(sym)
    t_lo=int(dt.datetime(2026,9,17,tzinfo=U).timestamp()); t_hi=int(dt.datetime(2026,10,17,tzinfo=U).timestamp())
    wk=[];wd=[]
    D=dt.datetime(2026,9,17,tzinfo=U)
    while D<dt.datetime(2026,10,16,tzinfo=U):
        d0=int(D.timestamp()); 
        if D.weekday()==4: a=d0+20*3600; b=a+65*3600; bucket=wk   # Fri 20:00 -> Mon 13:00 (hour-aligned)
        elif D.weekday() in(0,1,2,3): a=d0+20*3600; b=a+17*3600; bucket=wd
        else: D+=dt.timedelta(days=1); continue
        if a in ho and b in ho and a>=t_lo and b<=t_hi:
            pa,pb=p_last(T,P,a),p_last(T,P,b)
            if pa and pb: bucket.append((math.log(pb/pa)-math.log(ho[b]/ho[a]))*1e4)
        D+=dt.timedelta(days=1)
    f=lambda L:f"n={len(L)} mean {st.mean(L):6.1f} sd {st.pstdev(L):5.1f} se {st.pstdev(L)/max(1,len(L))**.5:4.1f}" if L else "n=0"
    print(sym,lab,"| weekend (hour-aligned, last swap)",f(wk),"| weekday overnight 17h control",f(wd))
