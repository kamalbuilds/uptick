# StockVault fourth review, 2026-10-20

Scope: `src/StockVault.sol`, `src/VaultMath.sol`, `src/UptickRouter.sol`, `src/VaultFactory.sol`, `script/DeployAll.s.sol`,
`SECURITY.md`, `test/security/*` at `02443f8` (round-3 fixes `bd4419c`, `eb60c45`, `02443f8`). Source untouched: `git diff
src/` empty after every mutation and at the end. New files: `test/security/Review4.t.sol` (3 contracts, 11 tests) and
`test/security/twap-feed-liveness.mjs` (read-only liveness measurement). Fork: public keyless RPC
`https://rpc.mainnet.chain.robinhood.com` at head (blocks 93,592,505 to 93,599,093 for the liveness reads, 20 to 21 Oct 2026; the RPC keeps no history, so
numbers are not pinned). Chainlink mocked at the pool price as `Base.t.sol` does. No arbitrageurs on the fork: attacker
numbers are the attacker-is-alone upper bound. One forge process at a time, `-j 1`.

Commands:
- Baseline: `forge test --match-path 'test/security/*' -j 1 -vv`: **80/80 pass** (10 suites, 1,664 s). The two round-3
  baseline reds (GME floor) are green after the GME fixture cap change.
- This review: `forge test --match-path test/security/Review4.t.sol --match-test R4 -j 1 -vv`: 9 pass, 2 fail (both
  findings below). `forge test --match-path test/DeployAll.t.sol -j 1`: 1/1 pass.
- Liveness: `node test/security/twap-feed-liveness.mjs 400 120` (2-minute samples back through each pool's observation
  ring, 98 to 400 h depending on ring depth, against `getRoundData`).

Open list (`node scripts/deploy-list.mjs --open-only`): AAPL, AMD, AMZN, GOOGL, INTC, META, MU, NVDA, QQQ, SPY, USO (11:
gates 2 open + 9 reduced in `web/lib/vault-universe.json`, not 7).

Verdict: **SHIP**, with the residuals below documented. No Critical, no High, no Medium. One Low is a round-3
regression with a zero-byte fix that is worth taking before the bytecode hash is pinned (R4-L1).

## Findings

### R4-L1 (Low, introduced by round 3). `withdraw(maxWithdraw(owner))` reverts for about 15% of balances on 0.05% and 1% pools
`StockVault.sol:501-510`. `previewRedeem` floors buffer then fee; `previewWithdraw` ceils buffer then fee, the same order,
so it does not invert `previewRedeem`. Before round 3 there was one factor and the pair inverted exactly; the R3-M2
pool-fee factor broke it. For an asset value `x` = `_convertToAssets(balance)`, `previewWithdraw(previewRedeem-derived
assets)` asks for `x + 1` wei, about 1e6 share units more than the owner holds, and `_burn` reverts
`ERC20InsufficientBalance`.
- Measured: `test_R4_withdrawMaxWithdrawNeverReverts` (NVDA, 20 holders) **FAIL, 3 of 20 revert** (`0xe450d38c`, shares
  held 992,477,526,036,993,375,414,753 vs asked 992,477,526,036,993,376,291,514).
- Exhaustive integer check of the two formulas, x in 1..2,000,000: 303,780 bad at 5 pips, 329,240 at 1%, 0 at 0.3%.
- Impact: EIP-4626 violation for integrators. No fund risk; `redeem` works. The web app maps a max withdraw to `redeem`
  (`web/components/deposit-panel.tsx:269-270`), so the app's own path is unaffected.
- Fix (zero bytes, order swap): `gross = ceilDiv(ceilDiv(assets * 1e6, 1e6 - poolFee) * 1e4, 1e4 - exitBufferBps)`.
  Same exhaustive check: 0 bad on all five (buffer, fee) pairs tested. `test_R4_withdrawMaxWithdrawNeverReverts` turns green.

### R4-L2 (Low, liveness, introduced by round 3). The Chainlink term in the deploy-swap floor bricks META's full-cap sell rebalance once the feed sits 25 bp above the pool
`StockVault.sol:809-820`. Selling Stock Token the floor prices the input at `max(TWAP, feed)`. The demanding side is the
correlated one: after a fall the position goes out of range all in Stock Token and the feed (prints only after about a
0.5% move) still sits above the pool, exactly when the rebalance must sell half the vault.
- `test_R4_fullCapRebalanceAtTheBoundEdge` (11 open vaults, per-token range and cap, feed 28 bp off the pool on the
  demanding side, both sides): **FAIL, 21 of 22**; META sell reverts `"Too little received"`.
- `test_R4_metaSellFloorThreshold`: META fills up to a 20 bp gap and reverts at 25. Mutation (Chainlink term removed,
  TWAP-only floor): fills at 25. So the revert is the round-3 term.
- Impact: no fund risk; the keeper retries; the position earns nothing while out of range until the feed prints or the
  pool recovers. Fund-safe lever: lower META's cap (`setDepositCap`, immediate). AAPL (28 bp margin), QQQ (31), SPY (33)
  in `test_floorMarginAtHalfCap` are the next closest.

### R4-L3 (Low, liveness). The 30 bp bound misses some keeper slots; the slot is predictable and off-hours
`keeper/src/calendar.ts:88` recentres in a 02:00-08:00 UTC window. Out of 92 slot windows measured, **5 had no minute
at which rebalance() would pass** (feed fresh, TWAP more than 30 bp off it or spot more than 10 bp off the TWAP): AMD
17 Oct, INTC 10 and 17 Oct, MU 17 Oct, SPY 15 Oct. None was a stale-feed miss. A missed slot leaves the position where it
is (no loss); the out-of-range trigger recovers it during the session. The deterministic, published slot is also when
arbitrage is thinnest, which makes the R3-H1 residual keeper-timeable (see below), not only a permissionless-path risk.

### Info
- R4-I1 DeployAll: `depositCapTokens` 0 means uncapped and is not refused; `ALLOW_CLOSED=true` is honoured on any chain
  4663 broadcast, mainnet included (only an env var away); `rangeBps` passes through a `uint16` cast before `_checkParams`;
  an entry missing `symbol` silently ends the list (later entries are neither checked nor deployed). Single-entry
  parsing works (`deploy-list-open.json`, one entry, `test_deployabilityGate` PASS).
- R4-I2 Bytecode: runtime 24,504 B, headroom 72 B (`forge build --sizes`). R4-L1's fix is a reorder (no new code);
  any on-chain tightening of R3-H1 must fit in 72 B; keeper-side mitigations need none.
- R4-I3 `SECURITY.md` says the 90 bp drag plus `instantDeploy` deposit "reverts at the deploy swap's Chainlink floor".
  True on PLTR (0.3%); on NVDA (0.05%, allowed cost 105 bp) the 90 bp instant deposit fills. It is still unprofitable
  (below).
- R4-I4 Weekend: feeds go stale (more than 90,000 s) for about 28 h every weekend (840 to 870 of 2,881 samples in 96 h);
  `redeem`/`withdraw`/rebalance are closed then, `redeemInKind` is open (now in the web app).

## Round-3 confirmation

| Item | Status | Evidence (this review) |
|---|---|---|
| R3-H1 drag outside the bound | Closed | `test_R4_nvdaDrag40Refused` PASS: 40 bp walk refused, attacker -0.300 NVDA, holders 0.000 vs control -0.469. Mutation 30 -> 60: FAIL, rebalance executes, attacker +0.701 NVDA, holders -1.184 |
| R3-H1 residual inside the bound | Bounded, documented residual | NVDA (whole $100K cap idle, range 150, p0 $217.09): 25 / 27 / 29 bp -> attacker **+0.563 / +0.582 / +0.601 NVDA ($122 / $126 / $130)**, holders extra loss 0.501 / 0.532 / 0.563 NVDA (10.9 to 12.2 bp of the cap), drag $40.8K to $47.3K held 750 to 900 s. PLTR launch (120 idle, p0 $194.86): +0.202 / +0.205 / +0.208 PLTR ($39 to $40), holders -0.135 / -0.143 / -0.151. PLTR half idle: attacker -0.048 to -0.053 (unprofitable). All under (30 + 10) bp x swap |
| R3-H1 via `instantDeploy` (bound not applied) | No finding | NVDA, attacker deposits 400 into 400: 0 / 60 / 90 bp -> attacker -0.742 / -1.464 / -1.846 NVDA, alice +0.622 / +0.955 / +1.163. Entry fee plus `_depositNav` make it a loss |
| R3-M1 35 bp entry fee | Closed | `test_R4_entryFeeOnEveryPath` PASS: deposit, `mint(previewDeposit(x))`, router zap at 1e15 / 40 / 400 NVDA; previews exact (`deposit == previewDeposit`, `mint == previewMint`); every share costs pre-entry NAV x (1 + 35 bp); alice's NAV gain equals fee x her share to 1 wei (router path slightly more: the zap's own pool fees). `test_R4_entryFeeNotShavedBySplitting` PASS (50 dust deposits buy no more than one). Mutation default -> pool fee: FAIL ("share bought below NAV + fee") |
| R3-M2 1% pool exits | Closed | Baseline `test_R3_erc4626ExitOnEveryListedToken` 17/17 and `test_R3_erc4626ExitOnTiers` PASS (GME redeem 89.07%, MSTR 88.93% of deposit after 10% withdraw). New regression on withdraw-at-max: R4-L1 |
| DeployAll gate, single entry | Closed | `test_deployabilityGate` PASS |

## Liveness of the 30 bp bound (11 open pools)

NYSE regular hours (13:30 to 20:00 UTC): TWAP within 30 bp of the feed in **75.3% (INTC) to 91.7% (QQQ)** of samples;
rebalanceable (bound plus 10 bp spot band plus fresh feed) **50.1% (NVDA) to 80.9% (SPY)**; longest NYSE-hours run with no
rebalanceable sample **0.5 h (NVDA) to 2.97 h (AMZN)**. Off-hours, fresh feed, TWAP over 30 bp: longest 24.6 h INTC,
16.9 h AMD, 11.9 h MU, 9.8 h SPY, at most 5.4 h elsewhere. Longest stretch with no rebalanceable sample at all: 25.7 to
52 h, driven by the weekend stale feed. Keeper slots: 5 of 92 missed (R4-L3). Judgement: the bound does not block the
keeper for long stretches during the session; it does cost some off-hours slots.

## End-to-end flows

`test_R4_endToEndMoneyFlows` PASS (NVDA, range 150): stock deposit and USDG zap sit idle; keeper rebalance opens the
position; `setInstantDeploy` through the owner queue; instant deposit adds liquidity; $2M of round-trip volume; permissionless
rebalance 26 h later harvests and mints the treasury fee; `withdraw` sends exactly; `redeem` pays at least
`previewRedeem`; `redeemInKind` with the receiver's Stock Token transfer reverting credits `stockOwed`, `claimStockOwed`
pays it and zeroes `totalStockOwed`; the last holders out in kind leave totalSupply 0 and $0 stranded.

## Mutation checks

| Mutation (src restored after each, `git diff src/` empty) | Test | Mutated | Restored |
|---|---|---|---|
| `maxTwapOracleBps = 60` | `test_R4_nvdaDrag40Refused` | FAIL (rebalance executes, attacker +0.701 NVDA) | PASS |
| `entryFee = poolFee` default | `test_R4_entryFeeOnEveryPath` | FAIL (share at NAV + 5 bp < NAV + 35 bp) | PASS |
| Chainlink term out of the deploy-swap floor | `test_R4_metaSellFloorThreshold` | fills to 25 bp (attribution of R4-L2) | 20 bp |

## Recommendations (none blocks SHIP)

1. Reorder `previewWithdraw` (R4-L1); re-pin `vaultCodeHash`.
2. Keeper: randomise the recentre minute inside the window, skip a send while |TWAP - feed| exceeds 10 to 15 bp unless
   the position has been out of range for hours, and rebalance right after the first deposits at launch (shrinks the
   R3-H1 residual, zero bytecode).
3. META: lower the cap until a full-cap sell clears the floor with 30 bp of feed lag (R4-L2).
4. DeployAll: refuse a zero cap and refuse `ALLOW_CLOSED` unless a fork-only env is also set (R4-I1).

## Blind spots

No arbitrageurs on the fork, so drag costs are lower bounds and attacker profits upper bounds; the drag must also be held
against real arbitrage for 12 to 15 minutes. Chainlink mocked in fork tests (the liveness script reads the real feeds).
Liveness samples are 2 minutes apart and the ring covers 98 to 400 h per pool, one week of keeper slots for some pools;
holidays are ignored. Drag residual measured on NVDA and PLTR only.

## Resolution

Taken before the bytecode hash is pinned: R4-L1 (`previewWithdraw` inverts `previewRedeem`; runtime unchanged at 24,504 B, headroom 72 B; `test_R4_withdrawMaxWithdrawNeverReverts` 0 of 20 revert, 3 of 20 with the old order), R4-L2 accepted with META deployed at a $17,025 cap (15% of in-range depth; `test_R4_metaSellFloorThreshold` now asserts the fill at every gap to 30 bp at that cap and logs where the $24,118 replay cap stops filling (it moves with the live pool: refused at 25 bp in one read, filled at 25 bp in another), `test_R4_fullCapRebalanceAtTheBoundEdge` opens 22 of 22), R4-I1 (DeployAll refuses a zero cap without `ALLOW_UNCAPPED`, refuses `ALLOW_CLOSED` on any node that is not a local anvil, reverts naming the entry that lacks `symbol`), and recommendation 2 (the keeper draws its recentre minute per day and defers a scheduled send while the TWAP is over 15 bp off Chainlink). Numbers and levers: `SECURITY.md`, Accepted residuals.
