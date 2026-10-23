#!/usr/bin/env bash
# Incident drill for contracts/INCIDENT.md. Forks Robinhood Chain 4663 from the public RPC on its own anvil, deploys one NVDA
# StockVault with contracts/script/Deploy.s.sol, seeds a holder, then asserts the behaviour the runbook documents:
#   A  keeper outage    a stranger's rebalance is refused (NotKeeper) until 26 h, deposits keep working, the permissionless path
#                       that opens at 26 h still sits behind the oracle gate
#   B  stale feed       deposit, redeem and rebalance refuse with OracleUnhealthy(FeedStale); redeemInKind pays the holder out in
#                       kind; the keeper dry-run defers with chainlink_stale where it sent the same tick before the feed aged
#   C  owner actions    pause closes deposits and leaves redeemInKind open; setKeeper waits the 24 h queue, then retires the old keeper
# Prints PASS/FAIL per assertion and exits 1 at the first mismatch (2 when the fork cannot be set up: the drill seeds a holder, so the
# feed must be inside the vault's 90,000 s bound at the fork block, which holds from Friday's US open to Saturday 21:00 UTC and on
# weekday market hours). DRILL_BREAK=1 flips one expectation (the stale status) to prove the drill goes red.
# Needs: anvil, forge, cast, jq, bun, nc, and keeper/node_modules + contracts/{out,lib}. Only anvil's public test accounts sign; no key is read.
set -euo pipefail
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1
APP="$(cd "$(dirname "$0")/.." && pwd)"
PORT=${DRILL_PORT:-8581}
UPSTREAM=${DRILL_UPSTREAM:-https://rpc.mainnet.chain.robinhood.com}
R=http://127.0.0.1:$PORT
TMP=$(mktemp -d)
STEP=00-setup

NVDA=0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC
NS=0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00   # OZ ERC-7201 ERC20 base: balance slot = keccak(holder . NS)
OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266     # anvil 0
HOLDER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8    # anvil 1
TREASURY=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC  # anvil 2
STRANGER=0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc  # anvil 5
NEWKEEPER=0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f # anvil 8
KEEPER=0xa0Ee7A142d267C1f36714E4a8F75612F20a79720    # anvil 9
STALE=${DRILL_EXPECT_STALE_STATUS:-2}                # Status.FeedStale
[ "${DRILL_BREAK:-0}" = 1 ] && STALE=3
NVDA_AMT=5000000000000000000   # 5 NVDA, a string: bash integers overflow at 9.2e18
FUND=20000000000000000000
SMALL=500000000000000000

report() { echo "$1"; }
pass() { report "PASS $STEP"; }
die() { report "FAIL $STEP: $*"; exit 1; }
setup_die() { report "SETUP-FAIL $STEP: $*"; exit 2; }
trap 'rm -rf "$TMP"; [ -n "${ANVIL:-}" ] && kill "$ANVIL" 2>/dev/null || true' EXIT
trap 'echo "FAIL $STEP: unexpected error near line $LINENO" >&2' ERR

call() { cast call -r "$R" "$@" | awk '{print $1}'; }
mine() { cast rpc evm_mine -r "$R" >/dev/null; }
now() { cast block latest --field timestamp -r "$R"; }
warp() { cast rpc evm_setNextBlockTimestamp "$1" -r "$R" >/dev/null; mine; }
snap() { cast rpc evm_snapshot -r "$R" | tr -d '"'; }
revert_to() { [ "$(cast rpc evm_revert "$1" -r "$R")" = true ] || die "evm_revert $1"; }
send() { local from=$1; shift; cast send -r "$R" --from "$from" --unlocked "$@" >"$TMP/send.out" 2>&1 || die "send failed: $(tr '\n' ' ' <"$TMP/send.out" | cut -c1-300)"; }
# revert data of an eth_call from $1 ("OK" when it succeeds); the rest is the cast call argument list
reverts() { local from=$1 out; shift; if out=$(cast call -r "$R" --from "$from" "$@" 2>&1); then echo OK; else echo "$out" | grep -oE '0x[0-9a-f]{8,}' | tail -1 || echo UNKNOWN; fi; }
sel() { cast sig "$1"; }
word() { printf '%064x' "$1"; }
expect_revert() { # label, got, expected-data
  [ "$2" = "$3" ] || die "$1: reverted with '$2', expected '$3'"
}
expect_selector() { [ "${2:0:10}" = "$(sel "$3")" ] || die "$1: reverted with '$2', expected selector of $3"; }
fund() { cast rpc anvil_setStorageAt "$NVDA" "$(cast index address "$1" $NS)" "$(cast to-uint256 "$2")" -r "$R" >/dev/null; }
status() { call "$V" "health()(uint8,uint256,uint256,uint160,uint160,uint160)" | head -1; }

# ------------------------------------------------------------------ setup
for t in anvil forge cast jq bun nc; do command -v "$t" >/dev/null || setup_die "$t not on PATH"; done
nc -z 127.0.0.1 "$PORT" 2>/dev/null && setup_die "port $PORT is in use; set DRILL_PORT"
anvil --fork-url "$UPSTREAM" --port "$PORT" --host 127.0.0.1 --silent >"$TMP/anvil.log" 2>&1 & ANVIL=$!
for _ in $(seq 60); do nc -z 127.0.0.1 "$PORT" 2>/dev/null && break; sleep 1; done
nc -z 127.0.0.1 "$PORT" 2>/dev/null || setup_die "anvil did not start: $(sed -E 's#https?://[^ "]+#<url>#g' "$TMP/anvil.log" | head -3 | tr '\n' ' ')"
[ "$(cast chain-id -r "$R")" = 4663 ] || setup_die "fork is not chain 4663"
cast rpc anvil_mine 1 -r "$R" >/dev/null   # forge's eth_feeHistory asks the upstream for fork-block state unless one local block exists
FORK_BLOCK=$(cast block-number -r "$R")

OUT=$(cd "$APP/contracts" && OWNER=$OWNER KEEPER=$KEEPER TREASURY=$TREASURY forge script script/Deploy.s.sol --rpc-url "$R" --broadcast --unlocked --sender $OWNER -j 1 2>&1) \
  || setup_die "vault deploy failed: $(echo "$OUT" | tail -4 | tr '\n' ' ')"
V=$(echo "$OUT" | awk '$1=="StockVault"{print $2}')
[ -n "$V" ] && [ "$(cast code "$V" -r "$R" | wc -c)" -gt 100 ] || setup_die "no StockVault code at '$V'"
DEPLOY_BLOCK=$(cast block-number -r "$R")
T0=$(now)
[ "$(status)" = 0 ] || setup_die "vault health status is $(status), not Ok (0): the feed is outside the vault's bound at fork block $FORK_BLOCK; run it in US market hours or before Saturday 21:00 UTC"
fund "$HOLDER" $FUND
send "$HOLDER" "$NVDA" "approve(address,uint256)" "$V" $FUND
send "$HOLDER" "$V" "deposit(uint256,address)" $NVDA_AMT "$HOLDER"
SHARES=$(call "$V" "balanceOf(address)(uint256)" "$HOLDER")
report "setup: fork block $FORK_BLOCK, vault $V, deployed at block $DEPLOY_BLOCK, holder has $SHARES shares for $NVDA_AMT NVDA-wei"
STEP=00-baseline-gate-open; [ "$SHARES" != 0 ] && [ "$(status)" = 0 ] || die "seed deposit minted nothing or gate not Ok"; pass
BASE=$(snap)

keeper_tick() { # one keeper dry run with the recentre slot assumed due; prints the vault's NVDA tick line
  ( cd "$APP/keeper" && RPC_URL="$R" VAULT_ADDRESS_NVDA="$V" VAULT_DEPLOY_BLOCK_NVDA="$DEPLOY_BLOCK" VAULT_KEEPER_ADDRESS="$KEEPER" KEEPER_JITTER_SALT=drill \
      bun --no-env-file src/keeper.ts --dry-run --assume-due 2>/dev/null ) | jq -c 'select(.event == "tick" and .ticker == "NVDA")' | head -1
}

# ------------------------------------------------------------------ A: keeper outage
STEP=A1-keeper-silent-7h; warp $((T0 + 7 * 3600))
[ "$(status)" = 0 ] || die "gate not Ok 7 h in (status $(status))"
expect_selector "$STEP stranger rebalance" "$(reverts "$STRANGER" "$V" "rebalance()")" "NotKeeper()"; pass
STEP=A2-deposit-works-without-keeper
send "$HOLDER" "$V" "deposit(uint256,address)" $SMALL "$HOLDER"
[ "$(call "$V" "balanceOf(address)(uint256)" "$HOLDER")" != "$SHARES" ] || die "deposit minted no shares with the keeper silent"; pass
STEP=A3-keeper-tick-control   # same tick, feed fresh: the guards pass, so the stale case below is a change the keeper reacts to
TICK=$(keeper_tick); echo "$TICK" | jq -e '.guards_ok == true and .action != "blocked_by_guard"' >/dev/null || die "control tick not clear: $TICK"; pass
STEP=A4-permissionless-opens-at-26h-behind-the-gate; warp $((T0 + 27 * 3600))
GOT=$(reverts "$STRANGER" "$V" "rebalance()")
[ "${GOT:0:10}" != "$(sel "NotKeeper()")" ] || die "26 h on, a stranger still gets NotKeeper"
expect_revert "$STEP" "$GOT" "$(sel "OracleUnhealthy(uint8)")$(word 2)"; pass
revert_to "$BASE"; BASE=$(snap)

# ------------------------------------------------------------------ B: stale feed
STEP=B1-feed-ages-past-the-bound; warp $((T0 + 30 * 3600))
[ "$(status)" = "$STALE" ] || die "health status is $(status), expected $STALE (FeedStale)"; pass
STEP=B2-deposit-refused
expect_revert "$STEP" "$(reverts "$HOLDER" "$V" "deposit(uint256,address)" 1000000000000000 "$HOLDER")" "$(sel "OracleUnhealthy(uint8)")$(word 2)"; pass
STEP=B3-redeem-refused
expect_revert "$STEP" "$(reverts "$HOLDER" "$V" "redeem(uint256,address,address)" "$SHARES" "$HOLDER" "$HOLDER")" "$(sel "OracleUnhealthy(uint8)")$(word 2)"; pass
STEP=B4-keeper-rebalance-refused
expect_revert "$STEP" "$(reverts "$KEEPER" "$V" "rebalance()")" "$(sel "OracleUnhealthy(uint8)")$(word 2)"; pass
STEP=B5-keeper-defers
TICK=$(keeper_tick); echo "$TICK" | jq -e '.guards_ok == false and .action == "blocked_by_guard" and (.guard_reasons | map(startswith("chainlink_stale")) | any)' >/dev/null || die "keeper tick not deferred on chainlink_stale: $TICK"; pass
STEP=B6-redeemInKind-pays-out
BEFORE=$(call "$NVDA" "balanceOf(address)(uint256)" "$HOLDER")
send "$HOLDER" "$V" "redeemInKind(uint256,address,address)" "$SHARES" "$HOLDER" "$HOLDER"
AFTER=$(call "$NVDA" "balanceOf(address)(uint256)" "$HOLDER")
LEFT=$(call "$V" "balanceOf(address)(uint256)" "$HOLDER")
GAIN=$(python3 -c "print($AFTER - $BEFORE)")
python3 -c "import sys; sys.exit(0 if $GAIN >= $NVDA_AMT * 0.999 and $LEFT == 0 else 1)" || die "redeemInKind returned $GAIN NVDA-wei for $SHARES shares"
report "     in kind: +$GAIN NVDA-wei with the feed $(( $(now) - $(call "$V" "health()(uint8,uint256,uint256,uint160,uint160,uint160)" | sed -n 3p) )) s old"; pass
revert_to "$BASE"; BASE=$(snap)

# ------------------------------------------------------------------ C: owner actions
STEP=C1-pause-closes-deposits-not-exits
send "$OWNER" "$V" "pause()"
[ "$(call "$V" "maxDeposit(address)(uint256)" "$HOLDER")" = 0 ] || die "maxDeposit is not 0 while paused"
[ "$(reverts "$HOLDER" "$V" "deposit(uint256,address)" 1000000000000000 "$HOLDER")" != OK ] || die "deposit accepted while paused"
[ "$(reverts "$HOLDER" "$V" "redeemInKind(uint256,address,address)" "$SHARES" "$HOLDER" "$HOLDER")" = OK ] || die "redeemInKind refused while paused"; pass
STEP=C2-setKeeper-waits-the-24h-queue
DATA=$(cast calldata "setKeeper(address)" "$NEWKEEPER")
send "$OWNER" "$V" "queueChange(bytes)" "$DATA"
expect_selector "$STEP execute at once" "$(reverts "$OWNER" "$V" "executeChange(bytes)" "$DATA")" "ChangeTooEarly(uint256)"
warp $(( $(now) + 24 * 3600 + 1 ))
send "$OWNER" "$V" "executeChange(bytes)" "$DATA"
[ "$(call "$V" "keeper()(address)" | tr 'A-F' 'a-f')" = "$(echo $NEWKEEPER | tr 'A-F' 'a-f')" ] || die "keeper did not change after the delay"; pass
STEP=C3-retired-keeper-is-a-stranger
expect_selector "$STEP" "$(reverts "$KEEPER" "$V" "rebalance()")" "NotKeeper()"; pass
echo "DRILL OK: fork block $FORK_BLOCK, vault $V"
