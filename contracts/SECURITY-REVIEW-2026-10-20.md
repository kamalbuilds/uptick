# StockVault money-path review, 2026-10-20

Scope: `src/StockVault.sol`, `src/UptickRouter.sol`, `src/VaultFactory.sol`, read against `SECURITY.md` and `test/`.
Evidence: `test/security/InKindArb.t.sol`, run on a Robinhood Chain (4663) fork of the public keyless RPC at head
(the local anvil on :8545, pid 37114, stopped answering `eth_blockNumber` mid-run and was left alone). Run with
`forge test --match-path 'test/security/*' -vv -j 1`.

Verdict: FIX-FIRST (one High, three Medium; no Critical found).

## Results of the new tests

| Test | Result | Measured |
|---|---|---|
| `test_M1_control_noMove` | PASS | bob round trip pnl -0.0000012 NVDA, alice +0.0000012 |
| `test_M1_inKindRoundTripAfterDrop` | FAIL (finding) | bob +0.844 NVDA on a 400 NVDA round trip, alice -0.844 NVDA |
| `test_M2_control_rebalanceAlone` | PASS | alice -0.00055 NVDA from a plain permissionless rebalance |
| `test_M2_depositRebalanceExit` | FAIL (finding) | attacker -0.005 NVDA, alice -0.203 NVDA (40:1 grief) |
| `test_M2_sandwichedPermissionlessRebalance` | FAIL (finding) | attacker +0.145 NVDA profit, alice -0.784 NVDA (about 20 bp of her 400) |

Values are in NVDA at a fixed reference price (M2) or at the post-move market price (M1). Alice is a 400 NVDA holder
in a deployed vault; the attacker uses 400 NVDA of capital.

## High

### H1. Anyone can force a deploy of their own deposit and sandwich it; remaining holders pay
`StockVault.sol:485-497` (rebalance, permissionless branch at 486-490), `:394-398` (`_afterDeposit` deploy under
`instantDeploy`), `:641-654` (`_balanceInventory`), `:622-634` (mint/increase with zero mins), `:695-697` (`_minOut`
floored only at oracle minus `slippageBps`).

Shares are priced before the deploy, so the cost of swapping a deposit into the range (fee, impact, and any spot
offset inside the gate) is socialised over all holders, and `redeemInKind` lets the depositor leave without paying it.
Sequence, one transaction, needs no mempool:
1. Wait until `lastRebalance + 26h`. This happens every weekend: the equity feed is silent 50 to 60 h, the gate closes
   after `maxStaleness` (25 h), the keeper is locked out, and at the Monday 00:00 UTC round the call is open to anyone.
   With `instantDeploy = true` no wait is needed at all, every `deposit` deploys.
2. Push spot about 60 bp down (inside the 100 bp gate).
3. `deposit(X)`, `rebalance()`: the vault sells roughly half of X at the depressed spot (floor is oracle minus 1%).
4. Swap spot back, capturing the vault's fill. `redeemInKind` the shares.

Measured: attacker +0.145 NVDA, alice -0.784 NVDA. Without step 2 the attacker loses 0.005 to cost alice 0.203.
With owner-allowed params (`maxDeviationBps` and `slippageBps` at 500) the extractable share scales roughly 5x.

Fails before fix: `test_M2_sandwichedPermissionlessRebalance`, `test_M2_depositRebalanceExit`.
Fix: make the depositor pay their own deploy. Options, any one closes the round trip: an entry buffer on
`previewDeposit`/`previewMint` mirrored on `exitBufferBps` and kept in the vault; or a lock so shares minted since the
last rebalance cannot `redeemInKind` until after the next one; and for the permissionless path, require spot within a
few bp of the TWAP (not just within `maxDeviationBps` of Chainlink) and floor swaps at the TWAP value, not oracle minus 1%.

## Medium

### M1. Stale `_navPrice` lets anyone sell Stock Token to the vault above market, fee-free
`StockVault.sol:784-786` (`_navPrice = min(feed, TWAP)`), `:370-380` (deposit), `:435-468` (`redeemInKind`).

deposit followed by `redeemInKind` exchanges the deposited stock for a pro-rata slice whose USDG leg was valued at
`_navPrice`. When the market falls and neither the 10-minute TWAP nor Chainlink (0.5% deviation trigger, latency,
off-hours) has caught up, `_navPrice` is above spot and the round trip is a free sale at the stale price. A
self-made spot move does not work (TWAP is unaffected in one block); a real move does, for up to `twapWindow` after each
drop of less than `maxDeviationBps`. The same arb works through `redeem` at the cost of the pool fee.
Measured on a 0.9% drop: bob +0.844 NVDA, alice -0.844 NVDA. Control without the drop is neutral.
The `_navPrice` comment and the SECURITY.md exit-proceeds row state the opposite of what this test shows.

Fails before fix: `test_M1_inKindRoundTripAfterDrop` (control `test_M1_control_noMove` green).
Fix: price deposits at `min(feed, TWAP, spot)`. Spot can then only be pushed to make deposits dearer; the H1 entry
buffer also covers it.

### M2. No timelock on owner powers; params plus keeper become an hourly extraction pump
`StockVault.sol:220-235`, bounds at `:261-270`.
The owner can, in one block, set `maxDeviationBps = 500`, `slippageBps = 500`, `minRebalanceInterval = 1h`,
`setKeeper(eoa)`, `setInstantDeploy(true)`. That keeper can then run H1 every hour at about 5x the measured loss.
Users can escape through `redeemInKind`, but get no notice. Fix: timelock (24 to 48 h) on `setParams`, `setKeeper`,
`setInstantDeploy`; or tighter hard bounds (deviation and slippage at 200 bp).
Test: none written; follows from H1 with `_m2` run after `setParams`.

### M3. Corporate actions are invisible to the vault and the feed is immutable
`StockVault.sol:198` (feed immutable), `:716-737` (`_read` never reads `uiMultiplier`, `newUIMultiplier`, `effectiveAt`,
`oraclePaused`). NVDA on chain right now: `uiMultiplier() = 1.000775e18`, so the multiplier does move (dividend
adjustments). If the token's multiplier step and the feed's adjustment land at different times, a step under
`maxDeviationBps` keeps the gate open and opens the M1 window at that size; a split-sized step closes every gated path
until the feed catches up, and if the feed convention ever diverges permanently there is no setter: the vault is left
on `redeemInKind` with a frozen range. Fix: gate (closed) for a window around `effectiveAt` when
`newUIMultiplier != uiMultiplier`, and honour `oraclePaused()`.
Test: none; which unit the RHNVDA/USD feed quotes in (per raw token or per share) is unverified on chain.

## Low

- L1. `totalAssets`, `convertTo*`, `preview*`, `maxDeposit` revert on `FeedInvalid` (`:280-283`, `:340-346`,
  `:702-706`); `maxWithdraw`/`maxRedeem` do not return 0 when the gate is closed. ERC-4626 says they must not revert
  and should reflect limits; integrators (lending markets, aggregators) will break.
- L2. Performance fee is charged on fees the vault's own balancing swaps paid into its own position (`:565-585`).
- L3. `UptickRouter` trusts any `vault` argument (`UptickRouter.sol:77`, `:117`); `stockReceived` is the router's whole
  balance (`:105`). Anything ever stranded in the router can be taken through a fake vault. Check
  `VaultFactory.isVault` or measure balance deltas.
- L4. `VaultFactory.createVault` (`VaultFactory.sol:84`) does not check the feed belongs to the stock (description,
  decimals). A wrong feed mostly fails closed at the gate, but a feed within 1% of another ticker would not.
- L5. No sequencer-uptime check; on an Orbit restart the feed and pool can both be stale and agree, so the gate opens on
  stale state. Documented in SECURITY.md.

## Checked and found sound

First-depositor and donation: offset 6 holds; pro-rata release ignores the virtual shares, which moves value toward a
victim, not away. Rounding: every preview and convert rounds against the caller, harvest and refund mints round down.
Fee mint: priced against gross minus cut, PPS continuous. Reentrancy: every mutating entry is `nonReentrant`, NPM v3
`mint` does not call `onERC721Received`, the `try` paths cannot be gas-griefed into a useful state (1/64 rule leaves too
little gas). `depositCap`: enforced on `deposit`, `mint` and the router path. Router minOut: decimals match the vault's
`_usdgToStock` exactly; approvals reset. Chainlink: answer, timestamp, future timestamp and `answeredInRound` checked.
Sandwiching a `redeemInKind` removal is unprofitable (the removed slice is worth more at the true price, not less).
Owner cannot sweep, upgrade, change feed, pool or router, or pause exits.

## Blind spots

The fork has no other traders, so M1 and H1 magnitudes assume the attacker is first after the move or the 26 h mark.
Fixes were not applied (read-only), so no test was seen to turn green after a fix; the controls show the checks can pass.
