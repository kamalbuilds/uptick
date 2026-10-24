import sys,json,os,time,bisect,datetime as dt,concurrent.futures as cf
sys.path.insert(0,'/Users/kamal/Desktop/arbitrium/spikes/stock-vaults/scripts')
from rpc import logs, block_ts, head, s
KE='/Users/kamal/Desktop/arbitrium/stock-vaults-app/keeper/data/engine/grid.json'
g=json.load(open(KE)); pts=sorted((int(a),float(b)) for a,b in g.items())
h=head(); 
# extend grid past cache end with live samples
last=pts[-1][0]
for b in range(last+250000,h,250000): pts.append((b,float(block_ts(b))))
pts.append((h,float(block_ts(h))))
json.dump(pts,open('grid_ext.json','w'))
B=[a for a,_ in pts]; T=[b for _,b in pts]
def t2b(t):
    i=bisect.bisect_left(T,t); i=min(max(i,1),len(T)-1)
    (b0,t0),(b1,t1)=pts[i-1],pts[i]; return int(b0+(t-t0)*(b1-b0)/(t1-t0))
V3="0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
POOLS={"NVDA":"0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3","AAPL":"0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D","TSLA3000":"0xf4ACdAEEB7022862A763C9B1B885e11191c889E3","TSLA500":"0xc4f0172D6ac8dd294dd1137d047d5e1893760236","PLTR3000":"0x851680416A4f4E1c463d45171d61ACDdBc8554c0"}
def utc(y,m,d,hh): return int(dt.datetime(y,m,d,hh,tzinfo=dt.timezone.utc).timestamp())
# Friday dates (UTC) of weekends to pull
FRI=[(2026,8,21),(2026,8,28),(2026,9,4),(2026,9,11),(2026,10,16),(2026,10,23)]
def parse(l):
    w=[int(l["data"][2:][i*64:(i+1)*64],16) for i in range(5)]
    return [int(l["blockNumber"],16),int(l["logIndex"],16),w[2],w[3],s(w[4],24),s(w[0],256),s(w[1],256)]
def job(args):
    name,pool,fri=args
    t0=utc(*fri,18); t1=t0+ (4*86400 - 2*3600) if fri!=(2026,10,23) else int(time.time())
    a,b=t2b(t0),t2b(t1)
    f=f"pool-{name}-{fri[0]}{fri[1]:02d}{fri[2]:02d}.json"
    if os.path.exists(f) and fri!=(2026,10,23): return f,-1
    for att in range(8):
        try:
            rows=sorted(parse(l) for l in logs(a,b,pool,[V3])); break
        except Exception as e:
            print('retry',name,fri,str(e)[:60],flush=True); time.sleep(20*(att+1))
    else: return f,'FAILED'
    json.dump({"t0":t0,"t1":t1,"from":a,"to":b,"rows":rows},open(f,"w")); return f,len(rows)
jobs=[(n,p,f) for f in FRI for n,p in POOLS.items()]
with cf.ThreadPoolExecutor(2) as ex:
    for r in ex.map(job,jobs): print(r,flush=True)
