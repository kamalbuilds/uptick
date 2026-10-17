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

## Universe and eligibility

`data/universe.json` lists every Robinhood Stock Token on Robinhood Chain (196 in the RHJ registry, each confirmed with `eth_getCode`) with its Chainlink feed, every Uniswap v3 USDG pool (fee tiers 100, 500, 3000, 10000), the deepest pool's depth and 7-day volume, and an `eligible` flag with the first failing condition as `reason`. Built from public RPC reads at one block (recorded in the file) by `bun scripts/build-universe.ts`; `--reeval` re-applies the rule to the stored reads without any RPC.

Fields per token: `symbol`, `name`, `token`, `multiplier`, `feed` (proxy, aggregator, description, decimals, price, age), `pool` (address, fee tier, tick spacing, pool price, `depth_usd_5pct`, `volume_7d_usd`, `volume_usd_per_day`, `swaps_7d`, `vault_share_100k`, `feed_deviation_bps`), `other_pools`, `eligible`, `reason`.

### Eligibility rule

A Stock Token gets a vault when all of these hold (thresholds in `src/universe.ts`, `RULE`):

| Condition | Threshold |
|---|---|
| Chainlink Stock Token feed | present in the Chainlink directory for 4663, `description()`, `decimals()` and `latestRoundData()` readable, answer positive |
| Feed age | at most 4 days (heartbeat plus a long weekend) |
| USDG pool | the deepest v3 pool by active liquidity across its +-5% band |
| Pool volume | at least USD 1,000,000 per day, 7-day average |
| Vault share | a USD 100,000 vault is at most 20% of in-range liquidity: `V / (depth + V)` |
| Pool vs feed | within 300 bps at the read block |

Where the numbers come from: the replay sizes a vault at USD 100,000 and rebalances it once a day, a swap of about half the deposit. One million dollars a day keeps that swap at or under 5% of the pool's daily flow (NVDA, at about USD 6.1M per day, qualifies; TSLA, at about USD 0.22M per day, does not). The 20% share line sits in the measured gap between GOOGL (15.5%) and AAPL (24.7%).

| Token | Volume per day (7 d) | Vault share | Result |
|---|---|---|---|
| NVDA | USD 6.14M | 5.8% | eligible |
| SPCX | USD 4.28M | 13.5% | eligible |
| CRCL | USD 2.03M | 10.4% | eligible |
| GOOGL | USD 1.84M | 15.5% | eligible |
| USO | USD 0.99M | 5.3% | volume |
| QQQ | USD 0.64M | 26.6% | volume, share |
| AAPL | USD 0.59M | 24.7% | volume, share |
| TSLA | USD 0.22M | 26.0% | volume, share |

Of 196 tokens: 35 have a feed, 95 have a USDG v3 pool, 4 are eligible. v4 pools are replayed for the eligible tokens (below) but do not enter eligibility: StockVault holds a Uniswap v3 position.

## Pool choice (replay)

`replay/pull.py` pulls 30 days of swaps (bounded 400,000-block pages, public RPC) for every v3 USDG pool of an eligible token and every v4 USDG pool without a fee-taking hook (hook address bits for swap and liquidity return deltas), plus the Chainlink rounds. `replay/replay.py` runs the spike engine (`spikes/stock-vaults/scripts/engine.py`, unchanged) on each pool with the vault's strategy: USD 100,000, +-5% around Chainlink, recentred daily at the NYSE open plus 5 minutes.

The window is 2026-09-17 to 2026-10-17. The first 15 days select, the last 15 days check. The vault's target is the v3 pool that did best on the first half among pools carrying at least USD 1M of volume; `confirmed_in_test` records whether it also led the second half, whose fee APR is reported as the out-of-sample figure.

| Token | Chosen pool | Fee APR, 30 days | Fee APR, second half | Swaps replayed (all pools) |
|---|---|---|---|---|
| NVDA | v3 0.05% | 40.6% | 39.5% | 842,504 |
| SPCX | v3 0.05% | 86.9% | 97.1% | 621,165 |
| CRCL | v3 0.3% | 170.7% | 128.1% | 105,466 |
| GOOGL | v3 0.05% | 38.8% | 32.0% | 171,538 |

```
pip3 install numpy
python3 replay/pull.py NVDA SPCX CRCL GOOGL     # swaps and Chainlink rounds into data/engine and data/swaps
python3 replay/replay.py NVDA SPCX CRCL GOOGL   # writes data/replay.json (merges per token)
bun scripts/build-history.ts                    # hourly price series for the charts
bun scripts/export-web.ts                       # writes ../web/lib/vault-universe.json
```

## Registry

`src/registry.ts` builds one ticker per eligible token: the pool is the replay's chosen pool. Vault addresses come from `VAULT_ADDRESS_<SYM>` with `VAULT_DEPLOY_BLOCK_<SYM>`, or from the `VaultFactory`: set `VAULT_FACTORY` and `VAULT_FACTORY_DEPLOY_BLOCK` and the registry reads `VaultCreated(stock, pool, vault, feed, feeTier, index)` logs (bounded pages) and matches on stock and pool. An explicit address wins over the factory. The keeper bot and the stats API both start from this registry, so a vault created through the factory is kept and reported without further configuration.

## Stats API (port 8790)

```
bun src/stats.ts
GET /health
GET /vaults                  every eligible vault, best 30-day fee APR first
GET /vaults/:id              one vault with its price chart; id = lowercase ticker
GET /universe                data/universe.json, all tokens with eligible and reason
GET /pools/:id/replay        the full replay record for a ticker or pool address
```

Each vault carries `fee_apr_pct.replay_30d` always, and `24h` / `7d` / `lifetime` once an on-chain vault has fee history (null before its first deposit). `source` is `"replay"` until a vault address is known, then `"onchain"`. A vault whose on-chain read fails drops back to its replay entry in the list, with `onchain_error`; the single-vault route answers 502.

`evidence` on `/vaults` and `/vaults/:id`:

```
chosen_pool, chosen_fee_tier, chosen_kind, chosen_fee_apr_pct
pools[]            pool, fee_tier, fee_apr_pct, kind (v3|v4), fee_label, hooks, vault_capable, chosen, volume_usd, swaps
fee_per_loss       regular | night | weekend: fees earned per USD lost to informed traders, chosen pool
swaps_replayed, window {start, end, days}, strategy, capital_usd
out_of_sample      second-half window, its fee APR, confirmed
```

`pools` lists every replayed pool with at least USD 250,000 of 30-day volume. A dynamic-fee v4 pool is shown at the average fee its swaps paid.

On-chain figures (vaults with an address) are built as before:
- Fees come from `FeesCollected` events; a transaction with only `Rebalanced` uses its `fees0/fees1`. Logs are read from the deploy block in 200,000 block pages, capped at 60 pages per scan, and the scan errors instead of truncating when the span is larger.
- The stock leg of each event is valued at the current pool price (the public RPC keeps no historical state). USDG leg is face value.
- Fee APR = window fees / current TVL, annualised from the window, with the window clamped to the vault age.
- Share price history is sampled from `pricePerShare()` every 5 minutes into `data/pps-<id>.jsonl` while the service runs.

## Tests

```
bun test
bunx tsc -p .
```

- `test/apr.test.ts`: fee APR on 4 real `Collect` events from the NVDA/USDG pool (`test/fixtures/collects.json`, pulled by `scripts/make_fixture.ts`), expected values computed by hand with exact decimals.
- `test/calendar.test.ts`: weekend, 2026 holidays, observed-day shifts, early close, EDT/EST slot time, `recentreDue`.
- `test/guards.test.ts`: a 3% pool vs Chainlink gap is rejected, 1% passes, stale feed rejected, price math.
- `test/universe.test.ts`: band-value math against the replay engine's `lv_for`, every rule condition rejecting alone with its own reason, the rule's boundaries, and `data/universe.json` (NVDA passes, TSLA fails on volume and share, feedless tokens never eligible while a busy feedless pool exists).
- `test/evidence.test.ts`: per eligible token, one chosen v3 row in a table sorted by fee APR, three finite session ratios, the 30-day and 15-day windows, and no edge or net-vs-hold keys in the payload.
- `test/registry.test.ts`: tickers follow the replay's chosen pool, explicit addresses need a deploy block, factory logs match on stock and pool, an explicit address wins.

## Addresses

USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, v3 factory 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA, position manager 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3, router 0xCaf681a66D020601342297493863E78C959E5cb2. Per-token pools and Chainlink proxies are in `data/universe.json`.
