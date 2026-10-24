# Uptick

Uptick puts Robinhood Stock Tokens to work: ERC-4626 vaults that provide Uniswap v3 and v4 liquidity against USDG on Robinhood Chain (4663), and vault shares that serve as Morpho Blue collateral.

App https://uptick-fi.pages.dev, evidence API https://uptick-evidence.earn-shield-alerts.workers.dev, code https://github.com/kamalbuilds/uptick. Verify in three commands:

1. `curl -s https://uptick-evidence.earn-shield-alerts.workers.dev/vaults | jq '[.[] | select(.open)] | length'` prints how many of the 17 vaults accept deposits.
2. `cd contracts && forge test --match-test test_realFeedUnmocked -j 1` reads the live NVDA Chainlink feed and Uniswap pool on a fork of Robinhood Chain, unmocked.
3. `cast code 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010 --rpc-url https://rpc.mainnet.chain.robinhood.com` prints the bytecode of the Morpho Blue singleton that takes a vault share as collateral.

**Put your Stock Tokens to work.**

On 22 October 2026 Robinhood made Stock Tokens collateral on Morpho: "Any eligible wallet can plug in and any app can tap into these markets" ([@RobinhoodCrypto](https://x.com/RobinhoodCrypto/status/2113270580472381515), 55,663 views by 2026-10-23 16:55 UTC). Morpho Blue holds $609.5M of Robinhood Chain's $1.14B in TVL, and a Stock Token posted there earns nothing while the loan accrues interest. Uptick is what gets built on top: deposit AAPL, GOOGL, PLTR and 9 more Stock Tokens (12 of 17 vaults launch first), earn the fees that survive losses to fast traders, and borrow USDG against the same vault share. Uptick lists every Stock Token with a Chainlink feed and a USDG pool trading at least $100K a day, shows what you earn and what you keep, and opens a vault only where past trades say it holds up.

Borrowing USDG against AAPL on Morpho cost 24.7% a year at the 2026-10-23 16:56 UTC read (market at a 62.5% loan to value limit, $221,409 supplied). An Uptick AAPL share earns its kept APR while posted, +2.7% to +3.9% a year across the two replay halves, which at a 50% loan to value pays back 5.4 to 7.8 points of that rate. That is an estimate from one read; the rate is variable and fee income varies.

Try it: paste any wallet address into `/check` to see which of its Stock Tokens can earn and where a loan opens, open a vault page for the Earn and borrow panel, and run `scripts/fork-demo.sh` for the whole loop on a fork of Robinhood Chain against the real Morpho Blue (deposit, borrow at 62.5%, a 3% push on the pool, a stale feed, a liquidation; every transaction in [docs/FORK-DEMO.md](docs/FORK-DEMO.md)). Ten MCP tools give agents the same reads and unsigned transactions, plus a sized weekend hedge: `plan_weekend_hedge` prices a short of the matching Stock Token perp on Lighter's Robinhood Chain exchange from what the wallet holds, with funding, order-book slippage and margin terms read live before you trade.

Every vault page shows fee APR next to what LPs keep.

Robinhood Chain (chain 4663) lists 189,012 NVDA holders and 114,550 SPCX holders. Their tokens sit idle, and holders cannot see which pool or fee tier pays liquidity providers best.[^1] Uptick publishes that calibration and routes the deposit by it.

## The insight

Liquidity economics on a stock token differ by session and by pool and tier. Fees earned per dollar lost to informed traders (1 hour markout), from 5,113,049 swaps on the chain's own NVDA, SPCX and TSLA pools between 24 August and 17 October 2026:[^2]

| Session | Fee earned per $1 lost to informed flow |
|---|---|
| NYSE regular hours | 1.03 to 1.35 |
| Weeknights | 1.30 to 3.90 |
| Weekends | 3.94 to 33.27 |

Pooled across the three pools, weekends pay 13.64 and NYSE hours 1.16, and the weekend ratio beats the NYSE ratio in 22 of 23 pool-weeks.

The spread between pools and tiers is as large as the spread between sessions. The evidence engine measures it per token and selects the pool and tier with the best out-of-sample result.

## How it works

**1. Evidence engine** (`spikes/stock-vaults/scripts/engine.py`, `keeper/replay/build_replay.py`). For every eligible Stock Token (Chainlink feed, deep and busy USDG pool; `keeper/src/universe.ts`) it replays every swap on every USDG pool and fee tier, computes fee per dollar of 1 hour markout by session, and ranks pool and tier on a held-out half of the window.[^2]

**2. StockVault** is an ERC-4626 vault per Stock Token. It deposits into the pool and tier the evidence selects, in one click. Shares rise in price as fees accrue. Every value-in and value-out path passes an oracle gate (Chainlink freshness, TWAP and spot within bounds), and `redeemInKind` always pays out both tokens. `StockVaultV4` is the same vault over a Uniswap v4 pool, with a keeper-fed TWAP ring in place of the pool's own oracle. 412 contract tests cover the vaults, 141 of them in a security suite that runs on a fork of Robinhood Chain, and 14 guards are mutation-tested.[^3]

**3. Keeper and stats API** refresh the evidence and recentre each vault once a day after each NYSE session, from 02:00 UTC with a jittered minute (`keeper/src/calendar.ts`). Every `rebalance()` is simulated with `eth_call` first and only a passing simulation is signed. The stats API serves TVL, fee APR, tier comparison and share price per vault.

**4. Pools under a declared cap.** The cap standard (`CappedTakeHook` + `CapRegistry`) lets a hook declare its maximum take and enforces it inside every swap on every router. The vault targets pools without take-capable hooks, or hooks with a registered cap. On a mainnet fork the cap stops 200 of 200 over-cap swaps, accounting matches to the wei, and the cap holds against a nested self-swap.[^4] `UptickHook` is one reference implementation of the standard.

**5. Web app** shows each token's tier comparison and session evidence, then deposits, redeems and tracks the portfolio.

**6. Weekend hedge** (`web/lib/hedge.ts`, `api/src/hedge-tools.ts`). Earn, borrow, hedge: once the vault share backs a USDG loan, the planner sizes a short of the matching Stock Token perp on Lighter's Robinhood Chain exchange from the Stock Tokens a wallet holds, or from the stock leg of its vault shares, using the on-chain ERC-8056 multiplier. It reads Lighter live for funding, order-book slippage at your exact size and margin terms, shows whether the short earns or pays funding over the weekend in basis points and USDG, and covers the 15 of 17 Uptick tokens that trade as Lighter perps. An NVDA weekend hedge costs about 1.6 bp at $10k against a 135 bp unhedged weekend swing (16 weekends of funding, 9 of pool-vs-perp drift).[^7] The default unwind is 30 minutes before the US open because the pool lags the perp at the open (NVDA residual 6.4 bp against 17.8 bp). The same plan is the `plan_weekend_hedge` MCP tool.

## How vaults open

Kept APR is fees earned less losses to informed traders (1 hour markout) and rebalancing cost, annualised, for a band chosen per token on the first 15 days of the replay, recentred at 02:00 UTC after each NYSE session (`keeper/src/calendar.ts`). The replay splits its 30 days into a 15 day calibration half and a 15 day held-out half, and reports two accounting bounds: the conservative figure decides the gate, the upper figure is shown beside it. A vault is open when both halves keep at least break-even, reduced (deposits capped at $25,000 per transaction) when the weaker half sits between -20% and break-even, and closed below -20% (`KEEP_FLOOR_APR`, `KEEP_FULL_APR` in `keeper/src/evidence.ts`).

<!-- gates:start -->
| Vault | Band | Vault size cap | First half kept | Held-out half kept (conservative to upper) | Status | Reason |
|---|---|---|---|---|---|---|
| PLTR | ±3.5% | $24,207 | +140.9% | +7.9% to +20.8% | Open | Both halves at or above break-even |
| AAPL | ±7.5% | $29,268 | +2.7% | +3.9% to +6.6% | Open | Both halves at or above break-even |
| GOOGL | ±20% | $38,950 | +0.2% | +2.2% to +2.5% | Open | Both halves at or above break-even |
| SPY | ±2.5% | $100,000 | +2.3% | -0.2% to +0.0% | Reduced | Weaker half between -20% and break-even; up to $25,000 a deposit |
| USO | ±20% | $23,359 | +17.2% | -0.9% to +0.2% | Reduced | Weaker half between -20% and break-even; up to $23,359 a deposit |
| QQQ | ±10% | $66,787 | +0.8% | -1.3% to -1.0% | Reduced | Weaker half between -20% and break-even; up to $25,000 a deposit |
| AMZN | ±7.5% | $68,501 | +2.4% | -1.9% to -0.2% | Reduced | Weaker half between -20% and break-even; up to $25,000 a deposit |
| INTC | ±20% | $19,116 | -2.2% | +3.3% to +7.1% | Reduced | Weaker half between -20% and break-even; up to $19,116 a deposit |
| AMD | ±20% | $18,436 | -1.2% | -4.7% to -3.1% | Reduced | Weaker half between -20% and break-even; up to $18,436 a deposit |
| NVDA | ±1.5% | $100,000 | +29.0% | -6.8% to +4.6% | Reduced | Weaker half between -20% and break-even; up to $25,000 a deposit |
| META | ±15% | $17,025 | +4.6% | -10.5% to -9.8% | Reduced | Weaker half between -20% and break-even; up to $17,025 a deposit |
| MU | ±15% | $86,710 | +7.2% | -13.9% to -9.8% | Reduced | Weaker half between -20% and break-even; up to $25,000 a deposit |
| TSLA | ±7.5% | $83,206 | +12.3% | -25.8% to -19.1% | Closed | Weaker half below the -20% floor, the gate shuts deposits |
| CRCL | ±20% | $100,000 | +0.1% | -27.8% to -25.9% | Closed | Weaker half below the -20% floor, the gate shuts deposits |
| MSTR | ±3.5% | $22,206 | -8.2% | -43.0% to -20.4% | Closed | Weaker half below the -20% floor, the gate shuts deposits |
| GME | ±2.5% | $49,212 | +105.3% | -93.5% to -37.2% | Closed | Weaker half below the -20% floor, the gate shuts deposits |
| SPCX | ±1.5% | $100,000 | +80.9% | -195.4% to -136.1% | Closed | Weaker half below the -20% floor, the gate shuts deposits |
<!-- gates:end -->

Every row is the vault's pool on its venue: a Uniswap v3 pool, or for PLTR, SPY and USO a Uniswap v4 pool. Every range bound in the replay sits on a multiple of its pool's tick spacing, rounded outward, so the figures are for positions Uniswap can hold. `StockVaultV4` runs the same vault over a Uniswap v4 pool, and the deploy list puts a token on the venue whose pool keeps more in its weaker half: PLTR's v4 1% pool, net of the PoolManager's protocol fee, keeps +7.9% against -18.9% on its v3 0.3% pool, so PLTR opens on v4. Holding the token, one position set once and the vault are priced side by side for every token in [docs/DIY-BASELINE.md](docs/DIY-BASELINE.md).

Seventeen tokens clear the registry rule in `keeper/src/universe.ts`: a Chainlink feed, a USDG pool trading at least $100K a day, and a vault sized to the pool. The vault size cap is the largest position that holds at most 20% of the pool's in-range liquidity, up to $100K and at least $10K, so a thinner pool gets a smaller vault instead of no vault; `StockVault` enforces the size on-chain through its `depositCap`. The replay simulates each vault at its own size, so every gate above reflects the vault a depositor can actually buy. The volume floor admits a token to a vault and the replay gate decides whether deposits open.

Source: `keeper/data/replay.json` via `keeper/src/evidence.ts`, regenerated with `keeper/replay/replay.py`; schedule comparison in `keeper/replay/SCHEDULE-CHANGE.md`.

## Why Robinhood Chain

Robinhood issues its Stock Tokens on Robinhood Chain (chain 4663, an Arbitrum Orbit chain), so the asset the vault holds lives here. Chainlink publishes the equity feeds the vault prices against on the same chain, and the Stock Tokens quote against USDG in Uniswap pools, so the hedge leg is native too. The vault sits where the token, the oracle and the pool are, instead of crossing a bridge on every valuation and every swap. The chain's own standards run in the contracts: `UptickHook` scales the Chainlink answer by the token's ERC-8056 `uiMultiplier` and prices swaps by NYSE session with holidays and DST compiled in (`contracts/src/hook/UptickHook.sol`), while `StockVault` refuses a stale, malformed or deviating feed read before any value-in or value-out path (`contracts/src/StockVault.sol`).

## Why the chain needs it

Hooks carry 74.5% of v4 trades on Robinhood Chain, 0x labels 80% of 84K hooks malicious, and about $1.2M left traders in 49 hours to hooks keeping 5 to 11% while their pools quote 0 to 1%.[^5] Quoted fees no longer tell the price a liquidity provider or trader gets. Uptick's pick is measured, and its pools sit under a cap the chain enforces.

Session-fee and oracle-gap hooks (Fables, SessionFeeHook, Bellswap, ClosingBell) price swaps. Vault products (AutoRange, HedgeHood, Saffron) choose ranges by hand. Uptick adds the published calibration, the cap standard and one-click vaults across many Stock Tokens.[^6]

## Evidence

| Claim | Number | Source |
|---|---|---|
| Swaps replayed | 3,059,881 over the 30 days to 2026-10-17, 17 vault pools | `keeper/data/replay.json` |
| NVDA vault fee APR, 30 day replay, daily recentre, 1.5% band | 92.8% | `web/lib/vault-universe.json` feeAprPct, regenerated 2026-10-23 |
| Hook share of v4 trades on Robinhood Chain | 74.5% | Bitquery |
| Hooks labelled malicious by 0x | 80% of 84K | 0x |
| Taken in 49 hours by hooks keeping 5 to 11% while pools quote 0 to 1% | about $1.2M | `docs/research/founder-house/OUTREACH-fomo-gmgn.md` |
| Stock-token LP demand elsewhere | Raydium $30.6M stock-token LP pools; @WazzCrypto | `docs/research/founder-house/vaults/DEMAND.md` |

## Chain components in use (Robinhood Chain 4663)

Each address returns bytecode from `cast code` against `https://rpc.mainnet.chain.robinhood.com` (`docs/research/founder-house/vaults/INFRA.md`).

| Component | Address |
|---|---|
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| Uniswap v3 NonfungiblePositionManager | `0x73991a25c818bf1f1128deaab1492d45638de0d3` |
| NVDA / USDG 0.05% pool | `0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3` |
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` |
| SPCX | `0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |

## Run locally

```
# contracts: fork tests against the real pool, router and tokens
cd contracts && forge test

# keeper: dry run reads mainnet, sends nothing
cd keeper && bun install && bun src/keeper.ts --dry-run
bun src/stats.ts            # stats API on :8790

# web
cd web && pnpm install && pnpm dev     # http://localhost:3000

# local mainnet fork
anvil --fork-url https://rpc.mainnet.chain.robinhood.com
```

## Repo layout

```
contracts/   StockVault (ERC-4626), CappedTakeHook, CapRegistry, UptickHook (reference
             implementation), fork tests, invariants, SECURITY.md
keeper/      evidence refresh, rebalance keeper, NYSE calendar, eligibility rule, stats API
web/         Next.js app: vaults, tier comparison and session evidence, portfolio
docs/        ARCHITECTURE.md, DEMO-SCRIPT.md, SUBMISSION.md, architecture.html
deck/        investor deck (index.html, uptick-deck.pdf)
```

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/architecture.html](docs/architecture.html). Demo: [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md).

[^1]: Holder counts: `docs/research/founder-house/PLATFORM-TRUTH.md`, Stock Tokens table (Blockscout, 2026-10-16).
[^2]: `spikes/stock-vaults/FINDINGS.md`, `spikes/stock-vaults/logs/session_split.txt`, engine `spikes/stock-vaults/scripts/engine.py`. Window 2026-08-24 to 2026-10-17.
[^3]: `contracts/SECURITY.md`, `contracts/test/`.
[^4]: `spikes/capped-hooks/FINDINGS.md`.
[^5]: 74.5%: Bitquery. 80% of 84K: 0x. $1.2M in 49 hours: `docs/research/founder-house/OUTREACH-fomo-gmgn.md`.
[^6]: `docs/research/founder-house/vaults/HOOK-DESIGN.md` section A and `docs/research/founder-house/vaults/COMPETITORS.md`.
[^7]: `spikes/stock-hedge/EVIDENCE.md` lists each figure with the script and output file in `spikes/stock-hedge/economics/` that produce it (funding, basis, order book, close-time and the weekend cost).
