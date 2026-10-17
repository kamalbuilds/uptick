"""Pixel checks on the rendered kit. Usage: python3 check.py <dir with the PNGs>. Exit 1 on any failure.

  size     each PNG has its X size
  profile  no PNG embeds a colour profile (P3 pixels shown as sRGB turn lime #9fe870 into #afe67f)
  tokens   known token fills read back as the token, within 2 per channel
"""
import json, sys
from pathlib import Path
from PIL import Image

D = Path(sys.argv[1])
SIZES = {"avatar-400.png": (400, 400), "banner.png": (1500, 500), "og.png": (1200, 630),
         "post-1-sessions.png": (1600, 900), "post-2-hooks.png": (1600, 900), "post-3-cap.png": (1600, 900), "post-4-app.png": (1600, 900)}
# (file, x, y, token): points inside a flat fill, taken from build.py geometry
PROBES = [("avatar-400.png", 200, 200, "#9fe870"), ("avatar-400.png", 10, 10, "#0e0f0c"),
          ("banner.png", 1400, 120, "#9fe870"), ("banner.png", 1000, 480, "#e8ebe6"),
          ("post-1-sessions.png", 40, 40, "#e8ebe6"),
          ("post-2-hooks.png", 1100, 670, "#d03238"), ("post-2-hooks.png", 40, 40, "#0e0f0c"),
          ("post-3-cap.png", 400, 708, "#d03238"), ("post-4-app.png", 40, 40, "#0e0f0c")]
hexrgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
bad = []
for f, wh in SIZES.items():
    im = Image.open(D / f)
    if im.size != wh:
        bad.append(f"{f}: size {im.size} != {wh}")
    if im.info.get("icc_profile"):
        bad.append(f"{f}: embeds a colour profile")
for f, x, y, tok in PROBES:
    px = Image.open(D / f).convert("RGB").getpixel((x, y))
    if max(abs(a - b) for a, b in zip(px, hexrgb(tok))) > 2:
        bad.append(f"{f} ({x},{y}): #{'%02x%02x%02x' % px} != {tok}")
print(json.dumps({"checked": len(SIZES), "probes": len(PROBES), "bad": bad}, indent=1))
sys.exit(1 if bad else 0)
