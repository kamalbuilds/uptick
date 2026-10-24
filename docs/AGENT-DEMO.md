# Agent demo: an AI agent uses Uptick (60 seconds)

An agent reads the vault list, checks the evidence behind PLTR's Uniswap v4 pool, asks for a deposit it can hand to a holder to sign, and gets a written refusal for a closed vault. Every answer carries the gate and its reason.

Host: the commands below run against `BASE`. The published endpoint is `https://uptick-evidence.earn-shield-alerts.workers.dev`; the outputs pasted here come from the same Worker code running locally with `npx wrangler dev` in `api/` and `VAULTS = '{}'` (the production value while the 12 launching vaults go on-chain). Running against the published host changes only `BASE`. Once the vault addresses are set, the `prepare_deposit pltr` output switches from the gate answer (step 4a) to unsigned calldata (step 4b).

```bash
BASE=http://127.0.0.1:8787        # local worker; the published host is https://uptick-evidence.earn-shield-alerts.workers.dev
MCP=$BASE/mcp
H=(-H 'content-type: application/json' -H 'accept: application/json, text/event-stream')
RECEIVER=0x2222222222222222222222222222222222222222
```

The endpoint speaks MCP over Streamable HTTP: JSON-RPC 2.0 over POST, `Accept: application/json, text/event-stream`. `scripts/agent-demo.sh [BASE]` runs every call below and exits non-zero if the server is unreachable or any call returns a JSON-RPC error.

## Run of show

| Seconds | Beat | Say |
|---|---|---|
| 0 to 10 | tools/list | "Ten tools. Six read, including the weekend hedge planner, and four that prepare transactions the holder signs, including borrowing against a vault share and making a loan safer." |
| 10 to 22 | list_vaults | "17 vaults, 3 open, 9 reduced, 5 closed. PLTR is open, on Uniswap v4." |
| 22 to 35 | get_vault_evidence pltr | "Venue v4, the pool id, the PoolManager, and the gate reason in the replay's own words." |
| 35 to 50 | prepare_deposit pltr | "The agent asks for a deposit. It gets the gate and the transactions to sign." |
| 50 to 60 | prepare_deposit spcx | "SPCX is closed. The agent is refused with the reason, so it tells the holder why." |
| 60 to 75 | plan_weekend_hedge | "Earn, borrow, hedge. The agent sizes a weekend short from what the wallet holds and reads Lighter live for what it costs. It places nothing." |

## 1. tools/list

```bash
curl -sS "$MCP" "${H[@]}" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '[.result.tools[].name]'
```

```json
["list_vaults", "get_vault_evidence", "scan_wallet", "prepare_deposit", "prepare_withdraw", "get_collateral_terms", "prepare_earn_and_borrow"]
```

## 2. list_vaults

```bash
curl -sS "$MCP" "${H[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_vaults","arguments":{}}}' \
  | jq '.result.structuredContent | {vaults: (.vaults|length), by_gate: (.vaults|group_by(.gate_state)|map({(.[0].gate_state): length})|add), pltr: (.vaults[]|select(.id=="pltr")|{venue,pool_id,gate_state})}'
```

```json
{
  "vaults": 17,
  "by_gate": { "closed": 5, "open": 3, "reduced": 9 },
  "pltr": {
    "venue": "v4",
    "pool_id": "0xee430ee1003e1985e1828a01b9a20dad67ad4302994fe2abb4a173de4ac54623",
    "gate_state": "open"
  }
}
```

Every vault in `list_vaults` and in `GET /vaults` carries `state` (open, reduced or closed), `per_tx_cap_usd` (the most one transaction may deposit, 0 for a closed vault) and `kept_worst_half_pct` (what liquidity providers kept in the weaker replay half, percent a year), beside the earlier fields. `open: true` means the vault accepts deposits, so it is true for state open and for state reduced.

## 3. get_vault_evidence for pltr

```bash
curl -sS "$MCP" "${H[@]}" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_vault_evidence","arguments":{"id":"pltr"}}}' \
  | jq '.result.structuredContent | {id, venue, pool_id, pool_manager, entry_fee_bps, swaps, gate: {state: .gate.state, reason: .gate.reason}}'
```

```json
{
  "id": "pltr",
  "venue": "v4",
  "pool_id": "0xee430ee1003e1985e1828a01b9a20dad67ad4302994fe2abb4a173de4ac54623",
  "pool_manager": "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  "entry_fee_bps": 109.9,
  "swaps": 53897,
  "gate": {
    "state": "open",
    "reason": "Open: the weaker half of the 30-day replay kept 7.9% a year, at or above break-even, across 53,897 swaps."
  }
}
```

## 4. prepare_deposit for pltr

```bash
curl -sS "$MCP" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"prepare_deposit\",\"arguments\":{\"id\":\"pltr\",\"amount\":\"1000\",\"receiver\":\"$RECEIVER\",\"asset\":\"usdg\"}}}" \
  | jq '.result.structuredContent'
```

4a. While PLTR is launching (`VAULTS` empty), the answer is the gate and `address_live: false`:

```json
{
  "isError": true,
  "error": "no deployed vault for pltr on this network",
  "address_live": false,
  "vault": "pltr",
  "venue": "v4",
  "gate": {
    "state": "open",
    "reason": "Open: the weaker half of the 30-day replay kept 7.9% a year, at or above break-even, across 53,897 swaps."
  }
}
```

4b. With the vault address set, the same call returns two unsigned transactions: approve USDG to the router, then `depositUsdgV4` (the router address is abbreviated below; read `router_function`):

```json
{
  "vault": "pltr",
  "venue": "v4",
  "asset": "usdg",
  "entry_fee_bps": 109.9,
  "entry_fee_note": "The vault keeps a 1.099% entry fee from this deposit for its existing holders; shares are minted against the amount net of it.",
  "transactions": [
    { "chainId": 4663, "to": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "value": "0", "description": "Approve 1000 USDG to the Uptick router" },
    { "chainId": 4663, "to": "<router>", "value": "0", "description": "Zap 1000 USDG into vault pltr for 0x2222222222222222222222222222222222222222" }
  ],
  "usdg_in": "1000",
  "router_function": "depositUsdgV4"
}
```

Each transaction also carries its `data` hex. The holder signs; the agent never holds a key.

## 5. prepare_deposit for spcx (closed)

```bash
curl -sS "$MCP" "${H[@]}" -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"prepare_deposit\",\"arguments\":{\"id\":\"spcx\",\"amount\":\"1000\",\"receiver\":\"$RECEIVER\"}}}" \
  | jq '.result.structuredContent'
```

```json
{
  "isError": true,
  "error": "Closed: the weaker half kept -199.5% a year, below the -20% floor."
}
```

Exits stay open on every vault: `prepare_withdraw` with `mode: "in_kind"` builds `redeemInKind`, which reads no oracle.

## Hedge it for the weekend

One prompt: "I hold NVDA. What does a weekend hedge cost?"

`plan_weekend_hedge {"address":"0x92d435c96e63c43e12d6d0ab28f6b0b04072f765"}` reads the wallet's NVDA balance and the token's on-chain ERC-8056 `uiMultiplier()` at one block, then reads Lighter's Robinhood Chain exchange (`orderBookDetails`, `assetDetails`, `orderBookOrders` for the market and `fundings`) and returns the size and the weekend cost. A run at 2026-10-23T23:33:47Z returned:

| Field | Value | Meaning |
|---|---|---|
| `shares` | 96.6378 | 96.563 NVDA tokens times the multiplier 1.000775, floored to the market's four size decimals |
| `notionalUsd` | 20396.37 | shares at the mid of Lighter's book |
| `slippageBp` | 1.77 | open into the bids plus close from the asks, walked at that size |
| `fundingBp`, `fundingDirection` | 5.07, earns | what a short earns over the 65 weekend hours at the mean hourly funding of the weekend hours in the last 28 days (a history, not a forecast) |
| `marginEligible`, `userCapTokens` | true, 60 | Lighter counts NVDA toward margin, up to 60 tokens an account, read live |
| `window` | close 2026-10-23T20:00Z, unwind 2026-10-26T13:00Z | the US close and 30 minutes before the Monday open |
| `handoffUrl` | https://robinhoodchain.lighter.xyz/trade/NVDA | the market on Lighter, where the holder enters the short |

`source: "loan"` with a `vault` that has a Morpho market configured sizes the short from the stock leg of the shares posted as Morpho collateral (the vault's `redeemInKind` simulated for the collateral) and adds the margin interest on the debt as `marginCostBp`. The tool returns no calldata. A wallet with no holding, or a token Lighter lists no perp for (GME, MSTR), answers with the reason. If Lighter does not answer cleanly the result is an error carrying its code and no plan; a missing figure is never returned as zero.

## Alternative: add the server to Claude Code

```bash
claude mcp add --transport http uptick https://uptick-evidence.earn-shield-alerts.workers.dev/mcp
```

Then type, in plain language:

> Using the uptick tools: count the vaults by gate state. Show me why PLTR is open and which Uniswap pool it uses. Prepare a 1000 USDG deposit into PLTR for 0x2222222222222222222222222222222222222222, then try the same for SPCX and tell me why it is refused.

The agent calls `list_vaults`, `get_vault_evidence`, and `prepare_deposit` twice, and answers with the counts, PLTR's v4 pool id and gate reason, the transactions to sign (or the gate answer), and SPCX's refusal reason.

## Collateral that earns

One prompt: "Put 10 NVDA to work and borrow 1,000 USDG against it."

1. `get_collateral_terms {"id":"nvda"}` returns the market (loan token USDG, collateral token the NVDA vault share, oracle, IRM, LLTV) and its Morpho Blue market id. The agent quotes the LLTV to the user.
2. `prepare_earn_and_borrow {"id":"nvda","amount":"10","borrow_usdg":"1000","receiver":"0x..."}` returns:

Two batches, in order:

| Batch | # | To | Call |
|---|---|---|---|
| 1 | 1 | NVDA Stock Token | `approve(vault, amount)` |
| 1 | 2 | NVDA vault | `deposit(amount, receiver)` |
| 2 | 3 | NVDA vault | `approve(Morpho Blue, shares)` |
| 2 | 4 | Morpho Blue | `supplyCollateral(marketParams, shares, receiver, "")` |
| 2 | 5 | Morpho Blue | `borrow(marketParams, borrow_usdg, 0, receiver, receiver)` |

The vault holds shares in the block they are minted, and on Robinhood Chain that block is the parent chain's, about 12 seconds apart. `wait_between_batches` tells the agent in plain words to send batch 2 after the next block: read Multicall3 `getBlockNumber()` as of the deposit's block, then poll it at the latest block until it is higher.

Every amount in calls 3 to 5 comes from chain reads at request time: `previewDeposit` on the vault for the share mint, `price()` on the market oracle, and `market(id)` on Morpho Blue for free liquidity. The collateral amount is the previewed mint minus 0.1%, so a price move between preview and mining cannot revert the supply. The response carries `shares_preview`, `collateral_shares`, `max_borrow_usdg`, `lltv_pct` and `market_id`.

The tool refuses, with a reason and no calldata, when:

- the vault id is unknown or the vault is closed (the gate reason is returned);
- no vault address is deployed for the id on the network;
- no Morpho market is configured for the vault, the market does not lend USDG, or its collateral token is not the deployed vault share;
- `borrow_usdg` exceeds `collateral * price * LLTV`, or exceeds the free liquidity in the market;
- the RPC is missing or a read fails.

The `receiver` owns the shares, the collateral and the loan, and receives the USDG, so it must sign all five transactions.

## Configuration

| Variable | Meaning |
|---|---|
| `VAULTS` | JSON map of vault id to deployed vault address |
| `ROUTER` | USDG zap router address, enables `asset: "usdg"` |
| `RPC_URL` | JSON-RPC endpoint for the collateral reads |
| `COLLATERAL_MARKETS` | optional JSON map of vault id to full market params, overrides `web/lib/collateral-markets.json` per vault |

`web/lib/collateral-markets.json` holds `{ "markets": { "<id>": { oracle, irm, lltv } } }`, with `lltv` as an 18-decimal string (`"625000000000000000"` is 62.5%); the loan token is USDG and the collateral token is the vault share from `VAULTS`. `COLLATERAL_MARKETS` entries carry all five market fields. `npm run sync` in `api/` copies the file into the worker.

## Checks

`bun test` in `api/` decodes every returned call with viem against its ABI. The Morpho signatures and market id are pinned to the live Morpho Blue singleton on chain 4663 (`0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010`): `supplyCollateral` is `0x238d6579`, `borrow` is `0x50d8cd4b`, and the market id derived from a live market's parameters equals the id Morpho reports for it. A test removes the configured market and asserts the tool returns a reason and no `data` field.
