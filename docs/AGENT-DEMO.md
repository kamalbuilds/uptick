# Agent demo: Uptick over MCP

An agent reads gate-checked vault evidence and prepares unsigned transactions through one Streamable HTTP MCP endpoint. The user signs and sends. The agent never holds a key.

Endpoint: `https://uptick-evidence.earn-shield-alerts.workers.dev/mcp`
Plain JSON: `/vaults`, `/vaults/<id>`, `/llms.txt` on the same host.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `list_vaults` | none | every vault with gate state, fee APR, kept APR, gate reason |
| `get_vault_evidence` | `id` | replay pools, gate rule and reason, replay window, swap count, source URL |
| `prepare_deposit` | `id`, `amount`, `receiver`, `asset` (`stock` or `usdg`) | approve then deposit (or approve then router zap); closed vaults refused with their reason; reduced vaults carry the per-transaction cap |
| `prepare_withdraw` | `id`, `shares`, `receiver` | ERC-4626 redeem |
| `get_collateral_terms` | `id` | the Morpho Blue market that takes the vault share as collateral against USDG: market params, market id, LLTV |
| `prepare_earn_and_borrow` | `id`, `amount`, `borrow_usdg`, `receiver` | five ordered transactions: approve, deposit, approve shares, supplyCollateral, borrow |

## Collateral that earns

One prompt: "Put 10 NVDA to work and borrow 1,000 USDG against it."

1. `get_collateral_terms {"id":"nvda"}` returns the market (loan token USDG, collateral token the NVDA vault share, oracle, IRM, LLTV) and its Morpho Blue market id. The agent quotes the LLTV to the user.
2. `prepare_earn_and_borrow {"id":"nvda","amount":"10","borrow_usdg":"1000","receiver":"0x..."}` returns:

| # | To | Call |
|---|---|---|
| 1 | NVDA Stock Token | `approve(vault, amount)` |
| 2 | NVDA vault | `deposit(amount, receiver)` |
| 3 | NVDA vault | `approve(Morpho Blue, shares)` |
| 4 | Morpho Blue | `supplyCollateral(marketParams, shares, receiver, "")` |
| 5 | Morpho Blue | `borrow(marketParams, borrow_usdg, 0, receiver, receiver)` |

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
| `COLLATERAL_MARKETS` | optional JSON map of vault id to market params, overrides `web/lib/collateral-markets.json` per vault |

`web/lib/collateral-markets.json` maps a vault id to `{ loanToken, collateralToken, oracle, irm, lltv }`, with `lltv` as an 18-decimal string (`"625000000000000000"` is 62.5%). `npm run sync` in `api/` copies it into the worker.

## Try it

```bash
curl -s https://uptick-evidence.earn-shield-alerts.workers.dev/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_collateral_terms","arguments":{"id":"nvda"}}}'
```

## Checks

`bun test` in `api/` decodes every returned call with viem against its ABI. The Morpho signatures and market id are pinned to the live Morpho Blue singleton on chain 4663 (`0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010`): `supplyCollateral` is `0x238d6579`, `borrow` is `0x50d8cd4b`, and the market id derived from a live market's parameters equals the id Morpho reports for it. A test removes the configured market and asserts the tool returns a reason and no `data` field.
