import json, time, urllib.request, sys
B="https://api.rh.lighter.xyz/api/v1"
def get(u, tries=6):
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(u,headers={"user-agent":"uptick-spike"}),timeout=60))
        except Exception as e:
            err=e; time.sleep(2*(i+1))
    raise err
MK={"NVDA":15,"TSLA":16,"AAPL":10,"PLTR":34}
def candles(mid,res,start,end,base=B):
    out={}; e=end
    while True:
        d=get(f"{base}/candles?market_id={mid}&resolution={res}&start_timestamp={start}&end_timestamp={e}&count_back=500")
        c=d["c"]
        if not c: break
        n0=len(out)
        for x in c: out[x["t"]//1000]=x
        first=min(x["t"]//1000 for x in c)
        if first<=start or len(out)==n0: break
        e=first-1
        time.sleep(0.3)
    return [out[k] for k in sorted(out)]
if __name__=="__main__":
    now=int(time.time()); start=int(sys.argv[1]) if len(sys.argv)>1 else 1790000000
    res={}
    for s,m in MK.items():
        c=candles(m,"1h",start,now); res[s]=c
        f=get(f"{B}/fundings?market_id={m}&resolution=1h&start_timestamp={start}&end_timestamp={now}&count_back=0")["fundings"]
        res[s+"_fund"]=f
        print(s,len(c),c[0]["t"]//1000,c[-1]["t"]//1000,len(f),f[0]["timestamp"],f[-1]["timestamp"])
    json.dump(res,open("perp1h.json","w"))
