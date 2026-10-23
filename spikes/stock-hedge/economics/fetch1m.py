import json,datetime as dt,time
from fetch import get,B,MK
U=dt.timezone.utc
def T(y,m,d,h,mi=0): return int(dt.datetime(y,m,d,h,mi,tzinfo=U).timestamp())
fr=[]; x=dt.datetime(2026,7,3,tzinfo=U)
while x<dt.datetime(2026,10,17,tzinfo=U): fr.append(x); x+=dt.timedelta(days=7)
out={}
for s,m in MK.items():
    for F in fr:
        for lab,t in (("fri",T(F.year,F.month,F.day,20)),("mon",T(F.year,F.month,F.day,13,30)+3*86400)):
            d=get(f"{B}/candles?market_id={m}&resolution=1m&start_timestamp={t-600}&end_timestamp={t+300}&count_back=20")
            out[f"{s}|{F.date()}|{lab}"]={"t":t,"c":[(x["t"]//1000,x["o"],x["c"],x["V"]) for x in d["c"]]}
    print(s,flush=True)
json.dump(out,open("perp1m.json","w"))
