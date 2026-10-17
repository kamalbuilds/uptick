"""Capture the NVDA vault page's band card (chart plus the four figures) from the running app at 2x, in sRGB.

Usage: python3 capture_app.py [url]   (default http://localhost:3000/vault/nvda) -> app-band-card.png next to this file.
Background CDP tab on port 9396; never activated.
"""
import base64, io, json, sys, time, urllib.request
from pathlib import Path

import websocket
from PIL import Image, ImageCms

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000/vault/nvda"
OUT = Path(__file__).with_name("app-band-card.png")

FIND = r"""(() => {
  const dt = [...document.querySelectorAll('dt')].find(e => e.textContent.trim() === 'Room to the nearest edge');
  let el = dt; while (el && !el.querySelector('svg[role=img]')) el = el.parentElement;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return JSON.stringify({x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight, sh: document.documentElement.scrollHeight, sy: scrollY});
})()"""

v = json.load(urllib.request.urlopen("http://127.0.0.1:9396/json/version", timeout=5))
ws = websocket.create_connection(v["webSocketDebuggerUrl"], suppress_origin=True, max_size=200 * 1024 * 1024)
n = [0]


def call(m, p=None, sid=None):
    n[0] += 1
    msg = {"id": n[0], "method": m, "params": p or {}}
    if sid:
        msg["sessionId"] = sid
    ws.send(json.dumps(msg))
    i = n[0]
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == i:
            if "error" in r:
                raise RuntimeError(f"{m}: {r['error']}")
            return r.get("result", {})


tid = call("Target.createTarget", {"url": "about:blank", "background": True})["targetId"]
sid = call("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
try:
    call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 3000, "deviceScaleFactor": 2, "mobile": False}, sid)
    call("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-reduced-motion", "value": "reduce"}]}, sid)
    call("Page.enable", {}, sid)
    call("Page.navigate", {"url": URL}, sid)
    time.sleep(8)
    # Brave can apply a per-site zoom after the first layout, so measure, capture and re-measure until stable.
    for _ in range(8):
        found = call("Runtime.evaluate", {"expression": FIND, "returnByValue": True}, sid)["result"].get("value")
        if not found:
            time.sleep(3)
            continue
        shot = call("Page.captureScreenshot", {"format": "png", "clip": {"x": 0, "y": 0, "width": 1440, "height": 3000, "scale": 1}}, sid)
        after = call("Runtime.evaluate", {"expression": FIND, "returnByValue": True}, sid)["result"].get("value")
        if after == found:
            break
        time.sleep(2)
    else:
        sys.exit(f"band card missing or layout kept moving on {URL}")
    r = json.loads(found)
finally:
    call("Emulation.clearDeviceMetricsOverride", {}, sid)
    call("Target.closeTarget", {"targetId": tid})

full = Image.open(io.BytesIO(base64.b64decode(shot["data"])))
k = full.width / r["iw"]
im = full.crop(tuple(round(v * k) for v in (r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])))
im.info["icc_profile"] = full.info.get("icc_profile")
icc = im.info.get("icc_profile")
if icc:
    im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(icc)), ImageCms.createProfile("sRGB"), outputMode="RGB")
im = im.convert("RGB")
im.info.pop("icc_profile", None)
im.save(OUT)
print(json.dumps({"out": str(OUT), "css_box": r, "px": im.size}))
