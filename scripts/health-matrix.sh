#!/usr/bin/env bash
# Runs contracts/script/HealthMatrix.s.sol against the live chain and keeps the output at
# contracts/test-logs/health-<UTC timestamp>.txt. Exit status is the script's: non-zero when a healthy vault cannot
# deploy its cap or redeemInKind fails. Read-only: it forks the RPC, broadcasts nothing, holds no key.
# Env: SYMBOLS (default AAPL,GOOGL,PLTR), WARP_SECONDS (what-if: age the real feeds), RPC via foundry.toml "robinhood".
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
log="$root/contracts/test-logs/health-$ts.txt"
mkdir -p "$root/contracts/test-logs"
node "$root/scripts/deploy-list.mjs" --open-only "$root/contracts/test-logs/deploy-list.json"
cd "$root/contracts"
{
  echo "# health matrix $ts UTC, commit $(git rev-parse --short HEAD), symbols ${SYMBOLS:-AAPL,GOOGL,PLTR}, warp ${WARP_SECONDS:-0}s"
  DEPLOY_LIST=test-logs/deploy-list.json forge script script/HealthMatrix.s.sol --rpc-url robinhood -vv 2>&1 | sed -n '/== Logs ==/,$p'
} | tee "$log"
echo "saved $log"
