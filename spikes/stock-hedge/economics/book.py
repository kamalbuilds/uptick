import json,time,datetime as dt
from fetch import get,B,MK
def snap(m):
    d=get(f"{B}/orderBookOrders?market_id={m}&limit=250")
    asks=sorted(((float(o["price"]),float(o["remaining_base_amount"])) for o in d["asks"]))
    bids=sorted(((float(o["price"]),float(o["remaining_base_amount"])) for o in d["bids"]),reverse=True)
    return bids,asks
def fill(levels,notional):
    rem=notional; cost=0; qty=0
    for p,q in levels:
        take=min(rem,p*q); cost+=take; qty+=take/p; rem-=take
        if rem<=1e-9: break
    return (cost/qty if qty else None), rem
def slip(bids,asks,N):
    mid=(bids[0][0]+asks[0][0])/2
    sp,r1=fill(bids,N)   # open short = sell into bids
    bp,r2=fill(asks,N)   # close short = buy from asks
    return mid,(None if r1>0 else (mid-sp)/mid*1e4),(None if r2>0 else (bp-mid)/mid*1e4),(bids[-1][0],asks[-1][0])
out={}
for rnd in range(5):
    for s,m in MK.items():
        bids,asks=snap(m)
        mid=(bids[0][0]+asks[0][0])/2
        row={"t":dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),"spread_bp":(asks[0][0]-bids[0][0])/mid*1e4,
             "bid25":sum(p*q for p,q in bids if p>=mid*(1-0.0025)),"ask25":sum(p*q for p,q in asks if p<=mid*(1+0.0025)),
             "bidlvl_depth_to":bids[-1][0]/mid-1,"asklvl_depth_to":asks[-1][0]/mid-1}
        for N in (1000,10000,50000):
            _,o,c,_=slip(bids,asks,N); row[f"open{N}"]=o; row[f"close{N}"]=c
        out.setdefault(s,[]).append(row)
    time.sleep(15)
json.dump(out,open("book.json","w"))
import statistics as st
for s,rows in out.items():
    def med(k):
        v=[r[k] for r in rows if r[k] is not None]; return (round(st.median(v),2),round(min(v),2),round(max(v),2),len(v)) if v else None
    print(s,"spread",round(st.median(r["spread_bp"] for r in rows),2),"bid25k",round(st.median(r["bid25"] for r in rows)),"ask25k",round(st.median(r["ask25"] for r in rows)),
          "bidlvls reach",round(rows[-1]["bidlvl_depth_to"]*1e4),"bp asks reach",round(rows[-1]["asklvl_depth_to"]*1e4),"bp")
    for N in (1000,10000,50000): print("  ",N,"open(sell) med/min/max/n",med(f"open{N}"),"close(buy)",med(f"close{N}"))
print(out["NVDA"][0]["t"],out["NVDA"][-1]["t"])
