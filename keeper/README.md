# Stock Vaults keeper and stats

Keeper bot and stats API for the Stock Token yield vaults on Robinhood Chain mainnet (4663). TypeScript, viem, Bun. Public RPC only: `https://rpc.mainnet.chain.robinhood.com`.

## Keeper

```
bun install
bun src/keeper.ts --dry-run               # mainnet reads, no key, no transactions
bun src/keeper.ts --dry-run --assume-due  # same, pretending the recentre slot is open
bun src/keeper.ts                         # live loop, needs VAULT_KEEPER_KEY in .env
```

Per vault, every 60 s:

1. Reads pool `slot0`, the Chainlink proxy `latestRoundData`, and the vault `currentRange()`.
2. Decides a trigger. `scheduled`: NYSE trading day, 5 minutes after the open (13:35 UTC in EDT, 14:35 UTC in EST), before the close, nothing sent since the slot. `out_of_range`: pool tick outside the vault range for 30 minutes and at least 2 hours since the last rebalance (the spike engine parameters). Weekends and NYSE holidays never trigger.
3. Guards: Chainlink age at most 87,000 s (24 h heartbeat plus grace) and pool vs Chainlink deviation at most 200 bps. A failed guard logs `blocked_by_guard` and retries next minute until the close.
4. `eth_call` simulation of `rebalance()`. Only a successful simulation is signed and sent. The receipt wait retries through RPC errors and falls back to a direct receipt lookup. Result is read from the receipt status.

Output is JSON lines (`start`, `tick`, `simulate_ok`, `simulate_failed`, `sent`, `rebalanced`, `reverted`, `error`).

Key handling: `VAULT_KEEPER_KEY` is read from the environment (Bun loads `keeper/.env`), format-checked, never logged, never in argv. See `.env.example`.

## Stats API (port 8790)

```
bun src/stats.ts
GET /health
GET /vaults                  list, per vault source "replay" or "onchain"
GET /vaults/:id              id = nvda | tsla | spcx
GET /pools/:id/replay        id = ticker or pool address
```

`source:"replay"` until `VAULT_ADDRESS_<TICKER>` is set, then `source:"onchain"` for that ticker. Onchain responses carry TVL (`totalValueInUSDG`, 6 dp), fees lifetime / 24 h / 7 d in USD, fee APR for 24 h / 7 d / lifetime, current range as USD prices against pool and Chainlink price, and share price history.

How the onchain figures are built:
- Fees come from `FeesCollected` events; a transaction with only `Rebalanced` uses its `fees0/fees1`. Logs are read from `VAULT_DEPLOY_BLOCK_<TICKER>` in 200,000 block pages, capped at 60 pages per scan, and the scan errors instead of truncating when the span is larger.
- The stock leg of each event is valued at the current pool price (the public RPC keeps no historical state). USDG leg is face value.
- Fee APR = window fees / current TVL, annualised from the window, with the window clamped to the vault age.
- `fees_lifetime_view_raw` is the raw `feesEarnedLifetime()` value, returned unconverted.
- Share price history is sampled from `pricePerShare()` every 5 minutes into `data/pps-<id>.jsonl` while the service runs. `price_per_share_raw` is the raw view value.

## Replay

`data/replay.json` is produced by `replay/build_replay.py` using the spike engine (`spikes/stock-vaults/scripts/engine.py`) on 5.1M cached swaps: last 30 days to 2026-10-17, USD 100,000, daily recentre with a static band around Chainlink (2, 5 and 10 percent; headline 5 percent). Fields: gross fee APR, 1 hour markout, cost, edge, net vs hold, rebalances. Rerun with `python3 replay/build_replay.py` (needs numpy).

| Pool | Fee tier | 30 d replay fee APR (5% band) |
|---|---|---|
| NVDA/USDG | 0.05% | 40.6% |
| TSLA/USDG | 0.3% | 53.1% |
| SPCX/USDG | 0.05% | 86.9% |

## Tests

```
bun test
bunx tsc -p .
```

- `test/apr.test.ts`: fee APR on 4 real `Collect` events from the NVDA/USDG pool (`test/fixtures/collects.json`, pulled by `scripts/make_fixture.ts`), expected values computed by hand with exact decimals.
- `test/calendar.test.ts`: weekend, 2026 holidays, observed-day shifts, early close, EDT/EST slot time, `recentreDue`.
- `test/guards.test.ts`: a 3% pool vs Chainlink gap is rejected, 1% passes, stale feed rejected, price math.

## Addresses

Pools: NVDA 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3, TSLA 0xf4ACdAEEB7022862A763C9B1B885e11191c889E3, SPCX 0xc61284332117c3FB23A2A56cceFFD07F7aF60029. Chainlink proxies: NVDA 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, TSLA 0x4A1166a659A55625345e9515b32adECea5547C38, SPCX 0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb. USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168.
