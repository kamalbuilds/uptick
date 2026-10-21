# StockVaultV4 review (Uniswap v4 adapter), 2026-10-22

Scope: `src/v4/StockVaultV4.sol`, `src/v4/TickOracleV4.sol`, `src/v4/VaultMathV4.sol`, `src/v4/StockVaultV4Lens.sol`,
`VaultFactory.createVaultV4` / `_poolId` / `setHookAllowed`, `UptickRouter.depositUsdgV4` / `_swapV4` / `unlockCallback` /
`_settle` / `redeemInKindMin`, `DeployAll._createV4`, branch `v4-adapter` (`git diff main..v4-adapter`, commits `fd09a1b`
to `bbbb0a9`; head moved to `520ed70` during the review, a test-only commit, `src/` identical). Source untouched: the only
new file is `test/security/v4/ReviewV4.t.sol` (1 contract, 4 tests, 3 helper contracts). Fork: public keyless RPC
`https://rpc.mainnet.chain.robinhood.com` at head (block 94,636,571, 2026-10-21 22:40 UTC; the RPC keeps no history, so
numbers are not pinned). Chainlink mocked at the pool price as `V4Fixture` does. No arbitrageurs on the fork: attacker
numbers are the attacker-is-alone bound. One forge process at a time, `-j 1`.

Commands (each run alone):
- `forge test --match-path test/security/v4/ReviewV4.t.sol --match-test test_V4R_M1 -j 1 -vv`: **FAIL** (V4R-M1 below).
- `forge test --match-path test/security/v4/ReviewV4.t.sol --match-test test_V4R_L1 -j 1 -vv`: **FAIL** (V4R-L1 below).
- `forge test --match-path test/security/v4/ReviewV4.t.sol --match-test test_V4R_ringWalkCost -j 1 -vv`: PASS (measurement).
- `forge test --match-path test/security/v4/ReviewV4.t.sol --match-test test_V4R_idleRemainderAtTheCap -j 1 -vv`: PASS (measurement).
- `forge build --sizes`: StockVaultV4 runtime 23,976 B (600 B headroom), creation 43,603 B.

PLTR v4 deploy entry (`node scripts/deploy-list.mjs`): pool `0xee430ee1...c54623`, USDG currency0, PLTR currency1, fee
10,000, spacing 200, hookless, protocol fee 1,000 pips both directions (swap fee 10,990), range 350 bp, cap $24,207
(124.84 PLTR). Replay (`keeper/data/replay.json`, PLTR, v4 pool): fee APR 211.0% full sample, 152.9% test half.

Verdict: **FIX-FIRST**, scoped to one item. No Critical, no High. One Medium (V4R-M1: the treasury's performance fee is
forfeited on every in-kind exit while the gate is not Ok, which happens every weekend with no attacker) whose fix fits in
the 600 B headroom and must land before `vaultV4CodeHash` is pinned, because the vault cannot be patched after deploy.
One Low (V4R-L1) whose fix is a constant. Everything else is Info or an accepted residual with a measured bound.

## Findings

### V4R-M1 (Medium, v4 regression from StockVault). A closed-gate `redeemInKind` turns all accrued fees into principal and the treasury's cut is never minted
`StockVaultV4.sol:570-587` with `_release` at `:730-741`. When `health()` is not `Ok`, `redeemInKind` skips `_harvest`.
`_release` then calls `_modify(-part)`, and v4's `modifyLiquidity` pays the **whole position's** accrued fees to the
caller with any liquidity change (`PoolManager.sol:169`, `callerDelta = principalDelta + feesAccrued`). The vault keeps
them as idle balances. From then on they are principal: `_pos()` reads zero uncollected fees, `_valuationAt` no longer
deducts the performance cut, and no later `_harvest` can see them. StockVault (v3) does not have this outcome:
`StockVault.sol:708-713` collects only the decreased principal (`collect(..., uint128(d0), uint128(d1))`), so the fees stay
owed in the NPM position and the next healthy harvest mints the cut. The v4 comment and `SECURITY.md` ("the same outcome
as StockVault skipping its harvest") are true for the redeemer and false for the treasury.

Attack (or plain usage): any holder calls `redeemInKind(totalSupply / 1e6, ...)` while the status is not `Ok`. Free
triggers: the weekend stale feed (about 28 h every weekend, R4-I4), `TwapUnavailable` after any keeper gap over 120 s,
the corporate-action window. The web app routes weekend exits to `redeemInKind`, so honest users trigger it without
intent.

Measured (`test_V4R_M1_closedGateInKindExitForfeitsTheTreasuryCut`, PLTR, 4 x UNIT deposited, synthetic volume):
- uncollected fees 0.6226 PLTR, treasury cut owed 0.06226 PLTR.
- Control (same dust exit, gate Ok): treasury holds 0.06226 PLTR (asserted inside the test, so the property holds when the
  harvest runs).
- Feed stale (`FeedStale`), dust exit: fees left in the position 0; price per share 1.018947 -> 1.020233 (+0.126%, the
  holders absorbed the cut); feed restored, a healthy harvest runs: treasury holds **0**; `feesEarnedLifetime` 0 / 0.
- Assertion `treasury >= 90% of cut`: **FAIL, 0 < 0.0560**.

Impact at the PLTR cap ($24,207): fees at the replay APR are $982 per week (211%) or $712 (152.9%); the 10% cut is $98 or
$71 per week. The weekend window alone exposes the fees accrued from the last fresh-feed harvest (Saturday's keeper slot)
to Monday's first print, about 43 of 168 h: **up to $25 per week, about $1,300 per year** (uniform-volume upper bound),
about a quarter of the vault's performance revenue, plus every keeper-gap and corporate-action window. No user loses
principal; the redeemer forfeits its fee slice as in v3.

Fix (storage plus about five touch points, inside the headroom): when `_release` receives non-zero `f0/f1` (the harvest did
not run), add them to `uint128 pendingFee0/pendingFee1`. `_valuationAt` adds the pending amounts to `feeStock/feeUsdg` for
the performance deduction (they already sit in idle, so only the deduction changes); `_release` excludes the treasury's
cut of pending from the idle it pays out; `_harvest` adds pending to `f0/f1`, zeroes it, and mints as today (also fixing
`lifetimeFees`). The failing-before-fix test is `test_V4R_M1_closedGateInKindExitForfeitsTheTreasuryCut`; it should then
pass unchanged, and the existing `test_anInKindExitWithTheGateClosedLeavesTheFeesWithTheHoldersWhoStay` must stay green.
Correct the `SECURITY.md` row "Liquidity removal while the oracle gate is not Ok" either way.

### V4R-L1 (Low, owner-gated). A hook the vault accepts can sandwich the vault's swap from inside it; "cannot take value" is false
`StockVaultV4.sol:139-141,252` (`FORBIDDEN_HOOK_BITS` = remove-liquidity callbacks and the four return-delta flags) and
`SECURITY.md` ("a hook without return-delta flags cannot take value from a swap or a liquidity change"). A hook with
`BEFORE_SWAP` and `AFTER_SWAP` (bits 7 and 6, accepted by the constructor and by
`test_aHookWithOnlySwapAndInitCallbacksPassesTheHookCheck`) runs inside the vault's own `swap`. v4 lets a hook call
`PoolManager.swap` from its callback (`Hooks.noSelfCall` only skips the hook's own callbacks), so it front-runs in
`beforeSwap` and back-runs in `afterSwap`, settling its own deltas before the vault's unlock ends. The vault's floor
(`_minOut`: swap fee plus `slippageBps` off Chainlink) is the only bound, about 210 bp on PLTR. The same holds for
`beforeAddLiquidity` (bit 11): it can move the price between `fit` (`:800`) and the add, so the comment "the add either
takes at most the idle balances or the settle transfer reverts" (`:797-799`) does not hold when idle remainder is
present (measured 4.3% at the cap, below).

Measured (`test_V4R_L1_aSwapHookSandwichesTheVaultInsideItsOwnSwap`): a hooked PLTR/USDG 1% pool at the live price, the
hook as LP with the live pool's in-range liquidity, vault deposit 4 x UNIT, keeper `rebalance()`; the armed hook pushes 80
bp in the vault's direction. Vault NAV after the rebalance 48.7554 PLTR (control, hook idle) vs 48.5362 (hook armed):
holders lose **0.2192 PLTR, 45 bp of NAV** (90 bp of the swapped half). Assertion `loss <= 5 bp`: **FAIL**.

Impact at the cap: up to the floor slack on every vault swap (rebalance, deploy, `redeem`/`withdraw` exit swaps); at a
half-cap rebalance swap of about $12.1K that is about $109 at the measured 80 bp push and about $120 near the floor. Today
zero: the allow-list (`keeper/data/v4-hook-allowlist.json`) is empty and PLTR's pool is hookless. Owner-gated through
`VaultFactory.setHookAllowed`, but an allowed hook is permanent for that vault and many hooks are upgradeable proxies.

Fix (zero bytes): add bits 7, 6, 11 and 10 (before/after swap, before/after add liquidity) to `FORBIDDEN_HOOK_BITS`, so only
initialize and donate hooks pass; or keep the bits and rewrite the `SECURITY.md` claim to "the allow-list is the guard: a
swap or add hook can take up to the swap floor per swap". Failing-before-fix test: `test_V4R_L1_...` (with the constant
fix the vault constructor reverts `ForbiddenHook` and the test is rewritten as that expectation).

### Info
- V4R-I1 Zero-capital observation writes. `poke()` is callable inside a foreign `unlock` (it only reads slot0), so an
  attacker pushes spot, pokes and swaps back in one unlock and settles only the two legs' fees (`PokeSandwicher` in the
  test file). This is the price the R3-H1 residual now rests on; measured below, it remains far above the bound.
- V4R-I2 The oracle band is `maxDeviationBps` ticks; 100 ticks is 100.5 bp, so a ring held at the band edge reads
  `TwapDeviates` (`TickOracleV4.sol:16-17` says the ring "never holds a tick the vault's own oracle gate calls deviant").
  Off by 0.5 bp; liveness only.
- V4R-I3 `fit`'s add pays from the vault's whole balance, which includes `totalStockOwed`; if the step-down ever passed a
  one-wei overshoot, the settle would borrow claimants' stock instead of reverting. Dust, and the step-down holds (see the
  M27 residual).
- V4R-I4 `entryFee` is floored to the swap fee at construction only; a later protocol-fee rise leaves it below `swapFee()`
  until the owner queues `setEntryFee`. PLTR already carries the maximum protocol fee (1,000 pips), so no action there.
- V4R-I5 ERC-4626 views: `totalAssets`/`convertToAssets`/`pricePerShare` value the position at spot while the ring is
  unavailable (manipulable for integrators reading them then; every priced path is closed in that state), and
  `maxDeposit` reverts on `FeedInvalid` instead of returning 0.
- Router and factory: `UptickRouter.unlockCallback` is bound to the PoolManager of a registered vault for the duration of
  `depositUsdgV4` only, settles both deltas, returns unspent input, and a hook cannot call it (sender check). A v3 vault
  passed to `depositUsdgV4` or a v4 vault passed to `depositUsdg` reverts on the missing view (fail closed).
  `createVaultV4` hashes the key as `PoolId.toId` does and checks the vault derived the same id. No finding.

## Declared residuals

| Residual | Judgement | Evidence (this review) |
|---|---|---|
| Balancing swap ignores its own impact (up to 10% idle) | Accepted | `test_V4R_idleRemainderAtTheCap`: full PLTR cap (124.84 PLTR) at the deploy range 350 bp, keeper rebalance: idle **4.34% of NAV**. Counted in NAV, deployed at the next rebalance. It is also the slack V4R-L1's add-hook variant would use |
| Keeper stall over 2 min closes priced paths for about 10 min | Accepted, with a note | Liveness only; `redeemInKind` stays open and `poke()` is permissionless. It widens V4R-M1's window until that is fixed, and the keeper runs on a public RPC that 429s, so a second independent poker (any account) is cheap insurance |
| M27: `fit` step-down survives mutation | Accepted | The loop only lowers liquidity; the unrounded fit already floors both legs. Worst case if it were absent is V4R-I3 (one or two wei) |
| R3-H1 drag inside the 30 bp bound, now with a cheaper walk | Accepted, bound unchanged | `test_V4R_ringWalkCost`: an attacker owning every observation for one 600 s window (31 sandwiched pokes every `MIN_GAP`, each pushing PLTR 32 bp) moves the TWAP 32 ticks for **$7,557 ($244 per poke)**, with the vault holding no liquidity in the pool (more liquidity raises the price). The most the walk can extract at the cap is (30 + 10) bp of a half-cap swap: **$48.41**. A keeper-interleaved walk (one 50-tick poke after each keeper poke) costs the same order. Unprofitable by about 150 times |

The TWAP ring otherwise held under attack: the tick is read from slot0, never supplied; `MIN_GAP` stops flooding (an
attacker poking every 20 s locks the keeper out but writes the same bounded ticks the cost above prices); `MAX_GAP` and the
continuity restart stop extrapolation; the step clamp is relative to the previous observation; `twap` refuses a window
that crosses a restart. NAV is priced at `min(Chainlink, TWAP)` (and spot for deposits) with the position's legs at the
TWAP, which overstates stock-denominated NAV whichever way the TWAP is pushed, so a manipulated TWAP cannot buy cheap
shares or a cheap withdraw (it can only make previews stricter or close paths: liveness).

## Mutation and failure checks

| Check | Red case | Green case |
|---|---|---|
| V4R-M1 property (treasury keeps its cut) | gate `FeedStale`: treasury 0 of 0.0623 PLTR | gate `Ok` (control branch, same test): 0.06226 of 0.06226 |
| V4R-L1 property (accepted hook takes nothing) | hook armed at 80 bp: holders -45 bp | hook idle (control branch, same test): 0 |
| Ring walk bound | not produced: it would need a pool where 31 pokes cost under $48 | live PLTR pool: $7,557 |

## Recommendations

1. Fix V4R-M1 (pending-fee accounting) and re-pin `vaultV4CodeHash`; correct the `SECURITY.md` row and the `redeemInKind`
   natspec.
2. V4R-L1: forbid bits 7, 6, 11, 10 (constant), or correct the `SECURITY.md` hook claim and treat every allow-list entry as
   a full trust grant including future upgrades.
3. Run a second poker beside the keeper (V4R-M1 window, liveness).

## Blind spots

No arbitrageurs on the fork, so ring-walk costs are attacker-alone figures and the walk was measured with the vault holding
no liquidity in the pool. Chainlink mocked at the pool price. V4R-M1's dollar figure assumes uniform weekend volume at the
replay APR; weekend pool volume was not measured. The fix for V4R-M1 was not built (source is read-only in this review), so
its bytecode cost is an estimate against the 600 B headroom. Only PLTR measured (TSLA, the token0 orientation, was not
re-run); the existing v4 suites were not re-run here.

## Re-review of the fixes (b6afbd1, 4a2bf6b)

Scope: `git diff de05c6e..4a2bf6b -- contracts/src` (StockVaultV4 only: `pendingFee0/1`, `_release`, `_harvest`,
`_valuationAt`, `FORBIDDEN_HOOK_BITS`) plus the changed tests and the keeper/replay hook-mask mirrors. Source untouched.
New file `test/security/v4/ReReviewV4.t.sol` (3 tests). Fork: the pinned local node (`FORK_URL=http://127.0.0.1:8546`,
`FORK_BLOCK=93694185`). Runtime 24,267 B (309 B headroom).

Commands:
- `forge test --match-path 'test/{v4,security/v4}/*' -j 1` on the pinned fork: 146 pass, 1 fail (the V4R-RR-L1 witness
  below); PLTR and TSLA vault suites 49 + 49, registry and router 14 + 14, oracle 10, fit 3, review 5.
- `forge test --match-path test/security/v4/ReReviewV4.t.sol -j 1 -vv`: 2 pass, 1 fail.

Verdict: **SHIP**. V4R-M1 and V4R-L1 are closed. One new Low (V4R-RR-L1, an edge case on a vault that has been emptied,
which a few wei of donation or the next keeper harvest clears), worth a few bytes before the hash is pinned. Nothing
in it blocks shipping.

### V4R-M1 fix: what holds

| Question | Result | Evidence |
|---|---|---|
| Cut minted after a closed-gate sweep | Yes | `test_V4R_M1_closedGateInKindExitForfeitsTheTreasuryCut`, `test_V4R_M1_laterClosedGateExitsCannotTakeThePendingCut` pass on the pinned fork |
| Pending cut double-counted | No. Pending fees are idle, so they are already in `gross`; `_valuationAt` adds only their cut to the deduction; `_harvest` adds them to `f0/f1` once and zeroes them before minting | Source read; harvest of a pending cut moves price per share by under 1e-5 (`test_RR_depositBetweenSweepAndHarvestGainsNothing`) |
| Deposit ordering around a pending cut | No gain. A depositor entering between the sweep and the harvest buys at NAV net of the cut; the harvest does not move the price; an in-kind round trip returns 0.9938 PLTR per PLTR (the entry fee) | `test_RR_depositBetweenSweepAndHarvestGainsNothing` PASS |
| Withdraw/redeem ordering | Both run `_harvest` first under an Ok gate, so `pending` is 0 by the time `_release` reserves; only a closed-gate `redeemInKind` ever reserves | Source read |
| `_idleStock() - rs` underflow in `_release` | Not reachable through the vault. `pending > 0` implies `positionOpen` (it is written after the early return), and every path that moves idle out (exit swaps, deploy and rebalance swaps, adds) runs `_harvest` first. Only an outside balance cut (issuer `adminBurn`, a USDG freeze) could reach it | Source read |
| Rounding per leg vs combined NAV | Exits reserve `floor(pending * perf / 1e4)` per leg; NAV deducts the combined value floored once. Exiters can take at most a wei of PLTR and a micro-USDG per exit beyond the reserve. That gap is the cause of V4R-RR-L1 | Below |
| `_harvest` at zero liquidity | Skips `_modify` when `liq == 0` (no `CannotUpdateEmptyPosition`), so the PoolManager cannot make it revert. The only revert is the underflow below | `test_fullInKindExitThenRedepositIntoTheEmptyRange` green; V4R-RR-L1 |
| "Everyone exits before harvest" | The cut is minted against the near-empty vault if `gross > cut`; otherwise `pending` is zeroed with no mint, and the reserved tokens (measured 0.025 PLTR + 5.0 USDG in a 2 x UNIT vault, about $10) become unowned NAV | `test_RR_emptiedVaultWithPendingCutDoesNotBrickNav` logs treasury 0 after the keeper harvest |

### V4R-RR-L1 (Low, liveness, from the M1 fix). An emptied vault with a pending cut reverts `totalAssets` until a donation
`StockVaultV4.sol` `_valuationAt` (`v.net = v.gross - feeValue * params.perfFeeBps / 1e4`) with `_release`'s per-leg
reserve. Sequence: the treasury holds no shares (launch, before any minting harvest; or after it redeemed), the gate is
closed, and the holders leave in kind in two steps (the first sweeps the fees into pending, the last takes idle net of the
per-leg floored reserve). Supply is 0 and the vault holds exactly the floored reserves, a few wei of PLTR below the
combined cut, so `gross - cut` underflows (Panic 0x11).

Measured (`test_RR_emptiedVaultWithPendingCutDoesNotBrickNav`, PLTR, gate reopened): `totalAssets` reverts 0x11, and a
new `deposit` reverts 0x11 (so do every preview, `maxDeposit`, `pricePerShare` and the lens). An hour later the keeper's
rebalance went through: at the new TWAP the rounding came out with `gross == cut`, and the harvest zeroed `pending` with
no mint. Whether that harvest reverts depends on rounding at the price it reads. Green case: `test_RR_aDonationUnbricksTheEmptiedVault`
(1e12 wei of PLTR sent to the vault by anyone: `totalAssets` works and the rebalance mints the treasury its cut).

Impact: no funds at risk; a fresh or fully drained vault refuses deposits until a donation or a favourable-rounding
harvest; about $10 of reserved cut is stranded as unowned NAV. A griefer must own the whole supply, so it only affects a
vault at launch or after a total exit. Fix (a few bytes): saturate in `_valuationAt`
(`v.net = v.gross > cutValue ? v.gross - cutValue : 0`), or round the per-leg reserve up. Failing-before-fix test:
`test_RR_emptiedVaultWithPendingCutDoesNotBrickNav`.

### V4R-L1 fix

`FORBIDDEN_HOOK_BITS` now carries bits 11, 10, 9, 8, 7, 6, 3, 2, 1, 0, so only initialize (13, 12) and donate (5, 4) hooks
pass; the vault never calls `donate`, and initialize hooks run only at pool creation. `keeper/src/v4.ts` and
`keeper/replay/replay.py` carry the same expression. Every `chosen_v4` in `keeper/data/replay.json` (PLTR is the only v4
deploy entry, pool `0xee430ee1...`) is hookless, so no deployable pool is excluded. The witness test now expects
`ForbiddenHook` for the swap hook and for bits 11 and 10. Closed.

### Re-review blind spots

Mutations of the fix were not re-run here (source is read-only in this review); the builder's five rows in `SECURITY.md`
were taken as given, and the in-test control branches are the green cases. One pinned block and PLTR only for the new
tests. V4R-RR-L1's revert depends on wei rounding at the price read: it was reproduced at the pinned block, and a later
price did not reproduce it in the harvest.
