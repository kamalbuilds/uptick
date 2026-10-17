# Min-out on liquidity removal, and the feed-lag deposit

Scope: `decreaseLiquidity` with `amount0Min = amount1Min = 0` in `_release` and `_closePosition`, and the deposit then `redeemInKind` cycle under a lagging Chainlink feed. Tests: `test/MinOut.t.sol`. All figures are Stock Token (NVDA) value at the fixed feed price on the real NVDA/USDG 0.05% pool, fork block 90902380 (`FORK_BLOCK=90902380`). Attacker = `trader`, who pushes the real pool inside the 100 bps gate, lets the victim call run, then swaps back.

## Decision 1: no min-out on decreaseLiquidity

Measured on the unmodified contract:

| Victim path | Pool pushed off the feed | Result |
|---|---|---|
| `redeem` | +39 bps | victim 19 bps below NAV; attacker net -16 bps |
| `redeem` | +49 / +60 bps (earlier harness) | 23 / 28 bps below NAV (worst success); attacker net -19 / -21 |
| `redeem` | +60, +70, +90, -90 bps | reverts (`ExitBelowMinimum` or the swap minOut) |
| `redeem` | -39, -60, -70 bps | victim at NAV (surplus stays in the vault); attacker net -44 to -75 |
| `withdraw` (full) | +40, -40, -70 bps succeed and pay exactly the assets; +70, +90, -90 revert | other holder NAV +11, +51, +65 bps |
| `redeemInKind` | +-50, +-90, +-300 bps | redeemer 0 to 49 bps above NAV; attacker net -31 to -252 |
| `rebalance` after a 3% recentre, 100 NVDA per holder | +89 bps | vault NAV -24 bps vs unattacked rebalance; attacker net -17 |
| same | -89 bps | vault NAV +25 bps; attacker net -59 |
| `rebalance`, 300 NVDA per holder | +90 bps | reverts `Too little received` (swap minOut) |
| `rebalance`, oracle unchanged | +-50 and +99 bps | vault NAV change 0 bps (no recentre swap) |

Why the zero minimums do not cost anything: removing liquidity while the pool is pushed returns a composition that is worth at least the unpushed composition at the true price (the pushed price is an arbitrage, and the pusher pays for it). The loss in each path comes from the swap that follows, and that swap is already bounded: exits by the `ExitBelowMinimum` floor (NAV less `exitBufferBps`, 30 bps), rebalance and deploy swaps by the Chainlink `minOut` (`slippageBps`). A per-leg floor derived from the oracle sqrt price at the 1% tolerance would reject honest 20% leg shifts, and a value floor would sit above the existing ones. `src` unchanged for this item; `MinOut.t.sol` keeps the bounds as regression tests.

Worst case seen: redeem 28 bps (inside the 30 bps buffer), rebalance 24 bps of NAV at 89 bps of deviation (about a quarter of the push; capped by `slippageBps` on the swapped notional). The attacker's net result was negative in every row.

## Decision 2: feed-lag deposit then redeemInKind reproduces, fixed

Cycle: Chainlink sits `gap` above the pool, attacker deposits 50 NVDA into a vault holding 100 NVDA, calls `redeemInKind`, sells the USDG leg back into the pool. Gain in bps of the deposit, original contract:

| fork block | gap 0 | gap 90 instantDeploy | gap 90 idle |
|---|---|---|---|
| 90902396 | -2 | 28 | 28 |
| 90900000 | -2 | 27 | 28 |
| 90890000 | -2 | 27 | 28 |
| 90880000 | -2 | 28 | 29 |
| 90870000 | -2 | 27 | 28 |
| 90500000 | | 27 | 29 |
| 90000000 | | 27 | 28 |

Mean 27.3 bps (instantDeploy) and 28.3 bps (idle), spread 27 to 29, baseline -2. Gap 60 gives 17 to 18 bps. The prior single-run estimate was +21 bps; the replicated figure is higher. Cause: NAV valued the USDG leg at the feed, so with the feed above the pool the USDG leg was priced below what the pool pays for it, shares were minted cheap, and `redeemInKind` (no gate, no swap) hands the leg back. Replicates share almost the same pool state (tick 222,484 to 222,651), so they are not independent samples of different markets. Block 89,000,000 was unusable (TWAP gate closed).

Change: `src/StockVault.sol`, new `_navPrice` (line 772), used in `_valuation` (line 761) and in the fee valuation inside `_harvest` (line 562). The USDG leg is valued at the lower of the Chainlink price and the pool TWAP price. TWAP, not spot, so a same-block push cannot move NAV (a spot-based version was tried and rejected: it made deposit pricing pushable). Runtime 24,085 to 24,132 bytes (headroom 444). Gap 60 and 90: gain 0 in both modes; gap -90 (feed below pool): -33 bps, the depositor overpays.

`test_exitCannotHarvestPoolOracleGap` in `StockVaultSafety.t.sol` asserted that the gap stays in the vault on exit. NAV now already prices the USDG leg at the pool, so the test asserts NAV ignores a feed above the pool, and that redeem pays at most NAV and at least NAV less the buffer.

Residual: an attacker who makes the gap himself (push the pool 60 bps below the unchanged feed, deposit, in-kind, sell, restore) nets -53 bps (instantDeploy) and -72 bps (idle) of the deposit at this pool depth, so it does not pay here. The break-even moves with the ratio of vault size to pool depth.

## Mutation results

| Guard broken | Test that went red | Restored |
|---|---|---|
| `_navPrice` returns the Chainlink price only | `test_depositThenInKindCannotHarvestFeedLag` (17 > 0 at gap 60), `test_exitCannotHarvestPoolOracleGap` | green |
| `ExitBelowMinimum` revert removed from `_exit` | `test_redeemSandwichBoundedByExitBuffer` (35 > 31) | green |
| `_minOut` returns 0 | `test_rebalanceSandwichOversizedSwapReverts` | green |

`test_withdrawSandwichNeverCostsTheOtherHolder` stayed green under the second mutation because the vault's own token transfer fails first; it asserts exact payment or revert, not the buffer. Its NAV-change bound of -3 bps absorbs a -2 bps move from the NAV price switching between Chainlink and TWAP.

## Run

`forge test` with `FORK_BLOCK=90902380`: 86 passed, 0 failed (7 in MinOut.t.sol). Unpinned (anvil head) the existing `test_rebalanceRecentresAfterRealPriceMove` fails with `ERC721: token already minted` on the unmodified contract too, so runs should pin the block.

Blind spots: one pool (NVDA 0.05%), one position size (100 NVDA per holder), a mocked feed at a fixed price, no live mempool, and gas costs are not in the attacker figures.
