# Operator runbook: Uptick vaults and the share oracle

This runbook covers `StockVault`, `StockVaultV4` and `UptickShareOracle` on Robinhood Chain (4663). Each scenario names the signal that shows it, what the contracts do on their own, the exact calls the owner and the keeper hold, what a holder can always do, and what gets published. `scripts/incident-drill.sh` replays the keeper outage, stale feed and owner scenarios on a fork and fails if the contracts stop behaving as written here.

## The standing guarantee

`redeemInKind(shares, receiver, owner)` reads no oracle, runs no swap and ignores `pause`. It burns the holder's shares and sends the pro-rata slice of the vault's actual Stock Token and USDG, plus a pro-rata liquidity withdrawal from the position. It is open in every scenario below. When the gate is `Ok` it harvests fees first; otherwise it skips the harvest and the redeemer's slice of uncollected fees stays with the remaining holders and the treasury. If the Stock Token refuses the transfer to the receiver, the amount is credited to `stockOwed` and sent later with `claimStockOwed(to)`.

No owner function moves or sweeps user funds, pauses exits or renounces ownership. The owner's queued powers (`setParams`, `setKeeper`, `setInstantDeploy`, `setSpotTwapBand`, `setTwapOracleBand`, `setEntryFee`) wait 24 hours after `queueChange` and expire 7 days after that. Every queued change is emitted in full as `ChangeQueued(id, eta, data)`.

## Signals and where they show

| Signal | Where | Meaning |
|---|---|---|
| `health()` returns status 0 to 6 | `cast call $VAULT "health()(uint8,uint256,uint256,uint160,uint160,uint160)" -r $RPC`; returns status, Chainlink price, `updatedAt`, then the oracle, TWAP and spot square-root prices | 0 Ok, 1 FeedInvalid, 2 FeedStale, 3 TwapUnavailable, 4 TwapDeviates, 5 SpotDeviates, 6 CorporateAction. Anything but 0 closes deposit, mint, withdraw, redeem and rebalance. |
| `OracleUnhealthy(status)` revert | any priced call, simulated or sent | The same status, as the caller sees it. |
| Keeper `tick` line with `"guards_ok":false` and `guard_reasons` | keeper stdout, one JSON line per vault per poll | The keeper's own pre-check failed: `chainlink_stale` (feed older than `CL_MAX_AGE_S`, 87,000 s by default), `pool_chainlink_deviation` (pool spot more than `MAX_DEV_BPS`, 200 bp, from the feed), `chainlink_answer_invalid`, `pool_price_invalid`. When a rebalance was due the same line reads `"action":"blocked_by_guard"`. The keeper's pre-check is looser than the vault's: the vault gate closes at 100 bp, so between 100 and 200 bp the keeper sends and logs `simulate_failed` with `OracleUnhealthy(4)` or `(5)`. |
| Keeper `deferred_twap_off_feed` | keeper stdout | A scheduled rebalance waits while the TWAP sits more than 15 bp from the feed; the vault itself refuses at 30 bp (`TwapOffOracle`). |
| Keeper `simulate_failed`, `reverted`, `poke_failed`, `poke_reverted`, `error`, `fatal` | keeper stdout | The rebalance or poke simulation failed with the decoded reason (`OracleUnhealthy(2)`, `SpotOffTwap()`, `TwapOffOracle()` and so on), a sent transaction reverted, a tick threw, or the process exited. `simulate_failed` retries on the next tick. |
| No `Rebalanced` event after a trading day's slot | `Rebalanced(tickLower, tickUpper, fees0, fees1)` logs on the vault | Keeper not rebalancing. The scheduled slot is one recentre after each NYSE session, at a per-keeper minute between 02:00 and 07:00 UTC the next day, so the Friday session's slot lands on Saturday and none follows until Tuesday. A position out of range for 30 minutes and at least 2 hours since the last rebalance triggers one more. |
| `ChangeQueued`, `ChangeExecuted`, `ChangeCancelled`, `KeeperUpdated`, `TreasuryUpdated`, `DepositCapUpdated`, `Paused`, `Unpaused`, `OwnershipTransferStarted` | vault logs | Owner activity. A queued change shows its calldata and `eta` 24 hours ahead. |
| `loan_health_below_threshold` webhook | POST from `api/src/alerts.ts` to the subscriber's `https` URL, checked by the Worker cron every 10 minutes | A Morpho loan on a vault share fell below the subscriber's health factor (threshold 1.05 to 5). It carries the loan fields and the next step (`prepare_make_safer`). It watches loans, not vaults. |
| `FeedInvalid()` or `FeedTooOld(updatedAt)` from `oracle.price()` | `cast call $ORACLE "price()(uint256)" -r $RPC` | The share oracle refuses to price. |

Reading everything at once: `health()`, `totalAssets()`, `pricePerShare()`, `positionInfo()`, `lastRebalance()` and `oracle.price()` are plain `eth_call`s on the public RPC `https://rpc.mainnet.chain.robinhood.com`. `currentRange()` is on StockVault; StockVaultV4 exposes `positionOpen()`, `tickLower()` and `tickUpper()`.

## Scenarios

### 1. Stale Chainlink feed over a weekend

- **Detection:** `health()` status 2 once the feed is older than `maxStaleness` (90,000 s, 25 h, at deploy). Keeper ticks read `chainlink_stale` from 87,000 s. Every weekend outlasts the bound: the longest silence on the 17 vault feeds is 91.5 h (Labor Day 2026, `keeper/data/weekend-gaps.json`).
- **Automatic:** deposit, mint, withdraw, redeem and rebalance revert `OracleUnhealthy(2)` (FeedStale). `UptickShareOracle.price()` keeps answering the last print up to 349,200 s (97 h). Past 97 h it reverts `FeedTooOld`, which stops Morpho borrow, collateral withdrawal and liquidation until a print lands. On StockVaultV4 `poke()` writes nothing while the feed is older than `maxStaleness`, so the TWAP record breaks; the vault reopens `twapWindow` (600 s at deploy) after the first fresh print, with `health()` status 3 in between.
- **Owner:** nothing is required. `pause()` and `setDepositCap(cap)` are immediate and optional.
- **Keeper:** defers by itself and resumes without a restart; its poke loop restarts the v4 record on the first fresh print.
- **Holders:** `redeemInKind`.
- **Communication:** none by default for a weekend gap. For a gap past 97 h, publish that priced paths and Morpho actions are closed, exits in kind are open, and the vault reopens after the next print.

### 2. Feed divergence or USDG depeg

- **Detection:** status 4 (`TwapDeviates`) or 5 (`SpotDeviates`) when the pool's TWAP or spot sits more than `maxDeviationBps` (100 bp at deploy, bound 10 to 500) from Chainlink. Keeper ticks read `pool_chainlink_deviation` from 200 bp. The vault prices the Chainlink figure with USDG at 1.00 and has no USDG feed, so a USDG depeg past `maxDeviationBps` reads as the same pool-versus-feed gap.
- **Automatic:** the priced paths close while the pool and the feed disagree. The USDG leg is valued at the lowest of Chainlink, TWAP and spot when new shares are priced, and a spot more than `maxSpotTwapBps` (10 bp at deploy) below the TWAP closes deposit and mint (`SpotOffTwap`). Rebalance also needs the TWAP within `maxTwapOracleBps` (30 bp) of the feed (`TwapOffOracle`).
- **Owner:** `pause()` closes deposits at once; `setDepositCap(cap)` shrinks the room at once. Changing the gate itself (`setParams`, `setSpotTwapBand`, `setTwapOracleBand`) goes through the 24-hour queue, so the incident response is to hold the gate, not to move it.
- **Keeper:** defers on its own guard.
- **Holders:** `redeemInKind` pays the actual composition. For a USDG depeg the USDG leg is paid as USDG.
- **Communication:** state which leg diverged, that the gate is closed by design, and that exits in kind are open.

### 3. Keeper outage

- **Detection:** no `Rebalanced` log after a trading day's slot; the keeper process is gone or logged `fatal`.
- **Automatic, StockVault (v3):** priced paths keep working; the position stays where the last rebalance left it and earns nothing once the price leaves the range. A non-keeper `rebalance()` reverts `NotKeeper` until 26 hours after `lastRebalance`, then anyone can call it, still behind the oracle gate, the 30 bp bound and the swap floors.
- **Automatic, StockVaultV4:** the TWAP ring `TickOracleV4` needs a gap-free record, written by `poke()`. After 2 minutes without a poke the priced paths revert `OracleUnhealthy(TwapUnavailable)` until 10 minutes of observations exist again. `poke()` is permissionless, so anyone can restart the record.
- **Keeper action:** restart `bun src/keeper.ts` from `keeper/` with `VAULT_KEEPER_KEY` in `keeper/.env`. `bun src/keeper.ts --dry-run` reads and simulates without sending. The poke loop runs every 45 s on its own clock.
- **Owner:** to replace the keeper address, `queueChange(abi.encodeCall(setKeeper, (newKeeper)))`, then `executeChange` after 24 hours and within 7 days.
- **Holders:** `redeemInKind` always; deposits and exits on a v3 vault work throughout.
- **Communication:** only when a v4 vault closes its priced paths for more than a few minutes.

### 4. Corporate action or ERC-8056 multiplier change

- **Detection:** `health()` status 6. The vault reads the Stock Token's `oraclePaused()` and `effectiveAt()`.
- **Automatic:** priced paths close while the token's oracle is paused and from one hour before until one hour plus `twapWindow` after `effectiveAt()` (2 h 10 min at the default 600 s window). Every multiplier step closes the window, ordinary dividend accruals included. `UptickShareOracle.price()` keeps answering the last print, so Morpho liquidations continue, and the liquidator leaves with the underlying through `redeemInKind`.
- **Owner:** none. The window is not adjustable.
- **Keeper:** `simulate_failed` with `OracleUnhealthy(6)` on each due tick until the window ends, then resumes.
- **Holders:** `redeemInKind`.
- **Communication:** for a split or a paused oracle, publish the window and that exits in kind are open. Routine dividend steps need no note.

### 5. Pool liquidity drain

- **Detection:** keeper `simulate_failed` with `SwapBelowMinimum`; user exits reverting `ExitBelowMinimum`; `positionInfo()` showing the position out of range; the pool's in-range liquidity read from the pool.
- **Automatic:** every swap carries a floor: the rebalance's balancing swap the more demanding of the TWAP and Chainlink values, the exit swap of `redeem` and `withdraw` the Chainlink value, each less the pool fee less `slippageBps`. A thin pool does not fill, so the call reverts (`SwapBelowMinimum`) and no state changes. An exit whose proceeds fall short of `previewRedeem` reverts `ExitBelowMinimum` instead of underpaying.
- **Owner:** `setDepositCap(cap)` to a lower value and `pause()` take effect at once. `setParams` (for example `slippageBps`) waits 24 hours, and widening the floor against a thinning pool is not the response.
- **Keeper:** retries each tick; the scheduled rebalance is not forced through the floor.
- **Holders:** `redeemInKind` withdraws liquidity pro-rata and does not swap, so pool depth does not change what it pays.
- **Communication:** name the pool, say the swap floors are refusing fills, and point holders to the in-kind exit.

### 6. Oracle price anomaly on a Morpho market

- **Detection:** compare `cast call $ORACLE "price()(uint256)"` with the vault's `pricePerShare()` and the Chainlink answer; a `loan_health_below_threshold` webhook from a watched loan; `FeedInvalid()` or `FeedTooOld` from the oracle.
- **Automatic:** `UptickShareOracle` has no owner, no setters and no upgrade path. It prices the share from the Chainlink answer and the vault's own balances, never from pool spot, so a swap in the pool cannot move it (a 3% buy push moved the price 0.97 bp on the fork). It reverts on an invalid feed and past 97 h. Its `totalAssets()` cap only lowers the figure.
- **Owner:** the oracle has nothing to switch. A market's oracle, LLTV and IRM are fixed in Morpho Blue at creation and the singleton's owner is a third party, so the response is at the application: remove the market from `web/lib/collateral-markets.json` and run `npm run sync` in `api/`, which copies it to `api/data/collateral-markets.json` for the MCP server (`MARKETS` in `api/src/loan-chain.ts`) and the alert Worker, so the app and the MCP server stop pointing at it.
- **Users:** borrowers repay or add collateral (`prepare_make_safer`); lenders withdraw idle supply; a liquidator exits the seized shares with `redeemInKind`.
- **Communication:** publish the market id, the oracle address, the figure read on both sides, and the borrower and lender actions above.

### 7. Compromised keeper key

- **Detection:** `Rebalanced` events the schedule does not explain; a keeper address balance moving without the process running.
- **Automatic:** the key can call `rebalance()` once per `minRebalanceInterval` and nothing else. It cannot move funds, change parameters or pause. Each rebalance is still behind the oracle gate, the 10 bp spot-to-TWAP band, the 30 bp TWAP-to-Chainlink bound and a swap floor, so one rebalance trades at no worse than the pool fee plus `slippageBps` against both references.
- **Owner:** `queueChange` of `setKeeper(newKeeper)` immediately (`cast calldata "setKeeper(address)" $NEW`, then `cast send $VAULT "queueChange(bytes)" $DATA`), `executeChange($DATA)` once the 24 hours pass. From that block the old key is an ordinary caller: `rebalance()` reverts `NotKeeper` until 26 hours after the last rebalance. Until then `pause()` and `setDepositCap(cap)` stop the vault taking new deposits; they do not shrink existing holdings.
- **Keeper:** stop the old process, generate the new key offline, place it in `keeper/.env` yourself, start the process after `executeChange`.
- **Holders:** `redeemInKind`.
- **Communication:** the keeper address changed, the bound on what the old key could do, the `ChangeQueued` transaction.

### 8. Owner key compromise

- **Detection:** any owner log from the signals table that no signer sent. `ChangeQueued` carries the calldata 24 hours ahead.
- **Automatic:** ownership is a multisig behind `Ownable2Step` (`transferOwnership`, then `acceptOwnership` from the new owner), and `renounceOwnership` reverts. The immediate powers are `pause`, `unpause`, `setDepositCap` and `setTreasury`: they shrink or reopen deposits and redirect only the performance-fee shares minted from then on. Queued powers are range-checked on execution and cannot touch a holder's claim.
- **Owner (remaining signers):** `cancelChange(id)` with `id = cast keccak $DATA` deletes a queued change at any time inside its window; `setTreasury(safeAddress)` restores the fee recipient; `transferOwnership(newMultisig)` starts a rotation, and a pending transfer is replaced by a new `transferOwnership`. With the quorum lost, the 24-hour delay is the response window.
- **Holders:** `redeemInKind` inside the 24 hours, before any queued change can run.
- **Communication:** the changed or queued parameter, its `eta`, the exit path, and the new owner address once rotated.

## Publishing

Every note carries four lines: what the contracts did on their own, what is open (`redeemInKind`, always), the transaction hashes behind it, and the next check time. Notes go to the product's X account, @uptickfi; a webhook subscriber is reached by the Worker, not by hand. Figures in a note come from an `eth_call` with its block number.

## The drill

```bash
bash scripts/incident-drill.sh          # exit 0: every documented behaviour held
DRILL_BREAK=1 bash scripts/incident-drill.sh   # one expectation flipped: exit 1 at B1
```

It forks 4663 from the public RPC on its own anvil, deploys an NVDA vault with `contracts/script/Deploy.s.sol`, seeds a holder, and asserts:

| Step | Asserted behaviour |
|---|---|
| A1 to A4 | With the keeper silent a stranger's `rebalance()` reverts `NotKeeper`; deposits still mint; the keeper tick passes its guards while the feed is fresh; at 27 hours the stranger's call no longer reverts `NotKeeper` and reverts `OracleUnhealthy(2)` |
| B1 to B6 | At 30 hours `health()` is 2; deposit, redeem and the keeper's rebalance revert `OracleUnhealthy(2)`; the keeper dry run defers with `chainlink_stale`; `redeemInKind` returns the holder's NVDA and zeroes the shares |
| C1 to C3 | `pause()` zeroes `maxDeposit`, refuses deposits, leaves `redeemInKind` open; `executeChange` of `setKeeper` reverts `ChangeTooEarly` at once and succeeds after 24 hours; the retired keeper then reverts `NotKeeper` |
| C4 to C5 | A queued change deleted by `cancelChange(keccak(data))` reverts `ChangeNotQueued` on `executeChange`; `renounceOwnership()` reverts `BadConfig`; `transferOwnership` leaves the owner in place until the new owner calls `acceptOwnership()` |
