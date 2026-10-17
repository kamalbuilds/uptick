"""Render an SVG/HTML source to an exact-size PNG through a background CDP tab (port 9396), then check it.

Usage: python3 render.py <source.svg> <out.png> <width> <height> [--no-text]

Checks, printed as JSON and exit 1 on any failure:
  fonts    every face the source declares reached status "loaded"
  overlap  no two <text> ink boxes (baseline - 0.78em to baseline + descender) intersect by more than 3px
  clipped  every <text> bbox (and every element marked data-box) sits inside the canvas, and inside its
           data-within="<x0> <y0> <x1> <y1>" region when one is given
The tab is created with background:true and never activated, so the user's window keeps focus.
"""
import base64, json, sys, time, urllib.request
from pathlib import Path

import websocket

src, out, W, H = Path(sys.argv[1]).resolve(), sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
NEED_TEXT = "--no-text" not in sys.argv
url = src.as_uri()

CHECK = r"""
(async () => {
  await document.fonts.ready;
  const faces = [...document.fonts].map(f => ({family: f.family, weight: f.weight, status: f.status}));
  const W = %d, H = %d, bad = [];
  const svg = document.documentElement;
  const inside = (b, x0, y0, x1, y1) => b.x >= x0 - 0.5 && b.y >= y0 - 0.5 && b.x + b.width <= x1 + 0.5 && b.y + b.height <= y1 + 0.5;
  for (const el of document.querySelectorAll('text, [data-box]')) {
    const r = el.getBoundingClientRect();
    const b = {x: r.left, y: r.top, width: r.width, height: r.height};
    const label = (el.textContent || el.id || el.tagName).trim().slice(0, 60);
    if (b.width === 0 && b.height === 0) { bad.push({label, why: 'empty bbox'}); continue; }
    if (!inside(b, 0, 0, W, H)) bad.push({label, why: 'outside canvas', b});
    const w = el.closest('[data-within]');
    if (w) {
      const [x0, y0, x1, y1] = w.getAttribute('data-within').split(/\s+/).map(Number);
      if (!inside(b, x0, y0, x1, y1)) bad.push({label, why: 'outside region ' + w.getAttribute('data-within'), b});
    }
  }
  // Ink box, not em box: x from layout, y from the baseline with ascender 0.78em and a descender sized by the glyphs present,
  // so tightly leaded headline lines do not count as collisions but real ones do.
  const ink = el => {
    const r = el.getBoundingClientRect(), base = r.top + (+el.getAttribute('y') - el.getBBox().y) * (r.height / el.getBBox().height);
    const fs = +el.getAttribute('font-size'), s = el.textContent;
    const desc = /[gjpqy]/.test(s) ? 0.22 : /[$,;()]/.test(s) ? 0.12 : 0.03;
    return {left: r.left, right: r.right, top: base - 0.78 * fs, bottom: base + desc * fs};
  };
  const tb = [...document.querySelectorAll('text')].map(el => [el.textContent.trim().slice(0, 40), ink(el)]);
  for (let i = 0; i < tb.length; i++) for (let j = i + 1; j < tb.length; j++) {
    const [a, A] = tb[i], [c, B] = tb[j];
    const w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
    if (w > 3 && h > 3) bad.push({label: a + ' | ' + c, why: 'text overlaps text', overlap: [Math.round(w), Math.round(h)]});
  }
  const texts = tb.length;
  return JSON.stringify({faces, texts, bad});
})()
"""

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
    call("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": 1, "mobile": False}, sid)
    call("Page.enable", {}, sid)
    call("Page.navigate", {"url": url}, sid)
    time.sleep(2.5)
    res = call("Runtime.evaluate", {"expression": CHECK % (W, H), "awaitPromise": True, "returnByValue": True}, sid)
    report = json.loads(res["result"]["value"])
    shot = call("Page.captureScreenshot", {"format": "png", "clip": {"x": 0, "y": 0, "width": W, "height": H, "scale": 1}}, sid)
    Path(out).write_bytes(base64.b64decode(shot["data"]))
finally:
    call("Emulation.clearDeviceMetricsOverride", {}, sid)
    call("Target.closeTarget", {"targetId": tid})

from PIL import Image

size = Image.open(out).size
unloaded = [f for f in report["faces"] if f["status"] != "loaded"]
ok = size == (W, H) and not unloaded and not report["bad"] and (report["texts"] > 0 or not NEED_TEXT)
print(json.dumps({"out": out, "size": size, "texts": report["texts"], "faces": report["faces"], "unloaded": unloaded, "clipped": report["bad"], "ok": ok}, indent=1))
sys.exit(0 if ok else 1)
