// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {ProtocolFeeLibrary} from "v4-core/libraries/ProtocolFeeLibrary.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

import {V4Fixture} from "./V4Fixture.sol";
import {StockVaultV4} from "../../src/v4/StockVaultV4.sol";
import {StockVaultV4Lens} from "../../src/v4/StockVaultV4Lens.sol";
import {TickOracleV4} from "../../src/v4/TickOracleV4.sol";

/// @dev Every test runs against a real Uniswap v4 pool on Robinhood Chain: the suite below is inherited by one
/// concrete contract per token, PLTR (USDG is currency0, the Stock Token currency1, 1% fee) and TSLA (Stock Token
/// currency0, 0.3% fee), so both currency orders and two fee tiers are exercised, each with the PoolManager's live
/// protocol fee.
abstract contract V4Suite is V4Fixture {
    using StateLibrary for IPoolManager;
    using Math for uint256;

    function RECENTRE_RANGE_BPS() internal pure virtual returns (uint16) {
        return 100;
    }

    function RECENTRE_PUSH_BPS() internal pure virtual returns (uint16) {
        return 300;
    }

    function _close(uint256 a, uint256 b, uint256 bps, string memory what) internal pure {
        uint256 d = a > b ? a - b : b - a;
        assertLe(d * 1e4, b * bps, what);
    }

    // ---------------------------------------------------------------- construction

    function test_runtimeCodeFitsEip170() public {
        assertLe(address(vault).code.length, 24_576);
        assertGt(address(vault).code.length, 20_000, "measuring the real contract");
        emit log_named_uint("StockVaultV4 runtime bytes", address(vault).code.length);
    }

    function test_bindsTheRealPoolAndItsLiveFees() public view {
        assertEq(_poolIdOf(), vault.poolId());
        assertEq(vault.stockIsToken0(), stockIsToken0);
        assertEq(vault.poolFee(), FEE());
        (uint160 sqrtP,, uint24 pf, uint24 lp) = PM.getSlot0(pid);
        assertGt(sqrtP, 0);
        assertEq(lp, FEE(), "static pool: slot0 lpFee is the key fee");
        uint16 a = ProtocolFeeLibrary.getZeroForOneFee(pf);
        uint16 b = ProtocolFeeLibrary.getOneForZeroFee(pf);
        uint256 hi = a > b ? a : b;
        assertGt(hi, 0, "the live pool carries a protocol fee: the swap fee is not the key fee");
        assertEq(vault.swapFee(), hi + lp - hi * lp / 1e6, "swap fee = protocol fee + lp fee - their product");
        assertGt(vault.swapFee(), vault.poolFee());
        assertEq(vault.entryFee(), Math.max(vault.swapFee(), 3500), "entry fee never below what a swap in the pool costs");
    }

    function _poolIdOf() internal view returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    function test_rejectsDynamicFeePool() public {
        StockVaultV4.Config memory c = _config();
        c.fee = 0x800000;
        vm.expectRevert(StockVaultV4.DynamicFeePool.selector);
        new StockVaultV4(c, _defaultParams(), "x", "x");
    }

    function test_rejectsAFeeAboveTwoPercent() public {
        StockVaultV4.Config memory c = _config();
        c.fee = 20_001;
        vm.expectRevert(StockVaultV4.BadConfig.selector);
        new StockVaultV4(c, _defaultParams(), "x", "x");
    }

    function test_rejectsHooksThatCanTakeValueOrBlockAnExit() public {
        uint256[6] memory bits = [uint256(0), 1, 2, 3, 8, 9];
        for (uint256 i; i < bits.length; ++i) {
            StockVaultV4.Config memory c = _config();
            c.hooks = address(uint160((uint256(0xAB) << 152) | (1 << bits[i])));
            vm.expectRevert(StockVaultV4.ForbiddenHook.selector);
            new StockVaultV4(c, _defaultParams(), "x", "x");
        }
    }

    function test_aHookWithOnlySwapAndInitCallbacksPassesTheHookCheck() public {
        // permission bits 13 (beforeInitialize) and 7 (beforeSwap): allowed by the vault; no such pool exists
        StockVaultV4.Config memory c = _config();
        c.hooks = address(uint160((uint256(0xAB) << 152) | (1 << 13) | (1 << 7)));
        vm.expectRevert(StockVaultV4.PoolNotInitialised.selector);
        new StockVaultV4(c, _defaultParams(), "x", "x");
    }

    function test_rejectsAPoolThatDoesNotExist() public {
        StockVaultV4.Config memory c = _config();
        c.tickSpacing = 7;
        vm.expectRevert(StockVaultV4.PoolNotInitialised.selector);
        new StockVaultV4(c, _defaultParams(), "x", "x");
    }

    function test_rejectsAPoolManagerWithoutCode() public {
        StockVaultV4.Config memory c = _config();
        c.poolManager = address(0xdead);
        vm.expectRevert(StockVaultV4.BadConfig.selector);
        new StockVaultV4(c, _defaultParams(), "x", "x");
    }

    function test_unlockCallbackIsPoolManagerOnly() public {
        vm.expectRevert(StockVaultV4.NotPoolManager.selector);
        vault.unlockCallback("");
    }

    // ---------------------------------------------------------------- the observation ring

    function test_seededRingOpensTheGate() public view {
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.Ok));
        (,,,, uint160 twap, uint160 spot) = vault.health();
        _close(twap, spot, 3, "pool idle in the fork: the average is the spot tick (a tick is 1 bp)"); // sqrt price: 1 bp of price is half a bp
    }

    function test_noObservationsMeansNoTwapAndEveryPricedPathIsClosed() public {
        StockVaultV4 fresh = _deploy(_defaultParams());
        (StockVaultV4.Status st,,,,,) = fresh.health();
        assertEq(uint8(st), uint8(StockVaultV4.Status.TwapUnavailable));
        deal(STOCK(), alice, UNIT());
        vm.startPrank(alice);
        IERC20(STOCK()).approve(address(fresh), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(StockVaultV4.OracleUnhealthy.selector, StockVaultV4.Status.TwapUnavailable));
        fresh.deposit(UNIT(), alice);
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + 2 hours);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(StockVaultV4.OracleUnhealthy.selector, StockVaultV4.Status.TwapUnavailable));
        fresh.rebalance();
    }

    function test_aStalledKeeperClosesPricedPathsButNotRedeemInKind() public {
        _instant();
        uint256 shares = _deposit(alice, UNIT());
        vm.warp(vm.getBlockTimestamp() + 3 minutes); // the newest observation is now older than MAX_GAP
        _setFeed(_poolPrice());
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.TwapUnavailable));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockVaultV4.OracleUnhealthy.selector, StockVaultV4.Status.TwapUnavailable));
        vault.redeem(shares / 2, alice, alice);
        vm.prank(alice);
        (uint256 s, uint256 u) = vault.redeemInKind(shares / 2, alice, alice);
        assertGt(s + u, 0, "in kind needs no oracle");
    }

    function test_pokeIsRateLimitedAndOnlyWritesWhenTheFeedIsUsable() public {
        assertFalse(vault.poke(), "same block as the last poke");
        vm.warp(vm.getBlockTimestamp() + 19);
        assertFalse(vault.poke(), "19 s after the last");
        vm.warp(vm.getBlockTimestamp() + 1);
        _setFeed(_poolPrice());
        assertTrue(vault.poke(), "20 s after the last");
        // an invalid feed answer writes nothing
        vm.warp(vm.getBlockTimestamp() + 60);
        vm.mockCall(FEED(), abi.encodeWithSelector(bytes4(keccak256("latestRoundData()"))), abi.encode(feedRound, int256(0), vm.getBlockTimestamp(), vm.getBlockTimestamp(), feedRound));
        assertFalse(vault.poke(), "zero answer");
        // a stale one too
        vm.mockCall(FEED(), abi.encodeWithSelector(bytes4(keccak256("latestRoundData()"))), abi.encode(feedRound, int256(100e8), vm.getBlockTimestamp() - 91_000, vm.getBlockTimestamp() - 91_000, feedRound));
        assertFalse(vault.poke(), "older than maxStaleness");
    }

    function test_aSandwichedPokeMovesTheAverageByAtMostFiveTicks() public {
        TickOracleV4 o = vault.oracle();
        (bool ok0, int24 before_) = o.twap(600);
        assertTrue(ok0);
        _pushPrice(60); // attacker pushes spot 60 bp (60 ticks) up
        _setFeed(_poolPrice());
        vm.warp(vm.getBlockTimestamp() + 60);
        _setFeed(_poolPrice());
        assertTrue(vault.poke(), "the sandwiched poke");
        (, int24 recorded) = o.latest();
        (, int24 spotTick) = _spot();
        assertGt(_abs(spotTick - before_), 50, "the push moved spot more than one observation may follow");
        assertEq(_abs(recorded - before_), o.MAX_STEP(), "the observation follows by exactly MAX_STEP ticks");
        _pushPrice(-60); // back out, same block
        _setFeed(_poolPrice());
        vm.warp(vm.getBlockTimestamp() + 60); // the keeper's next poke
        vault.poke();
        // the 60 s the manipulated observation was credited: 50 ticks * 60 s / 600 s = 5 ticks of average
        (bool ok1, int24 after_) = o.twap(600);
        assertTrue(ok1);
        assertLe(_abs(after_ - before_), 6, "one sandwiched observation moves a 10-minute average by at most MAX_STEP * 60 / 600 ticks");
    }

    function test_anObservationFollowsTheFeedAwayFromThePoolByAtMostOneStep() public {
        (bool ok, int24 before_) = vault.oracle().twap(600);
        assertTrue(ok);
        // the feed moves 3% away from the pool; the recorded tick moves toward the feed by MAX_STEP, never further
        uint256 p = _poolPrice() * 103 / 100;
        _setFeed(p);
        vm.warp(vm.getBlockTimestamp() + 60);
        _setFeed(p);
        assertTrue(vault.poke());
        (, int24 rec) = vault.oracle().latest();
        (,,, uint160 sqrtOracle,,) = vault.health();
        int24 oracleTick = TickMath.getTickAtSqrtPrice(sqrtOracle);
        assertEq(_abs(rec - before_), vault.oracle().MAX_STEP());
        assertLt(_abs(rec - oracleTick), _abs(before_ - oracleTick), "toward the feed");
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.TwapDeviates), "the average has not followed: 3% from the feed");
    }

    function _abs(int24 x) internal pure returns (int24) {
        return x < 0 ? -x : x;
    }

    // ---------------------------------------------------------------- deposit and deploy

    function test_depositInstantDeployOpensAPosition() public {
        _instant();
        uint256 amount = UNIT();
        uint256 shares = _deposit(alice, amount);
        assertGt(shares, 0);
        assertTrue(vault.positionOpen());
        StockVaultV4.PositionInfo memory info = vault.positionInfo();
        assertTrue(info.open);
        assertGt(info.liquidity, 0);
        assertGt(info.usdgAmount, 0, "usdg leg funded");
        assertGt(info.stockAmount, 0, "stock leg funded");
        assertTrue(info.inRange);
        assertEq(info.tickLower % SPACING(), 0);
        assertEq(info.tickUpper % SPACING(), 0);
        // NAV right after the deploy is within the swap cost (fee plus impact, one leg of about half) of the deposit
        _close(vault.totalAssets(), amount, 300, "NAV after deploy");
        // the vault's idle remainder is small
        uint256 idleStock = IERC20(STOCK()).balanceOf(address(vault));
        uint256 idleUsdg = IERC20(USDG).balanceOf(address(vault));
        assertLt(idleStock, amount / 100, "idle stock under 1% of the deposit");
        // the balancing swap moves the pool a little, the range ratio is taken at the price after it, so a sliver of the
        // swapped leg stays idle until the next rebalance and counts in NAV
        assertLt(idleUsdg, _poolPriceUsdg(amount) / 10, "idle usdg under 10% of the deposit value");
        // approvals are never left behind: v4 settles by transfer, nothing is approved to anyone
        assertEq(IERC20(STOCK()).allowance(address(vault), address(PM)), 0);
        assertEq(IERC20(USDG).allowance(address(vault), address(PM)), 0);
    }

    function test_depositWithoutInstantDeployStaysIdleUntilRebalance() public {
        uint256 amount = UNIT();
        _deposit(alice, amount);
        assertFalse(vault.positionOpen());
        assertEq(vault.totalAssets(), amount);
        _advance(1 hours + 1);
        vm.prank(keeper);
        vault.rebalance();
        assertTrue(vault.positionOpen());
        assertGt(vault.positionInfo().liquidity, 0);
        _close(vault.totalAssets(), amount, 300, "NAV after first rebalance");
    }

    function test_withdrawAndRedeemRoundTrip() public {
        _instant();
        uint256 amount = UNIT();
        uint256 shares = _deposit(alice, amount);
        uint256 floor_ = vault.previewRedeem(shares);
        uint256 balBefore = IERC20(STOCK()).balanceOf(alice);
        vm.prank(alice);
        uint256 got = vault.redeem(shares, alice, alice);
        assertEq(IERC20(STOCK()).balanceOf(alice) - balBefore, got);
        assertGe(got, floor_, "proceeds at least the preview floor");
        // two swaps at the pool's swap fee (entry fee retained in the vault, exit swap fee and impact paid)
        _close(got, amount, 400, "round trip cost");
        assertEq(vault.balanceOf(alice), 0);
        assertEq(vault.positionInfo().liquidity, 0, "the last holder took the whole position out");
    }

    function test_withdrawExactAssetsBurnsOnlyWhatItNeeded() public {
        _instant();
        uint256 shares = _deposit(alice, UNIT());
        uint256 want = vault.maxWithdraw(alice) / 3;
        uint256 maxBurn = vault.previewWithdraw(want);
        uint256 balBefore = IERC20(STOCK()).balanceOf(alice);
        vm.prank(alice);
        uint256 burned = vault.withdraw(want, alice, alice);
        assertEq(IERC20(STOCK()).balanceOf(alice) - balBefore, want, "exactly the requested assets");
        assertLe(burned, maxBurn);
        assertEq(vault.balanceOf(alice), shares - burned);
    }

    function test_redeemInKindReturnsBothLegsProRata() public {
        _instant();
        uint256 shares = _deposit(alice, UNIT());
        _advance(11 minutes); // the average catches up with the spot the deploy swap left, so legs at the average are legs at spot
        StockVaultV4.PositionInfo memory before_ = vault.positionInfo();
        uint256 idleStock = IERC20(STOCK()).balanceOf(address(vault));
        uint256 idleUsdg = IERC20(USDG).balanceOf(address(vault));
        uint256 half = shares / 2;
        uint256 sBal = IERC20(STOCK()).balanceOf(alice);
        uint256 uBal = IERC20(USDG).balanceOf(alice);
        vm.prank(alice);
        (uint256 s, uint256 u) = vault.redeemInKind(half, alice, alice);
        assertEq(IERC20(STOCK()).balanceOf(alice) - sBal, s);
        assertEq(IERC20(USDG).balanceOf(alice) - uBal, u);
        // half of each leg of the position (and of the idle remainder), to rounding
        _close(s, (before_.stockAmount + idleStock) / 2, 100, "stock leg");
        _close(u, (before_.usdgAmount + idleUsdg) / 2, 100, "usdg leg");
        _close(vault.positionInfo().liquidity, before_.liquidity / 2, 5, "half the liquidity stays");
    }

    function test_redeemInKindStaysOpenWithTheFeedDeadAndPaused() public {
        _instant();
        uint256 shares = _deposit(alice, UNIT());
        vm.mockCallRevert(FEED(), abi.encodeWithSelector(bytes4(keccak256("latestRoundData()"))), "dead");
        vm.prank(owner);
        vault.pause();
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.FeedInvalid));
        vm.prank(alice);
        (uint256 s, uint256 u) = vault.redeemInKind(shares, alice, alice);
        assertGt(s, 0);
        assertGt(u, 0);
        assertEq(vault.totalSupply(), 0);
        assertEq(IERC20(STOCK()).balanceOf(address(vault)) + IERC20(USDG).balanceOf(address(vault)), 0, "nothing left behind");
    }

    function test_fullInKindExitThenRedepositIntoTheEmptyRange() public {
        _instant();
        uint256 shares = _deposit(alice, UNIT());
        vm.prank(alice);
        vault.redeemInKind(shares, alice, alice);
        assertTrue(vault.positionOpen(), "the range stays set");
        assertEq(vault.positionInfo().liquidity, 0);
        _advance(60);
        _deposit(bob, UNIT());
        assertGt(vault.positionInfo().liquidity, 0, "liquidity added from zero in the old range");
        uint256 bobShares = vault.balanceOf(bob);
        vm.prank(bob);
        vault.redeem(bobShares, bob, bob);
    }

    // ---------------------------------------------------------------- fees

    function test_feesAreValuedExactlyAndHarvestKeepsThePriceContinuous() public {
        _instant();
        uint256 shares = _deposit(alice, UNIT() * 2);
        _volume(60_000e6, 2);
        _advance(300);
        StockVaultV4.PositionInfo memory info = vault.positionInfo();
        assertGt(info.uncollectedStock + info.uncollectedUsdg, 0, "the trades paid the position");
        uint256 pps0 = vault.pricePerShare();
        vm.recordLogs();
        vm.prank(alice);
        vault.redeemInKind(1e12, alice, alice); // dust exit: it harvests first
        (bool found, uint256 f0, uint256 f1, uint256 minted) = _feesCollected(vm.getRecordedLogs());
        assertTrue(found, "FeesCollected");
        (uint256 fStock, uint256 fUsdg) = stockIsToken0 ? (f0, f1) : (f1, f0);
        assertEq(fStock, info.uncollectedStock, "the valued stock fees are what the PoolManager paid");
        assertEq(fUsdg, info.uncollectedUsdg, "the valued usdg fees are what the PoolManager paid");
        assertGt(minted, 0, "the treasury cut was minted");
        assertEq(vault.balanceOf(treasury), minted);
        _close(vault.pricePerShare(), pps0, 2, "price per share is continuous through the harvest");
        assertGt(vault.balanceOf(alice), shares - 2e12);
        (uint256 lsStock, uint256 lsUsdg,) = vault.feesEarnedLifetime();
        assertEq(lsStock, fStock);
        assertEq(lsUsdg, fUsdg);
    }

    function test_rebalanceHarvestsRecentresAndEmits() public {
        _instant();
        _deposit(alice, UNIT() * 2);
        StockVaultV4.PositionInfo memory first = vault.positionInfo();
        _volume(60_000e6, 2);
        _advance(1 hours + 1);
        vm.recordLogs();
        vm.prank(keeper);
        vault.rebalance();
        (bool found,,, uint256 minted) = _feesCollected(vm.getRecordedLogs());
        assertTrue(found && minted > 0, "fees harvested with the treasury cut");
        StockVaultV4.PositionInfo memory second = vault.positionInfo();
        assertTrue(second.open);
        assertGt(second.liquidity, 0);
        assertTrue(second.inRange);
        assertEq(vault.lastRebalance(), vm.getBlockTimestamp());
        // a market that has barely moved leaves the range within a spacing of where it was
        assertLe(_abs(second.tickLower - first.tickLower), SPACING());
        assertLe(_abs(second.tickUpper - first.tickUpper), SPACING());
    }

    function test_rebalanceRecentresAfterARealPriceMove() public {
        StockVaultV4.Params memory p = _defaultParams();
        p.rangeBps = RECENTRE_RANGE_BPS(); // a narrow band, so a move the pool absorbs (RECENTRE_PUSH_BPS) takes the price out of it
        _ownerDo(abi.encodeCall(StockVaultV4.setParams, (p)));
        _instant();
        _deposit(alice, UNIT() * 2);
        StockVaultV4.PositionInfo memory first = vault.positionInfo();
        _pushPrice(int256(uint256(RECENTRE_PUSH_BPS()))); // the stock gains that much: out of the range
        _setFeed(_poolPrice());
        _advance(1 hours + 1); // the ring follows 50 ticks per observation, the feed follows the pool
        vm.prank(keeper);
        vault.rebalance();
        StockVaultV4.PositionInfo memory second = vault.positionInfo();
        assertTrue(second.inRange);
        assertTrue(second.tickLower != first.tickLower, "recentred");
    }

    function test_depositIntoAnOpenPositionHarvestsFirst() public {
        _instant();
        _deposit(alice, UNIT() * 2);
        _volume(60_000e6, 2);
        _advance(300);
        _settle();
        StockVaultV4.PositionInfo memory info = vault.positionInfo();
        assertGt(info.uncollectedStock + info.uncollectedUsdg, 0);
        _fund(bob, UNIT());
        vm.recordLogs();
        vm.prank(bob);
        vault.deposit(UNIT(), bob);
        (bool found, uint256 f0, uint256 f1, uint256 minted) = _feesCollected(vm.getRecordedLogs());
        assertTrue(found, "adding liquidity pays the position's fees into the vault, so they are harvested first");
        (uint256 fStock, uint256 fUsdg) = stockIsToken0 ? (f0, f1) : (f1, f0);
        assertEq(fStock, info.uncollectedStock);
        assertEq(fUsdg, info.uncollectedUsdg);
        assertGt(minted, 0, "with the treasury cut");
        assertEq(vault.balanceOf(treasury), minted);
    }

    function test_uncollectedFeesAreInNav() public {
        _instant();
        _deposit(alice, UNIT() * 2);
        uint256 nav0 = vault.totalAssets();
        _volume(60_000e6, 2); // no pokes: the average and the feed stand still, only the fees change
        StockVaultV4.PositionInfo memory info = vault.positionInfo();
        (, uint256 price,,, uint160 sqrtTwap,) = vault.health();
        uint256 navPrice = Math.min(price, _usdOf(sqrtTwap));
        uint256 feeValue = info.uncollectedStock + info.uncollectedUsdg * 1e20 / navPrice;
        assertGt(feeValue, 0);
        uint256 expected = nav0 + feeValue * (1e4 - 1000) / 1e4; // the treasury's cut is deducted from the fees
        assertApproxEqRel(vault.totalAssets(), expected, 5e14, "NAV rose by the fees, net of the performance cut");
    }

    function test_anInKindExitWithTheGateClosedLeavesTheFeesWithTheHoldersWhoStay() public {
        _instant();
        uint256 a = _deposit(alice, UNIT() * 2);
        uint256 b = _deposit(bob, UNIT() * 2);
        _volume(120_000e6, 3);
        _advance(600);
        _settle();
        StockVaultV4.PositionInfo memory info = vault.positionInfo();
        (, uint256 price,,,,) = vault.health();
        uint256 feeValue = info.uncollectedStock + info.uncollectedUsdg * 1e20 / price;
        assertGt(feeValue * 1000, vault.totalAssets() * 3, "the position holds fees worth at least 0.3% of NAV");
        uint256 idleStock = IERC20(STOCK()).balanceOf(address(vault));
        uint256 idleUsdg = IERC20(USDG).balanceOf(address(vault));
        // the position's legs at the price the removal will see: spot
        (uint160 spotSqrt,) = _spot();
        (uint256 p0, uint256 p1) = vault.vaultMath().amounts(spotSqrt, info.tickLower, info.tickUpper, info.liquidity);
        (uint256 posStock, uint256 posUsdg) = stockIsToken0 ? (p0, p1) : (p1, p0);
        uint256 bobBefore = vault.convertToAssets(b);
        uint256 supply = vault.totalSupply();
        vm.mockCallRevert(FEED(), abi.encodeWithSelector(bytes4(keccak256("latestRoundData()"))), "dead");
        vm.prank(alice);
        (uint256 s, uint256 u) = vault.redeemInKind(a, alice, alice);
        // her slice is her fraction of the principal and the idle balances; the fees stay with the vault
        _close(s, (posStock + idleStock) * a / supply, 10, "stock leg is principal only");
        _close(u, (posUsdg + idleUsdg) * a / supply, 10, "usdg leg is principal only");
        vm.clearMockedCalls();
        _setFeed(_poolPrice());
        assertGe(vault.convertToAssets(b) * 1e4, bobBefore * (1e4 - 5), "the holder who stays loses nothing to the exit");
    }

    // ---------------------------------------------------------------- must-fail: the oracle gate

    function test_depositRevertsWhenTheFeedAndThePoolDisagree() public {
        _setFeed(_poolPrice() * 103 / 100);
        StockVaultV4.Status st = _status();
        assertTrue(st == StockVaultV4.Status.SpotDeviates || st == StockVaultV4.Status.TwapDeviates, "closed");
        _fund(alice, UNIT());
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockVaultV4.OracleUnhealthy.selector, st));
        vault.deposit(UNIT(), alice);
    }

    function test_aFeedJumpWithoutAPoolMoveClosesOnTheAverageFirst() public {
        _setFeed(_poolPrice() * 103 / 100);
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.TwapDeviates));
    }

    function test_aPoolPushedAwayFromTheFeedClosesOnSpot() public {
        // spot moves 3% up with the feed unchanged; the observation lags by design (MAX_STEP per observation)
        _pushPrice(300);
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.SpotDeviates));
    }

    function test_depositIsRefusedWhenSpotIsPushedBelowTheAverageBeyondTheBand() public {
        _pushPrice(-50);
        _setFeed(_poolPrice()); // the feed follows: no deviation, only the band
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.Ok));
        _fund(alice, UNIT());
        vm.prank(alice);
        vm.expectRevert(StockVaultV4.SpotOffTwap.selector);
        vault.deposit(UNIT(), alice);
    }

    function test_aSpotAboveTheAverageDoesNotBlockADeposit() public {
        _pushPrice(50);
        _setFeed(_poolPrice());
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.Ok));
        _fund(alice, UNIT());
        vm.prank(alice);
        assertGt(vault.deposit(UNIT(), alice), 0);
    }

    function test_rebalanceRefusedWhenSpotIsOffTheAverageOnEitherSide() public {
        _instant();
        _deposit(alice, UNIT());
        _advance(1 hours + 1);
        _pushPrice(40);
        _setFeed(_poolPrice());
        vm.prank(keeper);
        vm.expectRevert(StockVaultV4.SpotOffTwap.selector);
        vault.rebalance();
    }

    function test_rebalanceRefusedWhenTheAverageIsFarFromTheFeed() public {
        _instant();
        _deposit(alice, UNIT());
        _advance(1 hours + 1);
        // the feed prints 50 bp away from a pool that has not moved: inside the 100 bp gate, outside the 30 bp bound
        _setFeed(_poolPrice() * 10_050 / 10_000);
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.Ok));
        vm.prank(keeper);
        vm.expectRevert(StockVaultV4.TwapOffOracle.selector);
        vault.rebalance();
    }

    function test_rebalanceIsKeeperOnlyUntilTwentySixHours() public {
        _instant();
        _deposit(alice, UNIT());
        _advance(2 hours);
        vm.prank(bob);
        vm.expectRevert(StockVaultV4.NotKeeper.selector);
        vault.rebalance();
        vm.prank(keeper);
        vault.rebalance();
        vm.prank(keeper);
        vm.expectRevert(StockVaultV4.TooSoon.selector);
        vault.rebalance();
        _advance(26 hours);
        vm.prank(bob);
        vault.rebalance();
    }

    function test_corporateActionClosesPricedPathsButNotRedeemInKind() public {
        _instant();
        uint256 shares = _deposit(alice, UNIT());
        vm.mockCall(STOCK(), abi.encodeWithSignature("oraclePaused()"), abi.encode(true));
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.CorporateAction));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockVaultV4.OracleUnhealthy.selector, StockVaultV4.Status.CorporateAction));
        vault.redeem(shares / 2, alice, alice);
        _fund(bob, UNIT());
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(StockVaultV4.OracleUnhealthy.selector, StockVaultV4.Status.CorporateAction));
        vault.deposit(UNIT(), bob);
        vm.prank(alice);
        (uint256 s,) = vault.redeemInKind(shares / 2, alice, alice);
        assertGt(s, 0);
        vm.clearMockedCalls();
    }

    function test_windowAroundAMultiplierChange() public {
        vm.mockCall(STOCK(), abi.encodeWithSignature("effectiveAt()"), abi.encode(vm.getBlockTimestamp() + 61 minutes));
        _setFeed(_poolPrice());
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.Ok), "more than an hour ahead is not yet in the window");
        vm.mockCall(STOCK(), abi.encodeWithSignature("effectiveAt()"), abi.encode(vm.getBlockTimestamp() + 59 minutes));
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.CorporateAction));
        vm.mockCall(STOCK(), abi.encodeWithSignature("effectiveAt()"), abi.encode(vm.getBlockTimestamp() - (1 hours + 600)));
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.CorporateAction), "still inside lag plus twapWindow");
        vm.mockCall(STOCK(), abi.encodeWithSignature("effectiveAt()"), abi.encode(vm.getBlockTimestamp() - (1 hours + 600) - 1));
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.Ok));
        vm.clearMockedCalls();
    }

    // ---------------------------------------------------------------- must-fail: shares and the queue

    function test_sharesCannotLeaveInTheBlockTheyAreMinted() public {
        _fund(alice, UNIT());
        vm.startPrank(alice);
        uint256 shares = vault.deposit(UNIT(), alice);
        vm.expectRevert(StockVaultV4.SharesLocked.selector);
        vault.redeem(shares, alice, alice);
        vm.expectRevert(StockVaultV4.SharesLocked.selector);
        vault.redeemInKind(shares, alice, alice);
        vm.expectRevert(StockVaultV4.SharesLocked.selector);
        vault.transfer(bob, shares);
        vm.stopPrank();
        vm.roll(block.number + 1);
        vm.prank(alice);
        vault.transfer(bob, shares / 2);
        vm.prank(alice);
        vault.redeemInKind(shares / 2, alice, alice);
    }

    function test_aDustDepositCannotTrapAnExistingHolder() public {
        uint256 shares = _deposit(alice, UNIT());
        _fund(bob, UNIT());
        vm.prank(bob);
        vault.deposit(1e6, alice); // dust minted to alice in this block
        vm.prank(alice);
        vault.redeemInKind(shares - 1, alice, alice); // her older shares are free
    }

    function test_settersAreOnlyReachableThroughTheQueue() public {
        vm.expectRevert(StockVaultV4.ChangeNotQueued.selector);
        vault.setSpotTwapBand(20);
        vm.prank(owner);
        vm.expectRevert(StockVaultV4.ChangeNotQueued.selector);
        vault.setSpotTwapBand(20);
        bytes memory data = abi.encodeCall(StockVaultV4.setSpotTwapBand, (20));
        vm.prank(owner);
        vault.queueChange(data);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(StockVaultV4.ChangeTooEarly.selector, vm.getBlockTimestamp() + 24 hours));
        vault.executeChange(data);
        vm.prank(owner);
        vm.expectRevert(StockVaultV4.ChangeNotAllowed.selector);
        vault.queueChange(abi.encodeCall(StockVaultV4.setTreasury, (bob)));
        vm.warp(vm.getBlockTimestamp() + 24 hours);
        vm.prank(owner);
        vault.executeChange(data);
        assertEq(vault.maxSpotTwapBps(), 20);
    }

    function test_theOwnerCannotPauseWithdrawalsOrRenounce() public {
        _instant();
        uint256 shares = _deposit(alice, UNIT());
        vm.prank(owner);
        vault.pause();
        vm.prank(alice);
        vault.redeem(shares / 2, alice, alice);
        vm.prank(alice);
        vault.redeemInKind(shares / 4, alice, alice);
        _fund(bob, UNIT());
        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.deposit(UNIT(), bob);
        vm.prank(owner);
        vm.expectRevert(StockVaultV4.BadConfig.selector);
        vault.renounceOwnership();
    }

    function test_paramsAreRangeChecked() public {
        StockVaultV4.Params memory p = _defaultParams();
        p.twapWindow = 599;
        vm.expectRevert(StockVaultV4.BadParams.selector);
        new StockVaultV4(_config(), p, "x", "x");
        p = _defaultParams();
        p.twapWindow = 1801;
        vm.expectRevert(StockVaultV4.BadParams.selector);
        new StockVaultV4(_config(), p, "x", "x");
    }

    // ---------------------------------------------------------------- swap fee, entry fee, floors

    function test_previewsPriceTheSwapFeeTheExitPays() public {
        _instant();
        uint256 shares = _deposit(alice, UNIT());
        uint256 fair = vault.convertToAssets(shares);
        uint256 expected = fair * (1e4 - 30) / 1e4 * (1e6 - vault.swapFee()) / 1e6;
        assertEq(vault.previewRedeem(shares), expected, "previewRedeem uses the live swap fee, protocol fee included");
        assertLt(vault.previewRedeem(shares), fair * (1e4 - 30) / 1e4 * (1e6 - vault.poolFee()) / 1e6);
    }

    function test_entryFeeStaysWithTheHoldersAndIsAtLeastTheSwapFee() public {
        _instant();
        _deposit(alice, UNIT() * 2);
        uint256 shares = _deposit(bob, UNIT());
        assertGe(vault.entryFee(), vault.swapFee(), "entering is never cheaper than swapping in the pool");
        vm.prank(bob);
        (uint256 s, uint256 u) = vault.redeemInKind(shares, bob, bob);
        (, uint256 price,,,,) = vault.health();
        uint256 out = s + u * 1e20 / price; // usdg raw (6 dp) to stock wei at the feed price (8 dp)
        // bob's claim is his deposit less the entry fee, plus about a third of the fee back as a holder of 1/3
        assertLt(out, UNIT() * (1e6 - vault.entryFee() / 2) / 1e6, "an immediate in-kind exit leaves at least half the fee with the vault");
    }

    function test_theDeploySwapFloorIncludesTheChainlinkPriceSelling() public {
        // widen the oracle gate so a 3% gap between feed and pool is not closed by it, then the swap floor must be
        StockVaultV4.Params memory p = _defaultParams();
        p.maxDeviationBps = 500;
        _ownerDo(abi.encodeCall(StockVaultV4.setParams, (p)));
        _instant();
        _setFeed(_poolPrice() * 103 / 100); // the feed says 3% above the pool: selling stock into the pool is a bad fill
        vm.warp(vm.getBlockTimestamp() + 60);
        _setFeed(_poolPrice() * 103 / 100);
        vault.poke();
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.Ok), "inside the widened gate");
        _fund(alice, UNIT());
        vm.prank(alice);
        vm.expectPartialRevert(StockVaultV4.SwapBelowMinimum.selector);
        vault.deposit(UNIT(), alice);
        // control: the same deposit with the feed on the pool fills
        _setFeed(_poolPrice());
        vm.warp(vm.getBlockTimestamp() + 60);
        _setFeed(_poolPrice());
        vault.poke();
        for (uint256 i; i < 12; ++i) {
            vm.warp(vm.getBlockTimestamp() + 60);
            _setFeed(_poolPrice());
            vault.poke();
        }
        vm.prank(alice);
        assertGt(vault.deposit(UNIT(), alice), 0);
        assertTrue(vault.positionOpen());
    }

    function test_theDeploySwapFloorIncludesTheChainlinkPriceBuying() public {
        StockVaultV4.Params memory p = _defaultParams();
        p.maxDeviationBps = 500;
        _ownerDo(abi.encodeCall(StockVaultV4.setParams, (p)));
        _instant();
        // the vault holds USDG and a sliver of stock: the deploy swap buys the stock
        deal(USDG, address(vault), _poolPriceUsdg(UNIT()));
        _setFeed(_poolPrice() * 97 / 100); // the feed says 3% below the pool: buying stock from the pool is a bad fill
        vm.warp(vm.getBlockTimestamp() + 60);
        _setFeed(_poolPrice() * 97 / 100);
        vault.poke();
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.Ok));
        _fund(alice, UNIT() / 100);
        vm.prank(alice);
        vm.expectPartialRevert(StockVaultV4.SwapBelowMinimum.selector);
        vault.deposit(UNIT() / 100, alice);
    }

    function _poolPriceUsdg(uint256 stockAmt) internal view returns (uint256) {
        return stockAmt * _poolPrice() / 1e8 / 1e12;
    }

    // ---------------------------------------------------------------- holders who stay

    function test_anExitLeavesTheHoldersWhoStayWhole() public {
        _instant();
        _deposit(alice, UNIT() * 2);
        _deposit(bob, UNIT());
        uint256 pps0 = vault.pricePerShare();
        uint256 bobShares = vault.balanceOf(bob);
        uint256 half = vault.balanceOf(alice) / 2;
        vm.prank(alice);
        vault.redeem(half, alice, alice);
        _close(vault.pricePerShare(), pps0, 20, "NAV per share of those who stay after a redeem");
        uint256 quarter = vault.balanceOf(alice) / 2;
        vm.prank(alice);
        vault.redeemInKind(quarter, alice, alice);
        _close(vault.pricePerShare(), pps0, 20, "NAV per share of those who stay after an in-kind exit");
        assertEq(vault.balanceOf(bob), bobShares);
    }

    // ---------------------------------------------------------------- views

    function test_lensViewsMatchTheVault() public {
        _instant();
        _deposit(alice, UNIT());
        StockVaultV4Lens lens = new StockVaultV4Lens();
        (uint256 stockFees, uint256 usdgFees, uint256 v) = vault.feesEarnedLifetime();
        assertEq(stockFees + usdgFees, 0);
        assertEq(v, 0);
        uint256 usdgValue = lens.totalValueInUSDG(vault);
        (, uint256 price,,,,) = vault.health();
        assertEq(usdgValue, vault.totalAssets() * price / 1e8 / 1e12);
        (int24 lo, int24 hi, uint256 pLow, uint256 pHigh) = lens.currentRange(vault);
        assertEq(lo, vault.tickLower());
        assertEq(hi, vault.tickUpper());
        assertLt(pLow, price);
        assertGt(pHigh, price);
        assertLt(pHigh * 1e4 / pLow, 11_600, "a +-5% band snapped outward to the spacing");
    }
}

contract StockVaultV4PltrTest is V4Suite {
    function STOCK() internal pure override returns (address) {
        return 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A;
    }

    function FEED() internal pure override returns (address) {
        return 0x820ABedFF239034956B7A9d2F0a331f9F075eB4c;
    }

    function FEE() internal pure override returns (uint24) {
        return 10_000;
    }

    function SPACING() internal pure override returns (int24) {
        return 200;
    }

    function UNIT() internal pure override returns (uint256) {
        return 100e18;
    }
}

contract StockVaultV4TslaTest is V4Suite {
    function STOCK() internal pure override returns (address) {
        return 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    }

    function FEED() internal pure override returns (address) {
        return 0x4A1166a659A55625345e9515b32adECea5547C38;
    }

    function FEE() internal pure override returns (uint24) {
        return 3000;
    }

    function SPACING() internal pure override returns (int24) {
        return 60;
    }

    function UNIT() internal pure override returns (uint256) {
        return 50e18;
    }

    function RECENTRE_RANGE_BPS() internal pure override returns (uint16) {
        return 50;
    }

    function RECENTRE_PUSH_BPS() internal pure override returns (uint16) {
        return 100;
    }
}
