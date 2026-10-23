#!/usr/bin/env bash
# Fails on any stale number or phrase in the public files. The right numbers live in docs/facts.json (node scripts/facts.mjs).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2
FILES=(README.md docs/SUBMISSION.md docs/DEMO-SCRIPT.md deck/index.html web/public/llms.txt)
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
[ $bad = 0 ] && echo "check-facts: ${#FILES[@]} files clean of ${#BANNED[@]} banned strings"
exit $bad
