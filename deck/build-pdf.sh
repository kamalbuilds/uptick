#!/usr/bin/env bash
# Prints deck/index.html to deck/uptick-deck.pdf in a background Brave tab (1440x810 pt slides).
set -euo pipefail
cd "$(dirname "$0")"
read -r -d '' PYCODE <<'EOF' || true
import base64, os, time
tid = new_tab(os.environ["DECK"])
wait_for_load()
time.sleep(2)
r = cdp("Page.printToPDF", printBackground=True, preferCSSPageSize=True,
        paperWidth=20.0, paperHeight=11.25, marginTop=0, marginBottom=0, marginLeft=0, marginRight=0)
open(os.environ["OUT"], "wb").write(base64.b64decode(r["data"]))
close_tab(tid)
print("wrote", os.environ["OUT"])
EOF
WS=$(curl -s -m5 http://127.0.0.1:9396/json/version | python3 -c "import sys,json;print(json.load(sys.stdin)['webSocketDebuggerUrl'])")
BU_NAME=deepsurge BU_CDP_WS="$WS" DECK="file://$PWD/index.html" OUT="$PWD/uptick-deck.pdf" browser-harness -c "$PYCODE"
pages=$(pdfinfo uptick-deck.pdf | awk '/^Pages:/{print $2}')
echo "pages=$pages"
test "$pages" -ge 10
