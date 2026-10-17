#!/usr/bin/env python3
"""Capture the running Uptick app over CDP (port 9396) in its OWN background tab.

A background tab does not paint a screencast, so this takes real screenshots
(Page.captureScreenshot works without focus): full-page stills of / and /vault/nvda,
plus viewport stills of the deposit field as it is typed. Remotion animates the
camera and cursor over these real pixels. Never touches another tab, never focuses a
window. Creates one tab, clears the viewport override, detaches, closes the tab.
"""
import base64, json, os, time, urllib.request
import websocket

PORT = 9396
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "app")
W, H, DSF = 1440, 810, 2

ver = json.load(urllib.request.urlopen(f"http://localhost:{PORT}/json/version"))
bws = websocket.create_connection(ver["webSocketDebuggerUrl"], timeout=30, suppress_origin=True)
_id = 0


def call(method, params=None, session=None):
    global _id
    _id += 1
    msg = {"id": _id, "method": method, "params": params or {}}
    if session:
        msg["sessionId"] = session
    bws.send(json.dumps(msg))
    while True:
        r = json.loads(bws.recv())
        if r.get("id") == _id:
            if "error" in r:
                raise RuntimeError(f"{method}: {r['error']}")
            return r["result"]


tid = call("Target.createTarget", {"url": "about:blank", "background": True})["targetId"]
sid = call("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
S = lambda m, p=None: call(m, p, sid)


def ev(js):
    r = S("Runtime.evaluate", {"expression": js, "returnByValue": True, "awaitPromise": True})
    return r.get("result", {}).get("value")


def hide_overlays():
    ev("""(()=>{if(document.getElementById('cap-hide'))return;const s=document.createElement('style');s.id='cap-hide';
      s.textContent='nextjs-portal,[data-nextjs-toast],[data-nextjs-dev-tools-button]{display:none!important}';
      document.head.appendChild(s);})()""")


def goto(url, settle=3.0):
    S("Page.navigate", {"url": url})
    time.sleep(settle)
    hide_overlays()


def shot(name, full):
    p = {"format": "png"}
    if full:
        h = ev("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)")
        p.update({"captureBeyondViewport": True, "clip": {"x": 0, "y": 0, "width": W, "height": h, "scale": 1}})
    d = S("Page.captureScreenshot", p)["data"]
    open(os.path.join(OUT, name), "wb").write(base64.b64decode(d))
    print("wrote", name)


os.makedirs(OUT, exist_ok=True)
try:
    S("Page.enable")
    S("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": DSF, "mobile": False})
    goto("http://localhost:3000/")
    shot("home-full.png", True)
    goto("http://localhost:3000/vault/nvda", 6.0)
    shot("vault-full.png", True)
    print(ev("document.body.innerText.slice(0,2500)"))
    info = ev("""(()=>{const i=document.querySelector('input');if(!i)return null;i.scrollIntoView({block:'center'});
      i.focus();const r=i.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,disabled:i.disabled,ph:i.placeholder}})()""")
    print("deposit input:", info)
    ev("window.scrollTo(0,0)")
    if info and not info["disabled"]:
        for n, txt in enumerate(["", "1", "10", "100"]):
            if txt:
                S("Input.insertText", {"text": txt[-1]})
                time.sleep(0.4)
            ev("(()=>{const i=document.querySelector('input'); i.focus(); i.scrollIntoView({block:'center'});})()")
            time.sleep(0.2)
            shot(f"deposit-{n}.png", False)
    json.dump({"input": info}, open(os.path.join(OUT, "app.json"), "w"))
finally:
    for fn, args in (("Emulation.clearDeviceMetricsOverride", None),):
        try:
            S(fn)
        except Exception as e:
            print(fn, "failed", e)
    try:
        call("Target.detachFromTarget", {"sessionId": sid})
    except Exception as e:
        print("detach failed", e)
    call("Target.closeTarget", {"targetId": tid})
    bws.close()
