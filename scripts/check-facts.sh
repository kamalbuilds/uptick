#!/usr/bin/env bash
# Fails on any stale number or phrase in the public files. The right numbers live in docs/facts.json (node scripts/facts.mjs).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2
FILES=(README.md docs/SUBMISSION.md docs/DEMO-SCRIPT.md docs/AGENT-DEMO.md deck/index.html deck/handout/index.html web/public/llms.txt)
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
claim mcp.count "$(jq -r .mcp.count docs/facts.json)" "\b($NW|[0-9]+) (MCP )?tools\b"
claim reviews.reports_total "$(jq -r .reviews.reports_total docs/facts.json)" "\b($NW|[0-9]+) ((review|security) )?reports?\b|\b($NW|[0-9]+) security reviews\b"
claim mutations.total "$(jq -r .mutations.total docs/facts.json)" "\b[0-9]+[- ](row )?mutation (checks?|rows?)\b|\b[0-9]+ guards are mutation-tested"
claim holders.spcx "$(jq -r .holders.spcx docs/facts.json)" "(^|[ (])11[0-9],[0-9]{3}\b"
# One repo URL.
REPO="$(jq -r .repo docs/facts.json)"; REPOPATH="${REPO#*hub.com/}"
seen=0
for f in "${FILES[@]}"; do
  [ -s "$f" ] || continue
  for u in $(grep -oE "hub\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_-]+" "$f" | sort -u); do
    seen=$((seen + 1)); [ "${u#hub.com/}" = "$REPOPATH" ] || { echo "$f: repo URL \"$u\", docs/facts.json repo says $REPOPATH"; bad=1; }
  done
done
[ "$seen" -gt 0 ] || { echo "check-facts: no repo URL found, the check read nothing"; bad=1; }
# Fee per $1 lost has two samples. A figure from either must have its sample stated within 15 lines: the spike's 13.64 and 1.16 name the fixed range, the three pools and the dates; the 30-day replay figures (web/lib/moment.json) carry the replay label.
winchk() { # file figure-regex need-regex label
  awk -v fig="$2" -v need="$3" '{L[NR]=$0} END{for(i=1;i<=NR;i++) if (L[i] ~ fig && L[i] !~ /<path/) {c=""; for(j=i-15;j<=i+15;j++) if (j>=1&&j<=NR) c=c" "L[j]; if (c !~ need) print i": "substr(L[i],1,120)}}' "$1" | while IFS= read -r l; do echo "$1:$l  <- $4"; done
}
esc() { sed 's/\./\\./g'; }
SPIKE=$(jq -r '[.fee_per_dollar_lost.spike.weekend,.fee_per_dollar_lost.spike.nyse]|map(tostring)|join("|")' docs/facts.json | esc)
REPLAY=$(jq -r '[.fee_per_dollar_lost.replay_30d[]|.vault,.pool]|map(tostring)|join("|")' docs/facts.json | esc)
for f in "${FILES[@]}"; do
  [ -s "$f" ] || continue
  for need in NVDA SPCX TSLA '(fixed|static)' '(24 August|2026-08-24)'; do
    o=$(winchk "$f" "(^|[^0-9.])($SPIKE)([^0-9]|\$)" "$need" "spike figure without \"$need\" within 15 lines"); [ -z "$o" ] || { echo "$o"; bad=1; }
  done
  o=$(winchk "$f" "(^|[^0-9.])($REPLAY)([^0-9]|\$)" '(30-day replay|vault replay)' "30-day replay figure without its label within 15 lines"); [ -z "$o" ] || { echo "$o"; bad=1; }
done
grep -qE "(^|[^0-9.])($SPIKE)([^0-9]|\$)" README.md docs/SUBMISSION.md deck/index.html || { echo "check-facts: no spike figure found, the fee check read nothing"; bad=1; }
grep -qE "(^|[^0-9.])($REPLAY)([^0-9]|\$)" deck/index.html || { echo "check-facts: no replay figure found in the deck, the fee check read nothing"; bad=1; }
[ $bad = 0 ] && echo "check-facts: ${#FILES[@]} files clean of ${#BANNED[@]} banned strings; $doors door counts match docs/facts.json"
exit $bad
