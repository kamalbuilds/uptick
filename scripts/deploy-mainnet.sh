#!/usr/bin/env bash
# One command to put Uptick on Robinhood Chain mainnet (4663) at a small cap.
#
#   scripts/deploy-mainnet.sh               preflight + simulation against the mainnet RPC, sends nothing
#   scripts/deploy-mainnet.sh --broadcast   the same, then the real deploy, read-back and deployments/4663.json
#
# Scope: the vaults whose evidence gate is "open" in web/lib/vault-universe.json (PLTR on its Uniswap v4 pool, AAPL, GOOGL),
# each capped at SMALL_CAP_USD (default 1000, allowed 250 to 2000), plus the VaultFactory, the UptickRouter, the
# UptickShareOracleFactory (DEPLOY_ORACLE_FACTORY, default true) and one UptickShareOracle per vault through that factory.
# PERF_FEE_BPS stays 0. Owner, keeper and treasury default to the deployer; set OWNER / KEEPER / TREASURY to change them
# (a different OWNER must call acceptOwnership on the factory afterwards).
#
# The key: contracts/.env holds DEPLOYER_KEY=0x... (gitignored). This script sources it inside its own process and hands it
# to forge through the environment: contracts/script/DeployAll.s.sol reads it with vm.envUint, so the key is never on an argv,
# never echoed and never written to a file. Everything printed is scrubbed of the key.
#
# Other env: RPC_URL (default the public mainnet RPC; the chain id must still be 4663), --no-balance-gate (simulate only: report
# the balance shortfall instead of failing on it; refused with --broadcast), FORCE=1 (redeploy although deployments/4663.json exists).
set -euo pipefail
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1
APP="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOYMENTS=${DEPLOYMENTS_FILE:-$APP/deployments/4663.json}   # DEPLOYMENTS_FILE: write the record elsewhere (rehearsals on a local fork)
RPC=${RPC_URL:-https://rpc.mainnet.chain.robinhood.com}
EXPLORER=https://robinhoodchain.blockscout.com
BROADCAST=0; BALANCE_GATE=1
for a in "$@"; do
  case "$a" in
    --broadcast) BROADCAST=1 ;;
    --no-balance-gate) BALANCE_GATE=0 ;;
    *) echo "unknown argument $a" >&2; exit 2 ;;
  esac
done
[ "$BROADCAST" = 0 ] || [ "$BALANCE_GATE" = 1 ] || { echo "--no-balance-gate is for simulation only; refused with --broadcast" >&2; exit 2; }

die() { echo "REFUSED: $*" >&2; exit 1; }
say() { printf '%s\n' "$*" >&2; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
KEYRE='^(0x)?[0-9a-fA-F]{64}$'
scrub() { local t; t=$(cat); [ -z "${KEYBARE:-}" ] || t=${t//$KEYBARE/<key>}; printf '%s\n' "$t"; }
bn() { node -e 'console.log(String(eval(process.argv[1].replace(/\d+/g, "$&n"))))' "$1"; }   # BigInt integer arithmetic: wei overflows bash past 9.2 ETH
eth() { node -e 'const w=BigInt(process.argv[1]);const s=w.toString().padStart(19,"0");console.log(s.slice(0,-18)+"."+s.slice(-18,-6)+" ETH")' "$1" 2>/dev/null; }
call() { cast call "$@" --rpc-url "$RPC"; }
first() { awk '{print $1}'; }
lc() { tr 'A-Z' 'a-z'; }

# ---- 1. scope and caps (checked before the key is even read)
CAP=${SMALL_CAP_USD:-1000}
[[ "$CAP" =~ ^[0-9]+$ ]] || die "SMALL_CAP_USD must be a whole number of USD, got '$CAP'"
[ "$CAP" -ge 250 ] && [ "$CAP" -le 2000 ] || die "SMALL_CAP_USD=$CAP is outside the allowed 250 to 2000; this script only launches small caps"
[ "${PERF_FEE_BPS:-0}" = 0 ] || die "PERF_FEE_BPS stays 0 at launch"

# ---- 2. key: sourced here only, validated by shape, never printed
if [ -z "${DEPLOYER_KEY:-}" ]; then
  [ -f "$APP/contracts/.env" ] || die "no DEPLOYER_KEY in the environment and no contracts/.env; write DEPLOYER_KEY=0x... into contracts/.env"
  set -a; . "$APP/contracts/.env"; set +a
fi
[ -n "${DEPLOYER_KEY:-}" ] || die "contracts/.env has no DEPLOYER_KEY"
[[ "$DEPLOYER_KEY" =~ $KEYRE ]] || die "DEPLOYER_KEY is not 32 bytes of hex"
KEYBARE=${DEPLOYER_KEY#0x}; export DEPLOYER_KEY="0x$KEYBARE"
DEPLOYER=$(node --input-type=module -e '
import { createRequire } from "node:module";
const { privateKeyToAddress } = createRequire(process.argv[1])("viem/accounts");
console.log(privateKeyToAddress(process.env.DEPLOYER_KEY));' "$APP/web/package.json" 2>/dev/null) || die "cannot derive the deployer address (run npm ci in web/)"
export OWNER=${OWNER:-$DEPLOYER} KEEPER=${KEEPER:-$DEPLOYER} TREASURY=${TREASURY:-$DEPLOYER} PERF_FEE_BPS=0
export DEPLOY_ORACLE_FACTORY=${DEPLOY_ORACLE_FACTORY:-true}
say "deployer $DEPLOYER   owner $OWNER   keeper $KEEPER   treasury $TREASURY   cap \$$CAP per vault   oracle factory $DEPLOY_ORACLE_FACTORY"
[ "$BROADCAST" = 0 ] || [ ! -f "$DEPLOYMENTS" ] || [ "${FORCE:-0}" = 1 ] || die "$DEPLOYMENTS exists: this chain is already deployed (FORCE=1 to deploy a second set)"

# ---- 3. chain, balance floor
CID=$(cast chain-id --rpc-url "$RPC" 2>/dev/null) || die "RPC $RPC did not answer"
[ "$CID" = 4663 ] || die "chain id is $CID, not 4663 (Robinhood Chain mainnet)"
BAL=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
GASPRICE=$(cast gas-price --rpc-url "$RPC")
say "chain 4663 ok   balance $(eth "$BAL") ($BAL wei)   gas price $GASPRICE wei"
if [ "$BAL" = 0 ] && [ "$BALANCE_GATE" = 1 ]; then die "deployer $DEPLOYER holds 0 ETH on chain 4663; fund it on Robinhood Chain, then rerun. No simulation was run"; fi

# ---- 4. the open vaults, capped
OPEN=$(jq -r '.vaults[]|select(.gate.state=="open")|.symbol' "$APP/web/lib/vault-universe.json" | sort | paste -sd, -)
[ -n "$OPEN" ] || die "web/lib/vault-universe.json has no open vault"
node "$APP/scripts/deploy-list.mjs" --open-only --only="$OPEN" --cap-usd="$CAP" "$TMP/list.json" 2>"$TMP/err" || { cat "$TMP/err" >&2; die "deploy list failed"; }
N=$(jq length "$TMP/list.json"); [ "$N" -gt 0 ] || die "empty deploy list"
jq -e 'all(.[]; .deployable == true)' "$TMP/list.json" >/dev/null || die "a listed vault is not deployable"
say "open vaults ($N): $(jq -r '[.[]|"\(.symbol) \(.venue) cap $\(.capUsd)"]|join(", ")' "$TMP/list.json")"
mkdir -p "$APP/contracts/cache"; cp "$TMP/list.json" "$APP/contracts/cache/deploy-list-mainnet.json"   # forge may only read inside contracts/

# ---- 5. feeds, pools, effective caps at the live price
NOW=$(cast block latest --field timestamp --rpc-url "$RPC")
STALE=90000   # DeployAll maxStaleness
PM=0x8366a39CC670B4001A1121B8F6A443A643e40951
FEED_NOTE=0
printf '\n%-6s %-5s %-10s %-9s %-10s %-24s %s\n' SYM VENUE FEED_AGE FEED_USD POOL EFFECTIVE_CAP_USD NOTE >&2
while IFS=$'\t' read -r SYM VENUE FEED CAPTOK POOLREF TOKEN; do
  read -r _ ANS _ UPD _ < <(call "$FEED" "latestRoundData()(uint80,int256,uint256,uint256,uint80)" | first | paste -sd' ' -)
  FD=$(call "$FEED" "decimals()(uint8)" | first)
  AGE=$((NOW - UPD)); NOTE=""
  [ "$ANS" -gt 0 ] || die "$SYM feed $FEED answers $ANS"
  if [ "$AGE" -gt "$STALE" ]; then NOTE="feed older than ${STALE}s: market closed, deploy now, deposits open when the feed prints"; FEED_NOTE=1; fi
  if [ "$VENUE" = v4 ]; then
    SLOT=$(cast index bytes32 "$POOLREF" 0x0000000000000000000000000000000000000000000000000000000000000006)
    P0=$(call "$PM" "extsload(bytes32)(bytes32)" "$SLOT" | first); POOLOK=$([ "$P0" != 0x0000000000000000000000000000000000000000000000000000000000000000 ] && echo live || echo MISSING)
  else
    POOLOK=$([ "$(cast code "$POOLREF" --rpc-url "$RPC" | wc -c)" -gt 4 ] && [ "$(call "$POOLREF" "liquidity()(uint128)" | first)" != 0 ] && echo live || echo MISSING)
  fi
  [ "$POOLOK" = live ] || die "$SYM pool $POOLREF does not exist on chain 4663 or holds no liquidity"
  EFF=$(node -e 'const [c,a,d]=process.argv.slice(1).map(BigInt);console.log((c*a/10n**(18n+d)).toString())' "$CAPTOK" "$ANS" "$FD")
  [ "$EFF" -le $((CAP * 125 / 100)) ] || die "$SYM cap is \$$EFF at the live Chainlink price, above 125% of SMALL_CAP_USD=$CAP; refresh keeper/data/universe.json"
  printf '%-6s %-5s %-10s %-9s %-10s %-24s %s\n' "$SYM" "$VENUE" "${AGE}s" "$(node -e 'console.log(Number(process.argv[1])/10**Number(process.argv[2]))' "$ANS" "$FD")" "$POOLOK" "\$$EFF" "$NOTE" >&2
done < <(jq -r '.[]|[.symbol,.venue,.feed,.depositCapTokens,(.poolId // .pool),.token]|@tsv' "$TMP/list.json")
[ "$FEED_NOTE" = 0 ] || say "note: a feed is outside its ${STALE}s bound. The vault gate refuses deposits until the feed prints; the deploy itself is unaffected."

# ---- 6. simulate: the same forge script, no --broadcast, against the mainnet RPC
say $'\nsimulating contracts/script/DeployAll.s.sol ...'
export DEPLOY_LIST=cache/deploy-list-mainnet.json
( cd "$APP/contracts" && forge script script/DeployAll.s.sol --rpc-url "$RPC" 2>&1 ) > "$TMP/sim.txt" || { scrub < "$TMP/sim.txt" | tail -25 >&2; die "simulation failed"; }
GAS=$(sed -nE 's/.*Estimated total gas used for script: ([0-9]+).*/\1/p' "$TMP/sim.txt" | tail -1)
[ -n "$GAS" ] || { scrub < "$TMP/sim.txt" | tail -25 >&2; die "simulation printed no gas estimate"; }
FGP=$(sed -nE 's/.*Estimated gas price: ([0-9.]+) gwei.*/\1/p' "$TMP/sim.txt" | tail -1)   # forge prices the txs at its own estimate; budget for the higher of that and the node's gas price
[ -z "$FGP" ] || GASPRICE=$(node -e 'const a=BigInt(process.argv[1]),b=BigInt(Math.round(Number(process.argv[2])*1e9));console.log(String(a>b?a:b))' "$GASPRICE" "$FGP")
NEED=$(bn "$GAS * $GASPRICE"); REQ=$(bn "$NEED * 3 / 2")
say "simulated gas $GAS   cost at gas price $GASPRICE wei $(eth "$NEED")   required balance (1.5x) $(eth "$REQ")   balance $(eth "$BAL")"
if [ "$(bn "$BAL < $REQ ? 1 : 0")" = 1 ]; then
  SHORT=$(eth "$(bn "$REQ - $BAL")")
  if [ "$BALANCE_GATE" = 0 ]; then say "SHORT by $SHORT (reported, not enforced under --no-balance-gate)"
  else die "balance $(eth "$BAL") is below 1.5x the simulated cost; fund $DEPLOYER with at least $SHORT more"; fi
fi

# creation-code hashes the factory will pin vs the hashes recorded for the reviewed build
for C in StockVault StockVaultV4; do
  GOT=$(awk -v c="$C" '$1==c && $2=="codehash"{print $3}' "$TMP/sim.txt" | tail -1)
  WANT=$(jq -r --arg c "$C" '.[$c]' "$APP/contracts/pinned-hashes.json")
  [ -n "$GOT" ] && [ "$GOT" = "$WANT" ] || die "$C creation-code hash $GOT differs from contracts/pinned-hashes.json ($WANT); the build is not the reviewed one"
  say "$C creation-code hash $GOT matches contracts/pinned-hashes.json"
done
say "preflight and simulation passed"
if [ "$BROADCAST" = 0 ]; then
  say "simulation only. To deploy: scripts/deploy-mainnet.sh --broadcast"; exit 0
fi

# ---- 7. broadcast
say $'\nbroadcasting ...'
( cd "$APP/contracts" && forge script script/DeployAll.s.sol --rpc-url "$RPC" --broadcast --slow 2>&1 ) > "$TMP/run.txt" || { scrub < "$TMP/run.txt" | tail -30 >&2; die "broadcast failed; check contracts/broadcast/DeployAll.s.sol/4663/ before rerunning (forge --resume), do not redeploy blind"; }
RUNJSON="$APP/contracts/broadcast/DeployAll.s.sol/4663/run-latest.json"
[ -f "$RUNJSON" ] || die "no $RUNJSON after broadcast"
logaddr() { awk -v n="$1" '$1==n{print $NF}' "$TMP/run.txt" | tail -1; }
FACTORY=$(logaddr VaultFactory); ROUTER=$(logaddr UptickRouter); OFACT=$(logaddr UptickShareOracleFactory)
[ -n "$FACTORY" ] && [ -n "$ROUTER" ] || die "could not read the factory and router addresses from the forge logs"
# address -> tx hash / block, from the broadcast file (creations by the deployer and by the factories)
jq '(.receipts|map({key:.transactionHash,value:(.blockNumber|if type=="string" then (.[2:]|ascii_downcase|explode|map(if .>=97 then .-87 else .-48 end)|reduce .[] as $d (0;.*16+$d)) else . end)})|from_entries) as $blk
  | [.transactions[] | . as $t | ((if ($t.transactionType|startswith("CREATE")) then [{a:$t.contractAddress}] else [] end) + [($t.additionalContracts // [])[]|{a:.address}])[] | {key:(.a|ascii_downcase),value:{tx:$t.hash,block:$blk[$t.hash]}}] | from_entries' "$RUNJSON" > "$TMP/where.json"

# ---- 8. read back from the chain
say $'\nverifying on chain ...'
FAIL=0
chk() { if [ "$2" = "$3" ]; then printf '  ok   %s\n' "$1" >&2; else printf '  FAIL %s: got %s want %s\n' "$1" "$2" "$3" >&2; FAIL=1; fi; }
hascode() { [ "$(cast code "$1" --rpc-url "$RPC" | wc -c)" -gt 4 ]; }
for A in "$FACTORY" "$ROUTER" ${OFACT:+"$OFACT"}; do hascode "$A" && printf '  ok   code at %s\n' "$A" >&2 || { printf '  FAIL no code at %s\n' "$A" >&2; FAIL=1; }; done
for C in StockVault StockVaultV4; do
  chk "factory pins $C hash" "$(call "$FACTORY" "$([ $C = StockVault ] && echo 'vaultCodeHash()(bytes32)' || echo 'vaultV4CodeHash()(bytes32)')")" "$(jq -r --arg c $C '.[$c]' "$APP/contracts/pinned-hashes.json")"
done
echo '{}' > "$TMP/vaults.json"
while read -r ROW; do
  SYM=$(jq -r .symbol <<<"$ROW"); VENUE=$(jq -r .venue <<<"$ROW")
  KIND=$([ "$VENUE" = v4 ] && echo StockVaultV4 || echo StockVault)
  V=$(awk -v n="$KIND" -v s="$SYM" '$1==n && $2==s{print $3}' "$TMP/run.txt" | tail -1)
  [ -n "$V" ] || { echo "no $KIND $SYM address in the forge logs" >&2; FAIL=1; continue; }
  say "$SYM $V"
  hascode "$V" || { printf '  FAIL no code at %s\n' "$V" >&2; FAIL=1; continue; }
  chk "$SYM isVault" "$(call "$FACTORY" "isVault(address)(bool)" "$V")" true
  chk "$SYM asset" "$(call "$V" "asset()(address)" | lc)" "$(jq -r .token <<<"$ROW" | lc)"
  chk "$SYM depositCap" "$(call "$V" "depositCap()(uint256)" | first)" "$(jq -r .depositCapTokens <<<"$ROW")"
  chk "$SYM owner" "$(call "$V" "owner()(address)" | lc)" "$(echo "$OWNER" | lc)"
  chk "$SYM keeper" "$(call "$V" "keeper()(address)" | lc)" "$(echo "$KEEPER" | lc)"
  chk "$SYM perfFeeBps" "$(call "$V" "params()(uint16,uint16,uint16,uint16,uint16,uint32,uint32,uint32)" | sed -n 2p | first)" 0
  chk "$SYM feed" "$(call "$V" "feed()(address)" | lc)" "$(jq -r .feed <<<"$ROW" | lc)"
  if [ "$VENUE" = v4 ]; then chk "$SYM poolId" "$(call "$V" "poolId()(bytes32)")" "$(jq -r .poolId <<<"$ROW")"
  else chk "$SYM pool" "$(call "$V" "pool()(address)" | lc)" "$(jq -r .pool <<<"$ROW" | lc)"; fi
  O=""
  if [ -n "$OFACT" ]; then
    O=$(awk -v s="$SYM" '$1=="UptickShareOracle" && $2==s{print $3}' "$TMP/run.txt" | tail -1)
    [ -n "$O" ] && hascode "$O" || { printf '  FAIL no oracle code for %s\n' "$SYM" >&2; FAIL=1; }
    chk "$SYM oracle isOracle" "$(call "$OFACT" "isOracle(address)(bool)" "$O")" true
    chk "$SYM oracleOf" "$(call "$OFACT" "oracleOf(address)(address)" "$V" | lc)" "$(echo "$O" | lc)"
  fi
  VL=$(echo "$V" | lc); OL=$(echo "$O" | lc)
  jq --arg s "$SYM" --argjson row "$ROW" --arg v "$V" --arg o "$O" --slurpfile w "$TMP/where.json" --arg vl "$VL" --arg ol "$OL" \
    '.[$s] = ($row | {venue, token, pool, poolId, feed, capUsd, depositCapTokens} | with_entries(select(.value != null)))
      + {address:$v, tx:$w[0][$vl].tx, block:$w[0][$vl].block}
      + (if $o == "" then {} else {oracle:$o, oracleTx:$w[0][$ol].tx} end)' "$TMP/vaults.json" > "$TMP/v2.json" && mv "$TMP/v2.json" "$TMP/vaults.json"
done < <(jq -c '.[]' "$TMP/list.json")
[ "$FAIL" = 0 ] || die "read-back failed: the deployed contracts do not match the plan (see FAIL lines above); deployments/4663.json was NOT written"

# ---- 9. deployments/4663.json
mkdir -p "$(dirname "$DEPLOYMENTS")"
FL=$(echo "$FACTORY" | lc); RL=$(echo "$ROUTER" | lc); OFL=$(echo "$OFACT" | lc)
jq -n --arg deployer "$DEPLOYER" --arg owner "$OWNER" --arg keeper "$KEEPER" --arg treasury "$TREASURY" --argjson cap "$CAP" \
  --arg f "$FACTORY" --arg r "$ROUTER" --arg of "$OFACT" --arg fl "$FL" --arg rl "$RL" --arg ofl "$OFL" \
  --slurpfile w "$TMP/where.json" --slurpfile v "$TMP/vaults.json" --arg at "$(date -u +%FT%TZ)" \
  --slurpfile pin "$APP/contracts/pinned-hashes.json" \
  '{chainId:4663, deployedAt:$at, deployer:$deployer, owner:$owner, keeper:$keeper, treasury:$treasury, perfFeeBps:0, smallCapUsd:$cap,
    creationCodeHashes:$pin[0],
    factory:{address:$f, tx:$w[0][$fl].tx, block:$w[0][$fl].block},
    router:{address:$r, tx:$w[0][$rl].tx, block:$w[0][$rl].block},
    oracleFactory:(if $of == "" then null else {address:$of, tx:$w[0][$ofl].tx, block:$w[0][$ofl].block} end),
    vaults:$v[0]}' > "$DEPLOYMENTS"
jq -e '(.vaults|length) > 0 and (.factory.tx != null) and (.vaults|to_entries|all(.value.tx != null and .value.block != null))' "$DEPLOYMENTS" >/dev/null \
  || die "deployments/4663.json is missing a tx hash or block"

say $'\ndeployed. deployments/4663.json written. Blockscout:'
say "  factory         $EXPLORER/address/$FACTORY"
say "  router          $EXPLORER/address/$ROUTER"
[ -z "$OFACT" ] || say "  oracle factory  $EXPLORER/address/$OFACT"
jq -r --arg x "$EXPLORER" '.vaults|to_entries[]|"  \(.key) vault      \($x)/address/\(.value.address)\n  \(.key) deploy tx  \($x)/tx/\(.value.tx)"' "$DEPLOYMENTS" >&2
say $'\nnext: scripts/wire-deployment.sh'
