# UptickShareOracle review (vault share as Morpho Blue collateral), 2026-10-23

Scope: `src/UptickShareOracle.sol`, `src/interfaces/IOracle.sol`, and every vault read the oracle depends on in
`src/StockVault.sol` and `src/v4/StockVaultV4.sol` (`health`, `positionInfo`, `params`, `totalAssets`, `totalStockOwed`,
`_update` share lock, `redeemInKind`, `_release`). Branch `share-collateral` (`git diff main...share-collateral`, commits
`fb6d55a` to `7f5f777`). The shared checkout moved to `integration` before the fork runs; `git diff --stat
share-collateral integration` over `contracts/src`, `ShareCollateral.t.sol`, `Base.t.sol`, `V4Fixture.sol` and
`foundry.toml` is empty, so every result applies to `7f5f777`. Source untouched: the only new file is `test/security/oracle/OracleReview.t.sol` (4 contracts,
8 tests, 3 helper contracts). Fork: public keyless RPC `https://rpc.mainnet.chain.robinhood.com` at head (block
95,922,151, 2026-10-23 ~12:00 UTC; the RPC keeps no history, so numbers are not pinned; the pinned anvil on :8546 was
not running). Chainlink mocked at the pool price as `Base` and `V4Fixture` do. Real Morpho Blue singleton
`0x9D53...1010`, IRM `0x2BD3...0fa1`, LLTV 62.5%. One forge process, `-j 1`.

Command (one run, all 8 pass): `forge test --match-path 'test/security/oracle/*' --match-test 'test_poc|test_measure' -j 1 -vv`.
Each `test_poc_*` asserts the vulnerable behaviour on the code as written and goes red once the fix lands; each finding
carries its own must-fail case inside the test or as a paired control test.

Verdict: **FIX-FIRST**, scoped to one item. No Critical, no High. The pricing maths is sound: it cannot be inflated
above value the vault holds, cannot be pushed down by spot, and degrades no worse than the live NVDA/USDG market's own
oracle on a stale feed. One Medium (O-M1: the registry check is chosen by the deployer, so it proves nothing and a
look-alike oracle drains whoever lends against it) must be fixed before any market is announced; the fix is a few
lines and the oracle is not deployed yet. Two Lows, both bounded at well under the LLTV buffer. Recommended LLTV: 62.5%.

## Findings

### O-M1 (Medium). `NotRegisteredVault` checks a registry the deployer supplies, and the oracle keeps no record of it
`UptickShareOracle.sol:116-117`. `constructor(IVaultFactory factory, IUptickVault vault_)` calls `factory.isVault(vault_)`
on whatever `factory` it is given and does not store it. Anyone can deploy the identical source with a factory that
returns `true` for everything and a vault that reports any `health()` / `totalAssets()`. The result is an
`UptickShareOracle` (same source, same runtime size, Blockscout verifies it as the same contract) whose `vault()` points
at a token the attacker mints, and nothing on chain says which registry approved it (there is no `factory()` getter).
`SECURITY.md` states the opposite: "only a vault the factory deployed from its pinned creation code gets an oracle". The
web docs tell users to find "the share oracle" market but no deployment script, oracle address or market id exists yet,
so the oracle's type is what a lender or curator would check.

Attack: deploy `YesFactory`, deploy `FakeVault` (24 decimals, reports the real NVDA token, the real USDG and the real
NVDA Chainlink proxy, so every public immutable of the forged oracle matches a genuine NVDA share oracle), deploy the
oracle against them, `createMarket(USDG, fake, forgedOracle, IRM, 62.5%)`, wait for supply, post one raw unit, borrow it all.

Impact at the $100,000 cap: not bounded by the vault cap, bounded by what lenders supply to the forged market. PoC: a
$100,000 USDG supply is borrowed in full against one raw unit of a worthless token; the market sits at 100% utilisation
with no recoverable collateral. Loss 100% of supply.

PoC: `OracleReviewV3.test_poc_forgedFactoryOracleDrainsLender`. Must-fail case in the same test: the real factory
rejects the fake (`isVault == false`, constructor reverts `NotRegisteredVault`), which is what the fixed oracle would
do for every deployer.

Fix: pin the registry. `IVaultFactory public constant FACTORY = IVaultFactory(<production VaultFactory>);` and drop the
constructor argument, so the check binds every deployment and `FACTORY()` is readable. Better still, deploy oracles only
through an `UptickShareOracleFactory` that records `isOracle[oracle]` (the `MorphoChainlinkOracleV2Factory` pattern), and
publish the market id. Correct the `SECURITY.md` sentence either way.

### O-L1 (Low). v4: the treasury's cut of pending fees leaks into the price whenever Chainlink sits above the TWAP
`UptickShareOracle.sol:155-160` relying on `StockVaultV4.sol:941-962`. A closed-gate `redeemInKind` moves the position's
fees into idle balances and records them as `pendingFee0/1` (private). The oracle counts idle balances in full and
relies on the `totalAssets()` cap to deduct the treasury's cut. The cap is not tight: `totalAssets()` values the USDG leg
at `min(Chainlink, TWAP)` and the oracle multiplies back by Chainlink, so with Chainlink above the TWAP the cap carries
`(px / twap - 1) x USDG holdings` of slack. Once that slack exceeds the pending cut the cap does not bind and the price
rises by the full cut. The builder's test sets Chainlink equal to the pool, the one setting where the slack is zero.

Measured (PLTR v4 vault, builder's own scenario, only the feed offset changed):

| Chainlink vs pool | Cut at stake | Price rise after the sweep |
|---|---|---|
| 0 bp (control) | 1,318 ppm | 0 ppm |
| +60 bp (inside the 100 bp band) | 1,318 ppm | 1,319 ppm |

Impact at the $100,000 cap: 13.2 bp of overvaluation, $132 of collateral value, $82 of extra borrow capacity at 62.5%.
It persists until the next harvest (the next Ok-gate exit, deposit or rebalance). Lender loss requires a 29.6% fall to
begin with (see LLTV); this adds 0.13 points to it.

PoC: `OracleReviewV4.test_poc_v4PendingCutLeaksWhenFeedAboveTwap`; control `test_poc_v4PendingCutControlFeedAtPool`.

Fix: derive the pending cut instead of hoping the cap binds. With `sqrtTwap` from `health()` the oracle can rebuild the
vault's own `gross` (`_valuationAt` at `nav = min(px, twapUsd)`) and take `pendingCut = gross - uncollectedCut - totalAssets()`
(saturating), then subtract `pendingCut x px` from `value`. Both terms use the same TWAP, so the TWAP cancels and spot
still never enters. Do not "fix" it by valuing the cap at `nav` instead of `px`: that makes the share follow the TWAP
down on every weekend and reopens multi-block deflation. Alternatively accept it and correct the `SECURITY.md` line
("the only path that carries the treasury's cut of fees recorded as pending") to say the carry is partial.

### O-L2 (Low). Dust minted to a liquidator in the liquidation block reverts a sweep-the-balance flash liquidation
`StockVault.sol:651-660`, `StockVaultV4.sol:695-705` (`_update` lock), reached through Morpho's `onMorphoLiquidate`
callback. Anyone can `deposit(1e12 wei, liquidator)`; the liquidator's lock then covers those dust shares, and a
callback that redeems `balanceOf(this)` reverts `SharesLocked`, reverting the whole `liquidate`. Morpho itself cannot be
locked this way (its balance always exceeds any one seizure by the minted amount: `test_poc_dustMintToMorphoCannotBlockLiquidation`),
and a liquidator that redeems exactly the seized amount is immune in the same block.

Bound: the grief needs the deposit gate open (status `Ok`, spot within 1% of Chainlink), so it works only while the
move that made the position liquidatable is small; once the price falls far enough to threaten lenders the gate closes
and deposits, hence the grief, stop. The griefer also has to land a deposit in every block before each attempt. Impact
at the $100,000 cap: delay of interest-driven or sub-1% liquidations; no lender loss path found.

PoC: `test_poc_dustMintToLiquidatorRevertsLiquidation` (sweep liquidator reverts, exact liquidator passes, same block);
control `test_poc_controlSweepLiquidatorWorksWithoutGrief`.

Fix: none in the vault (its creation code is pinned). Tell liquidators in the collateral docs to redeem the seized
amount, not their balance; ship the `FlashLiquidator` pattern with `exact = true` as the reference integration.

## Attack surfaces checked and closed (Info)

**Share-price inflation.** The oracle values only what the vault holds (idle less `totalStockOwed`, position legs from
its own liquidity, uncollected fees computed with the pool's wrapping maths) at Chainlink. Every way to raise it moves
real value into the vault: a donation, swap fees (`test_measure_v4SpotFallbackPushCannotRevertPrice`: a 200M USDG push
raises the price 3,935 ppm, all fee income, never lowers it), a v4 `donate`. A borrower holding fraction f of supply who
donates D gains 0.625 x f x D of borrow capacity for D: never profitable. Deposits are priced at `_depositNav`, the
highest of the vault's views, plus the entry fee, so new shares never cost less than the oracle values them; the
same-block lock stops deposit-borrow-redeem inside one transaction or a Morpho flash loan of the collateral.

**Empty vault, tiny supply.** Price divides by `supply + 1e6` (the vault's virtual shares) and is per raw unit scaled by
1e36, so there is no truncation to zero (the Resupply failure). Donating D to an empty vault and minting one raw share
gives one raw share a collateral value of D / (1e6 + 1): the attacker pays a million times what they can borrow. The
oracle is below `redeemInKind`'s pro-rata (`shares / supply`, no virtual term) in every state.

**Deflation griefing.** The `totalAssets()` cap is always at or above the uncapped figure in v3 and above it less the
pending cut in v4: the position at any TWAP composition, valued at Chainlink, is worth at least the composition at
Chainlink (AMM value is concave in price), and the USDG leg is multiplied by `px / min(px, twap) >= 1`. So no TWAP or
spot value can pull the price down. The remaining down-levers move real value: a rebalance swap (bounded by pool fee plus
`slippageBps`, 1% default, 5% max by timelocked owner change) and a higher `perfFeeBps` (timelocked, max 20%).

**Division by zero in the cap.** `totalAssets()` divides by the TWAP's USD price, which rounds to zero only near the
sqrt-price limit (tick below about -666,000 for NVDA and PLTR). v3: the NVDA pool has observation cardinality 7,200, so
the TWAP needs ten minutes at the limit. v4: with the ring lapsed (weekend, feed older than `maxStaleness`) the vault
uses spot, but a 200M USDG buy only reaches tick -31,813 in the live PLTR pool. Unreachable on both; the v3 cap adds
gas and this surface while never binding, and could be dropped for v3 vaults.

**v3 / v4 `PositionInfo` layout.** Static tuple, identical word order (`tokenId` / `open` both decode as a uint256 word),
`params()` the same eight fields, `Status.FeedInvalid == 1` in both enums. Exercised by both suites.

**Rounding.** `value` floors, the fee cut ceils, the cap floors, the price floors: every rounding favours the lender.

**Read-only reentrancy.** No caller-controlled code runs while vault state is mid-update. v3 calls the position
manager, the pool, SwapRouter02 and two plain ERC-20s. v4's hook bitmask forbids swap and liquidity callbacks and
`unlockCallback` only answers the PoolManager. The residual is issuer trust: the Stock Token is an upgradeable beacon proxy.

**Gas inside `liquidate`.** Three vault reads, each one feed read plus one pool observation. Liquidations in the PoCs
run with default gas. No unbounded loop: v3 `observe` and the v4 ring are binary searches.

**Stale feed and corporate actions vs the live NVDA/USDG market.** The live market's oracle `0xED29...b78c` returned
`2.1326e26` (NVDA $213.26) at this review, has no corporate-action gate and, per the builder's fork warp, reverts past
349,200 s on the NVDA feed; the share oracle matches that bound. The share is less exposed than the NVDA token in the
same window. (1) Borrowing at a stale Friday print against a weekend pool drop: anyone can buy NVDA in the pool and post
it to the NVDA market, but new shares cannot be minted once spot or the TWAP is more than 1% from the feed or the feed is
older than 25 h, so only shares that already exist can take that option. (2) A share falls no further than the stock:
concavity gives `V(P) >= (P / p) V(p)`; the builder measured -37.9% on a -40% feed. (3) An ERC-8056 multiplier step the
feed prints early or late: an overprint lifts the position legs only to their all-USDG value at the range edge (about
+range bps), so only idle Stock Token is marked up in full; an underprint liquidates borrowers at a discount, and
lenders are repaid. USDG is valued at exactly $1 (the NVDA market divides by a USDG/USD feed): a USDG premium would
overvalue the stock leg by that premium.

## LLTV

Recommended: **62.5%**, the live NVDA/USDG market's own. Morpho's incentive at 62.5% is `1 / (0.3 x 0.625 + 0.7)` =
1.1268, so a position borrowed to the limit leaves bad debt once the share falls 29.6% beyond its last liquidation
price (37.5% to plain insolvency). The share falls no more than NVDA does, so this is the NVDA market's gap tolerance or
slightly better. Exit depth for the liquidator, measured by selling NVDA into the live 0.05% NVDA/USDG pool with no
Uptick liquidity in it (`OracleReviewDepth.test_measure_liquidationExitDepth`, head, NVDA $213.38):

| NVDA sold | Discount to pool price |
|---|---|
| $1,000 | 5 bp |
| $5,000 | 6 bp |
| $25,000 | 14 bp |
| $62,500 (the largest debt a $100,000 vault can carry) | 29 bp |
| $100,000 | 44 bp |

At the largest debt the exit costs 29 bp, under 1/40 of the 12.68% incentive, so liquidations stay profitable. Do not raise it: at 77%
the incentive is 1.0741 and the bad-debt gap falls to 17.3%, inside the range of single-weekend equity gaps.

## Blind spots

- Head-of-chain fork on a Friday; pool depth, fee levels and the 13.2 bp cut move with the chain and were not pinned.
- No arbitrageurs on the fork: depth figures are a single static book, and the v4 push is the attacker-alone bound.
- The builder's -37.9% and 323K gas figures were not re-measured; the NVDA market oracle's 349,200 s bound was taken
  from the builder's warp, only its live `price()` was read here.
- ERC-8056 behaviour of the Chainlink feed across a real split was reasoned, not observed.
