#!/usr/bin/env bash
# Fails on any stale number or phrase in the public files. The right numbers live in docs/facts.json (node scripts/facts.mjs).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2
FILES=(README.md docs/SUBMISSION.md docs/DEMO-SCRIPT.md docs/AGENT-DEMO.md deck/index.html deck/pitch/index.html deck/handout/index.html web/public/llms.txt web/lib/content.ts)
# Web copy: every route page. find, not a glob, so a new route is scanned the day it is added.
while IFS= read -r pg; do FILES+=("$pg"); done < <(find web/app -name page.tsx | sort)
BANNED=("80 of 80" "46 fork" "5.1M" "54 days" "four review" "fourth ends" "10% of collected" "Live and reviewed" "Closed six" "and 8 more" "and 14 more" "Contracts are final")
# 366 was the test count before the v4 suite; it is allowed only while facts.json still says 366. Word-bounded so a hex address containing 366 is not a hit.
[ "$(jq -r .tests.total docs/facts.json)" = "366" ] || BANNED+=('\b366\b')
# Pitch copy says "launching", never that deposits are open or live. web/public/llms.txt is generated from keeper/scripts/llms-text.ts and keeps its own wording.
BANNED_PITCH=("take deposits" "takes deposits" "live deposits")
bad=0
for f in "${FILES[@]}"; do
  [ -s "$f" ] || { echo "MISSING or empty: $f"; bad=1; continue; }
  pats=("${BANNED[@]}"); [ "$f" = web/public/llms.txt ] || pats+=("${BANNED_PITCH[@]}")
  for p in "${pats[@]}"; do
    # The research article is the 54-day, 5.1M-swap study itself: its sample is stated in the article and bound by check-claims.mjs.
    case "$f:$p" in web/app/research/*:5.1M|web/app/research/*:"54 days") continue;; esac
    if [ "${p#\\b}" != "$p" ]; then hits=$(grep -nEi -- "$p" "$f"); else hits=$(grep -nFi -- "$p" "$f"); fi
    if [ -n "$hits" ]; then echo "$f: banned \"$p\""; echo "$hits" | cut -c1-200; bad=1; fi
  done
done
# The current test count must appear where the docs state one, so a stale count cannot pass by being absent.
TESTS="$(jq -r .tests.total docs/facts.json)"
for f in README.md docs/SUBMISSION.md; do
  grep -qF "$TESTS contract tests" "$f" || { echo "$f: does not state \"$TESTS contract tests\" (docs/facts.json)"; bad=1; }
done
# Door counts: every "N open", "N reduced", "N closed" (and "N vaults take any amount / up to / none") a public file states must equal docs/facts.json doors.
# "Round 4 closed 1 High" is a review round, not a door, so those words are removed before the count is read.
doors=0
for st in open reduced closed; do
  want=$(jq -r ".doors.$st" docs/facts.json)
  case $st in open) phrase="any amount";; reduced) phrase="up to";; closed) phrase="none";; esac
  for f in "${FILES[@]}"; do
    [ -s "$f" ] || continue
    for n in $(sed -E 's/[Rr]ound [0-9]+ closed//g; s/\$[0-9][0-9,.]*//g' "$f" | grep -oEi "\b[0-9]+ $st\b|\b[0-9]+ vaults? takes? $phrase" | grep -oE '^[0-9]+' | sort -u); do
      doors=$((doors + 1))
      if [ "$n" != "$want" ]; then echo "$f: states \"$n $st\", docs/facts.json says $want"; grep -noEi ".{0,50}\b$n $st\b.{0,30}|.{0,30}\b$n vaults? takes? $phrase.{0,30}" "$f" | cut -c1-200 | head -3; bad=1; fi
    done
  done
done
# A door count must be stated somewhere, so a file cannot pass by never naming them.
[ "$doors" -gt 0 ] || { echo "check-facts: no door count found in any public file, the check read nothing"; bad=1; }
# PLTR is open on its Uniswap v4 pool (docs/facts.json doors.open_symbols). Calling it reduced or placing it on v3 is stale.
jq -e '.doors.open_symbols | index("PLTR")' docs/facts.json >/dev/null || { echo "docs/facts.json: PLTR is not open; the PLTR check below is out of date"; bad=1; }
PLTR_STALE=("PLTR('s)?:? (launches|is|gated|gates|sits|stays|opens|deploys|takes|ships|holds)[^.;]{0,80}(reduced|on (its )?(Uniswap )?v3|venue v3)" "\\breduced\\b[^.;]{0,250}\\bPLTR\\b" "PLTR</span>.{0,120}>Reduced<")
for f in "${FILES[@]}"; do
  [ -s "$f" ] || continue
  for p in "${PLTR_STALE[@]}"; do
    hits=$(grep -noEi -- "$p" "$f")
    if [ -n "$hits" ]; then echo "$f: PLTR called reduced or placed on v3"; echo "$hits" | cut -c1-200; bad=1; fi
  done
done
# Claims that restate a number docs/facts.json owns. Number words are read as numbers; a claim must exist somewhere, so a file cannot pass by never stating it.
NW='one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve'
wordnum() { case "$(printf %s "$1" | tr A-Z a-z)" in one) echo 1;; two) echo 2;; three) echo 3;; four) echo 4;; five) echo 5;; six) echo 6;; seven) echo 7;; eight) echo 8;; nine) echo 9;; ten) echo 10;; eleven) echo 11;; twelve) echo 12;; *) printf %s "$1" | tr -d ,; echo;; esac; }
claim() { # label want regex
  local label=$1 want=$2 re=$3 f w n seen=0
  for f in "${FILES[@]}"; do
    [ -s "$f" ] || continue
    while IFS= read -r w; do
      [ -n "$w" ] || continue
      w=${w#[ (]}; seen=$((seen + 1)); n=$(wordnum "$(printf %s "$w" | grep -oEi '^[a-z0-9,]+')")
      if [ "$n" != "$want" ]; then echo "$f: states \"$w\", docs/facts.json $label says $want"; bad=1; fi
    done < <(grep -oEi -- "$re" "$f")
  done
  [ "$seen" -gt 0 ] || { echo "check-facts: no $label claim found in any public file, the check read nothing"; bad=1; }
}
claim mcp.count "$(jq -r .mcp.count docs/facts.json)" "\b($NW|[0-9]+) (MCP )?tools([^/]|$)"
claim reviews.reports_total "$(jq -r .reviews.reports_total docs/facts.json)" "\b($NW|[0-9]+) ((review|security) )?reports?\b|\b($NW|[0-9]+) security reviews\b"
claim mutations.total "$(jq -r .mutations.total docs/facts.json)" "\b[0-9]+[- ](row )?mutation (checks?|rows?)\b|\b[0-9]+ guards are mutation-tested"
claim tests.total "$(jq -r .tests.total docs/facts.json)" "\\b[0-9,]+ (contract )?tests\\b"
claim tests.security "$(jq -r .tests.security docs/facts.json)" "\\b[0-9]+ (of them )?security tests\\b|\\b[0-9]+ security,"
claim holders.spcx "$(jq -r .holders.spcx docs/facts.json)" "(^|[ (])11[0-9],[0-9]{3}\b"
# One repo URL.
REPO="$(jq -r .repo docs/facts.json)"; REPOPATH="${REPO#*hub.com/}"
OTHER_REPO="kamalbuilds/ava-portfolio-manager-ai-agents" # the founder's earlier project, named in the deck team slide; the only other repo a public file may link
seen=0
for f in "${FILES[@]}"; do
  [ -s "$f" ] || continue
  for u in $(grep -oE "(^|[^.A-Za-z0-9-])github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_-]+" "$f" | sed 's/.*github\.com/hub.com/' | sort -u); do
    seen=$((seen + 1)); [ "${u#hub.com/}" = "$REPOPATH" ] || [ "${u#hub.com/}" = "$OTHER_REPO" ] || { echo "$f: repo URL \"$u\", docs/facts.json repo says $REPOPATH"; bad=1; }
  done
done
[ "$seen" -gt 0 ] || { echo "check-facts: no repo URL found, the check read nothing"; bad=1; }
# web/public/llms.txt is generated: a hand edit that the generator (keeper/scripts/llms-text.ts) would not produce is drift.
if command -v bun >/dev/null; then
  bun -e 'import { readFileSync } from "node:fs"; import { llmsText } from "./keeper/scripts/llms-text.ts"; process.stdout.write(llmsText(JSON.parse(readFileSync("web/lib/vault-universe.json", "utf8")), JSON.parse(readFileSync("deployments/4663.json", "utf8"))));' | cmp -s - web/public/llms.txt \
    || { echo "web/public/llms.txt differs from keeper/scripts/llms-text.ts output; fix the generator and regenerate, never edit the file"; bad=1; }
else echo "check-facts: bun not found, cannot verify web/public/llms.txt against its generator"; bad=1; fi
# Fee per $1 lost, the off-hours share and the data-fact figures: one sample per sentence, labels in the same block, values from docs/facts.json (scripts/check-claims.mjs).
node scripts/check-claims.mjs "${FILES[@]}" || bad=1
# The weekend hedge cost any public file states at $10k is the one weekend_cost.py prints from the tracked JSON.
python3 spikes/stock-hedge/economics/weekend_cost.py --check README.md docs/SUBMISSION.md deck/index.html web/public/llms.txt || bad=1
[ $bad = 0 ] && echo "check-facts: ${#FILES[@]} files clean of ${#BANNED[@]} banned strings; $doors door counts match docs/facts.json"
exit $bad
