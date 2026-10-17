# StockVault security reference

Scope: `src/StockVault.sol`. Every guard below says what the contract does when the guard trips: closed means the call reverts and no state changes, open means the call proceeds on a defined fallback.

## Trust assumptions

| Component | What the vault relies on |
|---|---|
| Chainlink Stock Token / USD proxy | Correct 8-decimal USD price per Stock Token; heartbeat 86,400 s. Equity feeds go quiet outside market hours; the staleness bound turns that into a closed gate, not a stale price. |
| USDG | Worth 1 USD. There is no USDG feed; a depeg is outside the gate. |
| Uniswap v3 pool, position manager, SwapRouter02 | The canonical deployments, fixed as immutables. The constructor checks the pool's tokens and that the position manager's factory resolves the same pool for that pair and fee. |
| Stock Token issuer | Beacon-proxy token with pause and a blocklist. If the issuer blocklists the vault, the position manager or the pool, transfers revert and no contract-side remedy exists. A multiplier or split event shows up as pool and feed disagreeing, which closes the gate. |
| Owner | A multisig behind a two-step ownership transfer. Powers are bounded (see Roles) and take effect immediately; there is no timelock in the contract. |
| Keeper | Can only call `rebalance()`. |
| Chain | No sequencer-uptime feed is read. |

## Roles

| Role | Powers | Hard limits |
|---|---|---|
| Owner | `pause` / `unpause` deposits, `setParams`, `setKeeper`, `setTreasury`, `setInstantDeploy`, `setDepositCap` | Cannot move or sweep user funds (no such function exists), cannot pause withdrawals or `redeemInKind`, cannot renounce (reverts), every parameter is range-checked on set and in the constructor. Worst case via parameters: performance fee up to 20% of trading fees, oracle gate widened to 5%, swap slippage up to 5%. |
| Keeper | `rebalance()` once per `minRebalanceInterval` | Every swap carries a Chainlink-based `minOut`, so one rebalance can lose at most `slippageBps` of the swapped notional. |
| Anyone | `rebalance()` once 26 hours have passed since the last one; `redeemInKind`; `claimStockOwed` for their own credit | The oracle gate applies to them too. |
| Treasury | Receives performance-fee shares | Holds ordinary shares and redeems like anyone else. |

## Guards and what they do when they trip

| Guard | Applies to | On trip |
|---|---|---|
| Chainlink answer invalid (reverts, answer <= 0, timestamp 0 or in the future, `answeredInRound < roundId`) | deposit, mint, withdraw, redeem, rebalance | Closed: `OracleUnhealthy(FeedInvalid)` |
| Chainlink older than `maxStaleness` | same | Closed: `OracleUnhealthy(FeedStale)` |
| `pool.observe` over `twapWindow` fails (history too short, cardinality too low) | same | Closed: `OracleUnhealthy(TwapUnavailable)` |
| TWAP more than `maxDeviationBps` from Chainlink | same | Closed: `OracleUnhealthy(TwapDeviates)` |
| Spot more than `maxDeviationBps` from Chainlink | same | Closed: `OracleUnhealthy(SpotDeviates)` |
| Swap `minOut` (Chainlink value less `slippageBps`) | every swap: balancing swap on deploy, exit swap | Closed: the router reverts, and a local balance-delta check backs it up with `SwapBelowMinimum` |
| Exit buffer: proceeds below `previewRedeem` / requested assets | `withdraw`, `redeem` | Closed: `ExitBelowMinimum`. `redeemInKind` is the way out. |
| `redeem` NAV cap | `redeem` | Proceeds above the shares' NAV stay in the vault, so an exit cannot collect the gap between a cheap pool and the oracle. |
| Pause | deposit, mint | Closed. `maxDeposit` and `maxMint` return 0. |
| Deposit cap | deposit, mint | Closed above the cap. |
| Keeper-only window | `rebalance` | Closed to non-keepers until 26 hours after the last rebalance, then open to anyone, still behind the oracle gate. |
| `minRebalanceInterval` | keeper `rebalance` | Closed with `TooSoon`. |
| Parameter bounds | constructor, `setParams` | Closed: `BadParams`. |
| Reentrancy guard | every state-changing entry point | Closed. |
| `redeemInKind` | none (no oracle, no swap, no pause) | Always open. If the oracle gate is `Ok` it harvests fees first; if not, it skips the harvest (open): the redeemer's slice of uncollected fees stays with the remaining holders and the treasury. |
| Stock Token transfer reverts for the receiver | `redeemInKind` | Open: the amount is credited to the receiver (`stockOwed`), excluded from NAV and from deployable inventory, and claimed with `claimStockOwed(to)`. |
| Stock Token transfer reverts | deposit, withdraw, redeem, rebalance | Closed (the token reverts, nothing partial persists). |
| Swap of a USDG leg under one US cent | exit, deploy | Open: the dust stays in the vault. |

## Accounting rules

- `totalAssets()` = idle Stock Token (excluding credited `stockOwed`) + idle USDG + position principal at the TWAP price + uncollected fees, with USDG converted at Chainlink, less the treasury's performance cut on the uncollected fees.
- Uncollected fees are computed from the pool's fee-growth accumulators the same way the pool does it, with wrapping subtraction. A test compares the figure to the amount the position manager then pays out.
- Performance fee is taken only on fees collected from the position, minted as shares to the treasury. The mint is priced against assets net of the cut, so the share price does not move at harvest. Rounding goes down for the treasury.
- Virtual-share offset 6 (`_decimalsOffset`): shares have 24 decimals. A donation to the vault cannot make a later depositor round to zero shares without costing the donor more than the depositor loses.
- Rounding follows ERC-4626: down for assets out and shares in, up for assets in and shares out.
- Withdrawals and exits are pro-rata over idle balances and liquidity, so every exit leaves the per-share composition unchanged.
- Approvals to the position manager and router are set to the exact amount and returned to zero in the same call.

## Quantities measured on the real pool

| Quantity | Value | How |
|---|---|---|
| 100 NVDA instant-deploy deposit then full redeem | about 5 bp round-trip cost | `test_depositWithdrawRoundTrip_instantDeploy` |
| NAV drift of six consecutive rebalances | under 40 bp | `test_repeatedRebalancesNeverRevert` |
| TWAP-composition NAV vs spot-composition value of the same holdings, 400 NVDA deposit with `instantDeploy` | about 6.5 bp | debug run at head; the gate bounds the gap at second order in `maxDeviationBps` |
| Pool NVDA price below the Chainlink answer on a Saturday, feed 10 h old | 38 bp | `sqrtOracle` against spot at head; inside the 100 bp gate |

## Test and mutation evidence

Each row deletes or breaks one guard in the source, runs the tests that cover it, expects red, restores the source and expects green.

| Mutation | Tests that went red |
|---|---|
| TWAP-vs-Chainlink bound removed | `test_oracleJumpWithoutPoolMoveBlocks`, `test_sustainedPushBlocksOnTwapDisagreement` |
| Spot-vs-Chainlink bound removed | `test_spotPushedThreePercentBlocksDeposit` |
| Swap `minOut` forced to 0 | `test_swapMinOutBlocksBadFill` |
| Exit proceeds check removed | `test_exitBeyondBufferRevertsInsteadOfUnderpaying` |
| `redeem` NAV cap removed | `test_exitCannotHarvestPoolOracleGap` |
| Staleness check removed | `test_staleFeedBlocksRebalance`, `test_permissionlessRebalanceStillGatedByOracle` |
| Virtual-share offset set to 0 | `test_firstDepositorDonationAttackFails`, `testFuzz_donationAttackNeverProfits` |
| Uncollected fees not valued | `test_feeAccrualAndPerformanceFeeMath`, `test_pricePerShareContinuousThroughHarvest` |
| 26 hour permissionless gate removed | `test_rebalanceRespectsRoles`, `test_permissionlessRebalanceAfter26Hours` |
| Performance fee not minted | `test_feeAccrualAndPerformanceFeeMath` |
| Deposit pause not enforced | `test_depositCapAndPause` |
| Dust-swap guard removed | `test_tinyRedeemDoesNotRevert` |
| Token-0 sqrt-price orientation flipped | `test_oracleMappingMatchesPoolForTokenZeroStock`, `test_roundTripAndRebalanceWithTokenZeroStock` |

The stateful invariant run (random deposits, redeems, in-kind redeems and rebalances, 12 calls deep) surfaced the dust-swap case: a swap of a few raw units returns nothing because the pool rounds its fee up. The dust guard and `test_tinyRedeemDoesNotRevert` pin it.

Static analysis: `slither .` reports reentrancy and strict-equality findings on paths that sit behind `nonReentrant` and call only the immutable router and position manager; the return values it flags as unused are read back by balance delta instead.
