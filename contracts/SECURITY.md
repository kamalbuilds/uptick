# StockVault security reference

Scope: `src/StockVault.sol` and the stateless `src/VaultMath.sol` it deploys for itself, plus the registry checks in `src/UptickRouter.sol` and `src/VaultFactory.sol`. Every guard below says what the contract does when the guard trips: closed means the call reverts and no state changes, open means the call proceeds on a defined fallback.

## Trust assumptions

| Component | What the vault relies on |
|---|---|
| Chainlink Stock Token / USD proxy | Correct 8-decimal USD price per Stock Token; heartbeat 86,400 s. Equity feeds go quiet outside market hours; the staleness bound turns that into a closed gate, not a stale price. |
| USDG | Worth 1 USD. There is no USDG feed; a depeg is outside the gate. |
| Uniswap v3 pool, position manager, SwapRouter02 | The canonical deployments, fixed as immutables. The constructor checks the pool's tokens and that the position manager's factory resolves the same pool for that pair and fee. |
| Stock Token issuer | Beacon-proxy ERC-8056 token with pause and a blocklist. If the issuer blocklists the vault, the position manager or the pool, transfers revert and no contract-side remedy exists. The vault reads the token's own `oraclePaused()` and `effectiveAt()` (both confirmed by `eth_call` on the deployed NVDA token) and closes every price-checked path while the oracle is paused and from one hour before until one hour plus `twapWindow` after a multiplier change takes effect. A multiplier or split that moves pool and feed apart by more than `maxDeviationBps` closes the gate as well. Every multiplier step, ordinary dividend accruals included, closes the price-checked paths for one hour before until one hour plus `twapWindow` after `effectiveAt()` (2 h 10 min at the default window); `redeemInKind` stays open throughout. The window is deliberately not narrowed. |
| Owner | A multisig behind a two-step ownership transfer. Risk parameters, the keeper, `instantDeploy`, both price bands and the entry fee change only through a 24-hour queue (see Roles); the powers are bounded and the queue emits the full calldata, so holders have a full day to exit in kind. |
| Keeper | Can only call `rebalance()`. |
| Chain | No sequencer-uptime feed is read. |

## Roles

| Role | Powers | Hard limits |
|---|---|---|
| Owner | Queued, executable after 24 hours and void 7 days after that, cancellable at any time: `setParams`, `setKeeper`, `setInstantDeploy`, `setSpotTwapBand`, `setTwapOracleBand`, `setEntryFee`. Immediate: `pause` / `unpause` deposits, `setDepositCap`, `setTreasury` | Cannot move or sweep user funds (no such function exists), cannot pause withdrawals or `redeemInKind`, cannot renounce (reverts), every parameter is range-checked on execution and in the constructor. The immediate powers can only shrink or re-open deposits (pause, cap) or redirect the performance-fee shares (treasury); none touches a holder's claim. Worst case via the queued parameters: performance fee up to 20% of trading fees, oracle gate widened to 5%, swap slippage up to 5%, spot-to-TWAP band up to 50 bp, TWAP-to-Chainlink rebalance bound up to 5%, entry fee up to 2% (it never falls below the pool's own fee tier). |
| Keeper | `rebalance()` once per `minRebalanceInterval` | Every deploy swap carries a TWAP-based `minOut` (the pool fee plus `slippageBps` below the TWAP value), and the call is refused when spot sits more than `maxSpotTwapBps` from the TWAP or the TWAP sits more than `maxTwapOracleBps` from Chainlink, so one rebalance trades at no worse than the pool fee plus `slippageBps` against an average that is itself pinned near the feed. |
| Anyone | `rebalance()` once 26 hours have passed since the last one; `redeemInKind`; `claimStockOwed` for their own credit | The oracle gate and the spot-to-TWAP band apply to them too. |
| Treasury | Receives performance-fee shares | Holds ordinary shares and redeems like anyone else. |

## Guards and what they do when they trip

| Guard | Applies to | On trip |
|---|---|---|
| Chainlink answer invalid (reverts, answer <= 0, timestamp 0 or in the future, `answeredInRound < roundId`) | deposit, mint, withdraw, redeem, rebalance | Closed: `OracleUnhealthy(FeedInvalid)` |
| Chainlink older than `maxStaleness` | same | Closed: `OracleUnhealthy(FeedStale)` |
| `pool.observe` over `twapWindow` fails (history too short, cardinality too low) | same | Closed: `OracleUnhealthy(TwapUnavailable)` |
| TWAP more than `maxDeviationBps` from Chainlink | same | Closed: `OracleUnhealthy(TwapDeviates)` |
| Spot more than `maxDeviationBps` from Chainlink | same | Closed: `OracleUnhealthy(SpotDeviates)` |
| Stock Token oracle paused, or inside the window around an `effectiveAt()` multiplier change | deposit, mint, withdraw, redeem, rebalance | Closed: `OracleUnhealthy(CorporateAction)`. `health()` reports status 6. A token that does not expose the reads counts as no corporate action. |
| Spot more than `maxSpotTwapBps` from the TWAP (default 10 bp, bound 1 to 50) | `rebalance` (keeper and anyone), on both sides | Closed: `SpotOffTwap`. Retry once the TWAP has caught up. Exits are not gated by the band. |
| Spot more than `maxSpotTwapBps` **below** the TWAP | deposit, mint, and through them every `instantDeploy` swap | Closed: `SpotOffTwap`. A spot above the TWAP is let through: deposits are priced at the lowest of Chainlink, TWAP and spot, so a high spot cannot make shares cheaper, and `UptickRouter.depositUsdg` lifts spot with its own buy. |
| TWAP more than `maxTwapOracleBps` from Chainlink (default 60 bp, bound 10 to 500; tighter than the shared `maxDeviationBps` gate) | `rebalance` (keeper and anyone) | Closed: `TwapOffOracle`. Stops a TWAP walked away from the feed in steps that each stay inside the band from being traded against. |
| Swap `minOut` | balancing swap on deploy: TWAP value of the input less the pool fee less `slippageBps`. Exit swap: Chainlink value less the pool fee less `slippageBps`. `UptickRouter.depositUsdg`: Chainlink value less the pool fee less its `slippageBps` | Closed: the router reverts, and a local balance-delta check backs it up with `SwapBelowMinimum` |
| Mint minimums | position mint and increase on deploy | Closed: the position manager reverts unless it takes at least `1 - slippageBps` of what the idle pair buys at the spot the mint sees |
| Shares minted in the current block | burn (`redeem`, `withdraw`, `redeemInKind`) and transfer of those shares | Closed: `SharesLocked`. Only the shares minted this block are held back, and a transfer neither moves nor creates a lock, so sending dust to an account cannot trap the shares it already had. |
| Owner queue | `setParams`, `setKeeper`, `setInstantDeploy`, `setSpotTwapBand`, `setTwapOracleBand`, `setEntryFee` | Closed until `queueChange` + 24 h and again 7 days after that (`CHANGE_GRACE`): the setters accept only a call from the vault itself, `executeChange` runs the queued calldata, `cancelChange` deletes it, and an expired entry can be queued afresh. Errors: `ChangeNotAllowed`, `ChangeQueuedAlready`, `ChangeNotQueued`, `ChangeTooEarly`, `ChangeExpired`. |
| Entry fee | deposit, mint | The vault keeps `entryFee` (pool-fee pips, default the pool's fee tier, never below it, at most 2%) out of every deposit: shares are minted against the assets net of it, so it accrues to the holders who stay. `previewDeposit`, `previewMint` and `maxMint` include it exactly. |
| Router vault argument | `UptickRouter.depositUsdg`, `redeemInKindMin` | Closed: `NotRegisteredVault` unless `VaultFactory.isVault` is true. The deposit amount is the swap output measured as a balance delta, so Stock Token stranded in the router is never swept into a deposit. |
| Feed description | `VaultFactory.createVault` | Closed: `BadFeed` unless the feed's description ends in `<symbol> / USD` |
| Exit buffer: proceeds below `previewRedeem` / requested assets | `withdraw`, `redeem` | Closed: `ExitBelowMinimum`. `redeemInKind` is the way out. |
| Exit proceeds | `redeem`, `withdraw` | The exiter receives what their own slice realises. `redeem` pays all of it, `withdraw` pays the requested assets and burns only the shares it needed. The slice is cut pro-rata and the spot price is inside `maxDeviationBps` of Chainlink at entry, so the gap an exit can collect is bounded by that tolerance and comes out of the exiter's own slice, never from the holders who stay. |
| Pause | deposit, mint | Closed. `maxDeposit` and `maxMint` return 0. |
| Deposit cap | deposit, mint | Closed above the cap. The room is measured on the deposit-side valuation, so assets in plus assets already held never exceed the cap; `maxDeposit` and `maxMint` return exactly what is accepted. |
| Keeper-only window | `rebalance` | Closed to non-keepers until 26 hours after the last rebalance, then open to anyone, still behind the oracle gate. |
| `minRebalanceInterval` | keeper `rebalance` | Closed with `TooSoon`. |
| Parameter bounds | constructor, `setParams`, the three band and fee setters | Closed: `BadParams`. `twapWindow` is capped at 1,800 s and at the pool's `observationCardinality`, so one observation per second cannot push the window out of the ring buffer. |
| Reentrancy guard | every state-changing entry point | Closed. |
| `redeemInKind` | none (no oracle, no swap, no pause) | Always open. If the oracle gate is `Ok` it harvests fees first; if not, it skips the harvest (open): the redeemer's slice of uncollected fees stays with the remaining holders and the treasury. |
| Stock Token transfer reverts for the receiver | `redeemInKind` | Open: the amount is credited to the receiver (`stockOwed`), excluded from NAV and from deployable inventory, and claimed with `claimStockOwed(to)`. |
| Stock Token transfer reverts | deposit, withdraw, redeem, rebalance | Closed: the token reverts and the whole call reverts with it. |
| Swap of a USDG leg under one US cent | exit, deploy | Open: the dust stays in the vault. |

## Accounting rules

- `totalAssets()` = idle Stock Token (excluding credited `stockOwed`) + idle USDG + position principal at the TWAP price + uncollected fees, with USDG converted at the lower of Chainlink and the TWAP, less the treasury's performance cut on the uncollected fees.
- Value in: `previewDeposit` and `previewMint` (and so `deposit` and `mint`) price against the vault's assets with the USDG leg converted at the lowest of Chainlink, the TWAP and spot. A lower price converts the USDG leg into more Stock Token, so that figure is the largest of the three views and a deposit gets the fewest shares. New shares are never cheaper than the cheapest view of the vault's value: a market that has fallen ahead of both the feed (deviation trigger, off-hours) and the 10-minute TWAP cannot be sold into the vault at the stale price, and deposit followed by `redeemInKind` returns the deposit less the entry fee. The entry fee (at least the pool's own fee tier) is retained in the vault, so entering the vault is never cheaper than selling the same stock into the pool, which is what makes a trade on a price the feed has not printed yet unprofitable for the first 30 bp on a 0.3% pool (5 bp on a 0.05% pool, 100 bp on a 1% pool). Shares are minted for the assets net of the fee: `previewDeposit` rounds down, `previewMint` rounds up, and both equal what `deposit` and `mint` then do. Pushing spot down inside one block to overcharge another depositor is bounded by the spot-to-TWAP band (10 bp by default, enforced below the TWAP) and costs the pusher the pool fee both ways; `UptickRouter.depositUsdg` takes `minShares` for callers that want a floor.
- Value out: no price enters what the holders who stay keep. `redeemInKind` hands out a pro-rata slice of the actual balances, and `redeem` / `withdraw` hand out that slice's swap proceeds. `totalAssets` (Chainlink and TWAP only, so the vault's own swaps cannot move the reported share price) feeds `previewRedeem` / `previewWithdraw`, the exiter's guarantee: after a fall it quotes less than the swap returns and the surplus is paid out, after a rise it quotes slightly more and the exit reverts with `ExitBelowMinimum` instead of underpaying anyone, and `redeemInKind` is the way out. Fee and refund mints price at the same `totalAssets`, so the share price is continuous through them.
- Uncollected fees are computed from the pool's fee-growth accumulators the same way the pool does it, with wrapping subtraction. A test compares the figure to the amount the position manager then pays out.
- Performance fee is taken only on fees collected from the position, minted as shares to the treasury. The mint is priced against assets net of the cut, so the share price does not move at harvest. Rounding goes down for the treasury.
- Virtual-share offset 6 (`_decimalsOffset`): shares have 24 decimals. A donation to the vault cannot make a later depositor round to zero shares without costing the donor more than the depositor loses.
- Rounding follows ERC-4626: down for assets out and shares in, up for assets in and shares out.
- Withdrawals and exits are pro-rata over idle balances and liquidity, so every exit leaves the per-share composition unchanged.
- Exits guarantee both sides. The exiter gets the actual proceeds of their pro-rata slice: `redeem` returns at least `previewRedeem` (the swap is refused below it, to within the one-cent USDG dust that is never swapped), and every wei the swap returns above that is paid out. `withdraw` sends exactly the assets requested and burns at most `previewWithdraw` shares: the part of the exit buffer the swap does not spend is returned to the owner as shares, priced against the assets of those who stay (net of the surplus, rounding down), and the allowance is charged for the shares actually burned. The holders who stay keep their assets per share across every exit, to within the rounding of the liquidity maths (a few raw USDG units) and in their favour. Measured on the real pool: a 400 NVDA deposit with `instantDeploy` followed by a 99% `redeem` leaves a 0.053 NVDA holder redeeming 0.0528 NVDA (the stake it deposited, less its own deploy cost), and the same dust holder behind a full exit or a `withdraw` of the same size redeems within the 1% oracle tolerance of her deposit.
- Approvals to the position manager and router are set to the exact amount and returned to zero in the same call.

## Quantities measured on the real pool

| Quantity | Value | How |
|---|---|---|
| 100 NVDA instant-deploy deposit then full redeem | about 5 bp round-trip cost | `test_depositWithdrawRoundTrip_instantDeploy` |
| NAV drift of six consecutive rebalances | under 40 bp | `test_repeatedRebalancesNeverRevert` |
| TWAP-composition NAV vs spot-composition value of the same holdings, 400 NVDA deposit with `instantDeploy` | about 6.5 bp | debug run at head; the gate bounds the gap at second order in `maxDeviationBps` |
| Pool NVDA price below the Chainlink answer on a Saturday, feed 10 h old | 38 bp | `sqrtOracle` against spot at head; inside the 100 bp gate |
| Deposit while the position holds 0.122 NVDA of uncollected fees, in-kind exit one block later | 399.999997 NVDA out of 400 | `test_depositIntoAccruedFeesCapturesNothing` |
| 8 bp front-run push around a 400 NVDA deposit and permissionless rebalance, exit one block later | attacker -0.059 NVDA | `test_M2_inBandPushAcrossBlocksIsUnprofitable` |
| Mint minimums against the real position manager | within 1 bp of 99% of the fill | `test_mintMinimumsMatchWhatThePositionManagerTakes` |
| Swap floor headroom at half the vault cap, nine live pools (margin = allowed cost - (fee + impact) - 10 bp) | 0.05% pools 29 to 75 bp, 0.3% pools 28 to 33 bp, 1% pools (GME, MSTR) 29 to 31 bp; allowed cost is 105, 130 and 199 bp per tier | `test_floorMarginAtHalfCap` |
| Full-cap deposit, keeper rebalance on AMZN, PLTR (0.3%), GME, MSTR (1%) | a position opens on all four, both token orders | `test_vaultRebalancesAFullCapDepositOnEveryTier` |
| `depositUsdg` on PLTR (0.3% pool, thinnest depth) | $500, $2,000 and $10,000 zaps mint shares | `test_routerDepositRevertsOnItsOwnImpact` |
| `depositUsdg` of $2,000 on GME (1% pool) | mints shares | `test_routerZapOnA1PercentPool` |
| 10-minute TWAP vs Chainlink on NVDA and PLTR over 36 h (1,086 samples each, every 2 minutes, `pool.observe` against `getRoundData`) | within 60 bp in 95.4% (NVDA) and 95.7% (PLTR) of all samples; within 50 bp in 100% and 99.6% of weekday samples (NYSE hours 100% and 99.0%, overnight 100% and 99.7%) | `maxTwapOracleBps` default |
| 90 bp TWAP drag, then permissionless rebalance, PLTR with 50 deployed and 50 idle | rebalance refused (`TwapOffOracle`); holders +0.0175 PLTR against -0.1460 for a rebalance with no attacker; attacker -0.2906 PLTR | `test_H1x_dragThenPermissionlessRebalance` |
| 50 bp off-chain drop, deposit and in-kind exit one block later, PLTR | depositor -0.0108 PLTR on 50, holders +0.0108 PLTR | `test_M1r_offChainMoveRoundTrip` |

## Bytecode size

StockVault's runtime code is 24,479 bytes against the EIP-170 limit of 24,576 (built with `via_ir` and `optimizer_runs = 1`); `test_runtimeCodeFitsEip170` fails the build if it grows past the limit. The tick, liquidity and fee-growth maths live in `VaultMath` (6,547 bytes), which each vault deploys in its constructor and reaches only by `STATICCALL`; the vault's creation code (36,013 bytes) embeds it, so the factory's pinned creation-code hash covers both.

## Test and mutation evidence

Each row deletes or breaks one guard in the source, runs the tests that cover it, expects red, restores the source and expects green.

| Mutation | Tests that went red |
|---|---|
| TWAP-vs-Chainlink bound removed | `test_oracleJumpWithoutPoolMoveBlocks`, `test_sustainedPushBlocksOnTwapDisagreement` |
| Spot-vs-Chainlink bound removed | `test_spotPushedThreePercentBlocksDeposit` |
| Swap `minOut` forced to 0 | `test_swapMinOutBlocksBadFill` |
| Exit proceeds check removed | `test_exitBeyondBufferRevertsInsteadOfUnderpaying` |
| Staleness check removed | `test_staleFeedBlocksRebalance`, `test_permissionlessRebalanceStillGatedByOracle` |
| Virtual-share offset set to 0 | `test_firstDepositorDonationAttackFails`, `testFuzz_donationAttackNeverProfits` |
| Uncollected fees not valued | `test_feeAccrualAndPerformanceFeeMath`, `test_pricePerShareContinuousThroughHarvest` |
| 26 hour permissionless gate removed | `test_rebalanceRespectsRoles`, `test_permissionlessRebalanceAfter26Hours` |
| Performance fee not minted | `test_feeAccrualAndPerformanceFeeMath` |
| Deposit pause not enforced | `test_depositCapAndPause` |
| Dust-swap guard removed | `test_tinyRedeemDoesNotRevert` |
| Exit proceeds capped at the shares' NAV, unspent `withdraw` buffer kept in the vault | `test_dustHolderGainsNothingFromPartialExit`, `test_dustHolderGainsNothingFromFullExit`, `test_dustHolderGainsNothingFromWithdraw`, `test_fullWithdrawKeepsOthersWhole`, `testFuzz_depositWithdrawNoFreeMoney` |
| Exits release 20% more liquidity than the shares' fraction | `invariant_exitsNeverDiluteRemainingHolders` (NAV per share fell to 0.75 in one exit) |
| Token-0 sqrt-price orientation flipped | `test_oracleMappingMatchesPoolForTokenZeroStock`, `test_roundTripAndRebalanceWithTokenZeroStock` |
| Shares minted this block burnable and transferable | `test_M2_depositRebalanceExit`, `test_sharesCannotLeaveInTheBlockTheyAreMinted`, `test_transferDoesNotDodgeOrCarryTheLock`, `test_dustDepositCannotTrapAnExistingHolder`, `test_lockAccumulatesWithinABlock` |
| Spot-to-TWAP band always true | `test_M1_inKindRoundTripAfterDrop`, `test_M2_sandwichedPermissionlessRebalance`, `test_M2_sandwichedInstantDepositIsRefused` |
| Deposit priced without the spot term | `test_M1_roundTripAfterDropInsideBandIsNeutral` (0.091 NVDA gained on a 400 NVDA round trip at a 9 bp drop) |
| Corporate-action gate removed | `test_pausedOracleClosesEveryPriceCheckedPathButNotRedeemInKind`, `test_windowAroundAMultiplierChange` |
| Setters callable without the queue | `test_settersCannotBeCalledDirectly` |
| Queue delay set to zero | `test_changeBeforeDelayReverts` |
| Deploy swap floor taken from Chainlink instead of the TWAP | `test_deploySwapFloorFollowsTheTwapNotTheFeed` (`Too little received`) |
| Mint minimum forced to zero | `test_mintMinimumsMatchWhatThePositionManagerTakes` |
| Uncollected fees left out of the deposit valuation | `test_depositIntoAccruedFeesCapturesNothing` (0.054 NVDA paid out on a 400 NVDA round trip) |
| `maxMint` priced on plain `totalAssets` | `test_maxMintCostNeverExceedsTheRoom` |
| Cap measured on plain `totalAssets` | `test_maxMintCostNeverExceedsTheRoom` (post-deposit total 0.164 NVDA over the cap) |
| Swap floor without the pool fee (deploy and exit) | `test_vaultRebalancesAFullCapDepositOnEveryTier` (`Too little received` on the 1% pools) |
| Router swap floor without the pool fee | `test_routerZapOnA1PercentPool` (`Too little received`) |
| Deposit and mint band two-sided again | `test_N2_depositAndMintAboveTwapPass`, `test_routerDepositRevertsOnItsOwnImpact` (`SpotOffTwap`) |
| Deposit and mint band removed | `test_N2_depositAndMintBelowTwapRevert` |
| TWAP-to-Chainlink bound removed from `rebalance` | `test_N3_rebalanceRefusedWhenTwapFarFromFeed`, `test_N3_boundIsQueuedAndRanged`, `test_H1x_dragThenPermissionlessRebalance` (holders -0.3299 PLTR against -0.1529 for the control) |
| Entry fee set to zero | `test_N4_defaultIsThePoolTier`, `test_N4_feeStaysWithHolders`, `test_N4_inKindRoundTripCostsTheFee`, `test_M1r_offChainMoveRoundTrip` (depositor +0.0644 PLTR) |
| Queue expiry removed | `test_L_queuedChangeExpires` |
| Observation-cardinality bound removed | `test_L_twapWindowBoundedByCapAndCardinality` |
| `twapWindow` cap raised back to one day | `test_L_twapWindowBoundedByCapAndCardinality` |
| Router registry check removed | `test_unregisteredVaultIsRefused`, `test_arbitraryAddressIsRefused` |
| Router deposit amount taken as the whole balance | `test_strandedStockIsNotDeposited` |
| Factory feed check removed | `test_feedOfAnotherTickerIsRefused` |

The stateful invariant run (random deposits, redeems, in-kind redeems and rebalances; 300 runs of 16 calls, 4,800 calls per invariant) holds seven invariants: sum of share values never exceeds NAV, no USD created, no lingering approvals, deposits never refused except by the oracle gate, rebalances never refused except by the oracle gate, redeems refused only by the gates, and no exit lowers NAV per share for the holders left. It surfaced the dust-swap case: a swap of a few raw units returns nothing because the pool rounds its fee up. The dust guard and `test_tinyRedeemDoesNotRevert` pin it.

Static analysis: `slither .` reports reentrancy and strict-equality findings on paths that sit behind `nonReentrant` and call only the immutable router and position manager; the return values it flags as unused are read back by balance delta instead.
