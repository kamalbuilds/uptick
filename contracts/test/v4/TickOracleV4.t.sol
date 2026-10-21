// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {TickOracleV4} from "../../src/v4/TickOracleV4.sol";

/// @dev The oracle only reads slot0 from the PoolManager through `extsload`; this stand-in returns a settable slot0
/// word, so the ring logic is tested on its own with exact expectations (no fork).
contract SlotPM {
    int24 public tick;

    function setTick(int24 t) external {
        tick = t;
    }

    function extsload(bytes32) external view returns (bytes32) {
        // sqrtPriceX96 | tick << 160 | protocolFee << 184 | lpFee << 208
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(tick);
        return bytes32(uint256(sqrtP) | (uint256(uint24(tick)) << 160));
    }
}

contract TickOracleV4Test is Test {
    SlotPM pm;
    TickOracleV4 oracle;
    uint16 constant DEV = 100; // bps, ticks around the oracle price
    uint160 oracleSqrt;
    int24 oracleTick = 217_000;

    function setUp() public {
        vm.warp(1_800_000_000);
        pm = new SlotPM();
        oracle = new TickOracleV4(IPoolManager(address(pm)), keccak256("pool"));
        oracleSqrt = TickMath.getSqrtPriceAtTick(oracleTick);
        pm.setTick(oracleTick);
    }

    function _rec(uint32 dt, int24 spot) internal returns (bool ok) {
        vm.warp(vm.getBlockTimestamp() + dt);
        pm.setTick(spot);
        ok = oracle.record(oracleSqrt, DEV);
    }

    function _latest() internal view returns (int24 t) {
        (, t) = oracle.latest();
    }

    function test_onlyVaultRecords() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(TickOracleV4.NotVault.selector);
        oracle.record(oracleSqrt, DEV);
    }

    function test_noTwapBeforeAFullWindow() public {
        _rec(0, oracleTick);
        (bool ok,) = oracle.twap(600);
        assertFalse(ok, "one observation is not a window");
        for (uint256 i; i < 9; ++i) _rec(60, oracleTick);
        (ok,) = oracle.twap(600);
        assertFalse(ok, "540 s observed");
        _rec(60, oracleTick);
        int24 t;
        (ok, t) = oracle.twap(600);
        assertTrue(ok, "600 s observed");
        assertEq(t, oracleTick);
    }

    function test_minGapRefusesAndWritesNothing() public {
        assertTrue(_rec(0, oracleTick));
        assertFalse(_rec(19, oracleTick + 10), "19 s after the last");
        assertEq(oracle.count(), 1);
        assertEq(_latest(), oracleTick);
        assertTrue(_rec(1, oracleTick + 10), "20 s after the last");
        assertEq(oracle.count(), 2);
    }

    function test_observationIsBoundedAroundTheOraclePrice() public {
        // far above: clamped to oracle + DEV ticks (first observation: no step bound yet)
        _rec(0, oracleTick + 5000);
        assertEq(_latest(), oracleTick + int24(uint24(DEV)));
    }

    function test_observationStepIsBoundedPerObservation() public {
        _rec(0, oracleTick);
        _rec(60, oracleTick + 90); // inside the oracle bound, beyond MAX_STEP
        assertEq(_latest(), oracleTick + oracle.MAX_STEP());
        _rec(60, oracleTick + 90);
        assertEq(_latest(), oracleTick + 90, "second step reaches spot: 40 ticks left, under MAX_STEP");
        _rec(60, oracleTick - 90);
        assertEq(_latest(), oracleTick + 90 - oracle.MAX_STEP(), "steps down too");
    }

    function test_oneSandwichedObservationMovesTheAverageByAtMostStepTimesGapShare() public {
        for (uint256 i; i < 11; ++i) _rec(60, oracleTick); // continuous record at the oracle tick
        _rec(60, oracleTick + 99); // manipulated observation: recorded +MAX_STEP
        assertEq(_latest(), oracleTick + oracle.MAX_STEP());
        vm.warp(vm.getBlockTimestamp() + 60);
        (bool ok, int24 t) = oracle.twap(600);
        assertTrue(ok);
        // 60 s of 600 s at +50 ticks = +5 ticks
        assertEq(t, oracleTick + 5);
    }

    function test_gapLongerThanMaxGapRestartsTheRecord() public {
        for (uint256 i; i < 11; ++i) _rec(60, oracleTick);
        (bool ok,) = oracle.twap(600);
        assertTrue(ok);
        vm.warp(vm.getBlockTimestamp() + 121);
        (ok,) = oracle.twap(600);
        assertFalse(ok, "newest observation older than MAX_GAP");
        _rec(0, oracleTick); // the poke after the gap restarts the record
        (ok,) = oracle.twap(600);
        assertFalse(ok, "record restarted: a whole window is needed again");
        for (uint256 i; i < 10; ++i) _rec(60, oracleTick);
        (ok,) = oracle.twap(600);
        assertTrue(ok);
    }

    function test_gapInsideTheWindowIsNotAveragedOver() public {
        for (uint256 i; i < 5; ++i) _rec(60, oracleTick);
        _rec(130, oracleTick); // 130 s gap: restart
        for (uint256 i; i < 9; ++i) _rec(60, oracleTick);
        (bool ok,) = oracle.twap(600);
        assertFalse(ok, "only 540 s since the restart");
        _rec(60, oracleTick);
        (ok,) = oracle.twap(600);
        assertTrue(ok);
    }

    function test_ringWrapsAndStillAnswersALongWindow() public {
        // 200 observations 20 s apart: the ring (128) wrapped; a 1800 s window needs 91 of them
        for (uint256 i; i < 200; ++i) _rec(20, oracleTick + int24(int256(i % 2)));
        assertEq(oracle.count(), 128);
        (bool ok, int24 t) = oracle.twap(1800);
        assertTrue(ok);
        assertTrue(t == oracleTick || t == oracleTick + 1);
    }

    /// @dev Reference: piecewise-constant tick (an observation holds until the next one, the last until now),
    /// integrated by brute force over [now - window, now].
    function _reference(uint32[] memory ts, int24[] memory ticks, uint32 window) internal view returns (int24) {
        uint32 nowT = uint32(vm.getBlockTimestamp());
        uint32 from = nowT - window;
        int256 sum;
        for (uint256 i; i < ts.length; ++i) {
            uint32 a = ts[i];
            uint32 b = i + 1 < ts.length ? ts[i + 1] : nowT;
            if (b <= from) continue;
            if (a < from) a = from;
            sum += int256(ticks[i]) * int256(uint256(b - a));
        }
        int256 q = sum / int256(uint256(window));
        if (sum < 0 && sum % int256(uint256(window)) != 0) q--;
        return int24(q);
    }

    /// forge-config: default.fuzz.runs = 512
    function testFuzz_twapMatchesBruteForce(uint256 seed, uint32 window) public {
        window = uint32(bound(window, 600, 1800));
        uint32[] memory ts = new uint32[](400);
        int24[] memory ticks = new int24[](400);
        uint256 n;
        int24 spot = oracleTick;
        // build a continuous record (spacing between MIN_GAP and MAX_GAP) at least window + 120 s long
        uint256 elapsed;
        uint256 extra = (seed >> 200) % 6000; // some runs write more than RING observations and wrap the ring
        while (elapsed < uint256(window) + 240 + extra && n < 400) {
            seed = uint256(keccak256(abi.encode(seed, n)));
            uint32 dt = uint32(20 + seed % 101); // 20..120
            int24 move = int24(int256((seed >> 8) % 61) - 30);
            spot += move;
            vm.warp(vm.getBlockTimestamp() + dt);
            pm.setTick(spot);
            assertTrue(oracle.record(oracleSqrt, DEV));
            ts[n] = uint32(vm.getBlockTimestamp());
            ticks[n] = _latest();
            elapsed += dt;
            ++n;
        }
        // trim the arrays to what was written
        uint32[] memory t2 = new uint32[](n);
        int24[] memory k2 = new int24[](n);
        for (uint256 i; i < n; ++i) (t2[i], k2[i]) = (ts[i], ticks[i]);
        (bool ok, int24 got) = oracle.twap(window);
        assertTrue(ok, "continuous record covers the window");
        assertEq(got, _reference(t2, k2, window));
    }
}
