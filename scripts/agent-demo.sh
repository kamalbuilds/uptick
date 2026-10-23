#!/usr/bin/env bash
# Runs the Uptick agent demo calls against an MCP base URL and pretty-prints each result.
# Usage: scripts/agent-demo.sh [BASE_URL]   (default http://127.0.0.1:8787)
# Exits non-zero if the server is unreachable or any call returns a JSON-RPC error.
set -euo pipefail
BASE="${1:-http://127.0.0.1:8787}"
URL="${BASE%/}/mcp"
RECEIVER="0x2222222222222222222222222222222222222222"
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

rpc() { # label, json body, jq filter
  local out
  echo "== $1"
  out=$(curl -sS -f -m 20 "$URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d "$2") \
    || { echo "FAIL: $URL unreachable or returned an HTTP error" >&2; exit 1; }
  if jq -e '.error' >/dev/null <<<"$out"; then echo "FAIL: $(jq -c .error <<<"$out")" >&2; exit 1; fi
  jq "$3" <<<"$out"
}
call() { # label, tool, arguments json, jq filter over structuredContent
  rpc "$1" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$2\",\"arguments\":$3}}" ".result | {isError: (.isError // false)} + (.structuredContent | $4)"
}

rpc "tools/list" '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' '[.result.tools[].name]'
call "list_vaults" list_vaults '{}' '{vaults: (.vaults | length), by_gate: (.vaults | group_by(.gate_state) | map({(.[0].gate_state): length}) | add), pltr: (.vaults[] | select(.id=="pltr") | {venue, pool_id, gate_state})}'
call "get_vault_evidence pltr" get_vault_evidence '{"id":"pltr"}' '{id, venue, pool_id, pool_manager, entry_fee_bps, swaps, gate: {state: .gate.state, reason: .gate.reason}}'
call "prepare_deposit pltr (usdg)" prepare_deposit "{\"id\":\"pltr\",\"amount\":\"1000\",\"receiver\":\"$RECEIVER\",\"asset\":\"usdg\"}" '.'
call "prepare_deposit spcx (closed)" prepare_deposit "{\"id\":\"spcx\",\"amount\":\"1000\",\"receiver\":\"$RECEIVER\"}" '.'
