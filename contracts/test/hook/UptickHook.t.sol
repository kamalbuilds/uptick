// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, Vm, console2} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {CapRegistry} from "../../src/hook/CapRegistry.sol";
import {UptickHook} from "../../src/hook/UptickHook.sol";

/// Runs on the shared local Anvil fork of Robinhood Chain (4663): real PoolManager, real NVDA, USDG
/// and Chainlink NVDA feed. Only the feed's latestRoundData is mocked, to control price and age.
contract UptickHookTest is Test {
    using PoolIdLibrary for PoolKey;

    string constant RPC = "http://127.0.0.1:8545";
    IPoolManager constant PM = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;

    uint160 constant FLAGS = uint160(
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );
    bytes32 constant SWAP_TOPIC = keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    bytes32 constant QUOTED_TOPIC = keccak256("FeeQuoted(bytes32,uint8,uint256,uint24)");

    uint24 constant REGULAR = 2500;
    uint24 constant OFF = 1000;
    uint24 constant WEEKEND = 500;
    uint24 constant SLOPE = 20; // pips per bp of gap
    uint24 constant MAX_SUR = 5000;
    uint16 constant MAX_FEE_BPS = 100; // 10_000 pips
    uint32 constant STALE = 90_000; // 25 h

    // independent timestamps, generated with `date -u`, not with the hook's calendar code
    uint256 constant TUE_1500 = 1792508400; // 2026-10-20
    uint256 constant TUE_0200 = 1792461600;
    uint256 constant SAT_1200 = 1792843200; // 2026-10-24
    int256 constant A0 = 21458620962; // real NVDA answer, 8 decimals

    UptickHook hook;
    CapRegistry registry;
    PoolSwapTest router;
    PoolModifyLiquidityTest lpRouter;
    PoolKey key;
    PoolId pid;
    uint256 mult;
    uint160 initSqrt;

    function setUp() public {
        vm.createSelectFork(RPC);
        require(block.chainid == 4663, "not the 4663 fork");
        require(address(PM).code.length > 20_000, "PoolManager missing");
        require(USDG.code.length > 100 && NVDA.code.length > 100 && FEED.code.length > 100, "tokens missing");

        registry = new CapRegistry();
        hook = _deploy(NVDA, USDG, FEED);
        mult = _uiMult();

        (Currency c0, Currency c1) = (Currency.wrap(USDG), Currency.wrap(NVDA)); // USDG < NVDA
        key = PoolKey(c0, c1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 10, IHooks(address(hook)));
        pid = key.toId();

        // pool starts exactly at the real reference: USD per raw token = answer * uiMultiplier
        uint256 priceE8 = uint256(A0) * mult / 1e18;
        initSqrt = uint160(FixedPointMathLib.sqrt(FullMath.mulDiv(1e20, 1 << 128, priceE8)) << 32);
        int24 tick = PM.initialize(key, initSqrt);

        router = new PoolSwapTest(PM);
        lpRouter = new PoolModifyLiquidityTest(PM);
        deal(USDG, address(this), 1e15);
        deal(NVDA, address(this), 1e24);
        require(IERC20Like(USDG).balanceOf(address(this)) == 1e15, "deal USDG failed");
        require(IERC20Like(NVDA).balanceOf(address(this)) == 1e24, "deal NVDA failed");
        for (uint256 i; i < 2; ++i) {
            address t = i == 0 ? USDG : NVDA;
            IERC20Like(t).approve(address(router), type(uint256).max);
            IERC20Like(t).approve(address(lpRouter), type(uint256).max);
        }
        int24 lo = (tick / 10) * 10 - 3000;
        int24 hi = (tick / 10) * 10 + 3000;
        lpRouter.modifyLiquidity(key, IPoolManager.ModifyLiquidityParams(lo, hi, int256(1e15), 0), "");
        _mockFeed(A0, block.timestamp);
    }

    // ------------------------------------------------------------ helpers

    function _params(address stock, address quote, address feed_) internal pure returns (UptickHook.Params memory) {
        return UptickHook.Params(stock, quote, feed_, STALE, REGULAR, OFF, WEEKEND, SLOPE, MAX_SUR, MAX_FEE_BPS);
    }

    function _deploy(address stock, address quote, address feed_) internal returns (UptickHook h) {
        bytes memory args = abi.encode(PM, registry, _params(stock, quote, feed_));
        (address want, bytes32 salt) = HookMiner.find(address(this), FLAGS, type(UptickHook).creationCode, args);
        h = new UptickHook{salt: salt}(PM, registry, _params(stock, quote, feed_));
        assertEq(address(h), want);
    }

    function _uiMult() internal view returns (uint256) {
        return IERC20Like(NVDA).uiMultiplier();
    }

    function _mockFeed(int256 answer, uint256 updatedAt) internal {
        vm.mockCall(
            FEED,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(uint80(1), answer, updatedAt, updatedAt, uint80(1))
        );
    }

    /// reference lower by g bps of A0, so the pool sits above the reference
    function _poolAboveRef(uint256 gBps) internal {
        _mockFeed(int256(uint256(A0) * (10_000 - gBps) / 10_000), block.timestamp);
    }

    function _swap(bool zeroForOne, uint256 amtIn)
        internal
        returns (UptickHook.Session s, uint256 gapBps, uint24 hookFee, uint24 pmFee, int128 out)
    {
        vm.recordLogs();
        int128 a0;
        int128 a1;
        {
            IPoolManager.SwapParams memory sp = IPoolManager.SwapParams(
                zeroForOne, -int256(amtIn), zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            );
            PoolSwapTest.TestSettings memory ts = PoolSwapTest.TestSettings(false, false);
            router.swap(key, sp, ts, "");
        }
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 seenQuoted;
        uint256 seenSwap;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == QUOTED_TOPIC) {
                (uint8 ss, uint256 g, uint24 f) = abi.decode(logs[i].data, (uint8, uint256, uint24));
                s = UptickHook.Session(ss);
                gapBps = g;
                hookFee = f;
                ++seenQuoted;
            } else if (logs[i].emitter == address(PM) && logs[i].topics[0] == SWAP_TOPIC) {
                (a0, a1,,,, pmFee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                ++seenSwap;
            }
        }
        assertEq(seenQuoted, 1, "one FeeQuoted per swap");
        assertEq(seenSwap, 1, "one PoolManager Swap");
        assertEq(pmFee, hookFee, "PoolManager charged the quoted fee");
        out = zeroForOne ? a1 : a0;
    }

    /// swap from the state at call time, then roll the chain state back so the next swap sees the same pool
    function _swapFresh(bool zeroForOne, uint256 amtIn)
        internal
        returns (UptickHook.Session s, uint256 gapBps, uint24 hookFee, uint24 pmFee, int128 out)
    {
        uint256 snap = vm.snapshotState();
        (s, gapBps, hookFee, pmFee, out) = _swap(zeroForOne, amtIn);
        vm.revertToState(snap);
    }

    uint256 constant BUY = 1e8; // 100 USDG into the pool (zeroForOne, buys NVDA, price up)
    uint256 constant SELL = 4e17; // 0.4 NVDA into the pool (oneForZero, sells NVDA, price down)

    // -------------------------------------------------------- (a) session

    function test_sessionFeeCharged_regularOffWeekend() public {
        vm.warp(TUE_1500);
        _mockFeed(A0, block.timestamp);
        (UptickHook.Session s,,, uint24 f,) = _swapFresh(true, BUY);
        assertEq(uint8(s), uint8(UptickHook.Session.Regular));
        assertEq(f, REGULAR);

        vm.warp(TUE_0200);
        _mockFeed(A0, block.timestamp);
        (s,,, f,) = _swapFresh(true, BUY);
        assertEq(uint8(s), uint8(UptickHook.Session.OffHours));
        assertEq(f, OFF);

        vm.warp(SAT_1200);
        _mockFeed(A0, block.timestamp);
        (s,,, f,) = _swapFresh(false, SELL);
        assertEq(uint8(s), uint8(UptickHook.Session.Weekend));
        assertEq(f, WEEKEND);
    }

    function test_holidayIsOffHours_swap() public {
        vm.warp(1795705200); // Thanksgiving 2026-11-26 15:00 UTC, inside EST trading hours on any other Thursday
        _mockFeed(A0, block.timestamp);
        (UptickHook.Session s,,, uint24 f,) = _swapFresh(true, BUY);
        assertEq(uint8(s), uint8(UptickHook.Session.OffHours));
        assertEq(f, OFF);
        vm.warp(1795705200 + 7 days); // next Thursday, ordinary session
        _mockFeed(A0, block.timestamp);
        (s,,, f,) = _swapFresh(true, BUY);
        assertEq(uint8(s), uint8(UptickHook.Session.Regular));
        assertEq(f, REGULAR);
    }

    function _chk(uint256 ts, UptickHook.Session want) internal view {
        assertEq(uint8(hook.sessionAt(ts)), uint8(want), vm.toString(ts));
    }

    function test_sessionBoundaries_EDT() public view {
        UptickHook.Session R = UptickHook.Session.Regular;
        UptickHook.Session O = UptickHook.Session.OffHours;
        UptickHook.Session W = UptickHook.Session.Weekend;
        _chk(1793366999, O); // Fri 2026-10-30 13:29:59 (EDT)
        _chk(1793367000, R); // 13:30:00
        _chk(1792785599, R); // Fri 2026-10-23 19:59:59
        _chk(1792785600, W); // Fri 20:00:00 EDT close
        _chk(1792972799, W); // Sun 23:59:59
        _chk(1792972800, O); // Mon 00:00:00
        _chk(1792843200, W); // Sat
    }

    function test_dstBoundary_autumn_and_spring() public view {
        UptickHook.Session R = UptickHook.Session.Regular;
        UptickHook.Session O = UptickHook.Session.OffHours;
        UptickHook.Session W = UptickHook.Session.Weekend;
        // DST ended Sun 2026-11-01: EST, session 14:30-21:00 UTC
        _chk(1793626200, O); // Mon 11-02 13:30 UTC (open under EDT, not under EST)
        _chk(1793629799, O); // 14:29:59
        _chk(1793629800, R); // 14:30:00
        _chk(1793651400, R); // 20:30 (closed under EDT)
        _chk(1793653199, R); // 20:59:59
        _chk(1793653200, O); // 21:00:00
        // EST Friday close at 21:00 UTC: Fri 2026-03-06
        _chk(1772803800, O); // 13:30
        _chk(1772807400, R); // 14:30
        _chk(1772830799, R); // 20:59:59
        _chk(1772830800, W); // 21:00:00
        // DST began Sun 2026-03-08: EDT from Mon 03-09
        _chk(1773062999, O); // 13:29:59
        _chk(1773063000, R); // 13:30
        _chk(1773086399, R); // 19:59:59
        _chk(1773086400, O); // 20:00
        // 2027: DST begins Sun 03-14 (second Sunday)
        _chk(1804858200, O); // Fri 03-12 13:30 EST
        _chk(1804861800, R); // 14:30 EST
        _chk(1805117400, R); // Mon 03-15 13:30 EDT
        // Good Friday 2027-03-26: off all day, then weekend at the EDT close
        _chk(1806073200, O);
        _chk(1806094800, W);
    }

    function test_allTwentyHolidaysAreOffHours_andThreeWeeksAfterIsRegular() public view {
        uint256[20] memory h = [
            uint256(1767279600), 1768834800, 1771254000, 1775228400, 1779721200, 1781881200, 1783090800, 1788793200,
            1795705200, 1798210800, 1798815600, 1800284400, 1802703600, 1806073200, 1811775600, 1813330800,
            1814799600, 1820242800, 1827154800, 1829660400
        ];
        for (uint256 i; i < h.length; ++i) {
            // 15:00 UTC sits inside regular hours in both EDT and EST
            _chk(h[i], UptickHook.Session.OffHours);
            _chk(h[i] + 21 days, UptickHook.Session.Regular);
        }
    }

    // --------------------------------------------------- (b) surcharge

    function test_awayPaysMoreThanToward() public {
        vm.warp(TUE_1500);
        _poolAboveRef(100); // pool about 101 bps above reference
        uint256 snap = vm.snapshotState();

        // buying NVDA lifts the pool price: away from the reference
        (UptickHook.Session s, uint256 gapAway, uint24 feeAway,, int128 outAway) = _swap(true, BUY);
        assertEq(uint8(s), uint8(UptickHook.Session.Regular));
        assertApproxEqAbs(gapAway, 101, 1);
        assertEq(feeAway, REGULAR + gapAway * SLOPE);

        vm.revertToState(snap);
        _poolAboveRef(100);
        // selling NVDA lowers it: toward the reference, session fee only
        (, uint256 gapToward, uint24 feeToward,,) = _swap(false, SELL);
        assertEq(gapToward, gapAway, "same gap measured");
        assertEq(feeToward, REGULAR);
        assertGt(feeAway, feeToward);

        // same swap with no gap: the surcharge is a real cost to the trader
        vm.revertToState(snap);
        _mockFeed(A0, block.timestamp);
        (,, uint24 feeFlat,, int128 outFlat) = _swap(true, BUY);
        assertEq(feeFlat, REGULAR);
        assertGt(outFlat, outAway, "trader receives less when pushing away");
    }

    function test_awayPaysMore_mirror_poolBelowRef() public {
        vm.warp(TUE_1500);
        _mockFeed(int256(uint256(A0) * 10_100 / 10_000), block.timestamp); // ref 1% above pool
        (,, uint24 buyFee,,) = _swapFresh(true, BUY); // price up: toward
        assertEq(buyFee, REGULAR);
        (,, uint24 sellFee,,) = _swapFresh(false, SELL); // price down: away
        assertGt(sellFee, REGULAR);
    }

    function test_surchargeCapped() public {
        vm.warp(TUE_1500);
        _poolAboveRef(3000); // 30 percent off
        (,, uint24 f,,) = _swap(true, BUY);
        assertEq(f, REGULAR + MAX_SUR);
        assertLe(f, hook.maxFee());
    }

    // ------------------------------------------------------ (c) stale

    function test_staleFeedFallsBackToSession() public {
        vm.warp(TUE_1500);
        // exactly at maxStaleness the feed is still used
        _mockFeed(int256(uint256(A0) * 9_000 / 10_000), block.timestamp - STALE);
        (,, uint24 f,,) = _swap(true, BUY);
        assertGt(f, REGULAR, "fresh enough: surcharge applies");
        // one second older: session fee only, gap reported 0
        _mockFeed(int256(uint256(A0) * 9_000 / 10_000), block.timestamp - STALE - 1);
        (, uint256 gap, uint24 f2,,) = _swap(true, BUY);
        assertEq(f2, REGULAR);
        assertEq(gap, 0);
    }

    function test_realUnmockedFeedIsStaleAfterWeekend_sessionFeeOnly() public {
        vm.clearMockedCalls();
        vm.warp(SAT_1200);
        (, uint256 updatedAt) = _realFeed();
        assertGt(SAT_1200 - updatedAt, STALE, "real feed round is older than maxStaleness");
        (UptickHook.Session s,, uint24 f,,) = _swap(true, BUY);
        assertEq(uint8(s), uint8(UptickHook.Session.Weekend));
        assertEq(f, WEEKEND);
    }

    function test_badAnswerFallsBack() public {
        vm.warp(TUE_1500);
        _mockFeed(0, block.timestamp);
        (,, uint24 f,,) = _swap(true, BUY);
        assertEq(f, REGULAR);
        _mockFeed(-5, block.timestamp);
        (,, f,,) = _swap(true, BUY);
        assertEq(f, REGULAR);
        _mockFeed(int256(uint256(A0) * 9_000 / 10_000), block.timestamp + 1); // from the future
        (,, f,,) = _swap(true, BUY);
        assertEq(f, REGULAR);
    }

    function test_feedRevertFallsBack() public {
        vm.warp(TUE_1500);
        vm.mockCallRevert(FEED, abi.encodeWithSignature("latestRoundData()"), "feed down");
        (,, uint24 f,,) = _swap(true, BUY);
        assertEq(f, REGULAR);
    }

    function _realFeed() internal view returns (int256 answer, uint256 updatedAt) {
        (, answer,, updatedAt,) = IFeedLike(FEED).latestRoundData();
    }

    // ----------------------------------------------------- (d) cap holds

    function test_capRegisteredAndConstructorEnforcesSchedule() public {
        (uint16 cap, bool reg) = registry.capOf(address(hook));
        assertEq(cap, MAX_FEE_BPS);
        assertTrue(reg);
        assertEq(hook.maxFee(), uint24(MAX_FEE_BPS) * 100);
        // schedule whose worst case exceeds the declared cap cannot be deployed
        UptickHook.Params memory p = _params(NVDA, USDG, FEED);
        p.regularHoursFee = 6000; // 6000 + 5000 > 10000
        bytes memory args = abi.encode(PM, registry, p);
        (, bytes32 salt) = HookMiner.find(address(this), FLAGS, type(UptickHook).creationCode, args);
        vm.expectRevert(UptickHook.BadSchedule.selector);
        new UptickHook{salt: salt}(PM, registry, p);
    }

    function testFuzz_feeNeverExceedsCap(uint256 ts, int256 answer, uint256 age, uint256 amt, bool z) public {
        ts = bound(ts, 1_700_000_000, 1_900_000_000);
        age = bound(age, 0, 2 * uint256(STALE));
        answer = bound(answer, -10, 1e13);
        amt = z ? bound(amt, 1e6, 2e9) : bound(amt, 1e15, 8e18);
        vm.warp(ts);
        _mockFeed(answer, ts - age);
        (UptickHook.Session s,, uint24 hookFee, uint24 pmFee,) = _swap(z, amt);
        assertLe(hookFee, hook.maxFee());
        assertLe(pmFee, hook.maxFee());
        uint24 base = s == UptickHook.Session.Regular ? REGULAR : s == UptickHook.Session.OffHours ? OFF : WEEKEND;
        assertGe(hookFee, base);
        assertLe(hookFee, base + MAX_SUR);
    }

    function testFuzz_sessionIsWeekendOnWeekendDays(uint256 ts) public view {
        ts = bound(ts, 1_700_000_000, 2_000_000_000);
        uint256 dow = (ts / 1 days + 4) % 7;
        UptickHook.Session s = hook.sessionAt(ts);
        if (dow == 6 || dow == 0) assertEq(uint8(s), uint8(UptickHook.Session.Weekend));
        else if (dow != 5) assertTrue(s != UptickHook.Session.Weekend);
    }

    // ---------------------------------------------- price + orientation

    function test_poolPriceMatchesReference() public view {
        uint256 want = uint256(A0) * mult / 1e18;
        assertApproxEqRel(hook.poolPrice(initSqrt), want, 1e12); // 1e-6 relative
    }

    /// 18dp stock and 6dp quote mocks with the requested address order
    function _ordered(bool stockLow) internal returns (MockERC20 stk, MockERC20 qt) {
        for (uint256 i; i < 64; ++i) {
            stk = new MockERC20("S", "S", 18);
            qt = new MockERC20("Q", "Q", 6);
            if ((address(stk) < address(qt)) == stockLow) return (stk, qt);
        }
        revert("could not order tokens");
    }

    function test_poolPrice_bothOrientations() public {
        (MockERC20 s0, MockERC20 q0) = _ordered(true);
        UptickHook h0 = _deploy(address(s0), address(q0), FEED);
        assertFalse(h0.stockIsToken1());
        assertEq(h0.poolPrice(uint160(2) << 96), 4e20); // P = quoteRaw/stockRaw = 4: 4e18 quote raw = 4e12 USD per 1e18 raw
        (MockERC20 s1, MockERC20 q1) = _ordered(false);
        UptickHook h1 = _deploy(address(s1), address(q1), FEED);
        assertTrue(h1.stockIsToken1());
        assertEq(h1.poolPrice(uint160(2) << 96), 25e18); // P = stockRaw/quoteRaw = 4: 0.25e18 quote raw = 2.5e11 USD
    }

    function test_stockIsToken0_directionLogic() public {
        (MockERC20 stk, MockERC20 qt) = _ordered(true);
        UptickHook h = _deploy(address(stk), address(qt), FEED);
        vm.mockCall(address(stk), abi.encodeWithSignature("uiMultiplier()"), abi.encode(uint256(1e18)));
        PoolKey memory k = PoolKey(
            Currency.wrap(address(stk)), Currency.wrap(address(qt)), LPFeeLibrary.DYNAMIC_FEE_FLAG, 10, IHooks(address(h))
        );
        // pool at 200 USD per stock: P = quoteRaw/stockRaw = 200e6 / 1e18
        uint160 sq = uint160(FixedPointMathLib.sqrt(FullMath.mulDiv(200e6, 1 << 128, 1e18)) << 32);
        PM.initialize(k, sq);
        assertApproxEqRel(h.poolPrice(sq), 200e8, 1e12);

        vm.warp(TUE_1500);
        // reference 190: pool above ref. Stock is token0, so zeroForOne sells stock and lowers the price: toward
        _mockFeed(190e8, block.timestamp);
        (,, uint256 feeToward) = h.quoteFee(k, true);
        (,, uint256 feeAway) = h.quoteFee(k, false);
        assertEq(feeToward, REGULAR);
        assertGt(feeAway, REGULAR);
        // reference 210: pool below ref, so selling stock is away
        _mockFeed(210e8, block.timestamp);
        (,, feeAway) = h.quoteFee(k, true);
        (,, feeToward) = h.quoteFee(k, false);
        assertEq(feeToward, REGULAR);
        assertGt(feeAway, REGULAR);
    }

    function test_wrongPoolReverts() public {
        // a pool keyed to this hook but with the wrong token pair
        MockERC20 x = new MockERC20("X", "X", 18);
        PoolKey memory bad = PoolKey(Currency.wrap(USDG), Currency.wrap(address(x)), LPFeeLibrary.DYNAMIC_FEE_FLAG, 10, IHooks(address(hook)));
        vm.expectRevert(UptickHook.WrongPool.selector);
        hook.quoteFee(bad, true);
    }

    // --------------------------------------------------------- (e) gas

    function test_gasPerSwap() public {
        vm.warp(TUE_1500);
        _poolAboveRef(100);
        // hookless baseline pool on the same pair
        PoolKey memory base = PoolKey(key.currency0, key.currency1, 777, 10, IHooks(address(0)));
        PM.initialize(base, initSqrt);
        lpRouter.modifyLiquidity(base, IPoolManager.ModifyLiquidityParams(-3000, 3000 - 10, int256(1e15), 0), "");
        IPoolManager.SwapParams memory sp = IPoolManager.SwapParams(true, -int256(BUY), TickMath.MIN_SQRT_PRICE + 1);
        PoolSwapTest.TestSettings memory ts = PoolSwapTest.TestSettings(false, false);
        // warm both paths once, then measure
        router.swap(key, sp, ts, "");
        router.swap(base, sp, ts, "");
        uint256 g = gasleft();
        router.swap(key, sp, ts, "");
        uint256 withHook = g - gasleft();
        g = gasleft();
        router.swap(base, sp, ts, "");
        uint256 plain = g - gasleft();
        console2.log("swap gas with UptickHook (away swap, via router):", withHook);
        console2.log("swap gas hookless same pair:", plain);
        console2.log("hook overhead:", withHook - plain);
        assertGt(withHook, plain);
        assertLt(withHook - plain, 120_000);
    }
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function uiMultiplier() external view returns (uint256);
}

interface IFeedLike {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}
