import json,glob,bisect,math,os,statistics as st,datetime as dt,sys
U=dt.timezone.utc
KE='/Users/kamal/Desktop/arbitrium/stock-vaults-app/keeper/data/engine/v3/'
pts=json.load(open('grid_ext.json')); GB=[a for a,_ in pts]; GT=[b for _,b in pts]
def b2t(b):
    i=min(max(bisect.bisect_left(GB,b),1),len(GB)-1); (b0,t0),(b1,t1)=pts[i-1],pts[i]; return t0+(b-b0)*(t1-t0)/(b1-b0)
USDG="0x5fc5360d0400a0fd4f2af552add042d716f1d168"
TOK={"NVDA":"0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec","TSLA":"0x322f0929c4625ed5bad873c95208d54e1c003b2d","AAPL":"0xaf3d76f1834a1d425780943c99ea8a608f8a93f9","PLTR":"0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a"}
# (symbol, label) -> pool address, replay dir
POOLS={("NVDA","0.05%"):"0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3",("AAPL","0.05%"):"0xaae0d815ee56e4092a5e5c2911e676fea50b2d6d",
       ("TSLA","0.3%"):"0xf4acdaeeb7022862a763c9b1b885e11191c889e3",("TSLA","0.05%"):"0xc4f0172d6ac8dd294dd1137d047d5e1893760236",
       ("PLTR","0.3%"):"0x851680416a4f4e1c463d45171d61acddbc8554c0"}
PULLNAME={("NVDA","0.05%"):"NVDA",("AAPL","0.05%"):"AAPL",("TSLA","0.3%"):"TSLA3000",("TSLA","0.05%"):"TSLA500",("PLTR","0.3%"):"PLTR3000"}
MULT={"NVDA":(1.000775159164630595,1788998430),"AAPL":(1.000566080061092436,1786720366),"TSLA":(1.0,0),"PLTR":(1.0,0)}  # uiMultiplier() read 2026-10-23, effectiveAt()
def price(sym,sqrtP):
    P=(sqrtP/2**96)**2
    return (1e12/P) if TOK[sym]>USDG else (P*1e12)
def load(sym,lab):
    pool=POOLS[(sym,lab)]; rows={}
    for f in glob.glob(KE+pool+'/*.json'):
        for r in json.load(open(f)): rows[(r[0],r[1])]=r
    for f in glob.glob(f'pool-{PULLNAME[(sym,lab)]}-*.json'):
        for r in json.load(open(f))["rows"]: rows[(r[0],r[1])]=r
    out=sorted(rows.values())
    return [b2t(r[0]) for r in out],[price(sym,r[2]) for r in out]
def pool_at(T,P,t,win=600):
    j=bisect.bisect_left(T,t)  # swaps strictly before t: idx < j
    if j==0: return None,None
    lo=bisect.bisect_left(T,t-win); xs=P[lo:j]
    if xs: return st.median(xs),t-T[j-1]
    return P[j-1],t-T[j-1]
perp1m=json.load(open('perp1m.json')); perp1h=json.load(open('perp1h.json'))
def perp_at(sym,F,lab):
    c=perp1m[f"{sym}|{F}|{lab}"]; t=c["t"]; bars=[x for x in c["c"] if x[0]<t]
    if not bars: return None,None
    return bars[-1][2],t-(bars[-1][0]+60)
def run(sym,lab,verbose=True):
    T,P=load(sym,lab)
    if not T: return []
    rows=[]; x=dt.datetime(2026,7,3,tzinfo=U)
    hour={c['t']//1000:c for c in perp1h[sym]}
    while x<dt.datetime(2026,10,17,tzinfo=U):
        F=x.date(); t0=int(dt.datetime(x.year,x.month,x.day,20,tzinfo=U).timestamp()); t1=t0+65*3600+1800; x+=dt.timedelta(days=7)
        if not(T[0]<=t0-3600 and T[-1]>=t1+600): continue
        # coverage check: swaps in window
        a,b=bisect.bisect_left(T,t0),bisect.bisect_left(T,t1)
        if b-a<50: continue
        pf,af=pool_at(T,P,t0); pm,am=pool_at(T,P,t1)
        qf,gf=perp_at(sym,F,"fri"); qm,gm=perp_at(sym,F,"mon")
        if None in (pf,pm,qf,qm): continue
        m,eff=MULT[sym]; valid=t0>=eff
        lvl_f=math.log(pf/(qf*m))*1e4 if valid else None; lvl_m=math.log(pm/(qm*m))*1e4 if valid else None
        pr=math.log(pm/pf)*1e4; qr=math.log(qm/qf)*1e4
        # hourly weekend |basis|: last swap in hour vs hourly perp close
        lv=[];lv0=[]
        for h in range(t0,t1-1800,3600):
            lo,hi=bisect.bisect_left(T,h),bisect.bisect_left(T,h+3600)
            c=hour.get(h)
            if hi>lo and c:
                b0=math.log(P[hi-1]/c['c'])*1e4; lv0.append(b0); lv.append(b0-math.log(m)*1e4 if valid else None)
        rows.append(dict(F=str(F),n=b-a,pool_ret=pr,perp_ret=qr,drift=pr-qr,lvl_f=lvl_f,lvl_m=lvl_m,age_f=af,age_m=am,gap_f=gf,gap_m=gm,hours=len(lv0),
                         abs_med_nomult=st.median(abs(v) for v in lv0) if lv0 else None,
                         abs_med_mult=st.median(abs(v) for v in lv if v is not None) if valid and lv else None,
                         signed_med_nomult=st.median(lv0) if lv0 else None, valid=valid, hrs0=lv0, hrs=lv))
    return rows
if __name__=="__main__":
    allr={}
    for (sym,lab) in POOLS:
        r=run(sym,lab); allr[f"{sym}|{lab}"]=r
        print(f"== {sym} pool {lab}  weekends {len(r)}")
        print(" Fri      swaps  poolRet perpRet  drift | lvl Fri->Mon (mult-adj) | hrs |med|nomult |med|mult  signedmed | age_f/age_m s | perp gap s")
        for x in r:
            f=lambda v:"  n/a " if v is None else f"{v:6.1f}"
            print(f" {x['F']} {x['n']:6d} {x['pool_ret']:7.1f} {x['perp_ret']:7.1f} {x['drift']:6.1f} | {f(x['lvl_f'])} -> {f(x['lvl_m'])} | {x['hours']:3d} {f(x['abs_med_nomult'])} {f(x['abs_med_mult'])} {f(x['signed_med_nomult'])} | {x['age_f']:.0f}/{x['age_m']:.0f} | {x['gap_f']}/{x['gap_m']}")
        if r:
            d=[x['drift'] for x in r]
            print(f"  drift bps: mean {st.mean(d):.1f} median {st.median(d):.1f} stdev {st.pstdev(d):.1f} min {min(d):.1f} max {max(d):.1f} mean|drift| {st.mean(abs(v) for v in d):.1f}")
    json.dump({k:[{kk:vv for kk,vv in x.items() if kk not in('hrs0','hrs')} for x in v] for k,v in allr.items()},open('basis_out.json','w'))
