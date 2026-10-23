import json,datetime as dt,statistics as st
d=json.load(open('perp1h.json'))
U=dt.timezone.utc
def ts(y,m,dd,h,mi=0): return int(dt.datetime(y,m,dd,h,mi,tzinfo=U).timestamp())
# Fridays
fris=[]; x=dt.datetime(2026,6,26,20,tzinfo=U)
now=1792796400
while x.timestamp()+3*86400+18*3600<now: fris.append(x); x+=dt.timedelta(days=7)
res={}
for s in ('NVDA','TSLA','AAPL','PLTR'):
    close={c['t']//1000:c['c'] for c in d[s]}
    f={x['timestamp']:x for x in d[s+'_fund']}
    rows=[]
    for F in fris:
        t0=int(F.timestamp()); t1=t0+65*3600+1800   # Fri 20:00 -> Mon 13:30
        hrs=[t for t in range(t0+3600,t1,3600)]
        assert len(hrs)==65, len(hrs)
        miss=[t for t in hrs if t not in f]
        if miss: rows.append((F.date(),None,None,len(miss))); continue
        prec=0;rnd=0;n=0
        for t in hrs:
            e=f[t]; sign=1 if e['direction']=='long' else -1
            px=close.get(t-3600)  # bar covering the hour that just ended; close ~ index
            if px is None: px=close.get(t) 
            if px is None: continue
            prec+=sign*float(e['value'])/px*1e4; rnd+=sign*float(e['rate'])*100; n+=1
        rows.append((F.date(),prec,rnd,n))
    res[s]=rows
print("Weekend funding for a SHORT, bps of notional, Fri 20:00 -> Mon 13:30 UTC (65 hourly payments). precise = value/close, rounded = 'rate' field")
syms=('NVDA','TSLA','AAPL','PLTR')
print("Fri date    "+"".join(f"{s:>16}" for s in syms))
for i,F in enumerate(fris):
    line=f"{F.date()}  "
    for s in syms:
        r=res[s][i]; line+= f"{'n/a':>16}" if r[1] is None else f"{r[1]:>9.2f}/{r[2]:>6.2f}"
    print(line)
print()
for s in syms:
    v=[r[1] for r in res[s] if r[1] is not None]
    print(s,"n",len(v),"mean %.2f median %.2f min %.2f max %.2f  negative weekends %d  stdev %.2f"%(st.mean(v),st.median(v),min(v),max(v),sum(1 for a in v if a<0),st.pstdev(v)),
          "| last8 mean %.2f"%st.mean(v[-8:]), "| last4 mean %.2f"%st.mean(v[-4:]))
    # floor
    print("   floor (base interest only) 65 * 0.0004%% = %.2f bp"%(65*0.0004*100))
json.dump({s:[(str(a),b,c,n) for a,b,c,n in res[s]] for s in res},open('funding_weekends.json','w'))
