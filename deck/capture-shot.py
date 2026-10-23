#!/usr/bin/env python3
"""refshot.py URL OUT.png [W] [H] [--full]

Design-reference capture in the signed-in bhn `deepsurge` profile (new tab, closed after).
Waits for load, web fonts and network quiet, then captures. Refuses junk: exits 2 with a
reason and writes no PNG when the page is an error, a bot challenge, or visually blank.
Writes OUT.tokens.json beside the PNG: computed type, colour, radius and spacing of the
real page (h1-h3, body, links, buttons, inputs, the page background).
"""
import asyncio, base64, io, json, subprocess, sys, urllib.request

import websockets
from PIL import Image, ImageStat

args = [a for a in sys.argv[1:] if not a.startswith('--')]
FULL = '--full' in sys.argv
url, out = args[0], args[1]
W = int(args[2]) if len(args) > 2 else 1440
H = int(args[3]) if len(args) > 3 else 900

BAD_TEXT = ("can't be reached", "err_", "access denied", "just a moment", "verify you are human",
            "attention required", "page not found", "404", "enable javascript", "cf-browser-verification", "dns_probe", "this site can't", "took too long to respond", "err_name_not_resolved")

TOKENS_JS = r"""
(() => {
  const pick = (el) => { if (!el) return null; const s = getComputedStyle(el); return {
    text: (el.innerText || el.value || '').trim().slice(0, 60), font: s.fontFamily, size: s.fontSize,
    weight: s.fontWeight, tracking: s.letterSpacing, leading: s.lineHeight, color: s.color,
    bg: s.backgroundColor, radius: s.borderRadius, padding: s.padding, border: s.border,
    transform: s.textTransform, features: s.fontFeatureSettings }; };
  const q = (sel) => pick([...document.querySelectorAll(sel)].find(e => e.offsetParent !== null && (e.innerText || '').trim()));
  const fonts = new Set(); document.fonts.forEach(f => { if (f.status === 'loaded') fonts.add(f.family.replace(/"/g, '')); });
  return { title: document.title, h1: q('h1'), h2: q('h2'), h3: q('h3'), body: pick(document.body),
    p: q('p'), a: q('a'), button: q('button, [role=button], a[class*=button], a[class*=btn]'),
    input: pick(document.querySelector('input')), loadedFonts: [...fonts],
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    bodyText: (document.body.innerText || '').slice(0, 400), textLen: (document.body.innerText || '').length,
    height: document.documentElement.scrollHeight };
})()
"""


def fail(reason):
    print(json.dumps({'ok': False, 'url': url, 'reason': reason}))
    sys.exit(2)


st = subprocess.run(['bhn', 'deepsurge', 'status'], capture_output=True, text=True).stdout
port = [l.split()[1] for l in st.splitlines() if 'RUNNING' in l][-1]


async def _new_background_tab():
    # Browser-level Target.createTarget with background=True opens the tab without raising
    # the window or switching the user's app. /json/new plus Page.bringToFront (the old
    # way) stole focus from whatever the user was typing in.
    ver = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version'))
    async with websockets.connect(ver['webSocketDebuggerUrl'], max_size=2 ** 24) as bws:
        await bws.send(json.dumps({'id': 1, 'method': 'Target.createTarget',
                                   'params': {'url': 'about:blank', 'background': True}}))
        while True:
            r = json.loads(await bws.recv())
            if r.get('id') == 1:
                tid = r['result']['targetId']
                return {'id': tid, 'webSocketDebuggerUrl': f'ws://127.0.0.1:{port}/devtools/page/{tid}'}


tab = asyncio.run(_new_background_tab())


async def main():
    async with websockets.connect(tab['webSocketDebuggerUrl'], max_size=2 ** 28) as ws:
        n = 0
        pending = []

        async def cmd(m, p=None):
            nonlocal n
            n += 1
            i = n
            await ws.send(json.dumps({'id': i, 'method': m, 'params': p or {}}))
            while True:
                r = json.loads(await ws.recv())
                if r.get('id') == i:
                    return r
                pending.append(r)

        loop = asyncio.get_event_loop()
        await cmd('Page.enable'); await cmd('Network.enable')
        await cmd('Page.setWebLifecycleState', {'state': 'active'})  # render as if visible, without raising it
        await cmd('Emulation.setDeviceMetricsOverride', {'width': W, 'height': H, 'deviceScaleFactor': 2, 'mobile': W < 600})
        await cmd('Emulation.setFocusEmulationEnabled', {'enabled': True})
        await cmd('Page.navigate', {'url': url})

        # load event (max 25 s), then network quiet: 1.5 s without a new request (max 12 s more)
        loaded, last_req, t0 = False, loop.time(), loop.time()
        while loop.time() - t0 < 37:
            if pending:
                m = pending.pop(0)
            else:
                try:
                    m = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.3))
                except asyncio.TimeoutError:
                    m = {}
            meth = m.get('method')
            if meth == 'Page.loadEventFired':
                loaded = True
            elif meth == 'Network.requestWillBeSent':
                last_req = loop.time()
            if loaded and loop.time() - last_req > 1.5:
                break
            if not loaded and loop.time() - t0 > 25:
                break
        await cmd('Runtime.evaluate', {'expression': 'document.fonts.ready.then(() => 1)', 'awaitPromise': True})
        await asyncio.sleep(1.5)  # entrance animations settle

        tok = (await cmd('Runtime.evaluate', {'expression': TOKENS_JS, 'returnByValue': True}))['result']['result'].get('value') or {}
        low = (tok.get('title', '') + ' ' + tok.get('bodyText', '')).lower().replace('\u2019', "'")
        hit = next((b for b in BAD_TEXT if b in low[:300]), None)
        if hit and tok.get('textLen', 0) < 1500:
            fail(f'error or challenge page ("{hit}")')
        if tok.get('textLen', 0) < 80:
            fail(f'almost no text rendered ({tok.get("textLen", 0)} chars)')

        p = {'format': 'png'}
        if FULL:
            hgt = min(int(tok.get('height') or H), 7000)
            await cmd('Emulation.setDeviceMetricsOverride', {'width': W, 'height': hgt, 'deviceScaleFactor': 2, 'mobile': W < 600})
            await asyncio.sleep(1.0)
            p['captureBeyondViewport'] = True
        png = base64.b64decode((await cmd('Page.captureScreenshot', p))['result']['data'])
        im = Image.open(io.BytesIO(png)).convert('L')
        sd = ImageStat.Stat(im).stddev[0]
        if sd < 6:
            fail(f'visually blank (luma stddev {sd:.1f})')
        open(out, 'wb').write(png)
        tok.pop('bodyText', None)
        tok['url'], tok['viewport'], tok['lumaStddev'] = url, [W, H], round(sd, 1)
        open(out.rsplit('.', 1)[0] + '.tokens.json', 'w').write(json.dumps(tok, indent=1))
        print(json.dumps({'ok': True, 'out': out, 'fonts': tok.get('loadedFonts'), 'stddev': round(sd, 1)}))


try:
    asyncio.run(main())
finally:
    urllib.request.urlopen(f'http://127.0.0.1:{port}/json/close/{tab["id"]}')
