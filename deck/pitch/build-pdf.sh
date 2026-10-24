#!/usr/bin/env bash
# Prints deck/pitch/index.html to deck/pitch/uptick-pitch.pdf in a background deepsurge tab (1920x1080 px slides),
# then rasterises every page to deck/pitch/slides/slide-0N.png for review.
set -euo pipefail
cd "$(dirname "$0")"
read -r -d '' PYCODE <<'EOF' || true
import base64, os, time
tid = new_tab(os.environ["DECK"])
wait_for_load()
ok = False
for _ in range(40):
    if js("document.fonts.check('400 20px Literata') && document.fonts.check('500 20px \"Hanken Grotesk\"') && [...document.images].every(i => i.complete && i.naturalWidth > 0)"):
        ok = True
        break
    time.sleep(0.5)
if not ok:
    close_tab(tid)
    raise SystemExit("fonts or images did not load")
r = cdp("Page.printToPDF", printBackground=True, preferCSSPageSize=True,
        paperWidth=20.0, paperHeight=11.25, marginTop=0, marginBottom=0, marginLeft=0, marginRight=0)
open(os.environ["OUT"], "wb").write(base64.b64decode(r["data"]))
close_tab(tid)
print("wrote", os.environ["OUT"])
EOF
WS=$(curl -s -m5 http://127.0.0.1:9396/json/version | python3 -c "import sys,json;print(json.load(sys.stdin)['webSocketDebuggerUrl'])")
BU_NAME=uptick-pitch.pdf BU_CDP_WS="$WS" DECK="file://$PWD/index.html" OUT="$PWD/uptick-pitch.pdf" browser-harness -c "$PYCODE"
want=$(grep -c '<section class="slide' index.html)
pages=$(pdfinfo uptick-pitch.pdf | awk '/^Pages:/{print $2}')
echo "slides=$want pages=$pages"
test "$pages" -eq "$want"
mkdir -p slides && rm -f slides/slide-*.png
pdftoppm -png -scale-to-x 1920 -scale-to-y 1080 uptick-pitch.pdf slides/slide
for f in slides/slide-?.png; do mv "$f" "slides/slide-0${f##*-}"; done
ls slides
