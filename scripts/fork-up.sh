#!/usr/bin/env bash
# Starts the local Robinhood Chain fork on :8545 and leaves it running in the foreground.
# First run (no state): forks at $FORK_BLOCK (default latest; on weekends pass a Friday NYSE-hours block, the
# vault refuses deposits on a stale feed), records it in ~/.cache/uptick-fork/fork.json, deploys and funds the
# NVDA vault, rebalances it, and points keeper/.env.local and web/.env.local at it.
# Later runs: relaunch pinned to the recorded block with the saved state, so the vault's history stays local and the
# keeper's getLogs never reaches the upstream RPC (Alchemy free tier allows only 10 blocks per getLogs).
# The upstream RPC URL is read from file into the environment, never passed in argv.
set -euo pipefail
trap 'echo "fork-up failed at line $LINENO" >&2' ERR
APP="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HOME/.cache/uptick-fork"; mkdir -p "$DIR"
[ -f "$DIR/foundry.toml" ] || printf '[profile.default]\n\n[rpc_endpoints]\nrhc = "${UPTICK_RHC_RPC}"\n' > "$DIR/foundry.toml"
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1
export UPTICK_RHC_RPC="$(tr -d '[:space:]' < "$APP/../.progress/achemykey.env")"
[ -n "$UPTICK_RHC_RPC" ] || { echo "no upstream RPC in .progress/achemykey.env" >&2; exit 9; }
R=http://127.0.0.1:8545
ANVIL0_KEY=$(cast wallet private-key "test test test test test test test test test test test junk")  # anvil account 0 from the public Foundry test mnemonic
A0=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
NVDA=0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC
NVDA_BAL_SLOT=0x03b401b7b39ad5148aeb9ef28bef316a982c01bdaadee32abc45fed3bc7f4746

start_anvil() { (cd "$DIR" && exec anvil --fork-url rhc "$@" --port 8545 --host 127.0.0.1 --state ./state.json --state-interval 60 >"$DIR/anvil.log" 2>&1) & ANVIL=$!; for i in $(seq 90); do nc -z 127.0.0.1 8545 2>/dev/null && return 0; sleep 1; done; echo "anvil did not start, see $DIR/anvil.log" >&2; exit 1; }

if [ -f "$DIR/fork.json" ] && [ -f "$DIR/state.json" ]; then
  FB=$(jq -r .fork_block "$DIR/fork.json")
  start_anvil --fork-block-number "$FB"
  echo "fork pinned at $FB, vault $(jq -r .vault "$DIR/fork.json")"
else
  rm -f "$DIR/state.json"
  start_anvil ${FORK_BLOCK:+--fork-block-number "$FORK_BLOCK"}
  FB=$(cast block-number -r $R); echo "step: forked at $FB" >&2
  cast rpc anvil_setStorageAt $NVDA $NVDA_BAL_SLOT "$(cast to-uint256 235000000000000000000)" -r $R >/dev/null
  cast rpc anvil_mine 1 -r $R >/dev/null; echo "step: funded" >&2
  OUT=$(cd "$APP/contracts" && ANVIL_KEY=$ANVIL0_KEY forge script script/DeployFork.s.sol --rpc-url $R --broadcast 2>&1) || { echo "$OUT" | sed -E "s|https?://[^ ]+|<url>|g" | tail -15 >&2; exit 1; }
  V=$(echo "$OUT" | grep -oE "StockVault 0x[0-9a-fA-F]{40}" | head -1 | awk '{print $2}')
  [ -n "$V" ] || { echo "$OUT" | tail -20 >&2; exit 1; }
  echo "step: deployed $V" >&2
  DB=$(( $(jq -r '.receipts[0].blockNumber' "$APP/contracts/broadcast/DeployFork.s.sol/4663/run-latest.json") ))
  cast rpc evm_increaseTime 21700 -r $R >/dev/null; cast rpc anvil_mine 1 -r $R >/dev/null
  cast send "$V" "rebalance()" --unlocked --from $A0 -r $R >/dev/null; echo "step: rebalanced" >&2
  sed -i '' "s/^VAULT_ADDRESS_NVDA=.*/VAULT_ADDRESS_NVDA=$V/; s/^VAULT_DEPLOY_BLOCK_NVDA=.*/VAULT_DEPLOY_BLOCK_NVDA=$DB/" "$APP/keeper/.env.local"
  sed -i '' "s/^NEXT_PUBLIC_VAULT_NVDA=.*/NEXT_PUBLIC_VAULT_NVDA=$V/" "$APP/web/.env.local"
  cast rpc anvil_dumpState -r $R >/dev/null 2>&1 || true
  jq -n --argjson fb "$FB" --arg v "$V" --argjson db "$DB" '{fork_block:$fb, vault:$v, deploy_block:$db}' > "$DIR/fork.json"
  echo "fresh fork at $FB; vault $V deployed at $DB, totalAssets $(cast call "$V" 'totalAssets()(uint256)' -r $R)"
fi
wait "$ANVIL"
