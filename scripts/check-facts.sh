#!/usr/bin/env bash
# Fails on any stale number or phrase in the public files. The right numbers live in docs/facts.json (node scripts/facts.mjs).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2
FILES=(README.md docs/SUBMISSION.md docs/DEMO-SCRIPT.md deck/index.html deck/handout/index.html web/public/llms.txt)
BANNED=("80 of 80" "46 fork" "5.1M" "54 days" "four review" "fourth ends" "10% of collected" "Live and reviewed" "Closed six" "and 8 more" "and 14 more" "Contracts are final")
# 366 was the test count before the v4 suite; it is allowed only while facts.json still says 366. Word-bounded so a hex address containing 366 is not a hit.
[ "$(jq -r .tests.total docs/facts.json)" = "366" ] || BANNED+=('\b366\b')
bad=0
for f in "${FILES[@]}"; do
  [ -s "$f" ] || { echo "MISSING or empty: $f"; bad=1; continue; }
  for p in "${BANNED[@]}"; do
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
    for n in $(sed -E 's/[Rr]ound [0-9]+ closed//g' "$f" | grep -oEi "\b[0-9]+ $st\b|\b[0-9]+ vaults? takes? $phrase" | grep -oE '^[0-9]+' | sort -u); do
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
[ $bad = 0 ] && echo "check-facts: ${#FILES[@]} files clean of ${#BANNED[@]} banned strings; $doors door counts match docs/facts.json"
exit $bad
