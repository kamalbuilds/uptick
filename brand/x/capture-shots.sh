#!/usr/bin/env bash
# Starts the fork, stats API and web app, captures the SHOTS.md screenshots at 1600x900 in a background
# deepsurge tab, then stops everything it started. The RPC key is read from file, never passed in argv.
set -euo pipefail
APP="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$APP/brand/x/shots"; mkdir -p "$OUT"
pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; lsof -ti tcp:8545,8790,3000 2>/dev/null | xargs kill 2>/dev/null || true; }
trap cleanup EXIT

if ! nc -z 127.0.0.1 8545 2>/dev/null; then
  (cd ~/.cache/uptick-fork && UPTICK_RHC_RPC="$(tr -d '[:space:]' < "$APP/../.progress/achemykey.env")" \
    exec anvil --fork-url rhc --port 8545 --host 127.0.0.1 --state ./state.json --state-interval 60 >/tmp/shots-anvil.log 2>&1) & pids+=($!)
fi
for i in $(seq 1 60); do nc -z 127.0.0.1 8545 && break; sleep 1; done
(cd "$APP/keeper" && exec bun --env-file=.env.local src/stats.ts >/tmp/shots-stats.log 2>&1) & pids+=($!)
(cd "$APP/web" && exec pnpm dev >/tmp/shots-web.log 2>&1) & pids+=($!)
for i in $(seq 1 120); do curl -sf -o /dev/null localhost:8790/vaults && curl -sf -o /dev/null localhost:3000/vault/nvda && break; sleep 2; done
curl -sf -o /dev/null localhost:3000/vault/nvda
V=$(grep -E '^NEXT_PUBLIC_VAULT_NVDA=' "$APP/web/.env.local" | cut -d= -f2)
dec=$(cast call "$V" 'decimals()(uint8)' -r http://127.0.0.1:8545 2>/dev/null)
echo "vault share decimals: $dec"; test "$dec" = "24"
for i in $(seq 1 24); do curl -sf -m 30 localhost:8790/vaults/nvda | grep -q '"source":"onchain"' && { echo "nvda stats warm after $((i*5))s"; break; }; sleep 5; done

read -r -d '' PYCODE <<'EOF' || true
import base64, os, time, json
OUT = os.environ["OUT"]
SHOTS = [
  ("S1", "/vault/nvda", "deposit"),
  ("S2", "/vault/nvda", "Why this pool"),
  ("S3", "/vault/nvda", "What LPs keep"),
  ("S4", "/vault/crcl", "Deposits closed"),
  ("S5", "/vaults", None),
  ("S6", "/", None),
]
done = []
for sid, path, anchor in SHOTS:
    tid = new_tab("http://localhost:3000" + path)
    try:
        cdp("Emulation.setDeviceMetricsOverride", width=1600, height=900, deviceScaleFactor=1, mobile=False)
        wait_for_load()
        for _ in range(50):
            if js("document.querySelectorAll('[class*=animate-pulse],[class*=skeleton]').length") == 0 and js("document.readyState") == "complete":
                break
            time.sleep(0.5)
        time.sleep(1.5)
        if anchor == "deposit":
            js("""(()=>{const i=document.querySelector('input[type=number],input[inputmode=decimal],input');if(!i)return 0;
              const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'10');
              i.dispatchEvent(new Event('input',{bubbles:true}));i.scrollIntoView({block:'center'});return 1})()""")
        elif anchor:
            js("""(()=>{const t=%s;const el=[...document.querySelectorAll('h1,h2,h3,h4,button,p,span,div')].find(e=>e.childElementCount<3&&e.innerText&&e.innerText.trim().startsWith(t));
              if(el){el.scrollIntoView({block:'center'});return 1}return 0})()""" % json.dumps(anchor))
        time.sleep(1.5)
        img = cdp("Page.captureScreenshot", format="png", captureBeyondViewport=False)["data"]
        open(os.path.join(OUT, sid + ".png"), "wb").write(base64.b64decode(img))
        done.append(sid)
    finally:
        try: cdp("Emulation.clearDeviceMetricsOverride")
        except Exception: pass
        close_tab(tid)
print("captured", done)
EOF
WS=$(curl -s -m5 http://127.0.0.1:9396/json/version | python3 -c "import sys,json;print(json.load(sys.stdin)['webSocketDebuggerUrl'])")
BU_NAME=deepsurge BU_CDP_WS="$WS" OUT="$OUT" browser-harness -c "$PYCODE"
python3 -c "
import struct,glob,sys
bad=[]
for f in sorted(glob.glob('$OUT/S*.png')):
    w,h=struct.unpack('>II',open(f,'rb').read()[16:24]); print(f.split('/')[-1],w,h)
    if (w,h)!=(1600,900): bad.append(f)
sys.exit(1 if bad or len(glob.glob('$OUT/S*.png'))<6 else 0)"
