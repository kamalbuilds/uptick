#!/usr/bin/env bash
# Runs the whole forge suite against Robinhood Chain state frozen at one weekday NYSE-hours block, so results do not
# move with live market state (feed age, pool depth, protocol fees).
#
# Why this block: contracts/test/ForkPin.sol PINNED_BLOCK 93,694,185 = Tue 2026-10-20 15:30:56 America/New_York, inside
# the 09:30-16:00 NYSE session, so every equity feed is fresh and every pool is trading. The official RPC keeps about
# 10k blocks (~17 min) of state, so that block is read from an upstream that serves history without a key
# (robinhood.drpc.org answers eth_call and eth_getStorageAt at it).
#
# forge forks the upstream directly. A local anvil in front of it was tried first (forge -> anvil 1.6.0-nightly ->
# upstream) and wedges: after the first burst of cold storage reads anvil stops answering even eth_blockNumber, and every
# later setUp dies at forge's 45 s fork timeout. The upstream is a load-balanced pool where an occasional node answers
# "Unknown state. First available state is N" (HTTP 400, not retried by forge). That is an infrastructure error, not a
# test result, so the suite is passed again (forge keeps fetched slots in its on-disk cache for this block) until a pass
# contains none. Real failures never trigger a re-run.
#
# Usage: scripts/forge-pinned.sh        (env: UPSTREAM_RPC, FORK_BLOCK, MAX_PASSES, ALLOW_OFF_HOURS=1 to skip the session check)
# Output: contracts/test-logs/forge-<short sha>-<block>.txt  (block, RPC, pass/fail/skip per suite, totals, failing tests)
# Exit: 0 only when forge reports zero failures.
set -euo pipefail
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1
APP="$(cd "$(dirname "$0")/.." && pwd)"
CON="$APP/contracts"
UPSTREAM_RPC="${UPSTREAM_RPC:-https://robinhood.drpc.org}"
FORK_BLOCK="${FORK_BLOCK:-$(grep -oE 'PINNED_BLOCK = [0-9_]+' "$CON/test/ForkPin.sol" | grep -oE '[0-9_]+$' | tr -d _)}"
SHA="$(git -C "$APP" rev-parse --short HEAD)"
LOG="$CON/test-logs/forge-$SHA-$FORK_BLOCK.txt"
RAW="$(mktemp -t forge-pinned-raw)"
[ -n "$FORK_BLOCK" ] || { echo "no fork block" >&2; exit 2; }

# the block must be answerable by the upstream and be a weekday inside the NYSE session
TS="$(cast block "$FORK_BLOCK" -f timestamp -r "$UPSTREAM_RPC")" || { echo "upstream has no block $FORK_BLOCK" >&2; exit 3; }
HAS_STATE=0   # the upstream is a pool where some nodes are pruned, so one refusal is not "no history"; 12 in a row is
for _ in $(seq 12); do
  cast call 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'decimals()(uint8)' -r "$UPSTREAM_RPC" -b "$FORK_BLOCK" >/dev/null 2>&1 && { HAS_STATE=1; break; }
  sleep 1
done
[ "$HAS_STATE" = 1 ] || { echo "upstream $UPSTREAM_RPC keeps no state at block $FORK_BLOCK" >&2; exit 3; }
NY="$(TZ=America/New_York date -r "$TS" '+%a %Y-%m-%d %H:%M:%S %Z')"
DOW="$(TZ=America/New_York date -r "$TS" +%u)"
HM="$(TZ=America/New_York date -r "$TS" +%H%M)"
if [ "${ALLOW_OFF_HOURS:-0}" != 1 ] && { [ "$DOW" -gt 5 ] || [ "$HM" -lt 0930 ] || [ "$HM" -ge 1600 ]; }; then
  echo "block $FORK_BLOCK is $NY, outside weekday NYSE hours (ALLOW_OFF_HOURS=1 overrides)" >&2; exit 4
fi
echo "forking $UPSTREAM_RPC at $FORK_BLOCK ($NY); forge -j 2 starting, raw output $RAW"

# ETH_RPC_URL is what lets forge accept --fork-retries; ForkPin forks FORK_URL at FORK_BLOCK for every suite
FORGE=(forge test -j 2 --fork-block-number "$FORK_BLOCK" --fork-retries 5 --fork-retry-backoff 500 --no-rpc-rate-limit)
set +e
PASSES=0
while :; do
  PASSES=$((PASSES + 1))
  ( cd "$CON" && FORK_URL="$UPSTREAM_RPC" ETH_RPC_URL="$UPSTREAM_RPC" FORK_BLOCK="$FORK_BLOCK" "${FORGE[@]}" ) >"$RAW" 2>&1
  RC=$?
  grep -qE 'Unknown state|operation timed out|error sending request' "$RAW" || break
  echo "pass $PASSES: $(grep -cE 'Unknown state|operation timed out|error sending request' "$RAW") upstream errors, passing again"
  [ "$PASSES" -ge "${MAX_PASSES:-6}" ] && break
done
set -e

{
  echo "commit:     $(git -C "$APP" rev-parse HEAD)"
  echo "fork block: $FORK_BLOCK ($NY, unix $TS)"
  echo "rpc:        $UPSTREAM_RPC"
  echo "command:    cd contracts && FORK_URL=$UPSTREAM_RPC ETH_RPC_URL=$UPSTREAM_RPC FORK_BLOCK=$FORK_BLOCK ${FORGE[*]}"
  echo "forge:      $(forge --version | head -1); recorded pass $PASSES"
  echo
  printf '%-56s %6s %6s %7s\n' suite pass fail skip
  awk '   # suites finish in a different order each run, so sort the rows; TOTAL goes last
    /^Ran [0-9]+ tests? for /      { s=$NF }
    /^Suite result:/               { gsub(/[;.]/,""); printf "%-56s %6d %6d %7d\n", s, $4, $6, $8 }
  ' "$RAW" | sort | awk '{ print; p+=$(NF-2); f+=$(NF-1); k+=$NF } END { printf "%-56s %6d %6d %7d\n", "TOTAL", p, f, k }'
  echo
  echo "failing tests:"
  grep -E '^\[FAIL' "$RAW" | sed -E 's/ \(gas: [0-9]+\)//' | sort -u || true
  [ "$RC" -eq 0 ] && echo "(none)"
  echo
  echo "forge exit code: $RC"
  if ! grep -q '^Suite result' "$RAW"; then echo "INFRA: forge ran no suites, an empty run proves nothing"; RC=8; fi
  if grep -qE 'Unknown state|operation timed out|error sending request' "$RAW"; then echo "INFRA: upstream errors remain after $PASSES passes, this result is not valid"; RC=7; fi
} >"$LOG"
cat "$LOG"
echo "raw forge output: $RAW"
exit "$RC"
