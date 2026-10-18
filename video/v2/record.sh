#!/usr/bin/env bash
# Records real app footage for the launch film: drives the running app in a background deepsurge tab at 1600x900,
# grabs frames as fast as CDP allows, and encodes each flow to a real-time 30 fps MP4 in video/v2/footage/.
# Needs the fork on :8545 (scripts/fork-up.sh). Starts and stops its own stats API and web dev server.
set -euo pipefail
APP="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$APP/video/v2/footage"; mkdir -p "$OUT"
nc -z 127.0.0.1 8545 || { echo "fork not running: scripts/fork-up.sh" >&2; exit 1; }
pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; lsof -ti tcp:8790,3000 2>/dev/null | xargs kill 2>/dev/null || true; }
trap cleanup EXIT
(cd "$APP/keeper" && exec bun --env-file=.env.local src/stats.ts >/tmp/rec-stats.log 2>&1) & pids+=($!)
(cd "$APP/web" && pnpm -s build >/tmp/rec-build.log 2>&1 && exec pnpm -s start >/tmp/rec-web.log 2>&1) & pids+=($!)
for i in $(seq 1 240); do curl -sf -o /dev/null localhost:8790/vaults/nvda && curl -sf -o /dev/null localhost:3000/vault/nvda && break; sleep 2; done
for p in / /vaults /vault/nvda /vault/crcl; do curl -sf -o /dev/null "localhost:3000$p"; done   # compile every route before filming

read -r -d '' PYCODE <<'EOF' || true
import base64, os, time, json
OUT = os.environ["OUT"]
API = "https://uptick-evidence.earn-shield-alerts.workers.dev/vaults/nvda"

def settle():
    wait_for_load()
    for _ in range(60):
        if js("document.querySelectorAll('[class*=animate-pulse],[class*=skeleton]').length") == 0: break
        time.sleep(0.25)
    time.sleep(0.8)

def film(name, url, actions):
    tid = new_tab(url)
    frames = []
    try:
        cdp("Emulation.setDeviceMetricsOverride", width=1600, height=900, deviceScaleFactor=1, mobile=False)
        cdp("Emulation.setFocusEmulationEnabled", enabled=True)
        settle()
        d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
        for f in os.listdir(d): os.remove(os.path.join(d, f))
        t0 = time.time()
        def grab():
            img = cdp("Page.captureScreenshot", format="jpeg", quality=92)["data"]
            p = os.path.join(d, "%05d.jpg" % len(frames)); open(p, "wb").write(base64.b64decode(img)); frames.append((p, time.time() - t0))
        def hold(sec):
            end = time.time() + sec
            while time.time() < end: grab()
        for a in actions:
            kind = a[0]
            if kind == "hold": hold(a[1])
            elif kind == "js": js(a[1]); hold(a[2])
            elif kind == "type":
                for ch in a[2]:
                    js("""(()=>{const i=document.querySelector(%s);if(!i)return 0;i.focus();const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,i.value+%s);i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()""" % (json.dumps(a[1]), json.dumps(ch)))
                    hold(0.35)
            elif kind == "scroll":
                start = js("window.scrollY"); target = js("""(()=>{const t=%s;const el=[...document.querySelectorAll('h1,h2,h3,h4,p,button,span,div')].find(e=>e.childElementCount<3&&e.innerText&&e.innerText.trim().startsWith(t));return el?Math.max(0,el.getBoundingClientRect().top+window.scrollY-%d):window.scrollY})()""" % (json.dumps(a[1]), a[2]))
                steps = max(1, int(a[3] * 10))
                for k in range(1, steps + 1):
                    y = start + (target - start) * (1 - (1 - k / steps) ** 3)
                    js("window.scrollTo(0,%d)" % y); grab()
        lst = os.path.join(d, "list.txt")
        with open(lst, "w") as fh:
            for i, (p, t) in enumerate(frames):
                dur = (frames[i + 1][1] - t) if i + 1 < len(frames) else 0.5
                fh.write("file '%s'\nduration %.4f\n" % (p, dur))
            fh.write("file '%s'\n" % frames[-1][0])
        return name, len(frames), round(frames[-1][1], 1)
    finally:
        try: cdp("Emulation.clearDeviceMetricsOverride")
        except Exception: pass
        close_tab(tid)

INPUT = "input[type=number],input[inputmode=decimal]"
done = [
    film("f1-vaults", "http://localhost:3000/vaults", [("hold", 4.0)]),
    film("f2-deposit", "http://localhost:3000/vault/nvda", [("hold", 1.5), ("type", INPUT, "10"), ("hold", 4.0)]),
    film("f3-evidence", "http://localhost:3000/vault/nvda", [("hold", 1.0), ("scroll", "Why this pool", 90, 1.6), ("hold", 2.5), ("scroll", "What LPs keep", 140, 1.4), ("hold", 3.0)]),
    film("f4-closed", "http://localhost:3000/vault/crcl", [("hold", 1.0), ("scroll", "Why this pool", 90, 1.2), ("hold", 4.0)]),
    film("f5-api", API, [("hold", 3.5)]),
    film("f6-home", "http://localhost:3000/", [("hold", 3.5)]),
]
print(json.dumps(done))
EOF
WS=$(curl -s -m5 http://127.0.0.1:9396/json/version | python3 -c "import sys,json;print(json.load(sys.stdin)['webSocketDebuggerUrl'])")
BU_NAME=deepsurge BU_CDP_WS="$WS" OUT="$OUT" browser-harness -c "$PYCODE"
for d in "$OUT"/f*/; do n=$(basename "$d"); ffmpeg -v error -y -f concat -safe 0 -i "$d/list.txt" -vf "fps=30,format=yuv420p" -c:v libx264 -crf 16 -preset slow "$OUT/$n.mp4"; echo "$n.mp4 $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$n.mp4")s"; done
