import json,time
from fetch import *
now=int(time.time()); start=1782000000
def fundings(m,base=B,start=start):
    out={}; e=now
    while True:
        f=get(f"{base}/fundings?market_id={m}&resolution=1h&start_timestamp={start}&end_timestamp={e}&count_back=750")["fundings"]
        if not f: break
        n0=len(out)
        for x in f: out[x["timestamp"]]=x
        first=min(x["timestamp"] for x in f)
        if first<=start or len(out)==n0: break
        e=first-1; time.sleep(0.3)
    return [out[k] for k in sorted(out)]
res={}
for s,m in MK.items():
    c=candles(m,"1h",start,now); f=fundings(m)
    res[s]=c; res[s+"_fund"]=f
    print(s,len(c),c[0]["t"]//1000,c[-1]["t"]//1000,len(f),f[0]["timestamp"],f[-1]["timestamp"])
json.dump(res,open("perp1h.json","w"))
