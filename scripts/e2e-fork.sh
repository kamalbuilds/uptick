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

scrub() { sed -E 's#https?://[^ "]+#<url>#g'; }
report() { echo "$1" >&3; }
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
swap() { # FROM tokenIn tokenOut amountIn -> receipt (fee 500 pool, recipient = FROM)
  send "$1" "$SWAPROUTER" 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))(uint256)' "($2,$3,500,$1,$4,0,0)" >/dev/null
}

# ---------------------------------------------------------------- 00 preflight
[ -f "$FORK_JSON" ] || die "no $FORK_JSON, start scripts/fork-up.sh"
V=$(jq -r '.vaults.NVDA.address // empty' "$FORK_JSON"); ROUTER=$(jq -r '.router // empty' "$FORK_JSON"); FACTORY=$(jq -r '.factory // empty' "$FORK_JSON")
[ -n "$V" ] && [ -n "$ROUTER" ] && [ -n "$FACTORY" ] || die "fork.json lacks vaults.NVDA, router or factory: run scripts/fork-up.sh on the current bytecode"
cast chain-id -r "$R" >"$TMP/cid" 2>&1 || die "no RPC at $R: $(cat "$TMP/cid")"
chk "fork chain id" "$(cat "$TMP/cid") == 4663"
[ "$(cast code "$V" -r "$R" | wc -c)" -gt 100 ] || die "no vault code at $V"
chk "vault share decimals are 24" "$(call "$V" 'decimals()(uint8)') == 24"
chk "NVDA vault is registered in the factory" "'$(call "$FACTORY" 'isVault(address)(bool)' "$V")' == 'true'"
chk "router is bound to that factory" "'$(call "$ROUTER" 'registry()(address)' | tr A-Z a-z)' == '$(echo "$FACTORY" | tr A-Z a-z)'"
chk "router slippageBps is 100" "$(call "$ROUTER" 'slippageBps()(uint256)') == 100"
WANT_CAP=$(node "$APP/scripts/deploy-list.mjs" 2>/dev/null | jq -r '.[] | select(.symbol=="NVDA") | .depositCapTokens')
chk "NVDA depositCap is the deploy-list cap" "$(call "$V" 'depositCap()(uint256)') == $WANT_CAP and $WANT_CAP > 0"
chk "entry fee defaults to the pool fee tier (500 pips = 5 bp)" "$(call "$V" 'entryFee()(uint24)') == 500 and $(call "$V" 'poolFee()(uint24)') == 500"
chk "rebalance TWAP-to-Chainlink bound defaults to 60 bp" "$(call "$V" 'maxTwapOracleBps()(uint16)') == 60"
chk "vault is keyed to anvil account 0" "'$(cast call "$V" 'keeper()(address)' -r "$R" | tr A-Z a-z)' == '$(echo $A0 | tr A-Z a-z)'"
ANVIL0_KEY=$(cast wallet private-key "test test test test test test test test test test test junk") # public Foundry test mnemonic, account 0
SNAP=$(cast rpc evm_snapshot -r "$R" | tr -d '"')
START_BLOCK=$(cast block-number -r "$R")
START_SUPPLY=$(call "$V" 'totalSupply()(uint256)')
T0=$(ts)
warp $((T0 + 1))   # anvil's wall clock can sit behind the head after a restart: pin the chain clock at the head first
chk "chain clock moves forward" "$(ts) == $((T0 + 1))"
echo "  info: spot is $(off_twap_bps) bp from the TWAP at start; instantDeploy=$(call "$V" 'instantDeploy()(bool)'), depositCap=$(call "$V" 'depositCap()(uint256)')" >&3
if [ "$(off_twap_bps)" -gt 5 ]; then settle; fi
chk "spot is within the 10 bp band of the TWAP before the first deposit" "$(off_twap_bps) <= 5"
pass

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
ev=$(evdata "$rc" "$V" 'Deposited(address,address,uint256,uint256,bool)'); [ -n "$ev" ] || die "no Deposited event"
chk "Deposited.assets is the deposit" "$(word "${ev#*|}" 0) == $AMT"
chk "Deposited.shares equals the share balance delta" "$(word "${ev#*|}" 1) == $dsh"
chk "Deposited.deployed is false (factory vaults start with instantDeploy off: the deposit waits idle for the keeper)" "$(word "${ev#*|}" 2) == 0 and '$(call "$V" 'instantDeploy()(bool)')' == 'false'"
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
ev=$(evdata "$rc" "$V" 'Deposited(address,address,uint256,uint256,bool)'); [ -n "$ev" ] || die "no Deposited event from the vault"
chk "Deposited.receiver is the user" "int('$(echo "${ev%%|*}" | cut -d, -f2)',16) == int('$USER',16)"
chk "Deposited.caller is the router" "int('$(echo "${ev%%|*}" | cut -d, -f1)',16) == int('$ROUTER',16)"
chk "Deposited.shares equals the user share delta" "$(word "${ev#*|}" 1) == $dsh"
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
rc=$(send "$USER" "$t1to" "$t1d")
dsh=$(py "$(bal "$V" "$USER") - $sh0")
ev=$(evdata "$rc" "$V" 'Deposited(address,address,uint256,uint256,bool)'); [ -n "$ev" ] || die "no Deposited event"
chk "shares minted by the prepared deposit" "$dsh > 0 and $(word "${ev#*|}" 1) == $dsh"
chk "5 NVDA mints about 5 whole shares" "abs($dsh - 5 * 10**24) * 100 <= 5 * 10**24"
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
echo "  info: pps before swaps $pps_pre, after swaps (fees uncollected) $pps_swaps, after harvest $pps_post; FeesCollected fees0=$f0 fees1=$f1 value_in_NVDA=$fv treasuryShares=$tsh" >&3
chk "share price after harvest is not below the pre-swap price" "$pps_post >= $pps_pre"
chk "harvest did not dilute holders (post-harvest >= pre-harvest less 1e-9 rounding)" "$pps_post * 10**9 >= $pps_swaps * (10**9 - 1)"
pass

# ---------------------------------------------------------------- 06 a large swap closes deposits and rebalance, the keeper waits, then rebalances
step 06a-spot-off-twap-closes-deposits-and-rebalance
lastreb=$(call "$V" 'lastRebalance()(uint256)'); tok0=$(call "$V" 'tokenId()(uint256)')
minint=$(cast call "$V" 'params()(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)' -r "$R" | sed -n 8p | num)
maxstale=$(cast call "$V" 'params()(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)' -r "$R" | sed -n 6p | num)
fu=$(feedupdated); now=$(ts)
slot=$(NOW_MS=$((now * 1000)) bun -e "import {nextRecentreMs} from '$APP/keeper/src/calendar.ts'; console.log(nextRecentreMs(Number(process.env.NOW_MS))/1000)")
chk "next recentre slot is 02:00 UTC" "$slot % 86400 == 7200"
earliest=$(py "max($slot, $lastreb + $minint)")
target=$(py "$earliest + 600")
chk "warp target plus one TWAP window is inside the keeper's 6 h recentre window after the slot" "$target + 700 < $slot + 21600"
chk "warp target keeps the Chainlink feed inside the vault maxStaleness ($maxstale s) with room for the TWAP window" "$target + 700 - $fu < $maxstale"
chk "warp target keeps the feed inside the keeper's 87,000 s guard with the same room" "$target + 700 - $fu < 87000"
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

# (1) the TWAP walks 65 to 95 bp away from Chainlink, inside the 100 bp gate: every path stays open except rebalance
# (TwapOffOracle). Sells of 100 NVDA until the pool is that far from the feed, then one TWAP window with no trades.
FSNAP=$(cast rpc evm_snapshot -r "$R" | tr -d '"')
sells=0
while [ "$(off_feed_bps 6)" -lt 65 ] && [ $sells -lt 40 ]; do swap "$TRADER" "$NVDA" "$USDG" 100000000000000000000; sells=$((sells + 1)); done
settle
FD=$(off_feed_bps 5)
echo "  info: $sells sells of 100 NVDA, then a TWAP window: TWAP is $FD bp from Chainlink (rebalance bound 60, gate 100)" >&3
chk "TWAP is between 60 and 100 bp from Chainlink" "$FD > 60 and $FD < 100"
chk "the Chainlink gate is Ok, so only the rebalance bound can refuse (health status 0)" "$(health) == 0"
chk "spot sits on the TWAP, so the spot-to-TWAP band is not what refuses" "$(off_twap_bps) <= 1"
rd=$(revdata "$A0" "$V" 'rebalance()')
chk "the keeper's rebalance reverts TwapOffOracle()" "'${rd:0:10}' == '$(cast sig 'TwapOffOracle()')'"
chk "a deposit is still accepted (eth_call)" "$(cast call --from "$USER" "$V" 'deposit(uint256,address)(uint256)' 1000000000000000000 "$USER" -r "$R" | num) > 0"
cast rpc evm_revert "$FSNAP" -r "$R" >/dev/null || die "evm_revert of the feed-gap snapshot failed"
chk "back at the start of the step: spot on the TWAP" "$(off_twap_bps) <= 1"

# (2) a push UP leaves the deposit, the mint and the router zap open (shares are priced at the lowest of feed, TWAP and
# spot, so a high spot cannot make them cheaper); the rebalance still refuses on either side.
USNAP=$(cast rpc evm_snapshot -r "$R" | tr -d '"')
buys=0
while [ "$(off_twap_bps)" -lt 14 ] && [ $buys -lt 6 ]; do swap "$TRADER" "$USDG" "$NVDA" 30000000000; buys=$((buys + 1)); done
echo "  info: $buys buys of 30,000 USDG put spot $(off_twap_bps) bp above the TWAP (band is 10 bp)" >&3
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
sells=0
while [ "$(off_twap_bps)" -lt 14 ] && [ $sells -lt 6 ]; do swap "$TRADER" "$NVDA" "$USDG" 140000000000000000000; sells=$((sells + 1)); done
OFF=$(off_twap_bps)
echo "  info: $sells sells of 140 NVDA put spot $OFF bp below the TWAP (band is 10 bp)" >&3
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
    VAULT_KEEPER_KEY="$ANVIL0_KEY" FORK_CLOCK_MS=$(( $(ts) * 1000 )) \
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
echo "  info: keeper while closed: $(grep '"event":"simulate_failed"' "$TMP/keeper.log" | head -1 | jq -c '{event,action,error}' | cut -c1-260)" >&3
settle
done_k=0
for _ in $(seq 120); do
  if grep -q '"event":"rebalanced"' "$TMP/keeper.log"; then done_k=1; break; fi
  if grep -qE '"event":"(reverted|fatal)"' "$TMP/keeper.log"; then break; fi
  sleep 1
done
[ $done_k = 1 ] || die "keeper did not rebalance after the TWAP caught up: $(tail -4 "$TMP/keeper.log" | cut -c1-400)"
killtree "$(cat "$TMP/keeper.pid")"; rm -f "$TMP/keeper.pid"
echo "  info: keeper $(grep '"event":"simulate_ok"' "$TMP/keeper.log" | head -1 | jq -c '{trigger,note,guards_ok,chainlink_age_s,deviation_bps}')" >&3
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
chk "idle inventory is under 2% of totalAssets after the deploy" "$idle * 50 < $(call "$V" 'totalAssets()(uint256)')"
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
ev=$(evdata "$rc" "$V" 'Withdrawn(address,address,address,uint256,uint256)'); [ -n "$ev" ] || die "no Withdrawn event"
dn=$(py "$(bal "$NVDA" "$USER") - $n0")
chk "NVDA returned at least previewRedeem" "$dn >= $prev and $dn > 0"
chk "Withdrawn.assets equals the NVDA balance delta" "$(word "${ev#*|}" 0) == $dn"
chk "Withdrawn.shares equals the shares asked" "$(word "${ev#*|}" 1) == $part"
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

# ---------------------------------------------------------------- 09 leave the fork as found
step 09-fork-restored
cast rpc evm_revert "$SNAP" -r "$R" >/dev/null || die "evm_revert failed"
SNAP=""
chk "head block is back at the start block" "$(cast block-number -r "$R") == $START_BLOCK"
chk "vault supply is back to its start value" "$(call "$V" 'totalSupply()(uint256)') == $START_SUPPLY"
chk "fresh user holds no USDG again" "$(bal "$USDG" "$USER") == 0"
chk "the hand-deployed vault is gone" "$(cast code "$ROGUE" -r "$R" | wc -c) <= 3"
chk "the factory router is still deployed" "$(cast code "$ROUTER" -r "$R" | wc -c) > 100"
pass
