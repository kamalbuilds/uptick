# StockVault re-review of commit 3612c71, 2026-10-20

Scope: the fixes for H1, M1, M2, M3, L3, L4 in `src/StockVault.sol`, `src/VaultMath.sol`, `src/UptickRouter.sol`,
`src/VaultFactory.sol`, read against `SECURITY.md` and `test/security/*`. Source untouched (mutations restored, `git diff
src/` empty). New tests: `test/security/ReReview.t.sol` (PLTR 0.3% pool, the thin case) and
`test/security/ReReviewFloor.t.sol` (nine live pools). Fork: public RPC `https://rpc.mainnet.chain.robinhood.com` at
head (blocks 93,288,133 to 93,298,814 during the run; the RPC keeps no history, so numbers are not pinned to one block).
Chainlink is mocked at the pool price at setup (p0 = $193.08 per PLTR), exactly as `Base.t.sol` does. Commands:
`forge test --match-path test/security/ReReview.t.sol -vv -j 1`, `forge test --match-path test/security/ReReviewFloor.t.sol -vv -j 1`.

Verdict: FIX-FIRST. The original atomic H1 sandwich and the M1 round trip are closed and the guards are proven by
mutation. Not fixed: the deploy-swap floor ignores the pool fee, so the 1% vaults cannot deploy at all. The band
added for H1 breaks `UptickRouter.depositUsdg` above about $1.1K on PLTR. Two value leaks remain that the fix does
not cover: a TWAP drag across blocks, and arbitrage on off-chain price information.

## Status of the claimed fixes

| Item | Status | Evidence |
|---|---|---|
| H1 atomic sandwich | Closed | `test_M2_sandwichedPermissionlessRebalance` green; band forced true -> red |
| H1 same-block exit | Closed | `test_sharesCannotLeaveInTheBlockTheyAreMinted` green; lock disabled -> red |
| M1 deposit at min(feed, TWAP, spot) | Closed for on-chain moves | `test_H1x_dragThenInstantDepositExitNextBlock`: drag 90 bp down, deposit, exit: attacker -0.375 PLTR, alice +0.006 |
| M2 queue | Closed, selector allowlisted | `test_queueRejectsOtherCallsAndDuplicates` green; allowlist removed -> red |
| M3 corporate-action reads | Correct names, fail-safe | `cast call` on NVDA 0xd0601CE...: `oraclePaused()=false`, `effectiveAt()=1788998430`, `uiMultiplier()=newUIMultiplier()=1000775159164630595` |
| L3, L4 | Closed | read; existing tests |

## High

### N1. Deploy and exit swap floors ignore the pool fee: 1% vaults can never rebalance, 0.3% vaults have no margin at cap
`StockVault.sol:764-770` (`_balanceInventory`), `:795-797` (`_minOut`), `:634` (exit swap). The floor is
`refValue * (1 - slippageBps)` with `slippageBps = 100` for every vault (`script/DeployAll.s.sol:50`). The swap returns
`value * (1 - fee) - impact`. On a 1% pool the fee consumes the whole allowance, so every deploy swap reverts
"Too little received" (the coordinator saw this on GME and MSTR). Each `rebalance()` and each `instantDeploy` deposit
then reverts. The vault never opens a position, and deposits sit idle. No funds are lost.
Measured (`test_floorMarginAtHalfCap`, swap of half the universe cap, both directions, live pools; margin = 100 - fee
and impact - 10 bp band):

| Pool | Fee | Half cap | Cost bp sell/buy | Margin bp |
|---|---|---|---|---|
| NVDA | 0.05% | $50,000 | 20 / 20 | 70 |
| GOOGL | 0.05% | $50,000 | 45 / 45 | 45 |
| SPY | 0.05% | $50,000 | 61 / 57 | 29 |
| QQQ | 0.05% | $33,393 | 66 / 64 | 24 |
| AAPL | 0.05% | $36,991 | 65 / 70 | 20 |
| AMZN | 0.3% | $34,250 | 84 / 87 | 3 |
| PLTR | 0.3% | $12,103 | 92 / 90 | -2 |
| GME | 1% | $24,606 | 158 / 156 | -68 |
| MSTR | 1% | $11,103 | 160 / 157 | -70 |

Half the cap is the swap that follows a fully out-of-range position, which happens on the first large move. At that
size PLTR reverts and AMZN sits 3 bp from reverting. The exit swap and `UptickRouter` minStock (`UptickRouter.sol:114`)
have the same fee-blind floor. On a 1% pool, `redeem` of a deployed slice also exceeds `exitBufferBps = 30`.
Fix: floor = `refValue * (1e6 - poolFee) / 1e6 * (1e4 - slippageBps) / 1e4`, and size `slippageBps` per pool from
measured impact at cap. Either do not deploy GME and MSTR on 1% pools or give them their own params.

## Medium

### N2. The H1 band breaks the router: `depositUsdg` reverts on its own swap above about $1.1K on PLTR
`UptickRouter.sol:120-131` buys the Stock Token in the vault's own pool, then calls `vault.deposit`, which runs
`_requireTight` (`StockVault.sol:470`, `:823-826`). The router's buy moves spot past the 10 bp band. Measured: pushing
PLTR 11 bp takes $1,151 of notional. `test_routerDepositRevertsOnItsOwnImpact`: a $500 deposit passes, a $2,000
deposit (cap $24K) reverts `SpotOffTwap`. NVDA's threshold is higher (deeper pool) but finite.
Fix: on deposit the band only needs to be one-sided. Deposits are priced at min(feed, TWAP, spot), so a spot above
the TWAP cannot cheapen shares. Require the band only for spot below the TWAP, or only when `instantDeploy` trades.

### N3. TWAP drag across blocks, then permissionless rebalance (H1 across blocks)
`StockVault.sol:578-590`, `:764-770`. The band limits spot to TWAP ± 10 bp, but the TWAP follows spot. Every 30 s the
attacker pushes spot 9 bp under the TWAP. After 3,150 s and $9,439 of notional, spot and TWAP both sit 90 bp under
Chainlink, inside the 100 bp gate, and the band is satisfied. The attacker then calls `rebalance()` (open to anyone
26 h after the last one; the keeper's schedule is predictable too). The vault sells idle deposits into the depressed
pool, floored only at TWAP value less 100 bp, and re-centres. The attacker then unwinds. No deposit is needed, so the
share lock does not apply.
Measured on PLTR with 50 deployed and 50 idle PLTR (`test_H1x_*`, values at p0):

| Run | Attacker | Holders |
|---|---|---|
| rebalance only (control) | 0 | -0.1485 PLTR (-$28.7) |
| drag + unwind, no rebalance | -0.2949 (-$56.9) | +0.0184 |
| drag + rebalance + unwind | -0.0774 (-$14.9) | -0.3341 (-$64.5) |

The drag moves 0.217 PLTR (0.44% of the idle amount) from holders to the attacker. Holders lose $35.9 more than in
the control. At this size the attack is a grief at 2.4:1. The drag cost is fixed (about the pool fee on the
notional); the transfer scales with idle inventory. Extrapolated (not measured): break-even is about 68 idle PLTR, and
on a 0.05% pool with a $100K cap the drag costs about 6x less per dollar of notional, so a large idle balance pays.
This assumes no arbitrageur fights the drag for 52 minutes.
Fix: on `rebalance`, require |TWAP - Chainlink| within a few bp, or floor deploy swaps at the worse-for-the-attacker
of the TWAP and Chainlink values. A longer TWAP for the floor (30 to 60 min) also multiplies the drag cost.

### N4. Off-chain price information still sells into the USDG leg fee-free (M1 residual)
`StockVault.sol:919-926`. min(feed, TWAP, spot) bounds on-chain staleness only. When the real price moves before the
feed (0.5% deviation trigger) and the pool reprice, a depositor who knows the new price deposits Stock Token, exits
in kind the next block, and holds USDG bought at the stale price. Measured (`test_M1r_offChainMoveRoundTrip`, 50 bp
off-chain drop): Bob +0.0641 PLTR on a 50 PLTR deposit (12.8 bp), Alice -0.0641. Selling in the pool instead costs
the 30 bp fee plus impact, so the vault is the cheapest venue for this flow. A time lock does not remove it, because
the gain is fixed at entry. Fix: an entry fee of at least the pool fee, kept in the vault.

## Low

- L-a. Band liveness. Live `observe()` over the last 24 h, sampled every 6 min: spot sat more than 10 bp from the
  600 s TWAP in 10.0% of samples on PLTR, 12.5% on NVDA, 7.9% on META, 3.3% on QQQ and 1.2% on GME. Deposits and
  keeper rebalances revert that often. Grief cost on PLTR: $3.45 of fee closes deposits and rebalance for 110 s, about
  $113/h with no arbitrage.
- L-b. Queue has no expiry (`StockVault.sol:284-297`). A change queued once can run months later without fresh notice.
  Add a grace window (for example 7 days after eta).
- L-c. `twapWindow` may be set up to 1 day (`:359`), above the pools' observation cardinality (PLTR 1,801; GME 1,860).
  At one observation per second, anyone can then make `observe` revert and close the gate. Bound it by cardinality,
  or keep it at 600.
- L-d. Every dividend multiplier step (`effectiveAt`) closes all gated paths for 2 h 10 min. `redeemInKind` stays
  open. Whether the feed quotes per raw token or per UI share across a split is still unverified (pre-existing).

## Checked, no finding

- M2: `executeChange` runs only the exact queued bytes, and `queueChange` admits only the four setter selectors. No
  path reaches `transfer`, `redeemInKind` or ownership via `address(this).call`. `setTreasury`, `pause` and
  `setDepositCap` cannot touch a holder's claim; the treasury only receives fee shares (at most 20% of fees).
- M3: a revert or malformed return in `oraclePaused`/`effectiveAt` only makes `health()` revert, which `redeemInKind`
  catches (`:535-540`). Gated paths fail closed. The window maths was checked against `test_windowAroundAMultiplierChange`.
- Same-block lock with pre-held shares: an attacker can exit older shares in the block, but still holds the new ones
  and bears his pro-rata share of the deploy loss. Back-running his own instant deploy on PLTR:
  attacker -0.0710 PLTR, Alice -0.0460 (`test_H1r_instantDepositBackrunOwnDeploy`), so this is not profitable.
- VaultMath: created with CREATE in the constructor, all functions view/pure, reached by STATICCALL, no delegatecall
  or selfdestruct, covered by the factory's creation-code hash.
- `stockOwed`, the fee cut on uncollected fees, the harvest and refund mint rounding: consistent. The `uint128` lock
  amount truncates only above 3.4e38 shares (informational).

## Mutation checks (run by this review)

| Mutation | Test | Mutated | Restored |
|---|---|---|---|
| `_nearTwap` returns true | `test_M2_sandwichedPermissionlessRebalance` | FAIL (no revert) | PASS |
| lock condition `false &&` | `test_sharesCannotLeaveInTheBlockTheyAreMinted` | FAIL | PASS |
| queue allowlist `&& false` | `test_queueRejectsOtherCallsAndDuplicates` | FAIL | PASS |

## Should there be a Veda-style time lock?

No. A lock would not stop N3, which needs no deposit. It would not stop N4 either, because the gain is fixed at
entry. Measured on the 0.3% pool, the deploy-cost back-run is already unprofitable. The right tools are an entry fee
of at least the pool fee (N4 and socialised deploy cost), a TWAP-to-Chainlink bound on rebalance (N3), and fee-aware
floors (N1).

## Blind spots

The fork has no arbitrageurs. That makes the drag cost a lower bound, and the live band data shows these pools do
trade. N3 profit on 0.05% pools and large idle balances is extrapolated, not measured. The feed is mocked.
