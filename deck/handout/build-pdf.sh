#!/usr/bin/env bash
# Prints handout/index.html to handout.pdf (A5 portrait) in a background deepsurge tab, same CDP route as ../build-pdf.sh,
# then rasterises to handout.png for review.
set -euo pipefail
cd "$(dirname "$0")"
read -r -d '' PYCODE <<'EOF' || true
import base64, os, time
tid = new_tab(os.environ["DECK"])
wait_for_load()
ok = False
for _ in range(40):
    if js("document.fonts.check('400 20px Literata') && document.fonts.check('500 20px \"Hanken Grotesk\"')"):
        ok = True
        break
    time.sleep(0.5)
if not ok:
    close_tab(tid)
    raise SystemExit("fonts did not load")
print("overflow", js("(()=>{const p=document.querySelector('.page');return [p.scrollHeight,p.clientHeight,p.scrollWidth,p.clientWidth]})()"))
r = cdp("Page.printToPDF", printBackground=True, preferCSSPageSize=True,
        paperWidth=5.83, paperHeight=8.27, marginTop=0, marginBottom=0, marginLeft=0, marginRight=0)
open(os.environ["OUT"], "wb").write(base64.b64decode(r["data"]))
close_tab(tid)
print("wrote", os.environ["OUT"])
EOF
WS=$(curl -s -m5 http://127.0.0.1:9396/json/version | python3 -c "import sys,json;print(json.load(sys.stdin)['webSocketDebuggerUrl'])")
BU_NAME=uptick-handout-pdf BU_CDP_WS="$WS" DECK="file://$PWD/index.html" OUT="$PWD/handout.pdf" browser-harness -c "$PYCODE"
pages=$(pdfinfo handout.pdf | awk '/^Pages:/{print $2}')
echo "pages=$pages"
test "$pages" -eq 1
pdftoppm -png -r 200 -singlefile handout.pdf handout
