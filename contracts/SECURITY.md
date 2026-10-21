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
| Keeper | `rebalance()` once per `minRebalanceInterval` | Every deploy swap carries a `minOut` set by the higher of the TWAP value and the Chainlink value of its input (the lower price when it buys), less the pool fee and `slippageBps`, and the call is refused when spot sits more than `maxSpotTwapBps` from the TWAP or the TWAP sits more than `maxTwapOracleBps` (30 bp) from Chainlink, so one rebalance trades at no worse than the pool fee plus `slippageBps` against both references, and a TWAP walked away from the feed is refused. See Rebalance swap exposure. |
| Anyone | `rebalance()` once 26 hours have passed since the last one; `redeemInKind`; `claimStockOwed` for their own credit | The oracle gate, the spot-to-TWAP band, the 30 bp TWAP-to-Chainlink bound and both swap floors apply to them exactly as to the keeper. |
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
| TWAP more than `maxTwapOracleBps` from Chainlink (default 30 bp, bound 10 to 500; tighter than the shared `maxDeviationBps` gate) | `rebalance` (keeper and anyone) | Closed: `TwapOffOracle`. Stops a TWAP walked away from the feed in steps that each stay inside the band from being traded against. The keeper's tick retries every minute until the gap closes. |
| Swap `minOut` | balancing swap on deploy: the more demanding of the TWAP value and the Chainlink value of the input (the higher price when it sells the Stock Token, the lower when it buys), less the pool fee less `slippageBps`. Exit swap: Chainlink value less the pool fee less `slippageBps`. `UptickRouter.depositUsdg`: Chainlink value less the pool fee less its `slippageBps` | Closed: the router reverts, and a local balance-delta check backs it up with `SwapBelowMinimum`. A swap into a pool that sits below the feed (or above it, when buying) by more than the allowance does not fill, whatever the TWAP says. |
| Mint minimums | position mint and increase on deploy | Closed: the position manager reverts unless it takes at least `1 - slippageBps` of what the idle pair buys at the spot the mint sees |
| Shares minted in the current block | burn (`redeem`, `withdraw`, `redeemInKind`) and transfer of those shares | Closed: `SharesLocked`. Only the shares minted this block are held back, and a transfer neither moves nor creates a lock, so sending dust to an account cannot trap the shares it already had. The shares `withdraw` mints back for the unspent part of the exit buffer are minted in that block and so locked in it: a whole-balance `redeem` in the same block reverts, in the next block it goes through (`test_R3_withdrawRefundSharesAreLockedForTheBlock`). |
| Owner queue | `setParams`, `setKeeper`, `setInstantDeploy`, `setSpotTwapBand`, `setTwapOracleBand`, `setEntryFee` | Closed until `queueChange` + 24 h and again 7 days after that (`CHANGE_GRACE`): the setters accept only a call from the vault itself, `executeChange` runs the queued calldata, `cancelChange` deletes it, and an expired entry can be queued afresh. Errors: `ChangeNotAllowed`, `ChangeQueuedAlready`, `ChangeNotQueued`, `ChangeTooEarly`, `ChangeExpired`. |
| Entry fee | deposit, mint | The vault keeps `entryFee` (pool-fee pips, default the larger of the pool's fee tier and 3,500 = 35 bp, never below the tier, at most 2%) out of every deposit: shares are minted against the assets net of it, so it accrues to the holders who stay. `previewDeposit`, `previewMint` and `maxMint` include it exactly. |
| Router vault argument | `UptickRouter.depositUsdg`, `redeemInKindMin` | Closed: `NotRegisteredVault` unless `VaultFactory.isVault` is true. The deposit amount is the swap output measured as a balance delta, so Stock Token stranded in the router is never swept into a deposit. |
| Feed description | `VaultFactory.createVault` | Closed: `BadFeed` unless the feed's description ends in `<symbol> / USD` |
| Exit buffer: proceeds below `previewRedeem` / requested assets | `withdraw`, `redeem` | Closed: `ExitBelowMinimum`. `previewRedeem` is the shares' NAV less `exitBufferBps` less the pool's fee tier (the exit swap pays the fee on the USDG leg, up to its whole value), so a normal exit clears it on every tier, 1% pools included. `redeemInKind` is the way out. |
| Exit proceeds | `redeem`, `withdraw` | The exiter receives what their own slice realises. `redeem` pays all of it, `withdraw` pays the requested assets and burns only the shares it needed. The slice is cut pro-rata and the spot price is inside `maxDeviationBps` of Chainlink at entry, so the gap an exit can collect is bounded by that tolerance and comes out of the exiter's own slice, never from the holders who stay. |
| Pause | deposit, mint | Closed. `maxDeposit` and `maxMint` return 0. |
| Deposit cap | deposit, mint | Closed above the cap. The room is measured on the deposit-side valuation, so assets in plus assets already held never exceed the cap; `maxDeposit` and `maxMint` return exactly what is accepted. |
| Keeper-only window | `rebalance` | Closed to non-keepers until 26 hours after the last rebalance, then open to anyone, still behind the oracle gate, the 30 bp bound and the swap floors. |
| `minRebalanceInterval` | keeper `rebalance` | Closed with `TooSoon`. |
| Parameter bounds | constructor, `setParams`, the three band and fee setters | Closed: `BadParams`. `twapWindow` is capped at 1,800 s and must be shorter than the pool's `observationCardinality` (a pool serves at most `cardinality - 1` seconds under one write per second), so one observation per second cannot push the window out of the ring buffer. |
| Reentrancy guard | every state-changing entry point | Closed. |
| `redeemInKind` | none (no oracle, no swap, no pause) | Always open. If the oracle gate is `Ok` it harvests fees first; if not, it skips the harvest (open): the redeemer's slice of uncollected fees stays with the remaining holders and the treasury. |
| Stock Token transfer reverts for the receiver | `redeemInKind` | Open: the amount is credited to the receiver (`stockOwed`), excluded from NAV and from deployable inventory, and claimed with `claimStockOwed(to)`. |
| Stock Token transfer reverts | deposit, withdraw, redeem, rebalance | Closed: the token reverts and the whole call reverts with it. |
| Swap of a USDG leg under one US cent | exit, deploy | Open: the dust stays in the vault. |

## Rebalance swap exposure

A rebalance makes one balancing swap at the pool's price, and what a manipulator can take through it is the distance between that price and the real market times the size of the swap. The vault bounds the distance three ways: spot within `maxSpotTwapBps` (10 bp) of the TWAP, the TWAP within `maxTwapOracleBps` (30 bp) of Chainlink, and a swap floor at the more demanding of the TWAP and Chainlink values less the pool fee and `slippageBps`, so a pool dragged below the feed (or above it, when the vault buys) does not fill. A walk that stays inside the bound moves the TWAP slowly enough that every step passes, and what it takes grows with the distance walked. On the NVDA 0.05% pool with a whole $100K cap idle before the first rebalance, a 55 bp walk is refused (`TwapOffOracle`): the attacker ends 0.329 NVDA down and the holders at 0.000 against -0.586 for the rebalance with no attacker. A 29 bp walk goes through and takes at most the bound plus the 10 bp spot band times the swap: the holders end 0.638 NVDA below the control (14 bp of the $100K; (30 + 10) bp x the 232 NVDA swap = 0.93 NVDA), the attacker 0.837 NVDA up. The bound is 30 bp and not tighter because the feeds print only after a move of about half a percent, so a narrower bound would refuse the rebalance for most of the trading day (see the measurement below); the keeper retries every minute.

The permissionless path after 26 hours swaps too, behind the same bound and floors. It exists for a vault whose keeper has stopped: the position stays where the last rebalance left it and earns nothing once the price leaves the range, and a rebalance without a balancing swap cannot reopen a position then (a mint needs both tokens and the closed position is single-sided), so such a path would be least useful when it is needed. A caller who picks the moment gains nothing the keeper's schedule does not: a walk past 30 bp is refused whoever calls.

## Accounting rules

- `totalAssets()` = idle Stock Token (excluding credited `stockOwed`) + idle USDG + position principal at the TWAP price + uncollected fees, with USDG converted at the lower of Chainlink and the TWAP, less the treasury's performance cut on the uncollected fees.
- Value in: `previewDeposit` and `previewMint` (and so `deposit` and `mint`) price against the vault's assets with the USDG leg converted at the lowest of Chainlink, the TWAP and spot. A lower price converts the USDG leg into more Stock Token, so that figure is the largest of the three views and a deposit gets the fewest shares. New shares are never cheaper than the cheapest view of the vault's value: a market that has fallen ahead of both the feed (deviation trigger, off-hours) and the 10-minute TWAP cannot be sold into the vault at the stale price, and deposit followed by `redeemInKind` returns the deposit less the entry fee. The entry fee (at least the pool's own fee tier) is retained in the vault, so entering the vault is never cheaper than selling the same stock into the pool, which is what makes a trade on a price the feed has not printed yet unprofitable: a deposit made at the old price and taken out in kind the next block gains D*V/(V+D) * (m*u - fee) for an off-chain move m, a vault of value V, a deposit D and a USDG share u (about one half while the position is in range), so it pays only when m exceeds the fee over u. The 35 bp default breaks even at a 70 bp move, which 97.2% of the round-to-round changes of the NVDA, AAPL, GOOGL, SPY and QQQ feeds stay under (a 0.3% pool's own fee is 30 bp, a 1% pool's 100 bp). Shares are minted for the assets net of the fee: `previewDeposit` rounds down, `previewMint` rounds up, and both equal what `deposit` and `mint` then do. Pushing spot down inside one block to overcharge another depositor is bounded by the spot-to-TWAP band (10 bp by default, enforced below the TWAP) and costs the pusher the pool fee both ways; `UptickRouter.depositUsdg` takes `minShares` for callers that want a floor.
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
| Swap floor headroom at half the deposit cap, nine live pools (margin = allowed cost - (fee + impact) - 10 bp) | 0.05% pools 24 to 75 bp, 0.3% pools 28 to 34 bp, 1% pools (GME at a $25,000 cap, MSTR) 23 to 31 bp; allowed cost is 105, 130 and 199 bp per tier. GME's list cap of $49,212 cost 217 bp against 199 on 2026-10-20 (its pool has thinned since the cap was sized), so a rebalance at that cap would refuse the swap and the fixture runs GME at $25,000; `setDepositCap` is the lever for a pool that thins | `test_floorMarginAtHalfCap` |
| Full-cap deposit, keeper rebalance on AMZN, PLTR (0.3%), GME, MSTR (1%) | a position opens on all four, both token orders | `test_vaultRebalancesAFullCapDepositOnEveryTier` |
| `depositUsdg` on PLTR (0.3% pool, thinnest depth) | $500, $2,000 and $10,000 zaps mint shares | `test_routerDepositRevertsOnItsOwnImpact` |
| `depositUsdg` of $2,000 on GME (1% pool) | mints shares | `test_routerZapOnA1PercentPool` |
| 10-minute TWAP vs Chainlink on twelve vaulted pools (NVDA, AAPL, GOOGL, QQQ, SPY, AMZN, MU, PLTR, META, AMD, INTC, USO), 2,871 to 2,876 samples each, every 2 minutes over the 96 h to 20 Oct 2026 17:50 UTC (the pool's observation ring buffer against `getRoundData`, public RPC, about 390 NYSE-hours samples per pool) | within 30 bp in 76% to 91% of the NYSE-hours samples and within 60 bp in 96% to 100%; over all 96 h, weekend included, within 30 bp in 55% to 94% and within 60 bp in 70% to 100% | `maxTwapOracleBps` default |
| Round-to-round changes of the NVDA, AAPL, GOOGL, SPY and QQQ feeds (1,769 changes over 54 to 120 days each, `getRoundData`, public RPC) | median 52 bp, 90th percentile 59 bp, 95th 64.5 bp, 99th 96 bp; 97.2% at most 70 bp, which is the move a 35 bp fee breaks even on | `DEFAULT_ENTRY_FEE` |
| 90 bp TWAP drag, then permissionless rebalance, PLTR with 50 deployed and 50 idle | rebalance refused (`TwapOffOracle`); holders +0.0185 PLTR against -0.1459 for a rebalance with no attacker; attacker -0.2852 PLTR | `test_H1x_dragThenPermissionlessRebalance` |
| The same 90 bp drag, then an `instantDeploy` deposit by the attacker | PLTR (0.3% pool): the deposit reverts at the deploy swap's Chainlink floor; attacker -0.2852 PLTR, holders +0.0185. NVDA (0.05% pool, the floor allows 105 bp): a 400 NVDA deposit at 0 / 60 / 90 bp fills and the attacker ends -0.742 / -1.464 / -1.846 NVDA, alice +0.622 / +0.955 / +1.163 | `test_H1x_dragThenInstantDepositExitNextBlock`, `test_R4_instantDeployDragOutsideTheBound` |
| 55 bp TWAP drag, then permissionless rebalance, NVDA 0.05% pool with the whole $100K cap idle (465 NVDA), range 150 | rebalance refused (`TwapOffOracle`); holders 0.000 NVDA against -0.586 for a rebalance with no attacker; attacker -0.329 NVDA (-$71) | `test_R3_N3r_drag55_nvdaFirstRebalanceAtCap` |
| 55 bp drag, PLTR 0.3% pool, 120 PLTR idle / 50 deployed + 50 idle | refused; attacker -0.158 / -0.172 PLTR, holders 0.000 against -0.532 and +0.014 against -0.147 | `test_R3_N3r_drag55_firstRebalanceAtCap`, `test_R3_N3r_drag55_halfIdle` |
| 29 bp drag (inside the 30 bp bound), same NVDA state | rebalance goes through; holders end 0.638 NVDA below the control (14 bp of TVL, under (30 + 10) bp x the 232 NVDA swap = 0.93), attacker +0.837 NVDA | `test_R3_N3r_dragInsideBound_nvdaResidual` |
| Sell and buy deploy swaps with the feed 90 bp off the pool (TWAP bound widened to 100 bp), 460 NVDA idle / $100K USDG idle | no fill in either direction; the control with the feed on the pool fills | `test_R3_H1_sellSwapRevertsWhenPoolIsBelowTheFeed`, `test_R3_H1_buySwapRevertsWhenPoolIsAboveTheFeed` |
| 400 NVDA deposit into a 400 NVDA vault at the stale price, in-kind exit next block, NVDA 0.05% pool, 35 bp entry fee | 50 bp off-chain fall: depositor -0.183 NVDA (+0.394 at the old 5 bp fee), holders +0.183; 60 bp: -0.105; 100 bp: +0.297 (break-even 70 bp) | `test_R3_N4r_offChainMoveOnFivePipPool`, `test_R3_M1_breakEvenIsWhereTheFeeSays` |
| 400 NVDA deposited ahead of a 4,000 NVDA deposit into a 400 NVDA vault, in-kind exit next block | +0.467 NVDA, under half the fee the front-runner paid on its own 400 (0.7 NVDA); needs the later deposit to be visible before it is included | `test_R3_L1_entryFeeCaptureByFrontRunIsBounded` |
| `withdraw(maxWithdraw(owner))` for 20 holders of different sizes, NVDA 0.05% pool | all 20 succeed; before `previewWithdraw` inverted `previewRedeem`'s buffer-then-fee order, 3 of 20 reverted `ERC20InsufficientBalance` by about 1e6 share units (303,780 of the first 2,000,000 asset values on a 5-pip pool, 329,240 on a 1% pool; 0 after) | `test_R4_withdrawMaxWithdrawNeverReverts` |
| `withdraw` 10% then `redeem` the rest, $5K deployed, market unmoved, all 17 tokens of the deploy list (six 0.05% pools, nine 0.3%, two 1%) | both succeed on all 17 (GME and MSTR on 1% pools reverted `ExitBelowMinimum` before the pool fee entered `previewRedeem`) | `test_R3_erc4626ExitOnEveryListedToken`, `test_R3_erc4626ExitOnTiers` |
| 50 bp off-chain drop, deposit and in-kind exit one block later, PLTR 0.3% pool, 35 bp entry fee | depositor -0.0248 PLTR on 50, holders +0.0248 PLTR | `test_M1r_offChainMoveRoundTrip` |

## Accepted residuals

Each row is a measured bound the design accepts, with the lever that moves it.

| Residual | Numbers | Bound and levers |
|---|---|---|
| Drag inside the 30 bp rebalance bound (R3-H1) | NVDA, range 150, the whole $100K cap idle (about 464 NVDA, p0 $217.09), walks of 25 / 27 / 29 bp: attacker +0.563 / +0.582 / +0.601 NVDA ($122 / $126 / $130), holders' extra loss 0.501 / 0.532 / 0.563 NVDA (10.9 to 12.2 bp of the cap), drag $40.8K to $47.3K held 750 to 900 s. PLTR launch (120 idle, p0 $194.86): attacker +0.202 / +0.205 / +0.208 PLTR ($39 to $40), holders -0.135 / -0.143 / -0.151. PLTR half idle: attacker -0.048 to -0.053 (unprofitable). Attacker-alone upper bound: the fork has no arbitrageurs, and a real walk is held for 12 to 15 minutes against them | The holders' extra loss stays under (30 + 10) bp x the swap (`test_R4_nvdaDragSweepInsideBound`, `test_R4_pltrDragSweepInsideBound`); a 40 bp walk is refused and costs the attacker 0.300 NVDA (`test_R4_nvdaDrag40Refused`). The keeper draws its recentre minute per day inside 02:00 to 07:00 UTC from a local salt and holds a scheduled send while the TWAP is more than 15 bp off Chainlink, so the slot cannot be timed from the calendar and the keeper never sends into a half-walked TWAP |
| Deploy swap floor on the sell side after a fall (R4-L2) | META (0.3% pool, $96,476 in-range depth). A half-cap sell costs c bp including the 30 bp pool fee, read at two blocks of the live pool: 80 to 83 bp at $17,025, 92 to 96 at $21,000, 102 to 106 at $24,118. The floor allows 129 bp (pool fee plus `slippageBps`). At $24,118 the sell stops filling once the feed sits between 0 and 25 bp above the pool (fills to 20 at one block, refused at 25; refused from 25 to 30 at a later one); $21,000 fills at 30 bp at both | The Chainlink term of the floor stays. META deploys at a $17,025 deposit cap, 15% of its pool's in-range depth (`scripts/deploy-list.mjs` LIVENESS_SHARE): 16 to 19 bp short of the floor at the 30 bp bound, 6 to 9 bp after the 10 bp spot band. `test_R4_fullCapRebalanceAtTheBoundEdge` opens all 22 sell and buy rebalances on the 11 open vaults with the feed 28 bp off the pool; `test_R4_metaSellFloorThreshold` asserts the fill at every gap to 30 bp at the deploy cap. Next-closest margins at half cap: AAPL 28 bp, QQQ 31, SPY 33. `setDepositCap` is the immediate lever if the pool thins |
| Keeper slots the 30 bp bound misses (R4-L3) | 5 of 92 measured slot windows had no minute at which `rebalance()` passes (AMD 17 Oct, INTC 10 and 17 Oct, MU 17 Oct, SPY 15 Oct); none was a stale feed. NYSE hours: TWAP within 30 bp of the feed in 75.3% (INTC) to 91.7% (QQQ) of samples, rebalanceable in 50.1% (NVDA) to 80.9% (SPY), longest run without a rebalanceable sample 0.5 h (NVDA) to 2.97 h (AMZN) | A missed slot leaves the position where it is and the out-of-range trigger recovers it in the session; the TWAP deferral retries each minute through the window |
| Weekend stale feed | Feeds exceed `maxStaleness` (90,000 s) for about 28 h every weekend (840 to 870 of 2,881 samples in 96 h). `redeem`, `withdraw`, deposits and rebalance are closed then | `redeemInKind` needs no oracle and stays open (it is in the web app) |

## Bytecode size

StockVault's runtime code is 24,504 bytes against the EIP-170 limit of 24,576 (built with `via_ir` and `optimizer_runs = 1`); `test_runtimeCodeFitsEip170` fails the build if it grows past the limit. The tick, liquidity and fee-growth maths live in `VaultMath` (6,547 bytes), which each vault deploys in its constructor and reaches only by `STATICCALL`; the vault's creation code (36,068 bytes) embeds it, so the factory's pinned creation-code hash covers both. The `Deposited` and `Withdrawn` events that duplicated ERC-4626 `Deposit` and `Withdraw` are gone (nothing in the keeper, the app or the API read them), which paid for the Chainlink swap floor and the fee-aware previews.

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
| Deploy swap floor taken from the TWAP alone (Chainlink term removed) | `test_R3_H1_sellSwapRevertsWhenPoolIsBelowTheFeed` and `test_R3_H1_buySwapRevertsWhenPoolIsAboveTheFeed` (the swap fills with the feed 90 bp off the pool), `test_deploySwapFloorIsTheMoreDemandingOfTwapAndFeed`, `test_H1x_dragThenInstantDepositExitNextBlock` (the deposit into a 90 bp dragged pool goes through) |
| `maxTwapOracleBps` default 60 bp again | `test_N3_rebalanceRefusedWhenTwapFarFromFeed` (default 60 != 30), `test_R3_N3r_drag55_nvdaFirstRebalanceAtCap`, `test_R3_N3r_drag55_firstRebalanceAtCap`, `test_R3_N3r_drag55_halfIdle` (the 55 bp drag is no longer refused for the TWAP bound) |
| Entry fee defaults to the pool's own tier again | `test_N4_defaultIsTheLargerOfTierAndFloor` (500 != 3500), `test_N4_feeStaysWithHolders`, `test_N4_inKindRoundTripCostsTheFee`, `test_R3_N4r_offChainMoveOnFivePipPool` (depositor +0.419 NVDA on a 50 bp move), `test_R3_M1_breakEvenIsWhereTheFeeSays` (+0.518 NVDA on 60 bp) |
| `previewRedeem` / `previewWithdraw` without the pool fee | `test_R3_erc4626ExitOnTiers` (3 of 5 vaults exit: GME and MSTR revert `ExitBelowMinimum`) |
| `twapWindow` allowed to equal the observation cardinality | `test_L_twapWindowBoundedByCapAndCardinality` |
| Deploy list entry deployed whatever its `deployable` flag says / a missing flag accepted | `test_deployabilityGate` (both) |
| `Deposited` emitted again beside ERC-4626 `Deposit` | `test_R3_depositAndWithdrawEmitOnlyTheErc4626Events` |
| Share lock switched off (covers the `withdraw` refund shares) | `test_R3_withdrawRefundSharesAreLockedForTheBlock`, plus the rows of the lock mutation above |
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
| `previewWithdraw` grosses up by the buffer first and the pool fee second again (the round-3 order) | `test_R4_withdrawMaxWithdrawNeverReverts` (3 of 20 holders revert) |
| `maxTwapOracleBps` default 60 bp (round 4, drag 40 bp) | `test_R4_nvdaDrag40Refused` (the walk executes, attacker +0.701 NVDA, holders -1.184) |
| Entry fee defaults to the pool fee (round 4, every path) | `test_R4_entryFeeOnEveryPath` (a share bought at NAV + 5 bp) |
| DeployAll accepts a zero `depositCapTokens` without `ALLOW_UNCAPPED` | `test_zeroCapNeedsAllowUncapped` |
| DeployAll honours `ALLOW_CLOSED` on a node that is not a local anvil | `test_allowClosedRefusedOnARealChain` |
| DeployAll counts entries by `symbol` again (an entry without one ends the list silently) | `test_entryWithoutSymbolReverts` |
| Router registry check removed | `test_unregisteredVaultIsRefused`, `test_arbitraryAddressIsRefused` |
| Router deposit amount taken as the whole balance | `test_strandedStockIsNotDeposited` |
| Factory feed check removed | `test_feedOfAnotherTickerIsRefused` |

The stateful invariant run (random deposits, redeems, in-kind redeems and rebalances; 300 runs of 16 calls, 4,800 calls per invariant) holds seven invariants: sum of share values never exceeds NAV, no USD created, no lingering approvals, deposits never refused except by the oracle gate, rebalances never refused except by the oracle gate, redeems refused only by the gates, and no exit lowers NAV per share for the holders left. It surfaced the dust-swap case: a swap of a few raw units returns nothing because the pool rounds its fee up. The dust guard and `test_tinyRedeemDoesNotRevert` pin it.

Static analysis: `slither .` reports reentrancy and strict-equality findings on paths that sit behind `nonReentrant` and call only the immutable router and position manager; the return values it flags as unused are read back by balance delta instead.

# StockVaultV4 security reference

Scope: `src/v4/StockVaultV4.sol`, `src/v4/TickOracleV4.sol`, `src/v4/VaultMathV4.sol` and `src/v4/StockVaultV4Lens.sol`, plus `VaultFactory.createVaultV4`, `UptickRouter.depositUsdgV4` and `script/DeployAll.s.sol`'s v4 branch. StockVaultV4 reuses `VaultMath` and every StockVault guard in the sections above (oracle gate, spot-to-TWAP band, TWAP-to-Chainlink bound, entry fee, 24-hour owner queue, same-block share lock, corporate-action gate, Chainlink-floored swaps, the exit buffer, `redeemInKind` always open); this section covers what differs. Same convention: closed means the call reverts and no state changes.

## v4 trust assumptions

| Component | What the vault relies on |
|---|---|
| Uniswap v4 PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951` | The canonical deployment, an immutable address checked for code at construction. The vault holds its position there directly: one `unlock` per swap or liquidity change, both currencies settled before it returns, no position NFT, no Permit2, no approval to any address. The PositionManager (`0x58daec3116aae6D93017bAAea7749052E8a04fA7`) is not used: it would add an NFT custodian, Permit2 and a second unlock path, and the fee and liquidity reads the vault needs are PoolManager storage reads either way. |
| Pool key | A static LP fee of at most 2% (the dynamic-fee flag 0x800000 reverts `DynamicFeePool`, a higher fee `BadConfig`), an initialised pool (`PoolNotInitialised`), and a hook that is the zero address or has none of the address permission bits for before/after remove-liquidity, before/after swap, before/after add-liquidity or the four return-delta flags (`ForbiddenHook`), so only initialize and donate hooks pass. A hook without remove callbacks cannot revert a removal, so `redeemInKind` stays open; a hook without return-delta flags cannot take value outright; a hook with swap or add-liquidity callbacks runs inside the vault's own swap or add and can call the PoolManager from its callback to sandwich the vault up to its swap floor (review V4R-L1, measured 45 bp of NAV on a half-cap rebalance), so those are refused too. `VaultFactory` additionally refuses a hook the owner has not allow-listed (`HookNotAllowed`). |
| PoolManager protocol fee | The fee controller sets a protocol fee per pool and can change it at any time; the live PLTR 1% pool carries 1,000 pips (swap fee 10,990) and the TSLA 0.3% pool 500 pips (3,499). Every floor, preview and the entry-fee floor reads the live swap fee (`swapFee()`, the larger direction), not the key fee. |
| Observation ring | `TickOracleV4`, one per vault, written through `StockVaultV4.poke()`. See the next section. |
| Keeper | Calls `rebalance()` and, every 45 s, `poke()` (which anyone can call). A stalled keeper closes the priced paths after 2 minutes, never `redeemInKind`. |

## The TWAP source

A v4 pool keeps no observations and the pools that hold the depth are hookless, so a hook cannot supply one: no hook on 4663 serves observations (the SessionFeeHook, Fables, Doppler, Pons and launch hooks of `VENUES.md` are fee or launch hooks, dynamic-fee or return-delta), and an oracle hook only helps pools created with it. The vault keeps its own ring, `TickOracleV4`, written by `poke()`:

| Bound | Value | What it stops |
|---|---|---|
| Source of the tick | read from the PoolManager inside `record`, never passed by the caller | a caller choosing the tick |
| `MIN_GAP` | 20 s between observations | flooding the 128-slot ring; the ring always spans more than the longest window (1,800 s) plus `MAX_GAP` |
| Oracle band | the tick is clamped to the Chainlink tick plus or minus `maxDeviationBps` ticks (one tick is one bp) | recording a tick the gate itself calls deviant |
| `MAX_STEP` | 50 ticks from the previous observation | one observation dragging the average far however far spot is pushed |
| `MAX_GAP` | 120 s: `twap` needs the newest observation at most this old and no gap longer than this anywhere in the window; a longer gap restarts the record | extrapolating a stale tick across an outage; a single observation's weight is at most `MAX_GAP` of the window |

An observation is credited forward until the next one, as in a v3 oracle, so a tick written at time t weighs nothing at t. One sandwiched observation therefore moves a 10-minute average by at most `MAX_STEP` x the time to the next honest observation / the window: 50 x 45 / 600 = 3.75 ticks at the keeper's cadence, 10 ticks at `MAX_GAP`. What an attacker takes is still bounded by the guards that apply whatever the TWAP source is: the TWAP within `maxDeviationBps` of Chainlink on every priced path, the 30 bp `maxTwapOracleBps` bound and the 10 bp spot band on `rebalance`, and the swap floors, so the holders' loss from a walk inside the bound stays under (30 + 10) bp x the swap (the accepted residual R3-H1). The difference from a v3 pool is the price of the walk: a v3 TWAP must be held for ten minutes against arbitrageurs, a v4 observation is written in the block of a sandwich and the attacker needs about eight consecutive sandwiched observations (each paying the pool fee both ways) to move the average by 30 bp. `test_aSandwichedPokeMovesTheAverageByAtMostFiveTicks` measures one on a real pool.

Liveness is the price: priced paths (deposit, mint, withdraw, redeem, rebalance) need a gap-free record over `twapWindow` (10 minutes by default), so after a keeper outage of more than 2 minutes they close (`OracleUnhealthy(TwapUnavailable)`) until 10 minutes of observations exist again. `poke()` is permissionless, the keeper pokes every 45 s on its own loop, and `redeemInKind` reads no oracle.

## v4 guards and what they do when they trip

| Guard | Applies to | On trip |
|---|---|---|
| Dynamic-fee flag, fee above 2%, forbidden hook bits, uninitialised pool, PoolManager without code | construction (so `VaultFactory.createVaultV4`) | Closed: `DynamicFeePool`, `BadConfig`, `ForbiddenHook`, `PoolNotInitialised`, `BadConfig` |
| Hook not allow-listed; creation code not the pinned hash; feed of another ticker; v4 hash unset | `VaultFactory.createVaultV4` | Closed: `HookNotAllowed`, `WrongCreationCode`, `BadFeed`, `V4Disabled` |
| `unlockCallback` caller | the vault's PoolManager callback | Closed: `NotPoolManager` unless the caller is the PoolManager, which calls back only the contract that called `unlock` |
| Observation ring not a continuous record over `twapWindow`, or its newest observation older than 120 s | deposit, mint, withdraw, redeem, rebalance | Closed: `OracleUnhealthy(TwapUnavailable)` |
| Accrued fees paid out by the PoolManager on every liquidity change | deposit with `instantDeploy` into an open position, `rebalance`, `redeem`, `withdraw` | The vault harvests first (`_harvest`: collect with a zero-liquidity change, treasury cut minted against assets net of the cut), so the share price is continuous and the cut is not lost |
| Liquidity removal while the oracle gate is not Ok | `redeemInKind` | Open: the PoolManager pays the whole position's fees into the vault. The redeemer's slice is principal and idle balances only; the fees are recorded as pending (`pendingFee0/1`), the treasury's performance cut of them is deducted from NAV and held back from every later exit, and the next harvest mints it, so the treasury is paid and the share price does not move (review V4R-M1; StockVault gets the same result by leaving the fees owed in the position) |
| Swap floors | deploy and exit swaps, `depositUsdgV4` | As StockVault, with the swap fee (LP fee plus protocol fee) in place of the pool fee. The vault sends no price limit, so a partial fill fails the floor |
| Router vault argument | `depositUsdgV4`, `redeemInKindMin` | Closed: `NotRegisteredVault` unless `VaultFactory.isVault` (one registry for both vault types) |
| Router unlock callback | `UptickRouter.unlockCallback` | Closed: `NotPoolManager` outside a `depositUsdgV4` swap; the router holds no balances and returns an unspent input to the caller |

The mint minimum of StockVault is not carried over: the v3 position manager quotes liquidity at its own price, so a minimum guards the gap between quote and mint, while StockVaultV4 fits the liquidity itself (`VaultMathV4.fit`, stepped down until the amounts the PoolManager rounds up fit the idle balances) from the spot price the add sees, in the same call. The add takes at most the idle balances or the settle transfer reverts, and a minimum computed from the same price could not fail.

## v4 accounting differences

- `totalAssets()` is as StockVault with the position read from PoolManager storage: liquidity and the fees the PoolManager would pay on the next change (`VaultMathV4.position`, the pool's own fee-growth formula with wrapping subtraction). A test compares the figure to the amount the PoolManager then pays out.
- The liquidity add leaves a remainder idle: the balancing swap ignores its own price impact, so after it the range ratio at the new price needs slightly more of the other leg (under 10% of a deposit at 0.6% of pool depth, measured). It counts in NAV and is deployed at the next rebalance.
- The balance delta the PoolManager returns for a removal includes the fees accrued on the whole position; the vault subtracts the `feesAccrued` it also returns, so an exit releases principal only. Fees swept by a removal that no harvest preceded are tracked in `pendingFee0/1` until the next harvest; if every holder and the treasury have left by then, the pending cut stays in the vault.

## v4 bytecode size

StockVault is unchanged: runtime 24,504 bytes (72 under EIP-170), creation code 36,068, `forge build --sizes` before and after. StockVaultV4's runtime is 24,267 bytes (309 under the limit) and its creation code 43,901 (5,251 under the 49,152 initcode limit); it deploys `VaultMath` (6,547), `VaultMathV4` (4,001) and `TickOracleV4` (4,667) in its constructor. `StockVaultV4Lens` is 3,041, `VaultFactory` 8,597 (creation 9,850) and `UptickRouter` 7,616. The app views `totalValueInUSDG` and `currentRange` live in the lens and the position reads in `VaultMathV4.info` because the vault's runtime had no room for them; `test_runtimeCodeFitsEip170` fails the build if it grows past the limit.

## v4 test and mutation evidence

Fork tests run against the real PoolManager and real pools of PLTR (USDG is currency0, the Stock Token currency1, 1% fee, spacing 200) and TSLA (Stock Token currency0, 0.3% fee, spacing 60), both with a live protocol fee; the oracle ring and the liquidity fit are tested on their own (a brute-force TWAP model over 512 random observation sequences including ring wraps, 4,000 fuzzed liquidity fits). Each row breaks one guard in the source, runs the tests that cover it, expects red, restores the source and expects green.

| Mutation | Tests that went red |
|---|---|
| Dynamic-fee check removed (constructor) | `test_rejectsDynamicFeePool` (the flag falls through to `PoolNotInitialised`) |
| 2% fee cap removed | `test_rejectsAFeeAboveTwoPercent` |
| Forbidden hook permission bits cleared | `test_rejectsHooksThatCanTakeValueOrBlockAnExit` |
| Uninitialised-pool check removed | `test_rejectsAPoolThatDoesNotExist`, `test_aHookWithOnlyInitCallbacksPassesTheHookCheck` |
| `unlockCallback` sender check removed | `test_unlockCallbackIsPoolManagerOnly` |
| Oracle step bound (`MAX_STEP`) removed | `test_observationStepIsBoundedPerObservation`, `test_oneSandwichedObservationMovesTheAverageByAtMostStepTimesGapShare`, `test_aSandwichedPokeMovesTheAverageByAtMostFiveTicks` (the observation follows a 60 tick push in one step, 60 != 50), `test_anObservationFollowsTheFeedAwayFromThePoolByAtMostOneStep` |
| Oracle band around the Chainlink tick removed | `test_observationIsBoundedAroundTheOraclePrice` (222,000 != 217,100) |
| Oracle `MIN_GAP` removed | `test_minGapRefusesAndWritesNothing`, `test_pokeIsRateLimitedAndOnlyWritesWhenTheFeedIsUsable` |
| Oracle continuity check removed from `twap` | `test_gapInsideTheWindowIsNotAveragedOver` |
| Oracle freshness (`MAX_GAP`) check removed from `twap` | `test_gapLongerThanMaxGapRestartsTheRecord`, `test_aStalledKeeperClosesPricedPathsButNotRedeemInKind` |
| `TwapUnavailable` status removed | `test_noObservationsMeansNoTwapAndEveryPricedPathIsClosed`, `test_aStalledKeeperClosesPricedPathsButNotRedeemInKind` |
| TWAP-to-Chainlink bound removed from the gate | `test_aFeedJumpWithoutAPoolMoveClosesOnTheAverageFirst`, `test_depositRevertsWhenTheFeedAndThePoolDisagree` |
| Spot-to-Chainlink bound removed from the gate | `test_aPoolPushedAwayFromTheFeedClosesOnSpot` |
| Deposit spot-below-TWAP band removed | `test_depositIsRefusedWhenSpotIsPushedBelowTheAverageBeyondTheBand` |
| Rebalance spot-to-TWAP band removed | `test_rebalanceRefusedWhenSpotIsOffTheAverageOnEitherSide` |
| Rebalance TWAP-to-Chainlink bound removed | `test_rebalanceRefusedWhenTheAverageIsFarFromTheFeed` |
| Same-block share lock removed | `test_sharesCannotLeaveInTheBlockTheyAreMinted` |
| Corporate-action gate removed | `test_corporateActionClosesPricedPathsButNotRedeemInKind`, `test_windowAroundAMultiplierChange` |
| Sell-side deploy swap floor without the Chainlink price | `test_theDeploySwapFloorIncludesTheChainlinkPriceSelling` |
| Buy-side deploy swap floor without the Chainlink price | `test_theDeploySwapFloorIncludesTheChainlinkPriceBuying` |
| Swap fee ignores the PoolManager's protocol fee | `test_bindsTheRealPoolAndItsLiveFees` (10,000 != 10,990 on PLTR), `test_previewsPriceTheSwapFeeTheExitPays` |
| Entry fee set to zero | `test_entryFeeStaysWithTheHoldersAndIsAtLeastTheSwapFee` |
| No harvest before adding to an open position | `test_depositIntoAnOpenPositionHarvestsFirst` |
| Exit releases the fees together with the principal | `test_anInKindExitWithTheGateClosedLeavesTheFeesWithTheHoldersWhoStay` |
| Uncollected fees left out of the valuation | `test_uncollectedFeesAreInNav` (NAV 0.36% short), `test_feesAreValuedExactlyAndHarvestKeepsThePriceContinuous` |
| Harvest of an empty position not skipped | `test_fullInKindExitThenRedepositIntoTheEmptyRange` (`CannotUpdateEmptyPosition` from the PoolManager) |
| Router `depositUsdgV4` registry check removed | `test_routerRefusesAVaultTheFactoryDidNotDeploy` |
| Router `depositUsdgV4` Chainlink floor removed | `test_routerSwapFloorFollowsChainlinkNotThePool` |
| Factory v4 creation-code pin removed | `test_createV4RefusesWrongCodeDuplicateAndStrangers` |
| Factory hook allow-list removed | `test_createV4RefusesADynamicFeePoolAndForbiddenHooks` |
| Closed-gate sweep not recorded as pending fees (review V4R-M1) | `test_V4R_M1_closedGateInKindExitForfeitsTheTreasuryCut`, `test_V4R_M1_laterClosedGateExitsCannotTakeThePendingCut` (treasury 0 of a 9.8 PLTR cut at the pinned block) |
| Pending fees' cut held back from NAV removed | `test_V4R_M1_closedGateInKindExitForfeitsTheTreasuryCut` (price per share +0.18%: the holders absorb the cut) |
| Pending fees' cut not held back from later exits | `test_V4R_M1_laterClosedGateExitsCannotTakeThePendingCut` (the stayers' price per share falls 0.18%) |
| Harvest ignores pending fees | `test_V4R_M1_closedGateInKindExitForfeitsTheTreasuryCut`, `test_V4R_M1_laterClosedGateExitsCannotTakeThePendingCut` (treasury 0) |
| Swap and add-liquidity hook bits (7, 6, 11, 10) not forbidden (review V4R-L1) | `test_V4R_L1_aSwapHookSandwichesTheVaultInsideItsOwnSwap`, `test_rejectsHooksThatCanTakeValueOrBlockAnExit`, `test_createV4RefusesADynamicFeePoolAndForbiddenHooks` |

The mutations ran in four batches of guards with disjoint witness tests (one forge build per batch), the same tests on the restored source afterwards: 139 of 139 green (PLTR and TSLA vault suites 49 each, registry and router suites 14 each, oracle 10, liquidity fit 3). The review fixes (V4R-M1, V4R-L1) were mutated on the pinned fork and are the last five rows; the review's fork tests (5) run beside them. Two rows were run again alone because a batch hid them: the empty-position harvest (its call site was another mutation's target) and the uninitialised-pool check (the fee and hook checks it sits behind were also mutated).

One mutation survives: the step-down in `VaultMathV4.fit` (replace the `n0 <= a0 && n1 <= a1` test with an unconditional return). Across 300,000 fuzzed fits and every fork test the unrounded liquidity never needs more of a leg than is idle, because its own floors absorb the two roundings the PoolManager adds; the loop is defence in depth against a one-wei rounding case that no input has produced, and it is not claimed as a tested guard.

