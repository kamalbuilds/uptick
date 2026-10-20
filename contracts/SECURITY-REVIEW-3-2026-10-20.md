# StockVault third review, 2026-10-20

Scope: `src/StockVault.sol`, `src/VaultMath.sol`, `src/UptickRouter.sol`, `src/VaultFactory.sol`, `script/DeployAll.s.sol`,
`SECURITY.md`, `test/security/*`, at head after `3612c71`, `d837da2`, `bcc64ee`, `037c849`. Source untouched (`git diff
src/` empty after every mutation). New tests: `test/security/Review3.t.sol` (5 contracts). Fork: public keyless RPC
`https://rpc.mainnet.chain.robinhood.com` at head (block 93,397,735 when cardinalities were read; the RPC keeps no
history, so numbers are not pinned). Chainlink mocked at the pool price, as `Base.t.sol` does. No arbitrageurs exist on
the fork: every attack number is the attacker-is-alone case. One forge process at a time, `-j 1`.

Commands: `forge test --match-path 'test/security/*' -j 1 -vv` (baseline), `forge test --match-test R3 -j 1 -vv`.

Mainnet list used for impact: `node scripts/deploy-list.mjs --open-only` = AAPL, AMD, AMZN, GOOGL, INTC, META, MU,
NVDA, QQQ, SPY, USO (five 0.05% pools, six 0.3% pools, no 1% pool). Without `--open-only` the list is 17 vaults incl.
GME and MSTR (1%) and PLTR.

Verdict: **FIX-FIRST**. One High (N3 is narrowed, not closed: a drag inside the 60 bp bound is profitable on NVDA at
launch), one Medium (N4 is open on the five 0.05% vaults), one conditional Medium (1% vaults).

## Baseline: existing security suite at head

49 of 51 pass. Red: `test_floorMarginAtHalfCap` (GME margin -28 bp, rerun -30 bp) and
`test_vaultRebalancesAFullCapDepositOnEveryTier` ("Too little received" on GME). GME's live pool got thinner since
`SECURITY.md` was written (that table says 1% pools 29 to 31 bp margin; today a half-cap GME sell costs 217 bp
against 199 allowed).

## High

### R3-H1. N3 residual: a TWAP drag that stays inside `maxTwapOracleBps` (60 bp) is profitable at launch on NVDA
`StockVault.sol:626-627` (bound), `:807-813` (deploy-swap floor = TWAP value less fee less 100 bp), `:623` (anyone
after 26 h). The 60 bp bound refuses the round-2 90 bp drag, but the attacker drags 55 bp instead. Every 30 s spot is
pushed 9 bp under the TWAP (band never trips, Chainlink gate never trips), then `rebalance()` sells idle inventory into
the depressed pool, then the attacker unwinds. Idle inventory peaks before the first rebalance and between keeper
runs (`interval_h` 24); the keeper (`keeper/src/simulate.ts`) only checks that `rebalance()` would not revert, so its
own run is exposed the same way.

| Test | Idle | Drag | Attacker | Holders vs no-attack control |
|---|---|---|---|---|
| `test_R3_N3r_drag55_nvdaFirstRebalanceAtCap` (NVDA 0.05%, range 150) | 463.7 NVDA ($100K cap) | $78,408, 1,860 s | **+0.961 NVDA (+$207)** | -0.990 NVDA (-$214, 21 bp of TVL) |
| `test_R3_N3r_drag55_firstRebalanceAtCap` (PLTR 0.3%, range 350) | 120 PLTR ($23K) | $5,277, 1,860 s | **+0.337 PLTR (+$65)** | -0.289 PLTR (-$56) |
| `test_R3_N3r_drag55_halfIdle` (PLTR, 50 deployed + 50 idle) | 50 PLTR | $5,756 | -0.045 PLTR (-$9) | -0.114 PLTR (-$22), grief 2.5:1 |

All three FAIL the property "holders lose no more than the control + 0.01".
Fix options (any test above must turn green): bound non-keeper rebalances to a much tighter TWAP-to-Chainlink gap
(about 15 to 20 bp) and add the same check off chain in the keeper while the feed is fresh; or cap the notional one
rebalance may swap so the extraction (proportional to swapped size) stays below the drag cost (proportional to pool
depth times fee); and do not let a whole cap sit idle before the first rebalance (keeper rebalances right after the
first deposits, or `instantDeploy` at launch).

## Medium

### R3-M1. N4 is not closed on 0.05% pools: entry fee 5 bp, measured gain 10 bp on a 50 bp off-chain move
`StockVault.sol:274` (`entryFee = pool fee`), `:982-986`. `test_R3_N4r_offChainMoveOnFivePipPool` (NVDA, range 150):
Bob deposits 400 NVDA into a 400 NVDA vault while feed, TWAP and pool still show the old price, exits in kind next
block: **Bob +0.409 NVDA (+$88), Alice -0.409**. FAIL. Break-even move is about fee / (usdgShare x V/(V+D)), about
4x the fee: 20 bp on the five 0.05% vaults (AAPL, GOOGL, NVDA, QQQ, SPY), 120 bp on 0.3%. `SECURITY.md` says "5 bp on a
0.05% pool". Fix: entry fee of at least 25 bp on 0.05% pools (constructor default `max(poolFee, 2500)`, or deploy
paused, queue `setEntryFee(2500)`, unpause after execution). The 0.3% case stays green (`test_M1r_offChainMoveRoundTrip`).

### R3-M2 (conditional on deploying 1% pools). GME and MSTR: `redeem` and `withdraw` always revert; GME cannot deploy a full cap
`StockVault.sol:494`, `:678`, `exitBufferBps = 30` in `DeployAll.s.sol:49`. The web app's only exit buttons are
`redeem`/`withdraw` (`web/components/deposit-panel.tsx:217-219`); `redeemInKind` is not in the UI.
`test_R3_erc4626ExitOnTiers`, $5K deployed, market unmoved: AMZN, MU, NVDA pass (withdraw 10% then redeem the rest);
GME redeem got 191.898 vs minimum 192.412 (`ExitBelowMinimum`), withdraw short 21 bp; MSTR redeem short 42 bp, withdraw
short 32 bp. Plus the GME floor failure above. `--open-only` excludes both today, but `DeployAll` deploys whatever
list it is given. Fix: refuse fee tier 10,000 in `DeployAll` (or require the open-only list), or per-vault
`exitBufferBps` >= 100 and `slippageBps` >= 200 for 1% pools.

## Low / Info

- R3-L1 Entry fee capture by front-running a deposit larger than the vault. `test_R3_entryFeeCaptureByFrontRunIsUnprofitable`
  FAILS: 400 NVDA deposited ahead of a 4,000 NVDA deposit into a 400 NVDA vault, in-kind exit next block: **+0.0666 NVDA**.
  Profit = f x [D x A/(V+A+D) - A x V/(V+A)], positive whenever D > V(V+A)/A. Bounded by the cap (at most about f x cap/4,
  0.058 NVDA on NVDA) and needs pre-inclusion visibility (sequencer FCFS, no public mempool).
- R3-L2 Gate grief, PLTR (`test_R3_griefCloseGateCost`, PASS): close every price-checked path (spot 101 bp off feed):
  $10,352 notional, round trip -0.326 PLTR ($62), stays closed 12 h+ with no arbitrage, `redeemInKind` open. Block only
  rebalance (TWAP 61 bp off): $6,356, -0.200 PLTR ($38). Cost with arbitrage is the displacement each restoration.
- R3-I1 `withdraw` mints the unspent buffer back as shares, which are locked for the block: a same-block follow-up
  full `redeem` reverts `SharesLocked` (seen in the first run of `test_R3_erc4626ExitOnTiers`).
- R3-I2 Cardinality: guard is `twapWindow > cardinality`; under one write per second v3 serves at most `cardinality - 1`,
  so `twapWindow == cardinality` could be pushed out of the ring. Unreachable: cap 1,800, live minimum cardinality 1,801
  (PLTR; GME 1,860, META 3,601, others 7,200 to 14,400). Cardinality cannot shrink; `health()` never reverts on it.
- R3-I3 Bytecode: `Deposited` and `Withdrawn` duplicate ERC-4626 `Deposit`/`Withdraw` and have no web or keeper
  consumer. Removing the two emits: 24,479 -> 24,295 bytes, headroom 97 -> 281 (measured with `forge build --sizes`).
- R3-I4 `SECURITY.md` rows now false or stale: the 90 bp drag row reads as N3 closed; the 1% floor margins; the
  "5 bp on a 0.05% pool" sentence.

## Checked, no finding

- One-sided deposit band: `test_R3_upPushInstantDepositSandwich` (PLTR, 90 bp up-push, $9,598, around a 50 PLTR
  instant deposit): attacker -0.418 PLTR, Alice +0.139. PASS.
- Queue: `test_R3_queueAdmitsOnlyTheSixSetters` PASS: `executeChange`, `queueChange`, `cancelChange`,
  `transferOwnership`, `setTreasury`, `setDepositCap`, `transfer`, `approve`, `redeemInKind`, `unpause` all
  `ChangeNotAllowed`; unqueued and cancelled changes `ChangeNotQueued`; direct setter call by the keeper reverts. Expiry
  boundary consistent (`>` on execute, `<=` on re-queue). No external call path lets the vault call itself.
- Ticks: `testFuzz_R3_rangeIsAlignedAndCoversTheGate` PASS (64 runs; bps 150, 2000 and between; spacings 10/60/200;
  both orders; $1 to $100K): aligned, at least two spacings wide, the whole 100 bp gate inside the range.
- Every open-list vault opens a position from a full-cap deposit: `test_R3_fullCapFirstRebalanceOnOpenList` 11/11 PASS.
- Previews: `deposit == previewDeposit`, `mint == previewMint` (existing test green); `mint(maxMint)` can exceed the cap by
  at most 2 wei (ceil twice). Entry fee accrues to all holders pro rata, treasury shares included.
- `claimStockOwed`, `redeemInKind` harvest skip, refund mint rounding, `_release` rounding: favour the holders who stay.

## Prior findings

| Item | Status | Evidence |
|---|---|---|
| H1 atomic sandwich | Closed | `test_M2_sandwichedPermissionlessRebalance`, `test_M2_sandwichedInstantDepositIsRefused` green |
| H1 across blocks / N3 | **Not closed** (narrowed 90 -> 60 bp) | 90 bp refused (`test_H1x_dragThenPermissionlessRebalance` green); 55 bp profitable (R3-H1, 3 red) |
| M1 / N4 | Closed on 0.3% and on-chain moves; **open on 0.05%** | `test_M1_*`, `test_M1r_offChainMoveRoundTrip` green; `test_R3_N4r_*` red |
| M2 queue, L-b expiry | Closed | Hardening queue tests, `test_L_queuedChangeExpires`, `test_R3_queueAdmitsOnlyTheSixSetters` green |
| M3 corporate actions | Closed | `test_pausedOracle...`, `test_windowAroundAMultiplierChange` green |
| L3, L4 | Closed | `test_unregisteredVaultIsRefused`, `test_arbitraryAddressIsRefused`, `test_strandedStockIsNotDeposited`, `test_feedOfAnotherTickerIsRefused` green |
| N1 floors | Closed on the open list; **regressed on GME** | 11/11 open-list deploys; `test_floorMarginAtHalfCap` -28/-30 bp |
| N2 router band | Closed | `test_N2_*`, `test_routerDepositRevertsOnItsOwnImpact` ($500/$2K/$10K), `test_routerZapOnA1PercentPool` green |
| L-c twapWindow | Closed | cap 1,800 < live minimum cardinality 1,801 |
| L1, L2, L5, L-a, L-d | Unchanged by design | read |

## Mutation checks (this review)

| Mutation | Test | Mutated | Restored |
|---|---|---|---|
| `if (false && _deviates(twap, oracle, maxTwapOracleBps))` in `rebalance` | `test_N3_rebalanceRefusedWhenTwapFarFromFeed` | FAIL "next call did not revert" | PASS |
| `previewDeposit` with `(1e6 - 0)` | `test_N4_feeStaysWithHolders` | FAIL (delta 0.040 NVDA) | PASS |

`test_N4_previewsAreExact` stayed green under the second mutation: it proves exactness, not the fee.

## Blind spots

No arbitrageurs on the fork, so drag costs are lower bounds and attacker profits upper bounds. Feed mocked. N3 on the
other four 0.05% vaults and on keeper-timed runs is extrapolated, not measured. The up-push sandwich was measured only
on PLTR at range 350, not NVDA at 150 (narrowest range, most convexity); `instantDeploy` is off by default.
