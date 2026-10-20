#!/usr/bin/env bash
# Starts the local Robinhood Chain fork on :8545 and leaves it running in the foreground.
# First run (no state): forks at $FORK_BLOCK (default latest; on weekends pass a Friday NYSE-hours block, the
# vault refuses deposits on a stale feed), records it in ~/.cache/uptick-fork/fork.json, then runs
# scripts/fork-deploy-all.sh: every vault (NVDA included) through the VaultFactory plus the factory-bound router,
# seeded and rebalanced, with keeper/.env.local and web/.env.local pointed at them.
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

start_anvil() { (cd "$DIR" && exec anvil --fork-url rhc "$@" --port 8545 --host 127.0.0.1 --state ./state.json --state-interval 60 >"$DIR/anvil.log" 2>&1) & ANVIL=$!; for i in $(seq 90); do nc -z 127.0.0.1 8545 2>/dev/null && return 0; sleep 1; done; echo "anvil did not start, see $DIR/anvil.log" >&2; exit 1; }

if [ -f "$DIR/fork.json" ] && [ -f "$DIR/state.json" ]; then
  FB=$(jq -r .fork_block "$DIR/fork.json")
  start_anvil --fork-block-number "$FB"
  echo "fork pinned at $FB, $(jq '.vaults | length' "$DIR/fork.json") vaults, router $(jq -r .router "$DIR/fork.json")"
else
  rm -f "$DIR/state.json" "$DIR/fork.json"
  start_anvil ${FORK_BLOCK:+--fork-block-number "$FORK_BLOCK"}
  FB=$(cast block-number -r $R); echo "step: forked at $FB" >&2
  jq -n --argjson fb "$FB" '{fork_block:$fb}' > "$DIR/fork.json"
  cast rpc anvil_mine 1 -r $R >/dev/null   # forge's eth_feeHistory asks the upstream for fork-block state unless one local block exists
  "$APP/scripts/fork-deploy-all.sh" || { echo "fork-deploy-all failed, anvil left running on :8545" >&2; exit 1; }
  echo "fresh fork at $FB; $(jq '.vaults | length' "$DIR/fork.json") vaults, factory $(jq -r .factory "$DIR/fork.json"), router $(jq -r .router "$DIR/fork.json")"
fi
wait "$ANVIL"
