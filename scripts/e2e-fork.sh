#!/usr/bin/env bash
# End-to-end run of every user path against the local Robinhood Chain fork (scripts/fork-up.sh must be running on :8545).
# Uses the NVDA vault the VaultFactory deployed and the factory-bound router, both read from ~/.cache/uptick-fork/fork.json.
# Prints `PASS <step>` / `FAIL <step>: <detail>` and exits non-zero at the first broken step. Each step asserts a
# post-condition only completion can produce (balance deltas, share deltas, decoded event logs), never a tx hash alone.
# The whole run sits between evm_snapshot and evm_revert, so the shared fork is unchanged afterwards (E2E_KEEP=1 skips the revert).
# Needs: anvil fork on :8545, cast, forge, jq, python3, bun, and api/node_modules (wrangler). No secret is read or printed:
# the only key is anvil account 0 from the public Foundry test mnemonic, handed to the keeper through its environment.
set -Eeuo pipefail
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1 WRANGLER_SEND_METRICS=false
exec 3>&1
APP="$(cd "$(dirname "$0")/.." && pwd)"
R=${E2E_RPC:-http://127.0.0.1:8545}
FORK_JSON="$HOME/.cache/uptick-fork/fork.json"
TMP=$(mktemp -d)
STEP=00-preflight
SNAP=""
ONLY=${E2E_ONLY:-all}           # all: every user path on the NVDA vault, then the Morpho demo; demo: only the Morpho demo (needs no fork.json, any anvil fork of 4663)
JSALT=e2e-fork-jitter-salt   # the keeper's local jitter salt for this run; the slot the script waits for is computed from the same one

NVDA=0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC
USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
POOL=0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3
SWAPROUTER=0xCaf681a66D020601342297493863E78C959E5cb2
FEED=0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15
A0=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266   # deployer, vault owner and keeper
USER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8  # anvil account 1: the fresh user
USER2=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 # anvil account 4: a second fresh user, for the same-block exit checks
TREASURY=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
TRADER=0x90F79bf6EB2c4f870365E785982E1f101E93b906 # anvil account 3: swap volume
NVDA_NS=0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00 # OZ ERC-7201 ERC20 storage base: balance slot = keccak(holder . NVDA_NS)
USDG_BAL_SLOT=1                                                              # USDG proxy: balance slot = keccak(holder . 1)

# one dry-run pass of the keeper over the fork with the recentre slot assumed due; prints the NVDA tick line
keeper_dry_nvda() {
  ( cd "$APP/keeper" && RPC_URL="$R" VAULT_ADDRESS_NVDA="$V" VAULT_DEPLOY_BLOCK_NVDA="$(jq -r .vaults.NVDA.deploy_block "$FORK_JSON")" VAULT_KEEPER_ADDRESS="$A0" KEEPER_JITTER_SALT="$JSALT" \
      bun --no-env-file src/keeper.ts --dry-run --assume-due 2>/dev/null ) | jq -c 'select(.event == "tick" and .ticker == "NVDA")' | head -1
}

scrub() { sed -E 's#https?://[^ "]+#<url>#g'; }
report() { echo "$1" >&3; echo "$1" >>"$TMP/report.log"; }
info() { report "  info: $*"; }
die() { # also ends the main shell when called inside $(...)
  [ -f "$TMP/failed" ] || report "FAIL $STEP: $(printf '%s' "$*" | scrub | tr '\n' ' ' | cut -c1-600)"
  : > "$TMP/failed"; kill -TERM $$ 2>/dev/null; exit 1
}
pass() { report "PASS $STEP"; }
step() { STEP=$1; }

descendants() { local c; for c in $(pgrep -P "$1" 2>/dev/null || true); do descendants "$c"; echo "$c"; done; }
killtree() { local p; for p in $(descendants "$1") "$1"; do kill "$p" 2>/dev/null || true; done; }

cleanup() {
  local rc=$?
  [ -f "$TMP/wrangler.pid" ] && killtree "$(cat "$TMP/wrangler.pid")"
  [ -f "$TMP/keeper.pid" ] && killtree "$(cat "$TMP/keeper.pid")"
  if [ $rc -ne 0 ] && [ ! -f "$TMP/failed" ]; then
    report "FAIL $STEP: unexpected error (exit $rc) near line $(cat "$TMP/errline" 2>/dev/null || echo '?')"
  fi
  cast rpc anvil_setAutomine true -r "$R" >/dev/null 2>&1 || true   # a failure between the automine-off steps must not leave the fork not mining
  if [ -n "$SNAP" ] && [ "${E2E_KEEP:-0}" != 1 ]; then
    cast rpc evm_revert "$SNAP" -r "$R" >/dev/null 2>&1 || report "WARN fork revert failed, run scripts/fork-up.sh state check"
  fi
  [ -f "$TMP/anvil.pid" ] && kill "$(cat "$TMP/anvil.pid")" 2>/dev/null
  rm -rf "$TMP"
}
trap 'echo "$LINENO" > "$TMP/errline"' ERR
trap 'exit 1' TERM
trap cleanup EXIT

# ---------------------------------------------------------------- helpers
num() { awk '{print $1}'; }
call() { cast call -r "$R" "$@" | num; }                      # single uint/address return
py() { python3 -c "print($1)"; }
chk() { python3 -c "import sys; sys.exit(0 if ($2) else 1)" || die "$1 [$2]"; }
mine() { cast rpc evm_mine -r "$R" >/dev/null; }
ts() { cast block latest --field timestamp -r "$R"; }
warp() { cast rpc evm_setNextBlockTimestamp "$1" -r "$R" >/dev/null && mine; }

fund_nvda() { cast rpc anvil_setStorageAt "$NVDA" "$(cast index address "$1" $NVDA_NS)" "$(cast to-uint256 "$2")" -r "$R" >/dev/null; }
fund_usdg() { cast rpc anvil_setStorageAt "$USDG" "$(cast index address "$1" $USDG_BAL_SLOT)" "$(cast to-uint256 "$2")" -r "$R" >/dev/null; }
bal() { call "$1" 'balanceOf(address)(uint256)' "$2"; }       # token holder

# send FROM [cast send args...] -> receipt JSON; dies unless the tx mined with status 1
send() {
  local from=$1 out st; shift
  out=$(cast send --unlocked --from "$from" --json -r "$R" "$@" 2>&1) || die "tx did not mine: $(printf '%s' "$out" | tail -3)"
  st=$(jq -r .status <<<"$out" 2>/dev/null) || die "unparseable receipt: $out"
  [ "$st" = 0x1 ] || die "tx mined with status $st"
  printf '%s' "$out"
}
# send_reverts FROM [args...]: forces the tx on chain with a fixed gas limit; dies unless it mined with status 0
send_reverts() {
  local from=$1 out st; shift
  out=$(cast send --unlocked --from "$from" --gas-limit 3000000 --json -r "$R" "$@" 2>&1) || true
  st=$(jq -r .status <<<"$out" 2>/dev/null) || die "expected a mined revert, got: $(printf '%s' "$out" | tail -2)"
  [ "$st" = 0x0 ] || die "expected tx status 0x0, got $st"
}
# revdata FROM [cast call args...]: eth_call that must revert; prints the revert data hex
revdata() {
  local from=$1 out; shift
  if out=$(cast call --from "$from" -r "$R" "$@" 2>&1); then die "expected a revert but the call returned: $out"; fi
  printf '%s' "$out" | grep -oE '0x[0-9a-fA-F]{8,}' | tail -1
}
# evdata RECEIPT_JSON ADDRESS "Event(types)" -> "topic1,topic2|data" of the first matching log, empty if none
evdata() {
  local t0; t0=$(cast sig-event "$3")
  jq -r --arg a "$2" --arg t "$t0" '[.logs[] | select((.address|ascii_downcase)==($a|ascii_downcase) and .topics[0]==$t)][0] | if .==null then empty else ([.topics[1:][]]|join(","))+"|"+.data end' <<<"$1"
}
word() { python3 -c "import sys;d=sys.argv[1];i=int(sys.argv[2]);print(int(d[2+64*i:66+64*i],16))" "$1" "$2"; }
liquidity() { cast call "$V" 'positionInfo()((uint256,int24,int24,uint128,uint256,uint256,uint256,uint256,bool))' -r "$R" | tr -d '()' | awk -F', ' '{print $4}' | num; }
uncollected() { cast call "$V" 'positionInfo()((uint256,int24,int24,uint128,uint256,uint256,uint256,uint256,bool))' -r "$R" | tr -d '()' | awk -F', ' '{print $7, $8}' | sed -E 's/\[[^]]*\]//g'; }
pps() { call "$V" 'convertToAssets(uint256)(uint256)' 1000000000000000000000000; }
tick() { cast call "$POOL" 'slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)' -r "$R" | sed -n 2p | num; }
health() { cast call "$V" 'health()(uint8,uint256,uint256,uint160,uint160,uint160)' -r "$R" | sed -n 1p | num; }
# spot-to-TWAP distance in bp of price (price is the square of sqrtPrice), as the vault's health() reports both
off_twap_bps() {
  python3 -c "import sys;t,s=map(int,sys.argv[1:]);print(abs(s*s-t*t)*10000//(t*t))" $(cast call "$V" 'health()(uint8,uint256,uint256,uint160,uint160,uint160)' -r "$R" | sed -n '5p;6p' | num); }
# distance in bp of price between the Chainlink-implied sqrt price and the TWAP (field 5) or spot (field 6) of health()
off_feed_bps() {
  python3 -c "import sys;o,x=map(int,sys.argv[1:]);print(abs(x*x-o*o)*10000//(o*o))" $(cast call "$V" 'health()(uint8,uint256,uint256,uint160,uint160,uint160)' -r "$R" | sed -n "4p;${1}p" | num); }
# the vault refuses deposits and rebalances while spot sits more than 10 bp from the 600 s TWAP: let one window pass with no trades
gate_ready() { [ "$(off_twap_bps)" -le 5 ] || settle; }
settle() { local before; before=$(off_twap_bps); warp $(( $(ts) + 700 )); chk "TWAP caught up with spot (was ${before} bp apart, now at most 1)" "$(off_twap_bps) <= 1"; }
feedupdated() { cast call "$FEED" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' -r "$R" | sed -n 4p | num; }
swap() { # FROM tokenIn tokenOut amountIn -> receipt (fee 500 pool, recipient = FROM). Fixed gas limit: eth_estimateGas on a swap
  # intermittently lands below what the mined tx needs (out of gas inside the pool's USDG balanceOf, measured on this fork)
  local rc; rc=$(send "$1" "$SWAPROUTER" --gas-limit "${SWAP_GAS:-1500000}" 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))(uint256)' "($2,$3,500,$1,$4,0,0)")
  if declare -F logtx >/dev/null; then logtx "${SWAP_LABEL:-trader swap}" "$(jq -r .transactionHash <<<"$rc")"; fi
}

# ---------------------------------------------------------------- 00 preflight
if [ "$ONLY" = demo ] && [ -z "${E2E_RPC:-}" ]; then   # the one-command demo brings its own fork of the public RPC (FORK_BLOCK pins a block)
  PORT=$(/usr/bin/python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  anvil --fork-url "${UPSTREAM_RPC:-https://rpc.mainnet.chain.robinhood.com}" ${FORK_BLOCK:+--fork-block-number "$FORK_BLOCK"} --host 127.0.0.1 --port "$PORT" --silent >"$TMP/anvil.log" 2>&1 &
  echo $! >"$TMP/anvil.pid"; R=http://127.0.0.1:$PORT
  for _ in $(seq 90); do nc -z 127.0.0.1 "$PORT" 2>/dev/null && break; sleep 1; done
  nc -z 127.0.0.1 "$PORT" 2>/dev/null || die "anvil fork did not start: $(tail -3 "$TMP/anvil.log")"
  cast rpc anvil_mine 1 -r "$R" >/dev/null   # forge's eth_feeHistory asks the upstream for fork-block state unless one local block exists
fi
cast chain-id -r "$R" >"$TMP/cid" 2>&1 || die "no RPC at $R: $(cat "$TMP/cid")"
chk "fork chain id" "$(cat "$TMP/cid") == 4663"
if [ "$ONLY" != demo ]; then
[ -f "$FORK_JSON" ] || die "no $FORK_JSON, start scripts/fork-up.sh"
V=$(jq -r '.vaults.NVDA.address // empty' "$FORK_JSON"); ROUTER=$(jq -r '.router // empty' "$FORK_JSON"); FACTORY=$(jq -r '.factory // empty' "$FORK_JSON")
[ -n "$V" ] && [ -n "$ROUTER" ] && [ -n "$FACTORY" ] || die "fork.json lacks vaults.NVDA, router or factory: run scripts/fork-up.sh on the current bytecode"
[ "$(cast code "$V" -r "$R" | wc -c)" -gt 100 ] || die "no vault code at $V"
chk "vault share decimals are 24" "$(call "$V" 'decimals()(uint8)') == 24"
chk "NVDA vault is registered in the factory" "'$(call "$FACTORY" 'isVault(address)(bool)' "$V")' == 'true'"
chk "router is bound to that factory" "'$(call "$ROUTER" 'registry()(address)' | tr A-Z a-z)' == '$(echo "$FACTORY" | tr A-Z a-z)'"
chk "router slippageBps is 100" "$(call "$ROUTER" 'slippageBps()(uint256)') == 100"
WANT_CAP=$(node "$APP/scripts/deploy-list.mjs" 2>/dev/null | jq -r '.[] | select(.symbol=="NVDA") | .depositCapTokens')
chk "NVDA depositCap is the deploy-list cap" "$(call "$V" 'depositCap()(uint256)') == $WANT_CAP and $WANT_CAP > 0"
chk "entry fee defaults to max(pool fee tier, 35 bp): 3500 pips on the 5 bp NVDA pool" "$(call "$V" 'entryFee()(uint24)') == 3500 and $(call "$V" 'poolFee()(uint24)') == 500"
chk "rebalance TWAP-to-Chainlink bound defaults to 30 bp" "$(call "$V" 'maxTwapOracleBps()(uint16)') == 30"
chk "vault is keyed to anvil account 0" "'$(cast call "$V" 'keeper()(address)' -r "$R" | tr A-Z a-z)' == '$(echo $A0 | tr A-Z a-z)'"
fi
ANVIL0_KEY=$(cast wallet private-key "test test test test test test test test test test test junk") # public Foundry test mnemonic, account 0
SNAP=$(cast rpc evm_snapshot -r "$R" | tr -d '"')
START_BLOCK=$(cast block-number -r "$R")
T0=$(ts)
warp $((T0 + 1))   # anvil's wall clock can sit behind the head after a restart: pin the chain clock at the head first
chk "chain clock moves forward" "$(ts) == $((T0 + 1))"
if [ "$ONLY" != demo ]; then
START_SUPPLY=$(call "$V" 'totalSupply()(uint256)')
info "spot is $(off_twap_bps) bp from the TWAP at start; instantDeploy=$(call "$V" 'instantDeploy()(bool)'), depositCap=$(call "$V" 'depositCap()(uint256)')"
if [ "$(off_twap_bps)" -gt 5 ]; then settle; fi
chk "spot is within the 10 bp band of the TWAP before the first deposit" "$(off_twap_bps) <= 5"
fi
PRE=$(cast rpc evm_snapshot -r "$R" | tr -d '"')   # the demo starts from here: a fork that no earlier step has touched
pass

if [ "$ONLY" != demo ]; then
# ---------------------------------------------------------------- 01 fund the fresh user
step 01-fund-fresh-user
chk "user starts with no vault shares" "$(bal "$V" "$USER") == 0"
fund_nvda "$USER" 100000000000000000000   # 100 NVDA
fund_usdg "$USER" 50000000000             # 50,000 USDG
chk "user NVDA balance is 100e18" "$(bal "$NVDA" "$USER") == 100000000000000000000"
chk "user USDG balance is 50,000e6" "$(bal "$USDG" "$USER") == 50000000000"
pass

# ---------------------------------------------------------------- 02 ERC-4626 deposit
step 02-erc4626-deposit
AMT=20000000000000000000   # 20 NVDA
sh0=$(bal "$V" "$USER"); ta0=$(call "$V" 'totalAssets()(uint256)'); liq0=$(liquidity)
prev=$(call "$V" 'previewDeposit(uint256)(uint256)' $AMT)
send "$USER" "$NVDA" 'approve(address,uint256)' "$V" $AMT >/dev/null
rc=$(send "$USER" "$V" 'deposit(uint256,address)(uint256)' $AMT "$USER")
sh1=$(bal "$V" "$USER"); ta1=$(call "$V" 'totalAssets()(uint256)'); liq1=$(liquidity)
dsh=$(py "$sh1 - $sh0")
ev=$(evdata "$rc" "$V" 'Deposit(address,address,uint256,uint256)'); [ -n "$ev" ] || die "no Deposit event"
chk "Deposit.assets is the deposit" "$(word "${ev#*|}" 0) == $AMT"
chk "Deposit.shares equals the share balance delta" "$(word "${ev#*|}" 1) == $dsh"
chk "instantDeploy is off (factory vaults start with it off: the deposit waits idle for the keeper)" "'$(call "$V" 'instantDeploy()(bool)')' == 'false'"
chk "shares minted equal previewDeposit to the wei (entry fee included)" "$dsh == $prev"
chk "20 NVDA mints about 20 whole shares at 24 decimals" "abs($dsh - 20 * 10**24) * 100 <= 20 * 10**24"
chk "user NVDA fell by the deposit" "$(bal "$NVDA" "$USER") == 100000000000000000000 - $AMT"
chk "totalAssets grew by about the deposit (+-1%)" "abs(($ta1 - $ta0) - $AMT) * 100 <= $AMT"
chk "position liquidity unchanged (idle until the next rebalance)" "$liq1 == $liq0"
SH_STEP2=$dsh
pass

step 02b-deposit-above-cap-reverts
room=$(call "$V" 'maxDeposit(address)(uint256)' "$USER")
chk "room under the cap is positive and finite" "$room > 0 and $room < 10**30"
fund_nvda "$USER" $(py "$room * 2")
rd=$(revdata "$USER" "$V" 'deposit(uint256,address)(uint256)' "$(py "$room + 1")" "$USER")
chk "deposit one wei above maxDeposit reverts with the ERC-4626 max error" "'${rd:0:10}' == '$(cast sig 'ERC4626ExceededMaxDeposit(address,uint256,uint256)')'"
fund_nvda "$USER" $(py "100 * 10**18 - $AMT")   # back to 100 NVDA less the 20 deposited
chk "user NVDA is again 100 less the deposit" "$(bal "$NVDA" "$USER") == 100 * 10**18 - $AMT"
pass

step 02c-shares-locked-in-the-block-they-are-minted
# A fresh account (no older shares to exit with). Automine off: deposit, redeem and transfer land in ONE block; the vault
# must mint the deposit and refuse both exits. The lock is amount-aware, so an account that already held shares could
# still move those; only the shares minted this block stay put.
fund_nvda "$USER2" 5000000000000000000
chk "USER2 starts with no shares" "$(bal "$V" "$USER2") == 0"
send "$USER2" "$NVDA" 'approve(address,uint256)' "$V" 1000000000000000000 >/dev/null
sh0=$(bal "$V" "$USER2"); n0=$(bal "$NVDA" "$USER2"); tr_before=$(bal "$V" "$TREASURY")
nonce=$(cast nonce "$USER2" -r "$R")
cast rpc anvil_setAutomine false -r "$R" >/dev/null
asend() { cast send --unlocked --from "$USER2" --gas-limit 3000000 --nonce "$1" --async -r "$R" "${@:2}"; }
h1=$(asend "$nonce" "$V" 'deposit(uint256,address)' 1000000000000000000 "$USER2") || die "deposit not accepted into the mempool"
h2=$(asend $((nonce + 1)) "$V" 'redeem(uint256,address,address)' 500000000000000000000000 "$USER2" "$USER2") || die "redeem not accepted"
h3=$(asend $((nonce + 2)) "$V" 'transfer(address,uint256)' "$TREASURY" 500000000000000000000000) || die "transfer not accepted"
cast rpc anvil_mine 1 -r "$R" >/dev/null
cast rpc anvil_setAutomine true -r "$R" >/dev/null
r1=$(cast receipt "$h1" --json -r "$R"); r2=$(cast receipt "$h2" --json -r "$R"); r3=$(cast receipt "$h3" --json -r "$R")
chk "all three txs are in the same block" "$(jq -r .blockNumber <<<"$r1") == $(jq -r .blockNumber <<<"$r2") == $(jq -r .blockNumber <<<"$r3")"
chk "the deposit succeeded" "'$(jq -r .status <<<"$r1")' == '0x1'"
chk "the same-block redeem was refused" "'$(jq -r .status <<<"$r2")' == '0x0'"
chk "the same-block transfer was refused" "'$(jq -r .status <<<"$r3")' == '0x0'"
for h in "$h2" "$h3"; do
  out=$(cast rpc debug_traceTransaction "$h" '{"tracer":"callTracer"}' -r "$R" | jq -r '.output // empty')
  chk "revert of $h is SharesLocked()" "'${out:0:10}' == '$(cast sig 'SharesLocked()')'"
done
dsh=$(py "$(bal "$V" "$USER2") - $sh0")
chk "the deposit minted about one whole share and nothing left the account" "$dsh > 0 and abs($dsh - 10**24) * 100 <= 10**24 and $(bal "$V" "$TREASURY") == $tr_before"
chk "user NVDA fell by exactly the deposit" "$(bal "$NVDA" "$USER2") == $n0 - 10**18"
# next block: the lock is gone
mine
rc=$(send "$USER2" "$V" 'redeem(uint256,address,address)(uint256)' "$dsh" "$USER2" "$USER2")
chk "one block later the same shares redeem" "$(bal "$V" "$USER2") == $sh0"
pass

# ---------------------------------------------------------------- 02d owner changes go through the 24 h queue
step 02d-owner-changes-wait-in-the-queue
SET_ID=$(cast calldata 'setInstantDeploy(bool)' true)
rd=$(revdata "$A0" "$V" 'setInstantDeploy(bool)' true)
chk "the owner cannot call setInstantDeploy directly (ChangeNotQueued)" "'${rd:0:10}' == '$(cast sig 'ChangeNotQueued()')'"
rd=$(revdata "$A0" "$V" 'setKeeper(address)' "$USER")
chk "the owner cannot call setKeeper directly (ChangeNotQueued)" "'${rd:0:10}' == '$(cast sig 'ChangeNotQueued()')'"
rd=$(revdata "$A0" "$V" 'setSpotTwapBand(uint16)' 50)
chk "the owner cannot call setSpotTwapBand directly (ChangeNotQueued)" "'${rd:0:10}' == '$(cast sig 'ChangeNotQueued()')'"
rd=$(revdata "$A0" "$V" 'setTwapOracleBand(uint16)' 40)
chk "the owner cannot call setTwapOracleBand directly (ChangeNotQueued)" "'${rd:0:10}' == '$(cast sig 'ChangeNotQueued()')'"
rd=$(revdata "$A0" "$V" 'setEntryFee(uint24)' 600)
chk "the owner cannot call setEntryFee directly (ChangeNotQueued)" "'${rd:0:10}' == '$(cast sig 'ChangeNotQueued()')'"
rd=$(revdata "$USER" "$V" 'queueChange(bytes)' "$SET_ID")
chk "a stranger cannot queue (OwnableUnauthorizedAccount)" "'${rd:0:10}' == '$(cast sig 'OwnableUnauthorizedAccount(address)')'"
rd=$(revdata "$A0" "$V" 'queueChange(bytes)' "$(cast calldata 'setDepositCap(uint256)' 1)")
chk "the queue accepts only the six timelocked setters (ChangeNotAllowed)" "'${rd:0:10}' == '$(cast sig 'ChangeNotAllowed()')'"
rc=$(send "$A0" "$V" 'queueChange(bytes)' "$SET_ID")
ev=$(evdata "$rc" "$V" 'ChangeQueued(bytes32,uint256,bytes)'); [ -n "$ev" ] || die "no ChangeQueued event"
eta=$(word "${ev#*|}" 0); qts=$(cast block "$(jq -r .blockNumber <<<"$rc" | xargs printf '%d')" --field timestamp -r "$R")
chk "ChangeQueued eta is queue time plus 24 h" "$eta == $qts + 86400"
rd=$(revdata "$A0" "$V" 'executeChange(bytes)' "$SET_ID")
chk "executeChange before the eta reverts ChangeTooEarly(eta)" "'${rd:0:10}' == '$(cast sig 'ChangeTooEarly(uint256)')' and int('${rd:10:64}',16) == $eta"
send "$A0" "$V" 'cancelChange(bytes32)' "$(cast keccak "$SET_ID")" >/dev/null
rd=$(revdata "$A0" "$V" 'executeChange(bytes)' "$SET_ID")
chk "after cancelChange the change is gone (ChangeNotQueued)" "'${rd:0:10}' == '$(cast sig 'ChangeNotQueued()')'"
chk "instantDeploy is still off" "'$(call "$V" 'instantDeploy()(bool)')' == 'false'"
# a queued change that nobody executes expires 7 days after its eta (inside a snapshot: the long warp is undone)
QSNAP=$(cast rpc evm_snapshot -r "$R" | tr -d '"')
KEEPER_SET=$(cast calldata 'setKeeper(address)' "$USER")
rc=$(send "$A0" "$V" 'queueChange(bytes)' "$KEEPER_SET")
ev=$(evdata "$rc" "$V" 'ChangeQueued(bytes32,uint256,bytes)'); qeta=$(word "${ev#*|}" 0)
warp $((qeta + 7 * 86400 + 1))
rd=$(revdata "$A0" "$V" 'executeChange(bytes)' "$KEEPER_SET")
chk "executeChange after eta + 7 days reverts ChangeExpired(eta + 7 days)" "'${rd:0:10}' == '$(cast sig 'ChangeExpired(uint256)')' and int('${rd:10:64}',16) == $qeta + 7 * 86400"
cast rpc evm_revert "$QSNAP" -r "$R" >/dev/null || die "evm_revert of the expiry snapshot failed"
chk "the clock is back before the eta" "$(ts) < $qeta"
pass

# ---------------------------------------------------------------- 03 router: USDG -> shares
step 03-router-deposit-usdg
gate_ready
chk "router has code" "$(cast code "$ROUTER" -r "$R" | wc -c) > 100"
USDG_IN=10000000000   # 10,000 USDG
send "$USER" "$USDG" 'approve(address,uint256)' "$ROUTER" $USDG_IN >/dev/null
quote=$(cast call --from "$USER" "$ROUTER" 'depositUsdg(address,uint256,uint256,address)(uint256)' "$V" $USDG_IN 0 "$USER" -r "$R" | num)
chk "router quote mints shares" "$quote > 0"
MINSH=$(py "$quote * 99 // 100")
sh0=$(bal "$V" "$USER"); u0=$(bal "$USDG" "$USER"); ta0=$(call "$V" 'totalAssets()(uint256)')
rc=$(send "$USER" "$ROUTER" 'depositUsdg(address,uint256,uint256,address)(uint256)' "$V" $USDG_IN "$MINSH" "$USER")
sh1=$(bal "$V" "$USER"); dsh=$(py "$sh1 - $sh0")
ev=$(evdata "$rc" "$V" 'Deposit(address,address,uint256,uint256)'); [ -n "$ev" ] || die "no Deposit event from the vault"
chk "Deposit.receiver is the user" "int('$(echo "${ev%%|*}" | cut -d, -f2)',16) == int('$USER',16)"
chk "Deposit.caller is the router" "int('$(echo "${ev%%|*}" | cut -d, -f1)',16) == int('$ROUTER',16)"
chk "Deposit.shares equals the user share delta" "$(word "${ev#*|}" 1) == $dsh"
chk "shares minted respect minShares" "$dsh >= $MINSH"
chk "shares minted match the quote within 0.5%" "abs($dsh - $quote) * 200 <= $quote"
chk "user USDG fell by exactly the input" "$(bal "$USDG" "$USER") == $u0 - $USDG_IN"
chk "totalAssets grew by about 10,000 USDG of NVDA" "$(call "$V" 'totalAssets()(uint256)') > $ta0"
chk "router holds no USDG" "$(bal "$USDG" "$ROUTER") == 0"
chk "router holds no NVDA" "$(bal "$NVDA" "$ROUTER") == 0"
chk "router leaves no NVDA allowance to the vault" "$(call "$NVDA" 'allowance(address,address)(uint256)' "$ROUTER" "$V") == 0"
chk "router leaves no USDG allowance to the swap router" "$(call "$USDG" 'allowance(address,address)(uint256)' "$ROUTER" "$SWAPROUTER") == 0"
SH_STEP3=$dsh
pass

step 03b-router-minout-reverts
gate_ready
ABSURD=$(py "$quote * 10")
send "$USER" "$USDG" 'approve(address,uint256)' "$ROUTER" $USDG_IN >/dev/null
rd=$(revdata "$USER" "$ROUTER" 'depositUsdg(address,uint256,uint256,address)(uint256)' "$V" $USDG_IN "$ABSURD" "$USER")
chk "revert is InsufficientShares(uint256,uint256)" "'${rd:0:10}' == '$(cast sig 'InsufficientShares(uint256,uint256)')'"
chk "revert carries minShares as the second argument" "int('${rd:74:64}',16) == $ABSURD"
sh0=$(bal "$V" "$USER"); u0=$(bal "$USDG" "$USER")
send_reverts "$USER" "$ROUTER" 'depositUsdg(address,uint256,uint256,address)' "$V" $USDG_IN "$ABSURD" "$USER"
chk "reverted deposit minted no shares" "$(bal "$V" "$USER") == $sh0"
chk "reverted deposit kept the user's USDG" "$(bal "$USDG" "$USER") == $u0"
send "$USER" "$USDG" 'approve(address,uint256)' "$ROUTER" 0 >/dev/null
pass

step 03c-router-refuses-unregistered-vaults
NPM=0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3
send "$USER" "$USDG" 'approve(address,uint256)' "$ROUTER" $USDG_IN >/dev/null
JUNK=0x000000000000000000000000000000000000dEaD
rd=$(revdata "$USER" "$ROUTER" 'depositUsdg(address,uint256,uint256,address)(uint256)' "$JUNK" $USDG_IN 0 "$USER")
chk "depositUsdg on an arbitrary address reverts NotRegisteredVault(address)" "'${rd:0:10}' == '$(cast sig 'NotRegisteredVault(address)')' and int('${rd:10:64}',16) == int('$JUNK',16)"
rd=$(revdata "$USER" "$ROUTER" 'redeemInKindMin(address,uint256,uint256,uint256,address)(uint256,uint256)' "$JUNK" 1 0 0 "$USER")
chk "redeemInKindMin on an arbitrary address reverts NotRegisteredVault(address)" "'${rd:0:10}' == '$(cast sig 'NotRegisteredVault(address)')'"
# a working StockVault of the same build on the same pool, deployed by hand, not by the factory
out=$(cd "$APP/contracts" && forge create src/StockVault.sol:StockVault --unlocked --from "$A0" --broadcast --json --rpc-url "$R" \
  --constructor-args "($NVDA,$USDG,$POOL,$NPM,$SWAPROUTER,$FEED,$A0,$A0,$TREASURY,0)" "(500,1000,100,100,30,90000,600,3600)" "Rogue NVDA" rogue 2>&1) || die "forge create rogue vault failed: $(printf '%s' "$out" | tail -3)"
ROGUE=$(jq -r .deployedTo <<<"$out") || die "no deployedTo in: $out"
chk "the hand-deployed vault has code and a healthy oracle gate (status Ok)" "$(cast code "$ROGUE" -r "$R" | wc -c) > 100 and $(cast call "$ROGUE" 'health()(uint8,uint256,uint256,uint160,uint160,uint160)' -r "$R" | sed -n 1p | num) == 0"
chk "the factory does not list it" "'$(call "$FACTORY" 'isVault(address)(bool)' "$ROGUE")' == 'false'"
rd=$(revdata "$USER" "$ROUTER" 'depositUsdg(address,uint256,uint256,address)(uint256)' "$ROGUE" $USDG_IN 0 "$USER")
chk "the router refuses it: NotRegisteredVault(rogue)" "'${rd:0:10}' == '$(cast sig 'NotRegisteredVault(address)')' and int('${rd:10:64}',16) == int('$ROGUE',16)"
u0=$(bal "$USDG" "$USER")
send_reverts "$USER" "$ROUTER" 'depositUsdg(address,uint256,uint256,address)' "$ROGUE" $USDG_IN 0 "$USER"
chk "the refused deposit left the user's USDG and the router empty" "$(bal "$USDG" "$USER") == $u0 and $(bal "$USDG" "$ROUTER") == 0"
chk "control: the same call on the registered vault is accepted (eth_call)" "$(cast call --from "$USER" "$ROUTER" 'depositUsdg(address,uint256,uint256,address)(uint256)' "$V" $USDG_IN 0 "$USER" -r "$R" | num) > 0"
send "$USER" "$USDG" 'approve(address,uint256)' "$ROUTER" 0 >/dev/null
pass

# ---------------------------------------------------------------- 04 MCP path through the local Worker
step 04-mcp-prepare-deposit
WPORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
( cd "$APP/api" && ./node_modules/.bin/wrangler dev --port "$WPORT" --ip 127.0.0.1 --var NETWORK:robinhood-chain-fork \
    --var "VAULTS:{\"nvda\":\"$V\"}" --var "ROUTER:$ROUTER" >"$TMP/wrangler.log" 2>&1 & echo $! >"$TMP/wrangler.pid" )
up=0
for _ in $(seq 90); do curl -sf -o /dev/null "http://127.0.0.1:$WPORT/vaults" && { up=1; break; }; sleep 1; done
[ $up = 1 ] || die "worker did not start: $(tail -5 "$TMP/wrangler.log")"
mcp() { # tool args-json -> structuredContent JSON; dies on JSON-RPC error or isError
  local body res
  body=$(jq -nc --arg n "$1" --argjson a "$2" '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:$n,arguments:$a}}')
  res=$(curl -sf -X POST "http://127.0.0.1:$WPORT/mcp" -H 'content-type: application/json' -d "$body") || die "worker /mcp unreachable"
  [ "$(jq -r '.result.isError // false' <<<"$res")" = false ] || die "tool $1 returned error: $(jq -c '.result.structuredContent // .error' <<<"$res")"
  jq -c .result.structuredContent <<<"$res"
}
MCP_STOCK=$(mcp prepare_deposit "$(jq -nc --arg r "$USER" '{id:"nvda",amount:"5",receiver:$r}')")
chk "worker is on the fork network" "'$(jq -r .network <<<"$MCP_STOCK")' == 'robinhood-chain-fork'"
chk "stock path returns approve + deposit" "$(jq '.transactions|length' <<<"$MCP_STOCK") == 2"
t0to=$(jq -r '.transactions[0].to' <<<"$MCP_STOCK"); t1to=$(jq -r '.transactions[1].to' <<<"$MCP_STOCK")
t0d=$(jq -r '.transactions[0].data' <<<"$MCP_STOCK"); t1d=$(jq -r '.transactions[1].data' <<<"$MCP_STOCK")
chk "tx0 targets the NVDA token" "'$t0to'.lower() == '$NVDA'.lower()"
chk "tx1 targets the fork vault" "'$t1to'.lower() == '$V'.lower()"
chk "chainId in the prepared tx is 4663" "$(jq '.transactions[0].chainId' <<<"$MCP_STOCK") == 4663"
dec=$(cast calldata-decode 'deposit(uint256,address)' "$t1d"); chk "deposit calldata amount is 5 NVDA" "$(sed -n 1p <<<"$dec" | num) == 5 * 10**18"
chk "deposit calldata receiver is the user" "'$(sed -n 2p <<<"$dec")'.lower() == '$USER'.lower()"
dec=$(cast calldata-decode 'approve(address,uint256)' "$t0d"); chk "approve spender is the vault" "'$(sed -n 1p <<<"$dec")'.lower() == '$V'.lower()"
pass

step 04b-mcp-stock-deposit-lands
gate_ready
sh0=$(bal "$V" "$USER"); n0=$(bal "$NVDA" "$USER")
send "$USER" "$t0to" "$t0d" >/dev/null
prev=$(call "$V" 'previewDeposit(uint256)(uint256)' 5000000000000000000)
rc=$(send "$USER" "$t1to" "$t1d")
dsh=$(py "$(bal "$V" "$USER") - $sh0")
ev=$(evdata "$rc" "$V" 'Deposit(address,address,uint256,uint256)'); [ -n "$ev" ] || die "no Deposit event"
chk "shares minted by the prepared deposit" "$dsh > 0 and $(word "${ev#*|}" 1) == $dsh"
chk "shares minted equal previewDeposit to the wei (entry fee included)" "$dsh == $prev"
chk "5 NVDA mints about 5 whole shares (+-2%: the 35 bp entry fee, and the fees earlier steps left in a vault seeded with \$5K)" "abs($dsh - 5 * 10**24) * 100 <= 2 * 5 * 10**24"
chk "user NVDA fell by 5" "$(bal "$NVDA" "$USER") == $n0 - 5 * 10**18"
SH_STEP4=$dsh
pass

step 04c-mcp-usdg-zap-lands
gate_ready
MCP_USDG=$(mcp prepare_deposit "$(jq -nc --arg r "$USER" '{id:"nvda",amount:"2000",receiver:$r,asset:"usdg"}')")
z0to=$(jq -r '.transactions[0].to' <<<"$MCP_USDG"); z1to=$(jq -r '.transactions[1].to' <<<"$MCP_USDG")
z0d=$(jq -r '.transactions[0].data' <<<"$MCP_USDG"); z1d=$(jq -r '.transactions[1].data' <<<"$MCP_USDG")
chk "tx0 targets USDG" "'$z0to'.lower() == '$USDG'.lower()"
chk "tx1 targets the deployed router" "'$z1to'.lower() == '$ROUTER'.lower()"
dec=$(cast calldata-decode 'depositUsdg(address,uint256,uint256,address)' "$z1d")
chk "zap calldata vault is the fork vault" "'$(sed -n 1p <<<"$dec")'.lower() == '$V'.lower()"
chk "zap calldata amount is 2,000 USDG" "$(sed -n 2p <<<"$dec" | num) == 2000 * 10**6"
chk "zap calldata receiver is the user" "'$(sed -n 4p <<<"$dec")'.lower() == '$USER'.lower()"
sh0=$(bal "$V" "$USER"); u0=$(bal "$USDG" "$USER")
send "$USER" "$z0to" "$z0d" >/dev/null
rc=$(send "$USER" "$z1to" "$z1d")
dsh=$(py "$(bal "$V" "$USER") - $sh0")
chk "shares minted by the prepared zap" "$dsh > 0"
px=$(cast call "$FEED" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' -r "$R" | sed -n 2p | num)
expn=$(py "2000 * 10**6 * 10**26 // ($px * 10**6)")
chk "2,000 USDG zaps into about 2000/price NVDA of shares (within 2% at the oracle price)" "abs($dsh - $expn * 10**6) * 50 <= $expn * 10**6"
chk "user USDG fell by 2,000" "$(bal "$USDG" "$USER") == $u0 - 2000 * 10**6"
chk "router still holds nothing" "$(bal "$USDG" "$ROUTER") == 0 and $(bal "$NVDA" "$ROUTER") == 0"
SH_STEP4B=$dsh
pass

# ---------------------------------------------------------------- 05 swap volume and fee collection
step 05a-swap-volume-both-directions
fund_usdg "$TRADER" 500000000000   # 500,000 USDG
send "$TRADER" "$USDG" 'approve(address,uint256)' "$SWAPROUTER" 500000000000 >/dev/null
send "$TRADER" "$NVDA" 'approve(address,uint256)' "$SWAPROUTER" 1000000000000000000000000 >/dev/null
pps_pre=$(pps); tick0=$(tick)
fg0_0=$(call "$POOL" 'feeGrowthGlobal0X128()(uint256)'); fg1_0=$(call "$POOL" 'feeGrowthGlobal1X128()(uint256)')
ROUNDS=8; CLIP=40000000000   # 8 round trips of 40,000 USDG: 640,000 USDG of volume, both directions
vol_usdg=0
for i in $(seq $ROUNDS); do
  n0=$(bal "$NVDA" "$TRADER")
  swap "$TRADER" "$USDG" "$NVDA" $CLIP
  got=$(py "$(bal "$NVDA" "$TRADER") - $n0")
  chk "buy $i returned NVDA" "$got > 0"
  u0=$(bal "$USDG" "$TRADER")
  swap "$TRADER" "$NVDA" "$USDG" "$got"
  chk "sell $i returned USDG" "$(bal "$USDG" "$TRADER") > $u0"
  vol_usdg=$(py "$vol_usdg + $CLIP")
done
chk "every round trip ran ($ROUNDS x $CLIP USDG)" "$vol_usdg == $ROUNDS * $CLIP and $ROUNDS > 0"
fg0_1=$(call "$POOL" 'feeGrowthGlobal0X128()(uint256)'); fg1_1=$(call "$POOL" 'feeGrowthGlobal1X128()(uint256)')
chk "pool fee growth rose in USDG (USDG-in swaps)" "$fg0_1 > $fg0_0"
chk "pool fee growth rose in NVDA (NVDA-in swaps)" "$fg1_1 > $fg1_0"
chk "round trips left the pool tick within 20 of where it started" "abs($(tick) - $tick0) <= 20"
chk "trader paid fees: USDG ended below the 500,000 start" "$(bal "$USDG" "$TRADER") < 500000000000"
read -r unc_s unc_u < <(uncollected)
chk "vault position has uncollected fees to harvest" "$unc_s > 0 or $unc_u > 0"
chk "vault oracle gate is still Ok after the volume" "$(health) == 0"
pass

step 05b-fees-collected-share-price-held
pps_swaps=$(pps)
sh_user=$(bal "$V" "$USER"); part=$(py "$sh_user // 4")
tr0=$(bal "$V" "$TREASURY"); life0=$(cast call "$V" 'feesEarnedLifetime()(uint256,uint256,uint256)' -r "$R" | sed -n 3p | num)
prev=$(call "$V" 'previewRedeem(uint256)(uint256)' "$part"); n0=$(bal "$NVDA" "$USER")
rc=$(send "$USER" "$V" 'redeem(uint256,address,address)(uint256)' "$part" "$USER" "$USER")
ev=$(evdata "$rc" "$V" 'FeesCollected(uint256,uint256,uint256,uint256)'); [ -n "$ev" ] || die "redeem emitted no FeesCollected"
f0=$(word "${ev#*|}" 0); f1=$(word "${ev#*|}" 1); fv=$(word "${ev#*|}" 2); tsh=$(word "${ev#*|}" 3)
chk "FeesCollected carries fees (USDG leg or NVDA leg)" "$f0 + $f1 > 0 and $fv > 0"
chk "FeesCollected minted the treasury its cut" "$tsh > 0 and $(bal "$V" "$TREASURY") == $tr0 + $tsh"
chk "lifetime fee counter rose" "$(cast call "$V" 'feesEarnedLifetime()(uint256,uint256,uint256)' -r "$R" | sed -n 3p | num) > $life0"
chk "redeem returned at least previewRedeem NVDA" "$(bal "$NVDA" "$USER") - $n0 >= $prev"
chk "redeem burned exactly the shares asked" "$(bal "$V" "$USER") == $sh_user - $part"
pps_post=$(pps)
info "pps before swaps $pps_pre, after swaps (fees uncollected) $pps_swaps, after harvest $pps_post; FeesCollected fees0=$f0 fees1=$f1 value_in_NVDA=$fv treasuryShares=$tsh"
chk "share price after harvest is not below the pre-swap price" "$pps_post >= $pps_pre"
chk "harvest did not dilute holders (post-harvest >= pre-harvest less 1e-9 rounding)" "$pps_post * 10**9 >= $pps_swaps * (10**9 - 1)"
pass

# ---------------------------------------------------------------- 06 a large swap closes deposits and rebalance, the keeper waits, then rebalances
step 06a-spot-off-twap-closes-deposits-and-rebalance
lastreb=$(call "$V" 'lastRebalance()(uint256)'); tok0=$(call "$V" 'tokenId()(uint256)')
minint=$(cast call "$V" 'params()(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)' -r "$R" | sed -n 8p | num)
maxstale=$(cast call "$V" 'params()(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)' -r "$R" | sed -n 6p | num)
fu=$(feedupdated); now=$(ts)
slot=$(NOW_MS=$((now * 1000)) JITTER_SALT="$JSALT" bun -e "import {nextRecentreMs} from '$APP/keeper/src/calendar.ts'; console.log(nextRecentreMs(Number(process.env.NOW_MS), process.env.JITTER_SALT)/1000)")
wend=$(py "$slot - $slot % 86400 + 28800")
chk "next recentre slot is the keeper's jittered minute, inside 02:00 to 07:00 UTC" "$slot % 86400 >= 7200 and $slot % 86400 < 25200"
earliest=$(py "max($slot, $lastreb + $minint)")
target=$(py "$earliest + 600")
chk "warp target plus two TWAP windows is inside the keeper's recentre window, which closes at 08:00 UTC" "$target + 1400 < $wend"
chk "warp target keeps the Chainlink feed inside the vault maxStaleness ($maxstale s) with room for two TWAP windows" "$target + 1400 - $fu < $maxstale"
chk "warp target keeps the feed inside the keeper's 87,000 s guard with the same room" "$target + 1400 - $fu < 87000"
chk "warp moves time forward" "$target > $now"
warp "$target"
chk "vault oracle gate is Ok at the slot (no mock needed)" "$(health) == 0"
chk "no trades for hours: spot sits on the TWAP" "$(off_twap_bps) <= 1"
send "$USER" "$NVDA" 'approve(address,uint256)' "$V" 10000000000000000000 >/dev/null
chk "control: a deposit is accepted now (eth_call)" "$(cast call --from "$USER" "$V" 'deposit(uint256,address)(uint256)' 1000000000000000000 "$USER" -r "$R" | num) > 0"
cast call --from "$A0" "$V" 'rebalance()' -r "$R" >/dev/null 2>&1 || die "control: the keeper's rebalance does not simulate cleanly before the swap"
liq_pre=$(liquidity)
fund_usdg "$TRADER" 2000000000000   # 2,000,000 USDG
fund_nvda "$TRADER" 5000000000000000000000   # 5,000 NVDA
send "$TRADER" "$USDG" 'approve(address,uint256)' "$SWAPROUTER" 2000000000000 >/dev/null
send "$TRADER" "$NVDA" 'approve(address,uint256)' "$SWAPROUTER" 5000000000000000000000 >/dev/null

# The pool and Chainlink are the real market's and can sit 20 bp apart. The keeper holds a scheduled send while the TWAP is over
# 15 bp off the feed (tested below on its own), so walk the pool onto the feed first. NVDA is token1: a spot sqrt above the oracle's
# prices NVDA below the feed, so buy; otherwise sell. Clips are sized from the gap (about 1,500 USDG or 8 NVDA per bp).
hv() { cast call "$V" 'health()(uint8,uint256,uint256,uint160,uint160,uint160)' -r "$R" | sed -n "${1}p" | num; }
g_start=$(off_feed_bps 5); aligns=0
while [ "$(off_feed_bps 6)" -gt 4 ] && [ $aligns -lt 8 ]; do
  gap=$(off_feed_bps 6)
  if [ "$(py "1 if $(hv 6) > $(hv 4) else 0")" = 1 ]; then swap "$TRADER" "$USDG" "$NVDA" $(py "$gap * 1500000000")
  else swap "$TRADER" "$NVDA" "$USDG" $(py "$gap * 8000000000000000000"); fi
  aligns=$((aligns + 1))
done
settle
info "TWAP was $g_start bp off the feed at the slot; $aligns aligning trades, now $(off_feed_bps 5) bp"
chk "the pool sits within 10 bp of Chainlink, so the keeper's 15 bp deferral is not what the next steps exercise" "$(off_feed_bps 5) <= 10"

# (1) the TWAP walks 65 to 95 bp away from Chainlink, inside the 100 bp gate: every path stays open except rebalance
# (TwapOffOracle). Sells of 100 NVDA until the pool is that far from the feed, then one TWAP window with no trades.
FSNAP=$(cast rpc evm_snapshot -r "$R" | tr -d '"')
sells=0
while [ "$(off_feed_bps 6)" -lt 65 ] && [ $sells -lt 40 ]; do swap "$TRADER" "$NVDA" "$USDG" 100000000000000000000; sells=$((sells + 1)); done
settle
FD=$(off_feed_bps 5)
info "$sells sells of 100 NVDA, then a TWAP window: TWAP is $FD bp from Chainlink (rebalance bound 30, gate 100)"
chk "TWAP is between 30 and 100 bp from Chainlink" "$FD > 30 and $FD < 100"
chk "the Chainlink gate is Ok, so only the rebalance bound can refuse (health status 0)" "$(health) == 0"
chk "spot sits on the TWAP, so the spot-to-TWAP band is not what refuses" "$(off_twap_bps) <= 1"
rd=$(revdata "$A0" "$V" 'rebalance()')
chk "the keeper's rebalance reverts TwapOffOracle()" "'${rd:0:10}' == '$(cast sig 'TwapOffOracle()')'"
chk "a deposit is still accepted (eth_call)" "$(cast call --from "$USER" "$V" 'deposit(uint256,address)(uint256)' 1000000000000000000 "$USER" -r "$R" | num) > 0"
kd=$(keeper_dry_nvda)
info "keeper dry run, TWAP $FD bp off the feed: $(jq -c '{action,twap_feed_bps,max_bps}' <<<"$kd" | cut -c1-200)"
chk "the keeper defers its scheduled send while the TWAP is over 15 bp off the feed (dry run, slot assumed due)" "'$(jq -r .action <<<"$kd")' == 'deferred_twap_off_feed'"
cast rpc evm_revert "$FSNAP" -r "$R" >/dev/null || die "evm_revert of the feed-gap snapshot failed"
chk "back at the start of the step: spot on the TWAP" "$(off_twap_bps) <= 1"
G1=$(off_feed_bps 5)
kc=$(keeper_dry_nvda)
info "keeper dry run, TWAP $G1 bp off the feed (start of the step): $(jq -c '{action,twap_feed_bps}' <<<"$kc" | cut -c1-200)"
chk "control: with the TWAP within 15 bp of the feed the same dry run would send" "$G1 <= 10 and '$(jq -r .action <<<"$kc")' == 'dry_run_would_send'"

# (2) a push UP leaves the deposit, the mint and the router zap open (shares are priced at the lowest of feed, TWAP and
# spot, so a high spot cannot make them cheaper); the rebalance still refuses on either side.
USNAP=$(cast rpc evm_snapshot -r "$R" | tr -d '"')
buys=0
while [ "$(off_twap_bps)" -lt 14 ] && [ $buys -lt 6 ]; do swap "$TRADER" "$USDG" "$NVDA" 30000000000; buys=$((buys + 1)); done
info "$buys buys of 30,000 USDG put spot $(off_twap_bps) bp above the TWAP (band is 10 bp)"
chk "spot is more than the 10 bp band above the TWAP" "$(off_twap_bps) > 10 and $buys > 0"
chk "the Chainlink gate is still Ok (health status 0)" "$(health) == 0"
send "$USER" "$USDG" 'approve(address,uint256)' "$ROUTER" 1000000000 >/dev/null
chk "deposit above the TWAP is accepted (eth_call)" "$(cast call --from "$USER" "$V" 'deposit(uint256,address)(uint256)' 1000000000000000000 "$USER" -r "$R" | num) > 0"
chk "mint above the TWAP is accepted (eth_call)" "$(cast call --from "$USER" "$V" 'mint(uint256,address)(uint256)' 1000000000000000000000000 "$USER" -r "$R" | num) > 0"
chk "the router zap above the TWAP is accepted (eth_call)" "$(cast call --from "$USER" "$ROUTER" 'depositUsdg(address,uint256,uint256,address)(uint256)' "$V" 1000000000 0 "$USER" -r "$R" | num) > 0"
rd=$(revdata "$A0" "$V" 'rebalance()')
chk "the keeper's rebalance still reverts SpotOffTwap() above the TWAP" "'${rd:0:10}' == '$(cast sig 'SpotOffTwap()')'"
send "$USER" "$USDG" 'approve(address,uint256)' "$ROUTER" 0 >/dev/null
cast rpc evm_revert "$USNAP" -r "$R" >/dev/null || die "evm_revert of the upward-push snapshot failed"
chk "back at the start of the step: spot on the TWAP" "$(off_twap_bps) <= 1"

# (3) a push DOWN closes deposit, mint, the zap and the rebalance, while the Chainlink gate (100 bp) stays Ok
# Start it from a pool priced about 9 bp above the feed, so that once the TWAP catches up with the pushed spot (about 17 bp lower)
# it sits inside the keeper's 15 bp deferral and step 06b can watch the keeper send.
swap "$TRADER" "$USDG" "$NVDA" 15000000000   # 15,000 USDG
settle
G2=$(off_feed_bps 5)
chk "the TWAP sits within 15 bp of the feed before the push down ($G2 bp)" "$G2 <= 14"
sells=0
while [ "$(off_twap_bps)" -lt 14 ] && [ $sells -lt 6 ]; do swap "$TRADER" "$NVDA" "$USDG" 140000000000000000000; sells=$((sells + 1)); done
OFF=$(off_twap_bps)
info "$sells sells of 140 NVDA put spot $OFF bp below the TWAP (band is 10 bp)"
chk "spot is more than the 10 bp band below the TWAP" "$OFF > 10 and $sells > 0"
chk "the Chainlink gate is still Ok, so only the band can refuse (health status 0)" "$(health) == 0"
sh0=$(bal "$V" "$USER"); n0=$(bal "$NVDA" "$USER")
rd=$(revdata "$USER" "$V" 'deposit(uint256,address)(uint256)' 1000000000000000000 "$USER")
chk "deposit right after the swap reverts SpotOffTwap()" "'${rd:0:10}' == '$(cast sig 'SpotOffTwap()')'"
send_reverts "$USER" "$V" 'deposit(uint256,address)' 1000000000000000000 "$USER"
chk "the refused deposit minted nothing and took no NVDA" "$(bal "$V" "$USER") == $sh0 and $(bal "$NVDA" "$USER") == $n0"
rd=$(revdata "$USER" "$V" 'mint(uint256,address)(uint256)' 1000000000000000000000000 "$USER")
chk "mint right after the swap reverts SpotOffTwap()" "'${rd:0:10}' == '$(cast sig 'SpotOffTwap()')'"
send "$USER" "$USDG" 'approve(address,uint256)' "$ROUTER" 1000000000 >/dev/null
rd=$(revdata "$USER" "$ROUTER" 'depositUsdg(address,uint256,uint256,address)(uint256)' "$V" 1000000000 0 "$USER")
chk "the router zap reverts SpotOffTwap() too (the vault refuses its deposit)" "'${rd:0:10}' == '$(cast sig 'SpotOffTwap()')'"
send "$USER" "$USDG" 'approve(address,uint256)' "$ROUTER" 0 >/dev/null
rd=$(revdata "$A0" "$V" 'rebalance()')
chk "the keeper's rebalance reverts SpotOffTwap()" "'${rd:0:10}' == '$(cast sig 'SpotOffTwap()')'"
chk "control: exits are not gated by the band (redeemInKind eth_call succeeds)" "'$(cast call --from "$USER" "$V" 'redeemInKind(uint256,address,address)(uint256,uint256)' 1000000000000000000000 "$USER" "$USER" -r "$R" | sed -n 1p | num)' != ''"
pass

step 06b-keeper-skips-then-rebalances-once-the-twap-catches-up
B0=$(cast block-number -r "$R")
cat >"$TMP/clock.ts" <<EOF
const off = Number(process.env.FORK_CLOCK_MS) - Date.now();
const real = Date.now.bind(Date);
Date.now = () => real() + off;
EOF
# the keeper reads Date.now() for the schedule while the fork's chain clock sits days behind the wall clock: align them
: >"$TMP/keeper.log"
( cd "$APP/keeper" && RPC_URL="$R" VAULT_ADDRESS_NVDA="$V" VAULT_DEPLOY_BLOCK_NVDA="$(jq -r .vaults.NVDA.deploy_block "$FORK_JSON")" POLL_S=2 \
    VAULT_KEEPER_KEY="$ANVIL0_KEY" KEEPER_JITTER_SALT="$JSALT" FORK_CLOCK_MS=$(( $(ts) * 1000 )) \
    bun --no-env-file --preload "$TMP/clock.ts" src/keeper.ts >"$TMP/keeper.log" 2>&1 & echo $! >"$TMP/keeper.pid" )
kp=$(cat "$TMP/keeper.pid")
nfail=0
for _ in $(seq 90); do
  nfail=$(grep -c '"event":"simulate_failed"' "$TMP/keeper.log" || true)
  [ "$nfail" -ge 2 ] && break
  grep -qE '"event":"(fatal|rebalanced|sent)"' "$TMP/keeper.log" && break
  sleep 1
done
[ "$nfail" -ge 2 ] || die "keeper did not log two simulate_failed ticks while spot was off the TWAP: $(tail -4 "$TMP/keeper.log" | cut -c1-400)"
kill -0 "$kp" 2>/dev/null || die "keeper process died on the SpotOffTwap revert: $(tail -3 "$TMP/keeper.log" | cut -c1-300)"
chk "every simulate_failed line names SpotOffTwap" "$(grep '"event":"simulate_failed"' "$TMP/keeper.log" | grep -c 'SpotOffTwap') == $(grep -c '"event":"simulate_failed"' "$TMP/keeper.log")"
chk "keeper sent nothing while the band was closed" "$(grep -cE '"event":"(sent|rebalanced)"' "$TMP/keeper.log" || true) == 0 and $(call "$V" 'lastRebalance()(uint256)') == $lastreb and $(call "$V" 'tokenId()(uint256)') == $tok0"
info "keeper while closed: $(grep '"event":"simulate_failed"' "$TMP/keeper.log" | head -1 | jq -c '{event,action,error}' | cut -c1-260)"
settle
done_k=0
for _ in $(seq 120); do
  if grep -q '"event":"rebalanced"' "$TMP/keeper.log"; then done_k=1; break; fi
  if grep -qE '"event":"(reverted|fatal)"' "$TMP/keeper.log"; then break; fi
  sleep 1
done
[ $done_k = 1 ] || die "keeper did not rebalance after the TWAP caught up: $(tail -4 "$TMP/keeper.log" | cut -c1-400)"
killtree "$(cat "$TMP/keeper.pid")"; rm -f "$TMP/keeper.pid"
info "keeper $(grep '"event":"simulate_ok"' "$TMP/keeper.log" | head -1 | jq -c '{trigger,note,guards_ok,chainlink_age_s,deviation_bps}')"
khash=$(grep '"event":"rebalanced"' "$TMP/keeper.log" | head -1 | jq -r .hash)
krc=$(cast receipt "$khash" --json -r "$R")
chk "keeper tx mined with status 1" "'$(jq -r .status <<<"$krc")' == '0x1'"
chk "keeper tx was sent by the vault keeper" "'$(jq -r .from <<<"$krc")'.lower() == '$A0'.lower()"
ev=$(evdata "$krc" "$V" 'Rebalanced(int24,int24,uint256,uint256)'); [ -n "$ev" ] || die "keeper tx emitted no Rebalanced event"
chk "exactly one Rebalanced event since the warp" "$(cast logs --from-block $((B0 + 1)) --to-block latest --address "$V" 'Rebalanced(int24,int24,uint256,uint256)' --json -r "$R" | jq length) == 1"
kblock=$(cast block "$(jq -r .blockNumber <<<"$krc" | xargs printf '%d')" --field timestamp -r "$R")
chk "lastRebalance advanced to the keeper tx block time" "$(call "$V" 'lastRebalance()(uint256)') == $kblock and $kblock > $lastreb"
chk "position was re-minted (new tokenId)" "$(call "$V" 'tokenId()(uint256)') != $tok0 and $(call "$V" 'tokenId()(uint256)') != 0"
chk "the rebalance deployed the users' idle deposits (liquidity grew)" "$(liquidity) > $liq_pre"
px=$(cast call "$FEED" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' -r "$R" | sed -n 2p | num)
idle=$(py "$(bal "$NVDA" "$V") + $(bal "$USDG" "$V") * 10**20 // $px")
# what a deploy leaves idle is the balancing swap's price impact times the 150 bp range's sensitivity to it: 3.47% of totalAssets for
# 83 NVDA at this fork block, identical on the pre-round-3 bytecode (git 037c849); a rebalance that deployed nothing leaves about half
chk "idle inventory is under 5% of totalAssets after the deploy" "$idle * 20 < $(call "$V" 'totalAssets()(uint256)')"
rng=$(cast call "$V" 'currentRange()(int24,int24,uint256,uint256)' -r "$R"); lo=$(sed -n 3p <<<"$rng" | num); hi=$(sed -n 4p <<<"$rng" | num)
chk "new range brackets the Chainlink price" "$lo < $px < $hi"
chk "new range is centred on the oracle within 1%" "abs(($lo + $hi) // 2 - $px) * 100 <= $px"
chk "vault oracle gate still Ok" "$(health) == 0"
pass

# ---------------------------------------------------------------- 07 exits
step 07a-redeem-part-via-mcp-calldata
sh_user=$(bal "$V" "$USER"); part=$(py "$sh_user * 40 // 100")
MCP_W=$(mcp prepare_withdraw "$(jq -nc --arg s "$(cast format-units "$part" 24)" --arg r "$USER" '{id:"nvda",shares:$s,receiver:$r}')")
wto=$(jq -r '.transactions[0].to' <<<"$MCP_W"); wd=$(jq -r '.transactions[0].data' <<<"$MCP_W")
chk "withdraw tx targets the vault" "'$wto'.lower() == '$V'.lower()"
dec=$(cast calldata-decode 'redeem(uint256,address,address)' "$wd")
chk "redeem calldata shares match" "$(sed -n 1p <<<"$dec" | num) == $part"
chk "redeem calldata receiver and owner are the user" "'$(sed -n 2p <<<"$dec")'.lower() == '$USER'.lower() and '$(sed -n 3p <<<"$dec")'.lower() == '$USER'.lower()"
prev=$(call "$V" 'previewRedeem(uint256)(uint256)' "$part"); n0=$(bal "$NVDA" "$USER"); u0=$(bal "$USDG" "$USER")
rc=$(send "$USER" "$wto" "$wd")
ev=$(evdata "$rc" "$V" 'Withdraw(address,address,address,uint256,uint256)'); [ -n "$ev" ] || die "no Withdraw event"
dn=$(py "$(bal "$NVDA" "$USER") - $n0")
chk "NVDA returned at least previewRedeem" "$dn >= $prev and $dn > 0"
chk "Withdraw.assets equals the NVDA balance delta" "$(word "${ev#*|}" 0) == $dn"
chk "Withdraw.shares equals the shares asked" "$(word "${ev#*|}" 1) == $part"
chk "shares fell by exactly the redeemed amount" "$(bal "$V" "$USER") == $sh_user - $part"
chk "redeem paid in NVDA only (USDG unchanged)" "$(bal "$USDG" "$USER") == $u0"
pass

step 07b-redeem-in-kind-rest
rest=$(bal "$V" "$USER"); n0=$(bal "$NVDA" "$USER"); u0=$(bal "$USDG" "$USER")
chk "user still holds shares to exit" "$rest > 0"
rc=$(send "$USER" "$V" 'redeemInKind(uint256,address,address)(uint256,uint256)' "$rest" "$USER" "$USER")
ev=$(evdata "$rc" "$V" 'RedeemedInKind(address,address,address,uint256,uint256,uint256,uint256)'); [ -n "$ev" ] || die "no RedeemedInKind event"
so=$(word "${ev#*|}" 1); uo=$(word "${ev#*|}" 2); cr=$(word "${ev#*|}" 3)
chk "RedeemedInKind.shares is everything the user held" "$(word "${ev#*|}" 0) == $rest"
chk "both legs came back (NVDA > 0 and USDG > 0)" "$so > 0 and $uo > 0"
chk "no NVDA was credited to stockOwed" "$cr == 0"
chk "user NVDA balance rose by stockOut" "$(bal "$NVDA" "$USER") - $n0 == $so"
chk "user USDG balance rose by usdgOut" "$(bal "$USDG" "$USER") - $u0 == $uo"
chk "user holds zero shares" "$(bal "$V" "$USER") == 0"
pass

# ---------------------------------------------------------------- 08 stale feed blocks deposits
step 08-stale-feed-deposit-reverts
gate_ready
fund_nvda "$USER" 10000000000000000000; fund_usdg "$USER" 5000000000
send "$USER" "$NVDA" 'approve(address,uint256)' "$V" 1000000000000000000 >/dev/null
send "$USER" "$USDG" 'approve(address,uint256)' "$ROUTER" 1000000000 >/dev/null
fu=$(feedupdated)
chk "control: deposit works while the feed is fresh (eth_call)" "$(cast call --from "$USER" "$V" 'deposit(uint256,address)(uint256)' 1000000000000000000 "$USER" -r "$R" | num) > 0"
warp $((fu + maxstale + 1))
chk "chain time is past maxStaleness" "$(ts) - $fu > $maxstale"
chk "vault health reports FeedStale (2)" "$(health) == 2"
sh0=$(bal "$V" "$USER"); n0=$(bal "$NVDA" "$USER")
rd=$(revdata "$USER" "$V" 'deposit(uint256,address)(uint256)' 1000000000000000000 "$USER")
chk "vault deposit reverts OracleUnhealthy(FeedStale)" "'${rd:0:10}' == '$(cast sig 'OracleUnhealthy(uint8)')' and int('${rd:10:64}',16) == 2"
send_reverts "$USER" "$V" 'deposit(uint256,address)' 1000000000000000000 "$USER"
chk "stale deposit minted nothing and took no NVDA" "$(bal "$V" "$USER") == $sh0 and $(bal "$NVDA" "$USER") == $n0"
rd=$(revdata "$USER" "$ROUTER" 'depositUsdg(address,uint256,uint256,address)(uint256)' "$V" 1000000000 0 "$USER")
chk "router deposit reverts Unhealthy(FeedStale)" "'${rd:0:10}' == '$(cast sig 'Unhealthy(uint8)')' and int('${rd:10:64}',16) == 2"
chk "control: exits are not oracle-gated (redeemInKind eth_call succeeds on the stale feed)" "'$(cast call --from "$A0" "$V" 'redeemInKind(uint256,address,address)(uint256,uint256)' 1000000000000000000000 "$A0" "$A0" -r "$R" | sed -n 1p | num)' != ''"
pass
fi

# ---------------------------------------------------------------- DEMO
# The Morpho demo. One run, one fork: a fresh factory and router, PLTR (Uniswap v4) and AAPL (Uniswap v3) vaults, an UptickShareOracle
# on the AAPL share, a market on the real Morpho Blue singleton, a lender, a borrower using the web app's own call encoding, a 3% pool
# push, a stale feed, a feed drop and a liquidation. Every transaction is logged with its hash and block to $TXLOG (label, hash, block).
MORPHO=0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010
MIRM=0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1
LENDER=0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc      # anvil account 5
LIQUIDATOR=0x976EA74026E726554dB657fA54763abd0C3a0aa9  # anvil account 6
AAPL_CEIL_BPS=9432   # AAPL max LLTV 94.32% (keeper/data/weekend-gaps.json max_lltv_pct: 1 - worst adverse weekend gap 0.68% - 5 pt)
TXLOG="$TMP/fork-txs.tsv"; : >"$TXLOG"
logtx() { printf '%s\t%s\t%s\n' "$1" "$2" "$(cast receipt "$2" blockNumber -r "$R")" >>"$TXLOG"; }
dsend() { local label=$1 rc; shift; rc=$(send "$@"); logtx "$label" "$(jq -r .transactionHash <<<"$rc")"; printf '%s' "$rc"; }
dsend_reverts() { local label=$1 from=$2 out; shift 2
  out=$(cast send --unlocked --from "$from" --gas-limit 3000000 --json -r "$R" "$@" 2>&1) || true
  [ "$(jq -r .status <<<"$out" 2>/dev/null)" = 0x0 ] || die "expected a mined revert for $label, got: $(printf '%s' "$out" | tail -2)"
  logtx "$label (reverts)" "$(jq -r .transactionHash <<<"$out")"; }
fund_tok() { cast rpc anvil_setStorageAt "$1" "$(cast index address "$2" $NVDA_NS)" "$(cast to-uint256 "$3")" -r "$R" >/dev/null; }   # every Stock Token shares the ERC-7201 balance base
d_health() { cast call "$1" 'health()(uint8,uint256,uint256,uint160,uint160,uint160)' -r "$R" | sed -n "${2}p" | num; }   # 1 status 2 price 3 updatedAt 4 oracle 5 twap 6 spot
d_off_twap_bps() { python3 -c "import sys;t,s=map(int,sys.argv[1:]);print(abs(s*s-t*t)*10000//(t*t))" "$(d_health "$1" 5)" "$(d_health "$1" 6)"; }
d_off_feed_bps() { python3 -c "import sys;o,x=map(int,sys.argv[1:]);print(abs(x*x-o*o)*10000//(o*o))" "$(d_health "$1" 4)" "$(d_health "$1" "$2")"; }
d_liq() { cast call "$1" 'positionInfo()((uint256,int24,int24,uint128,uint256,uint256,uint256,uint256,bool))' -r "$R" | tr -d '()' | awk -F', ' '{print $4}' | num; }
d_settle() { warp $(( $(ts) + 700 )); }

# Trades move a pool the way a trader does: through the v3 SwapRouter, or the v4 PoolManager through a minimal swapper.
# d_gap VAULT -> "bp side": distance of pool spot from the Chainlink-implied price, and "buy" when the pool prices the stock below the feed
# (a buyer of the stock, who pays USDG, closes it) or "sell" when above.
d_gap() { python3 -c "
import sys
o,x,t0=map(int,sys.argv[1:4])
bp=abs(x*x-o*o)*10000//(o*o)
over=(x>o)==(t0==1)
print(bp, 'sell' if over else 'buy')" "$(d_health "$1" 4)" "$(d_health "$1" 6)" "$([ "$(call "$1" 'stockIsToken0()(bool)')" = true ] && echo 1 || echo 0)"; }
# d_trade VENUE VAULT STOCK buy|sell USDG_VALUE_RAW: a trade worth that much USDG at the Chainlink price. v4 needs $SWAPPER and $V4KEY.
d_trade() {
  local venue=$1 vlt=$2 tok=$3 dir=$4 usdg_raw=$5 px amt z
  px=$(d_health "$vlt" 2)
  if [ "$dir" = buy ]; then
    if [ "$venue" = v3 ]; then SWAP_LABEL="AAPL pool: trader buys AAPL (walks the pool onto the feed)" swap "$TRADER" "$USDG" "$tok" "$usdg_raw"; else
      z=$([ "$(py "1 if int('$USDG',16) < int('$tok',16) else 0")" = 1 ] && echo true || echo false)
      dsend "PLTR pool: trader buys PLTR (walks the pool onto the feed)" "$TRADER" "$SWAPPER" --gas-limit 3000000 'swap((address,address,uint24,int24,address),bool,uint256)(uint256)' "$V4KEY" "$z" "$usdg_raw" >/dev/null; fi
  else
    amt=$(py "$usdg_raw * 10**20 // $px")
    if [ "$venue" = v3 ]; then SWAP_LABEL="AAPL pool: trader sells AAPL (walks the pool onto the feed)" swap "$TRADER" "$tok" "$USDG" "$amt"; else
      z=$([ "$(py "1 if int('$tok',16) < int('$USDG',16) else 0")" = 1 ] && echo true || echo false)
      dsend "PLTR pool: trader sells PLTR (walks the pool onto the feed)" "$TRADER" "$SWAPPER" --gas-limit 3000000 'swap((address,address,uint24,int24,address),bool,uint256)(uint256)' "$V4KEY" "$z" "$amt" >/dev/null; fi
  fi
}
# d_align VENUE VAULT STOCK: trade until spot is within 4 bp of the Chainlink price; the size of each trade is learned from the move of the last.
d_align() {
  local venue=$1 vlt=$2 tok=$3 it=0 rate=30000000 g0 g1 side0 side1 usd moved
  read -r g0 side0 < <(d_gap "$vlt")
  while [ "$g0" -gt 4 ] && [ $it -lt 16 ]; do
    usd=$(py "max(1000000, int($rate * ($g0 - 1) * 9 // 10))")
    d_trade "$venue" "$vlt" "$tok" "$side0" "$usd"
    read -r g1 side1 < <(d_gap "$vlt")
    moved=$(py "abs($g0 - $g1) if '$side0' == '$side1' else $g0 + $g1")
    [ "$moved" -gt 0 ] && rate=$(py "int($usd / $moved)")
    g0=$g1; side0=$side1; it=$((it + 1))
  done
  [ "$g0" -le 4 ] || die "could not walk the pool onto the feed: $g0 bp after $it trades"
  info "$venue pool walked onto the feed in $it trades ($(py "$rate / 10**6") USD per bp)"
}

# ---------------------------------------------------------------- 10 deploy the factory, the router and both vaults
step 10-deploy-factory-router-and-two-vaults
FORK_BLOCK_N=$(cast rpc anvil_nodeInfo -r "$R" | jq -r '.forkConfig.forkBlockNumber')
chk "the fork has a recorded fork block" "$FORK_BLOCK_N > 0"
node "$APP/scripts/deploy-list.mjs" 2>/dev/null | jq '[.[] | select(.symbol=="PLTR" or .symbol=="AAPL")]' >"$TMP/demo-list.json"
chk "the deploy list holds exactly AAPL (v3) and PLTR (v4)" "$(jq length "$TMP/demo-list.json") == 2 and '$(jq -r 'map(.symbol + ":" + .venue) | sort | join(",")' "$TMP/demo-list.json")' == 'AAPL:v3,PLTR:v4'"
AAPL=$(jq -r '.[] | select(.symbol=="AAPL") | .token' "$TMP/demo-list.json"); PLTR=$(jq -r '.[] | select(.symbol=="PLTR") | .token' "$TMP/demo-list.json")
AAPL_POOL=$(jq -r '.[] | select(.symbol=="AAPL") | .pool' "$TMP/demo-list.json"); AAPL_FEED=$(jq -r '.[] | select(.symbol=="AAPL") | .feed' "$TMP/demo-list.json")
mkdir -p "$APP/contracts/cache"; cp "$TMP/demo-list.json" "$APP/contracts/cache/demo-deploy-list.json"
OUT=$(cd "$APP/contracts" && DEPLOY_LIST=cache/demo-deploy-list.json ANVIL_KEY=$ANVIL0_KEY OWNER=$A0 KEEPER=$A0 TREASURY=$TREASURY MIN_REBALANCE_INTERVAL=3600 \
  forge script script/DeployAll.s.sol --rpc-url "$R" --broadcast 2>&1) || die "DeployAll failed: $(printf '%s' "$OUT" | tail -8)"
DFACTORY=$(echo "$OUT" | awk '$1=="VaultFactory"{print $2}'); DROUTER=$(echo "$OUT" | awk '$1=="UptickRouter"{print $2}')
VA=$(echo "$OUT" | awk '$1=="StockVault" && $2=="AAPL"{print $3}'); VP=$(echo "$OUT" | awk '$1=="StockVaultV4" && $2=="PLTR"{print $3}')
[ -n "$DFACTORY" ] && [ -n "$DROUTER" ] && [ -n "$VA" ] && [ -n "$VP" ] || die "could not parse DeployAll output: $(printf '%s' "$OUT" | tail -8)"
BCAST="$APP/contracts/broadcast/DeployAll.s.sol/4663/run-latest.json"
jq -r '.transactions[] | [(if .transactionType == "CREATE" then "deploy: " + .contractName else .contractName + "." + (.function | split("(")[0]) end), .hash] | @tsv' "$BCAST" | while IFS=$'\t' read -r nm h; do logtx "$nm" "$h"; done
chk "DeployAll logged its deployments, vault creations and settings" "$(wc -l <"$TXLOG") >= 5"
chk "the demo factory has code" "$(cast code "$DFACTORY" -r "$R" | wc -c) > 100"
chk "AAPL vault is registered in the new factory" "'$(call "$DFACTORY" 'isVault(address)(bool)' "$VA")' == 'true'"
chk "PLTR vault is registered in the new factory" "'$(call "$DFACTORY" 'isVault(address)(bool)' "$VP")' == 'true'"
chk "router is bound to the new factory" "'$(call "$DROUTER" 'registry()(address)' | tr A-Z a-z)' == '$(echo "$DFACTORY" | tr A-Z a-z)'"
chk "AAPL vault holds AAPL, PLTR vault holds PLTR" "'$(call "$VA" 'asset()(address)' | tr A-Z a-z)' == '$(echo "$AAPL" | tr A-Z a-z)' and '$(call "$VP" 'asset()(address)' | tr A-Z a-z)' == '$(echo "$PLTR" | tr A-Z a-z)'"
chk "both share tokens have 24 decimals" "$(call "$VA" 'decimals()(uint8)') == 24 and $(call "$VP" 'decimals()(uint8)') == 24"
PLTR_FEE=$(jq -r '.[] | select(.symbol=="PLTR") | .feeTier' "$TMP/demo-list.json"); PLTR_TS=$(jq -r '.[] | select(.symbol=="PLTR") | .tickSpacing' "$TMP/demo-list.json"); PLTR_HOOKS=$(jq -r '.[] | select(.symbol=="PLTR") | .hooks' "$TMP/demo-list.json")
if [ "$(py "1 if int('$USDG',16) < int('$PLTR',16) else 0")" = 1 ]; then V4KEY="($USDG,$PLTR,$PLTR_FEE,$PLTR_TS,$PLTR_HOOKS)"; else V4KEY="($PLTR,$USDG,$PLTR_FEE,$PLTR_TS,$PLTR_HOOKS)"; fi
out=$(cd "$APP/contracts" && forge create test/fixtures/V4Swapper.sol:V4Swapper --unlocked --from "$A0" --broadcast --json --rpc-url "$R" --constructor-args 0x8366a39CC670B4001A1121B8F6A443A643e40951 2>&1) || die "forge create V4Swapper failed: $(printf '%s' "$out" | tail -3)"
SWAPPER=$(jq -r .deployedTo <<<"$out"); logtx "deploy: V4Swapper (trader helper for the PLTR v4 pool)" "$(jq -r .transactionHash <<<"$out")"
fund_usdg "$TRADER" 20000000000000; fund_tok "$AAPL" "$TRADER" 100000000000000000000000; fund_tok "$PLTR" "$TRADER" 100000000000000000000000
dsend "trader approve USDG to the v3 router" "$TRADER" "$USDG" 'approve(address,uint256)' "$SWAPROUTER" 20000000000000 >/dev/null; dsend "trader approve AAPL to the v3 router" "$TRADER" "$AAPL" 'approve(address,uint256)' "$SWAPROUTER" 100000000000000000000000 >/dev/null
dsend "trader approve USDG to the v4 swapper" "$TRADER" "$USDG" 'approve(address,uint256)' "$SWAPPER" 20000000000000 >/dev/null; dsend "trader approve PLTR to the v4 swapper" "$TRADER" "$PLTR" 'approve(address,uint256)' "$SWAPPER" 100000000000000000000000 >/dev/null
info "forked at block $FORK_BLOCK_N; factory $DFACTORY router $DROUTER AAPL vault $VA PLTR vault $VP"
pass

# ---------------------------------------------------------------- 11 seed and rebalance both vaults
step 11-seed-and-rebalance
# A vault may rebalance 3,600 s after it is created. A v4 pool keeps no price history, so the PLTR vault builds its TWAP from the
# observations its keeper writes with poke() every minute: eleven of them span the 600 s window and open its gate.
need=$(py "max($(call "$VA" 'lastRebalance()(uint256)'), $(call "$VP" 'lastRebalance()(uint256)')) + 3600 + 1 - $(ts)")
[ "$need" -le 0 ] || warp $(( $(ts) + need ))
# The pools are the real market's and sit off Chainlink by whatever the market did since the last print. The vault rebalances only with
# the TWAP within 30 bp of the feed, so a trader walks each pool onto the feed first (a v3 TWAP needs one quiet window to follow).
read -r ga sa < <(d_gap "$VA"); read -r gp sp < <(d_gap "$VP")
info "at the fork AAPL spot is $ga bp ($sa side) from Chainlink and PLTR $gp bp ($sp side)"
d_align v3 "$VA" "$AAPL"
warp $(( $(ts) + 700 ))
chk "AAPL TWAP caught up with the aligned pool (within 10 bp of the feed)" "$(d_off_feed_bps "$VA" 5) <= 10"
d_align v4 "$VP" "$PLTR"
chk "PLTR gate is closed before its keeper has observed the pool (TwapUnavailable, status 3)" "$(d_health "$VP" 1) == 3"
VPO=$(call "$VP" 'oracle()(address)')
for i in $(seq 11); do
  warp $(( $(ts) + 60 ))
  chk "poke $i would write an observation" "'$(cast call --from "$A0" "$VP" 'poke()(bool)' -r "$R")' == 'true'"
  dsend "PLTR: keeper poke $i of 11 (TWAP observation)" "$A0" "$VP" 'poke()(bool)' >/dev/null
done
chk "the ring holds eleven observations" "$(call "$VPO" 'count()(uint16)') == 11"
chk "PLTR gate is Ok after eleven minutes of observations (status 0)" "$(d_health "$VP" 1) == 0"
for pair in "AAPL $VA $AAPL" "PLTR $VP $PLTR"; do
  set -- $pair; sym=$1; vlt=$2; tok=$3
  chk "$sym vault gate is Ok (status 0)" "$(d_health "$vlt" 1) == 0"
  chk "$sym spot is within the 10 bp band of its TWAP ($(d_off_twap_bps "$vlt") bp)" "$(d_off_twap_bps "$vlt") <= 8"
  px=$(d_health "$vlt" 2); amt=$(py "5000 * 10**26 // $px")
  fund_tok "$tok" "$A0" $(py "$amt + 10**19")
  dsend "$sym: approve seed" "$A0" "$tok" 'approve(address,uint256)' "$vlt" $amt >/dev/null
  dsend "$sym: seed deposit (5,000 USD of $sym)" "$A0" "$vlt" 'deposit(uint256,address)(uint256)' $amt "$A0" >/dev/null
  chk "$sym seed minted shares" "$(bal "$vlt" "$A0") > 0"
done
for pair in "AAPL $VA" "PLTR $VP"; do
  set -- $pair; sym=$1; vlt=$2
  if ! cast call --from "$A0" "$vlt" 'rebalance()' -r "$R" >/dev/null 2>"$TMP/rb.err"; then die "$sym rebalance does not simulate: $(tr '\n' ' ' <"$TMP/rb.err" | cut -c1-300)"; fi
  dsend "$sym: keeper rebalance (mints the position)" "$A0" "$vlt" 'rebalance()' >/dev/null
  chk "$sym position holds liquidity after the rebalance" "$(d_liq "$vlt") > 0"
done
info "after the rebalance AAPL spot is $(d_off_feed_bps "$VA" 6) bp from Chainlink, PLTR $(d_off_feed_bps "$VP" 6) bp"
pass

# ---------------------------------------------------------------- 12 a user deposits PLTR (v4) and exits in kind
step 12-user-deposits-pltr-v4
# straight after the rebalance, before any quiet window: the v4 TWAP is built from the last eleven minutes of pokes and a gap would reopen TwapUnavailable
fund_tok "$PLTR" "$USER" 100000000000000000000
PL_IN=20000000000000000000   # 20 PLTR
chk "PLTR gate is Ok for the user's deposit" "$(d_health "$VP" 1) == 0"
sh0=$(bal "$VP" "$USER"); prev=$(call "$VP" 'previewDeposit(uint256)(uint256)' $PL_IN)
dsend "PLTR: user approve" "$USER" "$PLTR" 'approve(address,uint256)' "$VP" $PL_IN >/dev/null
rc=$(dsend "PLTR: user deposit 20 PLTR into the v4 vault" "$USER" "$VP" 'deposit(uint256,address)(uint256)' $PL_IN "$USER")
dsh=$(py "$(bal "$VP" "$USER") - $sh0")
ev=$(evdata "$rc" "$VP" 'Deposit(address,address,uint256,uint256)'); [ -n "$ev" ] || die "no Deposit event from the PLTR vault"
chk "Deposit.shares equals the share delta and previewDeposit to the wei" "$(word "${ev#*|}" 1) == $dsh and $dsh == $prev and $dsh > 0"
chk "20 PLTR mints about 20 whole shares at 24 decimals (the 100 bp entry fee on a 1% pool, less the seed's drift)" "abs($dsh - 20 * 10**24) * 100 <= 3 * 20 * 10**24"
chk "the user's PLTR fell by the deposit" "$(bal "$PLTR" "$USER") == 100 * 10**18 - $PL_IN"
rc=$(dsend "PLTR: user redeemInKind of a quarter of the shares" "$USER" "$VP" 'redeemInKind(uint256,address,address)(uint256,uint256)' $(py "$dsh // 4") "$USER" "$USER")
ev=$(evdata "$rc" "$VP" 'RedeemedInKind(address,address,address,uint256,uint256,uint256,uint256)'); [ -n "$ev" ] || die "no RedeemedInKind event from the PLTR vault"
chk "both legs came back from the v4 position (PLTR and USDG)" "$(word "${ev#*|}" 1) > 0 and $(word "${ev#*|}" 2) > 0"
pass

# ---------------------------------------------------------------- 13 the share oracle for the AAPL vault, and one for the PLTR vault
step 13-share-oracles
oracle_of() { local o; o=$(cd "$APP/contracts" && forge create src/UptickShareOracle.sol:UptickShareOracle --unlocked --from "$A0" --broadcast --json --rpc-url "$R" --constructor-args "$DFACTORY" "$1" 2>&1) || die "forge create UptickShareOracle failed: $(printf '%s' "$o" | tail -3)"
  logtx "deploy: UptickShareOracle for the $2 vault" "$(jq -r .transactionHash <<<"$o")"; jq -r .deployedTo <<<"$o"; }
ORA=$(oracle_of "$VA" AAPL); ORP=$(oracle_of "$VP" PLTR)
out=$(cd "$APP/contracts" && forge create test/fixtures/SpotShareOracle.sol:SpotShareOracle --unlocked --from "$A0" --broadcast --json --rpc-url "$R" --constructor-args "$VA" 2>&1) || die "forge create SpotShareOracle failed: $(printf '%s' "$out" | tail -3)"
SPOTORA=$(jq -r .deployedTo <<<"$out"); logtx "deploy: SpotShareOracle (the control: an oracle that reads pool spot)" "$(jq -r .transactionHash <<<"$out")"
if [ "${DEMO_ORACLE:-}" = spot ]; then ORA=$SPOTORA; info "DEMO_ORACLE=spot: the AAPL market uses the spot-reading oracle"; fi   # the must-fail switch: step 17 goes red
chk "the AAPL oracle is wired to the AAPL vault" "'$(call "$ORA" 'vault()(address)' | tr A-Z a-z)' == '$(echo "$VA" | tr A-Z a-z)'"
INIT="$(cd "$APP/contracts" && forge inspect src/UptickShareOracle.sol:UptickShareOracle bytecode 2>/dev/null)$(cast abi-encode 'constructor(address,address)' "$DFACTORY" "$DROUTER" | cut -c3-)"
if out=$(cast call -r "$R" --create "$INIT" 2>&1); then die "the oracle accepted the router as a vault: $out"; fi
rd=$(printf '%s' "$out" | grep -oE '0x[0-9a-fA-F]{8,}' | tail -1 || true)
info "constructor with a non-vault answered: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
chk "the oracle refuses an address the factory did not deploy (NotRegisteredVault)" "'${rd:0:10}' == '$(cast sig 'NotRegisteredVault()')'"
for pair in "AAPL $VA $ORA" "PLTR $VP $ORP"; do
  set -- $pair; sym=$1; vlt=$2; ora=$3
  px=$(d_health "$vlt" 2); op=$(call "$ora" 'price()(uint256)')
  nav=$(py "$(call "$vlt" 'convertToAssets(uint256)(uint256)' 1000000000000000000000000) * $px // 10**20")   # USDG raw of one whole share at Chainlink, from the vault's own NAV
  info "$sym share: oracle price $op (1e36 scale) = $(py "$op / 10**12") USDG raw per whole share; vault NAV at Chainlink $nav"
  chk "$sym oracle price is within 1.5% of the vault's own NAV per share at Chainlink" "abs($op // 10**12 - $nav) * 1000 <= 15 * $nav and $nav > 0"
done
pass

# ---------------------------------------------------------------- 14 a market on the real Morpho Blue singleton
step 14-morpho-market
chk "Morpho Blue has code on the fork" "$(cast code "$MORPHO" -r "$R" | wc -c) > 1000"
chk "the singleton's IRM is enabled" "'$(call "$MORPHO" 'isIrmEnabled(address)(bool)' "$MIRM")' == 'true'"
CEIL=$AAPL_CEIL_BPS
file_ceil=$(jq -r '[.tokens[] | select(.symbol == "AAPL") | .max_lltv_pct * 100 | round][0]' "$APP/keeper/data/weekend-gaps.json")
chk "the price-gap ceiling pinned here equals the one derived in keeper/data/weekend-gaps.json" "$file_ceil == $CEIL"
# 62.5% is the market's LLTV (contracts/SECURITY-REVIEW-ORACLE-2026-10-23.md): the gap ceiling bounds the price only, Morpho's liquidation
# incentive at 62.5% is 12.68% and a position borrowed to the limit leaves bad debt only after a further 29.6% fall of the share.
LLTV_BPS=6250
LLTV=625000000000000000
chk "the market LLTV is 62.5%, enabled on the singleton and under the 94.32% price-gap ceiling" "$LLTV_BPS == 6250 and $LLTV_BPS <= $CEIL and '$(call "$MORPHO" 'isLltvEnabled(uint256)(bool)' "$LLTV")' == 'true'"
MKT="($USDG,$VA,$ORA,$MIRM,$LLTV)"
mplan() { jq -nc --arg v "$VA" --arg u "$USDG" --arg o "$ORA" --arg i "$MIRM" --arg l "$LLTV" '{market:{loanToken:$u,collateralToken:$v,oracle:$o,irm:$i,lltv:$l}}'; }
MID=$(MODE=id PLAN="$(mplan)" bun "$APP/scripts/fork-demo-steps.ts")
chk "market id has the shape of a bytes32" "'${MID:0:2}' == '0x' and ${#MID} == 66"
chk "the market does not exist yet (lastUpdate 0)" "$(cast call "$MORPHO" 'market(bytes32)(uint128,uint128,uint128,uint128,uint128,uint128)' "$MID" -r "$R" | sed -n 5p | num) == 0"
rd=$(revdata "$A0" "$MORPHO" 'createMarket((address,address,address,address,uint256))' "($USDG,$VA,$ORA,$MIRM,900000000000000000)")
chk "an LLTV Morpho has not enabled (90%) is refused with an Error(string)" "'${rd:0:10}' == '0x08c379a0'"
dsend "Morpho: createMarket USDG / AAPL share, UptickShareOracle, LLTV 62.5%" "$A0" "$MORPHO" 'createMarket((address,address,address,address,uint256))' "$MKT" >/dev/null
chk "the market now exists (lastUpdate set)" "$(cast call "$MORPHO" 'market(bytes32)(uint128,uint128,uint128,uint128,uint128,uint128)' "$MID" -r "$R" | sed -n 5p | num) > 0"
mp=$(cast call "$MORPHO" 'idToMarketParams(bytes32)(address,address,address,address,uint256)' "$MID" -r "$R" | num | tr '\n' ' ' | sed 's/ $//')
chk "Morpho stores the five parameters under the id the app derives" "'$(echo "$mp" | tr A-Z a-z)' == '$(echo "$USDG $VA $ORA $MIRM $LLTV" | tr A-Z a-z)'"
rd=$(revdata "$A0" "$MORPHO" 'createMarket((address,address,address,address,uint256))' "$MKT")
chk "creating it twice is refused (Error(string))" "'${rd:0:10}' == '0x08c379a0'"
info "market $MID, LLTV $LLTV_BPS bp (ceiling $CEIL bp)"
pass

# ---------------------------------------------------------------- 15 a lender supplies USDG
step 15-lender-supplies-usdg
SUPPLY=300000000000   # 300,000 USDG
fund_usdg "$LENDER" $SUPPLY
dsend "Morpho: lender approve USDG" "$LENDER" "$USDG" 'approve(address,uint256)' "$MORPHO" $SUPPLY >/dev/null
dsend "Morpho: lender supply 300,000 USDG" "$LENDER" "$MORPHO" 'supply((address,address,address,address,uint256),uint256,uint256,address,bytes)(uint256,uint256)' "$MKT" $SUPPLY 0 "$LENDER" 0x >/dev/null
mk() { cast call "$MORPHO" 'market(bytes32)(uint128,uint128,uint128,uint128,uint128,uint128)' "$MID" -r "$R" | sed -n "${1}p" | num; }
pos() { cast call "$MORPHO" 'position(bytes32,address)(uint256,uint128,uint128)' "$MID" "$1" -r "$R" | sed -n "${2}p" | num; }   # 1 supplyShares 2 borrowShares 3 collateral
chk "the market holds the lender's 300,000 USDG" "$(mk 1) == $SUPPLY and $(mk 3) == 0"
chk "the lender holds supply shares and the lender's wallet is empty" "$(pos "$LENDER" 1) > 0 and $(bal "$USDG" "$LENDER") == 0"
pass

# ---------------------------------------------------------------- 16 a borrower deposits AAPL and borrows, with the web app's own calls
step 16-borrower-earn-and-borrow
warp $(( $(ts) + 700 ))   # the rebalance swapped in the pool: let the TWAP catch up before a deposit
chk "AAPL vault gate is Ok (status 0)" "$(d_health "$VA" 1) == 0"
chk "spot is within the 10 bp band of the TWAP" "$(d_off_twap_bps "$VA") <= 8"
# the vault's deposit cap (the deploy list sizes it from the pool's depth) bounds what a single user can put in: deposit 60% of what it still accepts
AP_IN=$(py "$(call "$VA" 'maxDeposit(address)(uint256)' "$USER") * 60 // 100 // 10**17 * 10**17")
chk "the borrower deposits a non-trivial amount under the cap (at least 10 AAPL)" "$AP_IN >= 10 * 10**18"
fund_tok "$AAPL" "$USER" $(py "$AP_IN + 10**19")
quote=$(call "$VA" 'previewDeposit(uint256)(uint256)' $AP_IN)
collateral=$(py "$quote * 9950 // 10000")   # web/lib/morpho.ts collateralFromQuote: the quote less 50 bp
oprice=$(call "$ORA" 'price()(uint256)')
maxb=$(py "$collateral * $oprice // 10**36 * $LLTV // 10**18")
BORROW=$(py "$maxb * 95 // 100")
chk "the borrow is 95% of the limit and the market has the USDG to lend it" "$BORROW > 0 and $BORROW < $SUPPLY and $BORROW * 100 >= $maxb * 95 - 100"
PLAN=$(jq -nc --arg v "$VA" --arg t "$AAPL" --arg a "$USER" --arg u "$USDG" --arg o "$ORA" --arg i "$MIRM" --arg l "$LLTV" --arg d "$AP_IN" --arg c "$collateral" --arg b "$BORROW" \
  '{symbol:"AAPL",token:$t,vault:$v,account:$a,market:{loanToken:$u,collateralToken:$v,oracle:$o,irm:$i,lltv:$l},deposit:$d,collateral:$c,borrow:$b,tokenAllowance:"0",shareAllowance:"0"}')
STEPS=$(PLAN="$PLAN" bun "$APP/scripts/fork-demo-steps.ts") || die "web/lib/morpho.ts earnAndBorrowSteps failed"
chk "the app's flow is five calls: approve token, deposit, approve shares, supply collateral, borrow" "'$(jq -r 'map(.id) | join(",")' <<<"$STEPS")' == 'approve-token,deposit,approve-shares,supply-collateral,borrow'"
chk "the app sends them as two batches, the deposit alone in the first (the vault locks fresh shares until the next parent-chain block)" "'$(jq -r 'map(.phase) | join(",")' <<<"$STEPS")' == '0,0,1,1,1'"
chk "the supply-collateral and borrow calls target the Morpho singleton" "'$(jq -r '[.[3].to, .[4].to] | map(ascii_downcase) | join(",")' <<<"$STEPS")' == '$(echo "$MORPHO,$MORPHO" | tr A-Z a-z)'"
u0=$(bal "$USDG" "$USER"); a0=$(bal "$AAPL" "$USER")
for i in 0 1 2 3 4; do
  id=$(jq -r ".[$i].id" <<<"$STEPS"); to=$(jq -r ".[$i].to" <<<"$STEPS"); data=$(jq -r ".[$i].data" <<<"$STEPS")
  dsend "AAPL flow $((i + 1))/5: $id" "$USER" "$to" "$data" >/dev/null
done
minted=$(bal "$VA" "$USER")
chk "the deposit minted exactly the previewed shares, all but the 50 bp margin went to Morpho as collateral" "$minted + $collateral == $quote and $(pos "$USER" 3) == $collateral"
chk "the user's AAPL fell by the deposit" "$(bal "$AAPL" "$USER") == $a0 - $AP_IN"
chk "the user received the borrowed USDG" "$(bal "$USDG" "$USER") == $u0 + $BORROW"
debt=$(py "($(pos "$USER" 2) * ($(mk 3) + 1) + ($(mk 4) + 10**6) - 1) // ($(mk 4) + 10**6)")
chk "the position owes the borrow (rounded up by Morpho's virtual shares) and holds the collateral" "$debt >= $BORROW and $debt <= $BORROW + 2"
chk "control: borrowing 6% of the limit more (101% in all) is refused (Error(string): insufficient collateral)" "'$(revdata "$USER" "$MORPHO" 'borrow((address,address,address,address,uint256),uint256,uint256,address,address)' "$MKT" $(py "$maxb * 6 // 100") 0 "$USER" "$USER" | cut -c1-10)' == '0x08c379a0'"
info "$(py "$AP_IN / 10**18") AAPL deposited, $collateral share units posted, $(py "$BORROW / 10**6") USDG borrowed against a limit of $(py "$maxb / 10**6") at LLTV $LLTV_BPS bp"
pass

# ---------------------------------------------------------------- 17 a 3% push of the AAPL pool leaves the oracle where it was
step 17-pool-push-oracle-holds
# The market's oracle is $ORA. SpotShareOracle (a fixture) is the control: the same push, the same vault, an oracle that reads spot.
LTV_OK() { python3 -c "import sys;d,c,p,l=map(int,sys.argv[1:]);sys.exit(0 if d <= c*p//10**36*l//10**18 else 1)" "$debt" "$collateral" "$1" "$LLTV"; }
LTV_OK "$(call "$ORA" 'price()(uint256)')" || die "the borrower is not healthy before the push"
P_BEFORE=$(call "$ORA" 'price()(uint256)'); S_BEFORE=$(call "$SPOTORA" 'price()(uint256)'); SUP=$(call "$VA" 'totalSupply()(uint256)')
VAL_BEFORE=$(py "$P_BEFORE * ($SUP + 10**6) // 10**36")   # the vault's holdings in USDG raw units, as the oracle values them
SPOT0=$(d_health "$VA" 6); STK0=$([ "$(call "$VA" 'stockIsToken0()(bool)')" = true ] && echo 1 || echo 0)
moved_bp() { python3 -c "import sys;s0,s1,t=map(int,sys.argv[1:]);m=(s1*s1)/(s0*s0) if t==1 else (s0*s0)/(s1*s1);print(int(round((m-1)*10000)))" "$SPOT0" "$(d_health "$VA" 6)" "$STK0"; }   # stock price in the pool, bp above its start
# The pool is thin on this side (about 20,000 USDG moves it 3.4%, and the depth falls off a cliff past that), so buy in 1,000 USDG clips
# until the pool prices AAPL 3% higher: the last clip moves it by about 35 bp at most, which lands inside the 3% to 3.6% window.
VOL=0; mb=0; it=0; CLIP=1000000000
while [ "$mb" -lt 300 ] && [ $it -lt 80 ]; do
  SWAP_GAS=8000000 SWAP_LABEL="AAPL pool: 3% push, buy $((it + 1)) of 1,000 USDG" swap "$TRADER" "$USDG" "$AAPL" "$CLIP"; VOL=$(py "$VOL + $CLIP")
  mb=$(moved_bp); it=$((it + 1))
done
chk "the push moved the pool price of AAPL up by 3% to 3.6% ($mb bp, $it buys, $(py "$VOL / 10**6") USDG)" "$mb >= 300 and $mb <= 360"
chk "the pool now prices AAPL more than 100 bp off Chainlink" "$(d_off_feed_bps "$VA" 6) > 100"
chk "the vault's own gate refuses to price at that spot (status is not Ok)" "$(d_health "$VA" 1) != 0"
P_AFTER=$(call "$ORA" 'price()(uint256)'); S_AFTER=$(call "$SPOTORA" 'price()(uint256)')
DV=$(py "($P_AFTER - $P_BEFORE) * ($SUP + 10**6) // 10**36")          # change of the checked oracle, in USDG raw units
FEE_BOUND=$(py "$VOL * 500 // 10**6")                                  # every USDG of fee the trader paid, the vault's share of it at most
SV=$(py "($S_AFTER - $S_BEFORE) * ($SUP + 10**6) // 10**36")
info "market oracle ($ORA) moved $DV USDG raw on a vault of $VAL_BEFORE (bound: +$FEE_BOUND of fee income, -$(py "$VAL_BEFORE * 2 // 10000") of rounding and TWAP drift); the spot-reading control moved $SV ($(py "round($SV * 10000 / $VAL_BEFORE)") bp)"
chk "the oracle moved by no more than the fee income the push paid, and fell by no more than 2 bp" "$DV <= $FEE_BOUND and $DV * 10000 >= -2 * $VAL_BEFORE"
chk "control: an oracle that reads pool spot moved by more than 50 bp on the same push (so the bound above is able to fail)" "abs($SV) * 10000 >= 50 * $VAL_BEFORE"
LTV_OK "$P_AFTER" || die "the borrower is not healthy after the push"
chk "the borrower is as healthy after the push as before (same oracle price to within the bound)" "abs($P_AFTER - $P_BEFORE) * 10000 <= 2 * $P_BEFORE"
pass

# ---------------------------------------------------------------- 18 a stale feed closes deposits, exits stay open, the oracle keeps answering
step 18-stale-feed
d_fu=$(d_health "$VA" 3); maxstale=$(cast call "$VA" 'params()(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)' -r "$R" | sed -n 6p | num)
fund_tok "$AAPL" "$USER" 10000000000000000000; dsend "AAPL: user approve (stale-feed deposit attempt)" "$USER" "$AAPL" 'approve(address,uint256)' "$VA" 1000000000000000000 >/dev/null
dsend "USDG: user approve to the router (stale-feed zap attempt)" "$USER" "$USDG" 'approve(address,uint256)' "$DROUTER" 1000000000 >/dev/null
chk "control: the feed is fresh, so the gate is not the stale one" "$(d_health "$VA" 1) != 2 and $(py "$(ts) - $d_fu") < $maxstale"
P_FRESH=$(call "$ORA" 'price()(uint256)')
warp $(( d_fu + maxstale + 1 ))
chk "chain time is past maxStaleness ($maxstale s) since the last Chainlink print" "$(ts) - $d_fu > $maxstale"
chk "vault health reports FeedStale (2)" "$(d_health "$VA" 1) == 2"
sh0=$(bal "$VA" "$USER"); n0=$(bal "$AAPL" "$USER")
rd=$(revdata "$USER" "$VA" 'deposit(uint256,address)(uint256)' 1000000000000000000 "$USER")
chk "vault deposit reverts OracleUnhealthy(FeedStale)" "'${rd:0:10}' == '$(cast sig 'OracleUnhealthy(uint8)')' and int('${rd:10:64}',16) == 2"
dsend_reverts "AAPL: deposit on a stale feed" "$USER" "$VA" 'deposit(uint256,address)' 1000000000000000000 "$USER"
chk "the refused deposit minted nothing and took no AAPL" "$(bal "$VA" "$USER") == $sh0 and $(bal "$AAPL" "$USER") == $n0"
rd=$(revdata "$USER" "$DROUTER" 'depositUsdg(address,uint256,uint256,address)(uint256)' "$VA" 1000000000 0 "$USER")
chk "the router zap reverts Unhealthy(FeedStale) too" "'${rd:0:10}' == '$(cast sig 'Unhealthy(uint8)')' and int('${rd:10:64}',16) == 2"
a_sh0=$(bal "$VA" "$A0"); a_n0=$(bal "$AAPL" "$A0"); a_u0=$(bal "$USDG" "$A0")
rc=$(dsend "AAPL: redeemInKind on a stale feed" "$A0" "$VA" 'redeemInKind(uint256,address,address)(uint256,uint256)' 1000000000000000000000000 "$A0" "$A0")
chk "redeemInKind still pays out both legs while the feed is stale" "$(bal "$VA" "$A0") == $a_sh0 - 10**24 and $(bal "$AAPL" "$A0") > $a_n0 and $(bal "$USDG" "$A0") > $a_u0"
P_STALE=$(call "$ORA" 'price()(uint256)')
chk "the share oracle keeps answering at the last print while the vault is closed (age under its 97 h bound)" "$(ts) - $d_fu < $(call "$ORA" 'MAX_FEED_AGE()(uint256)') and abs($P_STALE - $P_FRESH) * 1000 <= 5 * $P_FRESH"
pass

# ---------------------------------------------------------------- 19 a new round at a lower price, then a liquidation
step 19-feed-drop-and-liquidation
FEEDDROP_BPS=1200
liq_call() { cast call --from "$LIQUIDATOR" "$MORPHO" 'liquidate((address,address,address,address,uint256),address,uint256,uint256,bytes)(uint256,uint256)' "$MKT" "$USER" "$1" 0 0x -r "$R" 2>&1; }
SEIZE=$(py "$(pos "$USER" 3) // 2")
fund_usdg "$LIQUIDATOR" 100000000000
dsend "USDG: liquidator approve to Morpho" "$LIQUIDATOR" "$USDG" 'approve(address,uint256)' "$MORPHO" 100000000000 >/dev/null
out=$(liq_call "$SEIZE") && die "control: a healthy position was liquidated: $out"
chk "control: before the drop the liquidation is refused (Error(string): position is healthy)" "'$(printf '%s' "$out" | grep -oE '0x08c379a0[0-9a-f]*' | head -1 | cut -c1-10)' == '0x08c379a0'"
read -r rid rans rstart rupd rans2 <<<"$(cast call "$AAPL_FEED" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' -r "$R" | awk '{print $1}' | tr '\n' ' ')"
NEWANS=$(py "$rans * (10000 - $FEEDDROP_BPS) // 10000"); NOW=$(ts)
out=$(cd "$APP/contracts" && forge create test/fixtures/SettableFeed.sol:SettableFeed --unlocked --from "$A0" --broadcast --json --rpc-url "$R" --constructor-args 8 $((rid + 1)) "$NEWANS" "$NOW" "$NOW" 2>&1) || die "forge create SettableFeed failed: $(printf '%s' "$out" | tail -3)"
MOCK=$(jq -r .deployedTo <<<"$out"); logtx "deploy: SettableFeed (the code anvil_setCode copies over the AAPL feed)" "$(jq -r .transactionHash <<<"$out")"
cast rpc anvil_setCode "$AAPL_FEED" "$(cast code "$MOCK" -r "$R")" -r "$R" >/dev/null
mine
chk "the AAPL feed now answers a new round $((rid + 1)) at $NEWANS ($(py "$FEEDDROP_BPS / 100")% below the last print $rans)" "$(cast call "$AAPL_FEED" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' -r "$R" | sed -n 2p | num) == $NEWANS"
P_DROP=$(call "$ORA" 'price()(uint256)')
dsend "Morpho: accrueInterest" "$A0" "$MORPHO" 'accrueInterest((address,address,address,address,uint256))' "$MKT" >/dev/null   # the stored totals include the 25 h of interest
debt=$(py "($(pos "$USER" 2) * ($(mk 3) + 1) + ($(mk 4) + 10**6) - 1) // ($(mk 4) + 10**6)")
cval=$(py "$(pos "$USER" 3) * $P_DROP // 10**36")
info "share price fell $(py "round((1 - $P_DROP / $P_FRESH) * 10000)") bp on a $FEEDDROP_BPS bp feed drop; debt $debt against collateral worth $cval at LLTV $LLTV_BPS bp (LTV $(py "round($debt * 10000 / $cval)") bp after the drop, $(py "round($BORROW * 10000 / ($(pos "$USER" 3) * $P_FRESH // 10**36))") bp when borrowed; liquidation threshold $LLTV_BPS bp)"
chk "the position is now over its LLTV" "$debt * 10**18 > $cval * $LLTV"
chk "and the collateral still covers the debt, so there is no bad debt to write off" "$cval > $debt"
c0=$(pos "$USER" 3); b0=$(pos "$USER" 2); lq_u0=$(bal "$USDG" "$LIQUIDATOR")
rc=$(dsend "Morpho: liquidate half of the AAPL-share collateral" "$LIQUIDATOR" "$MORPHO" 'liquidate((address,address,address,address,uint256),address,uint256,uint256,bytes)(uint256,uint256)' "$MKT" "$USER" "$SEIZE" 0 0x)
repaid=$(py "$lq_u0 - $(bal "$USDG" "$LIQUIDATOR")")
chk "the liquidator received exactly the seized shares and the borrower's collateral fell by them" "$(bal "$VA" "$LIQUIDATOR") == $SEIZE and $(pos "$USER" 3) == $c0 - $SEIZE"
chk "the borrower's debt shares fell and the liquidator paid USDG" "$(pos "$USER" 2) < $b0 and $repaid > 0"
bonus_bp=$(py "round(($SEIZE * $P_DROP // 10**36) * 10000 / $repaid) - 10000")
chk "the liquidator's incentive is Morpho's LIF at 62.5% (1 / (1 - 0.3 * 0.375) = 1.1268): between 1,200 and 1,300 bp over the repayment" "$bonus_bp >= 1200 and $bonus_bp <= 1300"
sh_l=$(bal "$VA" "$LIQUIDATOR"); n_l=$(bal "$AAPL" "$LIQUIDATOR"); u_l=$(bal "$USDG" "$LIQUIDATOR")
rc=$(dsend "AAPL: liquidator exits the seized shares with redeemInKind" "$LIQUIDATOR" "$VA" 'redeemInKind(uint256,address,address)(uint256,uint256)' "$SEIZE" "$LIQUIDATOR" "$LIQUIDATOR")
out_val=$(py "($(bal "$AAPL" "$LIQUIDATOR") - $n_l) * $NEWANS // 10**20 + ($(bal "$USDG" "$LIQUIDATOR") - $u_l)")
chk "the liquidator holds no shares after the exit and both legs came back" "$(bal "$VA" "$LIQUIDATOR") == 0 and $(bal "$AAPL" "$LIQUIDATOR") > $n_l and $(bal "$USDG" "$LIQUIDATOR") > $u_l"
info "repaid $(py "$repaid / 10**6") USDG, seized shares exit for $(py "$out_val / 10**6") USDG at the new Chainlink price ($(py "round($out_val * 10000 / $repaid) - 10000") bp over the repayment)"
chk "the seized shares exit for more than the USDG repaid at the new Chainlink price (the incentive covers the exit)" "$out_val > $repaid"
pass

# ---------------------------------------------------------------- 20 past 97 hours the oracle refuses and Morpho freezes
step 20-feed-older-than-97h
warp $(( NOW + $(call "$ORA" 'MAX_FEED_AGE()(uint256)') + 1 ))
rd=$(revdata "$A0" "$ORA" 'price()(uint256)')
chk "the oracle reverts FeedTooOld(updatedAt) once the print is older than 97 h" "'${rd:0:10}' == '$(cast sig 'FeedTooOld(uint256)')' and int('${rd:10:64}',16) == $NOW"
out=$(liq_call "$(py "$(pos "$USER" 3) // 4")") && die "a liquidation went through on a dead oracle: $out"
chk "Morpho cannot liquidate on a dead oracle either (the same revert data comes back)" "'$(printf '%s' "$out" | grep -oE '0x[0-9a-f]{8,}' | tail -1 | cut -c1-10)' == '$(cast sig 'FeedTooOld(uint256)')'"
pass

# ---------------------------------------------------------------- 09 leave the fork as found
step 09-fork-restored
cast rpc evm_revert "$SNAP" -r "$R" >/dev/null || die "evm_revert failed"
SNAP=""
chk "head block is back at the start block" "$(cast block-number -r "$R") == $START_BLOCK"
if [ "$ONLY" != demo ]; then
chk "vault supply is back to its start value" "$(call "$V" 'totalSupply()(uint256)') == $START_SUPPLY"
chk "fresh user holds no USDG again" "$(bal "$USDG" "$USER") == 0"
chk "the hand-deployed vault is gone" "$(cast code "$ROGUE" -r "$R" | wc -c) <= 3"
chk "the factory router is still deployed" "$(cast code "$ROUTER" -r "$R" | wc -c) > 100"
fi
chk "the demo's factory is gone" "$(cast code "$DFACTORY" -r "$R" | wc -c) <= 3"
pass

# ---------------------------------------------------------------- 21 the run's transactions go to docs/FORK-DEMO.md
step 21-fork-demo-doc
DOC="$APP/docs/FORK-DEMO.md"
FORK_TXS="$TMP/fork-txs.tsv" FORK_LOG="$TMP/report.log" FORK_BLOCK_N="$FORK_BLOCK_N" FORK_DOC="$DOC" /usr/bin/python3 - <<'PY'
import os, re
txs = [l.rstrip("\n").split("\t") for l in open(os.environ["FORK_TXS"]) if l.strip()]
log = open(os.environ["FORK_LOG"]).read().splitlines()
res = [l for l in log if l.startswith("PASS 1") or l.startswith("PASS 2") or l.startswith("  info:")]
b = os.environ["FORK_BLOCK_N"]
rows = "\n".join(f"| FORK | {lbl} | {int(blk)} | `{h}` |" for lbl, h, blk in txs)
sec = f"""<!-- fork-demo-txs:start -->
## Morpho demo run: every transaction

`scripts/fork-demo.sh` runs the product end to end on an Anvil fork of Robinhood Chain 4663 taken at block {b}: a fresh VaultFactory and UptickRouter, the PLTR (Uniswap v4) and AAPL (Uniswap v3) vaults, an UptickShareOracle on the AAPL share, a market on the real Morpho Blue singleton `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010`, a lender, a borrower using the app's own call encoding, a 3% pool push, a stale feed, a feed drop and a liquidation. The hashes below exist on that fork only (label FORK), in the order sent, with the block that mined each.

| Network | Step | Block | Hash |
|---|---|---|---|
{rows}

What the run measured:

```
{chr(10).join(res)}
```
<!-- fork-demo-txs:end -->
"""
p = os.environ["FORK_DOC"]
d = open(p).read()
if "<!-- fork-demo-txs:start -->" in d:
    d = re.sub(r"<!-- fork-demo-txs:start -->.*?<!-- fork-demo-txs:end -->\n?", lambda m: sec, d, flags=re.S)
else:
    d = d.rstrip("\n") + "\n\n" + sec
open(p, "w").write(d)
PY
chk "the doc lists every logged transaction with a FORK label" "$(grep -c '^| FORK |' "$DOC") == $(wc -l <"$TXLOG")"
chk "the doc names the fork block" "$(grep -c "taken at block $FORK_BLOCK_N" "$DOC") == 1"
pass
