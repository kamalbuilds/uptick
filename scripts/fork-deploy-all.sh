#!/usr/bin/env bash
# Deploys every eligible vault (keeper/data/universe.json, NVDA included) plus the VaultFactory and an UptickRouter bound
# to the factory registry on the local Robinhood Chain fork (scripts/fork-up.sh running on :8545) with
# contracts/script/DeployAll.s.sol, the same script mainnet uses (mainnet passes deploy-list --open-only; the fork keeps all).
# fork-up.sh writes fork.json with the fork block first; tokens that already have a vault in fork.json are skipped.
# Per new vault: warp past minRebalanceInterval, read health(), and only when it is Ok seed it (SEED_USD, default 5000,
# funded with anvil_setStorageAt) and rebalance() once as the keeper. A vault whose gate is not Ok, or whose
# rebalance reverts, is reported with the reason; nothing is mocked.
# Then writes ~/.cache/uptick-fork/fork.json, keeper/.env.local, web/.env.local, verifies every vault with cast
# (code, asset, depositCap, health, deposit + redeemInKind round trip inside evm_snapshot/evm_revert) and dumps state.
# Only anvil account 0 (public Foundry test mnemonic) signs. The upstream RPC is never touched from here.
set -euo pipefail
trap 'echo "fork-deploy-all failed at line $LINENO" >&2' ERR
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1
APP="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HOME/.cache/uptick-fork"; FJ="$DIR/fork.json"
R=http://127.0.0.1:8545
SEED_USD=${SEED_USD:-5000}
MIN_INTERVAL=${FORK_MIN_REBALANCE_S:-3600}   # fork vaults only: 1 h (the contract minimum) instead of mainnet 6 h, so the first keeper rebalance warps ~1 h and the e2e recentre window (next 02:10 UTC slot) stays ahead
A0=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
TREASURY=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
NS=0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00   # OZ ERC-7201 ERC20 base: balance slot = keccak(holder . NS)
STATUS=(Ok FeedInvalid FeedStale TwapUnavailable TwapDeviates SpotDeviates CorporateAction)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
scrub() { sed -E 's#https?://[^ "]+#<url>#g'; }
lc() { tr 'A-Z' 'a-z'; }
call() { cast call "$@" -r $R; }
# decoded revert of vault.rebalance() as the keeper would send it
revert_reason() {
  local d s; d=$(cast call "$1" "rebalance()" --from $A0 -r $R 2>&1 | grep -oE '0x[0-9a-f]{8,}' | tail -1) || true
  [ -n "$d" ] || { echo "(no revert data)"; return; }
  for s in "SwapBelowMinimum(uint256,uint256)" "OracleUnhealthy(uint8)" "SpotOffTwap()" "TooSoon()" "NotKeeper()"; do
    if [ "${d:0:10}" = "$(cast sig "$s")" ]; then echo "$s $(cast decode-error "$d" --sig "$s" | tr '\n' ' ')"; return; fi
  done
  echo "$d"
}
first() { awk '{print $1}'; }
fund() { cast rpc anvil_setStorageAt "$1" "$(cast index address "$A0" $NS)" "$(cast to-uint256 "$2")" -r $R >/dev/null; }

nc -z 127.0.0.1 8545 >/dev/null 2>&1 || { echo "no fork on :8545, run scripts/fork-up.sh" >&2; exit 1; }
[ -f "$FJ" ] || { echo "$FJ missing, run scripts/fork-up.sh first" >&2; exit 1; }
[ "$(cast chain-id -r $R)" = 4663 ] || { echo "not chain 4663" >&2; exit 1; }
K=$(cast wallet private-key "test test test test test test test test test test test junk")  # anvil account 0, public

# ---------------------------------------------------------------- A: deploy the tokens that have no vault yet
# fork.json is the ledger: every vault is written the moment it exists, so an interrupted run resumes at
# seed + rebalance instead of deploying a second factory.
node "$APP/scripts/deploy-list.mjs" "$TMP/all.json"
HAVE=$(jq -r '(.vaults // {})[].address' "$FJ" | while read -r v; do call "$v" "asset()(address)" | lc; done)
jq --arg have "$HAVE" '[.[] | select((.token | ascii_downcase) as $t | ($have | split("\n") | index($t)) | not)]' "$TMP/all.json" > "$TMP/pending.json"
N=$(jq length "$TMP/pending.json"); echo "step: $N token(s) to deploy, $(jq length "$TMP/all.json") eligible"
if [ "$N" -gt 0 ]; then
  mkdir -p "$APP/contracts/cache"; cp "$TMP/pending.json" "$APP/contracts/cache/deploy-list.json"   # forge may only read inside contracts/
  OUT=$(cd "$APP/contracts" && DEPLOY_LIST=cache/deploy-list.json ANVIL_KEY=$K OWNER=$A0 KEEPER=$A0 TREASURY=$TREASURY MIN_REBALANCE_INTERVAL=$MIN_INTERVAL \
    forge script script/DeployAll.s.sol --rpc-url $R --broadcast 2>&1) || { echo "$OUT" | scrub | tail -15 >&2; exit 1; }
  FACTORY=$(echo "$OUT" | awk '$1=="VaultFactory"{print $2}'); ROUTER=$(echo "$OUT" | awk '$1=="UptickRouter"{print $2}')
  [ -n "$FACTORY" ] && [ -n "$ROUTER" ] || { echo "$OUT" | scrub | tail -20 >&2; exit 1; }
  # deploy block of each vault = block of its VaultCreated log on the factory (the system of record; forge's receipts array is not in tx order)
  cast logs --from-block "$(( $(jq -r .fork_block "$FJ") + 1 ))" --to-block latest --address "$FACTORY" -r $R --json 2>/dev/null \
    | jq -r '.[] | select(.topics | length == 4) | [("0x" + .topics[3][26:]), .blockNumber] | @tsv' > "$TMP/created.tsv"
  echo "$OUT" | awk '$1=="StockVault"{print $2"\t"$3}' > "$TMP/new.tsv"
  [ "$(wc -l < "$TMP/new.tsv")" -eq "$N" ] || { echo "parsed $(wc -l < "$TMP/new.tsv") vaults for $N tokens" >&2; exit 1; }
  while IFS=$'\t' read -r SYM V; do
    DB=$(awk -v v="$(echo "$V" | lc)" '$1==v{print $2}' "$TMP/created.tsv"); [ -n "$DB" ] || { echo "no VaultCreated log for $SYM $V" >&2; exit 1; }; DB=$((DB))
    jq --arg s "$SYM" --arg v "$V" --argjson db "$DB" --arg f "$FACTORY" --arg r "$ROUTER" '.factory=$f | .router=$r | .vaults[$s]={address:$v, deploy_block:$db}' "$FJ" > "$TMP/fj" && mv "$TMP/fj" "$FJ"
  done < "$TMP/new.tsv"
  echo "step: deployed factory $FACTORY router $ROUTER, $N vaults recorded in fork.json" >&2
fi

# seed + rebalance every vault fork.json lists without a rebalance outcome. Each step reads the chain first (supply, tokenId),
# so a run that died halfway resumes where the chain stopped instead of depositing twice.
jq -r '(.vaults // {}) | to_entries[] | select(.value.rebalance == null) | .key' "$FJ" > "$TMP/todo.txt"
while read -r SYM; do
  V=$(jq -r --arg s "$SYM" '.vaults[$s].address' "$FJ")
  read -r ST PRICE _ < <(call "$V" "health()(uint8,uint256,uint256,uint160,uint160,uint160)" | first | tr '\n' ' ') || true
  TOK=$(call "$V" "asset()(address)" | first); RB="not attempted (gate ${STATUS[$ST]})"; SEED=$(call "$V" "totalSupply()(uint256)" | first)
  if [ "$ST" = 0 ]; then
    if [ "$SEED" = 0 ]; then
      SW=$(node -e 'console.log((BigInt(process.argv[1])*10n**26n/BigInt(process.argv[2])).toString())' "$SEED_USD" "$PRICE")
      MAXD=$(call "$V" "maxDeposit(address)(uint256)" "$A0" | first)
      SW=$(node -e 'const [a,b]=process.argv.slice(1).map(BigInt);console.log((a<b?a:b).toString())' "$SW" "$MAXD")
      fund "$TOK" "$(node -e 'console.log((BigInt(process.argv[1])+10n**19n).toString())' "$SW")"
      cast send "$TOK" "approve(address,uint256)" "$V" "$SW" --unlocked --from $A0 -r $R >/dev/null
      cast send "$V" "deposit(uint256,address)" "$SW" "$A0" --unlocked --from $A0 -r $R >/dev/null
      SEED=$(call "$V" "totalSupply()(uint256)" | first)
    fi
    if [ "$(call "$V" "tokenId()(uint256)" | first)" != 0 ]; then RB=ok
    else
      # keeper rebalance needs lastRebalance + minRebalanceInterval: warp only that gap, because every warp ages the pinned Chainlink feeds toward maxStaleness
      MI=$(call "$V" "params()(uint16,uint16,uint16,uint16,uint16,uint32,uint32,uint32)" | sed -n 8p | first)
      NEED=$(( $(call "$V" "lastRebalance()(uint256)" | first) + MI + 1 - $(cast block latest --field timestamp -r $R | tail -1) ))
      if [ "$NEED" -gt 0 ]; then cast rpc evm_increaseTime "$NEED" -r $R >/dev/null; cast rpc anvil_mine 1 -r $R >/dev/null; fi
      if cast send "$V" "rebalance()" --unlocked --from $A0 -r $R >/dev/null 2>"$TMP/err"; then RB=ok
      else RB="FAILED send: $(tr '\n' ' ' < "$TMP/err" | scrub | cut -c1-160) | eth_call: $(revert_reason "$V")"; fi
    fi
  fi
  jq --arg s "$SYM" --arg h "${STATUS[$ST]}" --arg seed "$SEED" --arg rb "$RB" '.vaults[$s] += {health:$h, seed_shares:$seed, rebalance:$rb}' "$FJ" > "$TMP/fj" && mv "$TMP/fj" "$FJ"
  echo "step: $SYM $V health=${STATUS[$ST]} shares=$SEED rebalance=$RB tokenId=$(call "$V" "tokenId()(uint256)" | first)" >&2
done < "$TMP/todo.txt"

# ---------------------------------------------------------------- B: env files from fork.json
setenv() { { grep -v "^$2=" "$1" 2>/dev/null || true; echo "$2=$3"; } > "$TMP/env" && cat "$TMP/env" > "$1"; }
KE="$APP/keeper/.env.local"; WE="$APP/web/.env.local"; touch "$KE" "$WE"
while IFS=$'\t' read -r SYM A DB; do
  setenv "$KE" "VAULT_ADDRESS_$SYM" "$A"; setenv "$KE" "VAULT_DEPLOY_BLOCK_$SYM" "$DB"
done < <(jq -r '.vaults | to_entries[] | [.key, .value.address, .value.deploy_block] | @tsv' "$FJ")
setenv "$WE" NEXT_PUBLIC_VAULTS "'$(jq -c '.vaults | map_values(.address)' "$FJ")'"
setenv "$WE" NEXT_PUBLIC_ROUTER "$(jq -r '.router // empty' "$FJ")"
setenv "$WE" NEXT_PUBLIC_VAULT_NVDA "$(jq -r '.vaults.NVDA.address // empty' "$FJ")"   # web/lib/vaults.ts lets this override the map, so a stale value would shadow the new vault

# ---------------------------------------------------------------- C: verify every vault with cast
# Each rebalance swapped in its pool a moment ago: deposits are refused (SpotOffTwap) until the 600 s TWAP has caught up
# with spot, so let one window pass, which also leaves the fork ready for a first deposit.
cast rpc evm_increaseTime 700 -r $R >/dev/null; cast rpc anvil_mine 1 -r $R >/dev/null
SNAP=$(cast rpc evm_snapshot -r $R | tr -d '"')
printf '\n%-6s %-42s %-10s %-24s %-10s %-9s %s\n' SYM VAULT CODE DEPOSIT_CAP HEALTH ROUNDTRIP DETAIL
FAIL=0
while IFS=$'\t' read -r SYM V; do
  TOK=$(jq -r --arg s "$SYM" '.[] | select(.symbol==$s) | .token' "$TMP/all.json")
  WANT=$(jq -r --arg s "$SYM" '.[] | select(.symbol==$s) | .depositCapTokens' "$TMP/all.json")
  CODE=$([ "$(cast code "$V" -r $R | wc -c)" -gt 100 ] && echo yes || echo NO)
  ASSET=$(call "$V" "asset()(address)" | first); CAP=$(call "$V" "depositCap()(uint256)" | first)
  read -r ST PRICE _ < <(call "$V" "health()(uint8,uint256,uint256,uint160,uint160,uint160)" | first | tr '\n' ' ') || true
  OK=PASS; DET=""
  [ "$CODE" = yes ] || OK=FAIL
  [ "$(echo "$ASSET" | lc)" = "$(echo "$TOK" | lc)" ] || { OK=FAIL; DET="asset!=token "; }
  if [ "$CAP" != "$WANT" ]; then OK=FAIL; DET="${DET}cap!=$WANT "; fi
  if [ "$ST" != 0 ]; then OK=SKIP; DET="${DET}gate ${STATUS[$ST]}, no deposit possible"
  else
    B=$(call "$TOK" "balanceOf(address)(uint256)" "$A0" | first)
    fund "$TOK" "$(node -e 'console.log((BigInt(process.argv[1])+10n**18n).toString())' "$B")"
    SH0=$(call "$V" "balanceOf(address)(uint256)" "$A0" | first)
    S0=$(call "$TOK" "balanceOf(address)(uint256)" "$A0" | first); U0=$(call "$USDG" "balanceOf(address)(uint256)" "$A0" | first)
    if cast send "$TOK" "approve(address,uint256)" "$V" 1000000000000000000 --unlocked --from $A0 -r $R >/dev/null 2>&1 \
      && cast send "$V" "deposit(uint256,address)" 1000000000000000000 "$A0" --unlocked --from $A0 -r $R >/dev/null 2>&1; then
      SH=$(node -e 'console.log((BigInt(process.argv[1])-BigInt(process.argv[2])).toString())' "$(call "$V" "balanceOf(address)(uint256)" "$A0" | first)" "$SH0")   # only the shares this deposit minted
      cast send "$V" "redeemInKind(uint256,address,address)" "$SH" "$A0" "$A0" --unlocked --from $A0 -r $R >/dev/null 2>&1 || { OK=FAIL; DET="${DET}redeemInKind reverted "; }
      S1=$(call "$TOK" "balanceOf(address)(uint256)" "$A0" | first); U1=$(call "$USDG" "balanceOf(address)(uint256)" "$A0" | first)
      # value returned / 1 token deposited, both in USD at the Chainlink price, must be within 2%
      RT=$(node -e 'const [s0,s1,u0,u1,p]=process.argv.slice(1).map(BigInt);const back=(s1-s0+10n**18n)*p/10n**18n+(u1-u0)*100n;const dep=p;
        const bps=Number(back*10000n/dep);console.log(bps)' "$S0" "$S1" "$U0" "$U1" "$PRICE")
      DET="${DET}1 token in, $(node -e 'console.log(process.argv[1]/100)' "$RT")% of its value back, shares $SH"
      [ "$RT" -ge 9800 ] && [ "$RT" -le 10200 ] || OK=FAIL
    else OK=FAIL; DET="${DET}deposit reverted"; fi
  fi
  [ "$OK" = FAIL ] && FAIL=1
  printf '%-6s %-42s %-10s %-24s %-10s %-9s %s\n' "$SYM" "$V" "$CODE" "$CAP" "${STATUS[$ST]}" "$OK" "$DET"
done < <(jq -r '.vaults | to_entries[] | [.key, .value.address] | @tsv' "$FJ")
cast rpc evm_revert "$SNAP" -r $R >/dev/null || { echo "evm_revert failed" >&2; exit 1; }
echo "router $(jq -r '.router' "$FJ") code bytes $(( ($(cast code "$(jq -r .router "$FJ")" -r $R | wc -c) - 3) / 2 ))"

# ---------------------------------------------------------------- D: persist the fork state
cast rpc anvil_dumpState -r $R >/dev/null 2>&1 || true
T0=$(date +%s); for _ in $(seq 75); do [ "$(stat -f %m "$DIR/state.json")" -ge "$T0" ] && break; sleep 1; done
[ "$(stat -f %m "$DIR/state.json")" -ge "$T0" ] && echo "state.json rewritten after the deploy" || echo "WARN state.json not rewritten within 75s (anvil --state-interval 60)" >&2
[ "$FAIL" = 0 ] || { echo "round trip FAILED on at least one vault" >&2; exit 1; }
