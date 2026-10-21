// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";
import {VaultMathV4} from "../../src/v4/VaultMathV4.sol";

/// @dev The liquidity the vault adds is fitted on-chain to the idle balances; the PoolManager then takes the amounts
/// that liquidity needs, rounded up, so the fit must never need more of a leg than is idle and must not leave
/// meaningful liquidity unused. Pure maths, no fork.
contract VaultMathV4Test is Test {
    VaultMathV4 m = new VaultMathV4();

    function _needed(uint160 sqrtP, int24 tl, int24 tu, uint128 liq) internal pure returns (uint256 n0, uint256 n1) {
        uint160 sa = TickMath.getSqrtPriceAtTick(tl);
        uint160 sb = TickMath.getSqrtPriceAtTick(tu);
        if (sqrtP <= sa) {
            n0 = SqrtPriceMath.getAmount0Delta(sa, sb, liq, true);
        } else if (sqrtP < sb) {
            n0 = SqrtPriceMath.getAmount0Delta(sqrtP, sb, liq, true);
            n1 = SqrtPriceMath.getAmount1Delta(sa, sqrtP, liq, true);
        } else {
            n1 = SqrtPriceMath.getAmount1Delta(sa, sb, liq, true);
        }
    }

    /// forge-config: default.fuzz.runs = 4000
    function testFuzz_fitNeverNeedsMoreThanIsIdleAndLeavesLittleUnused(
        int24 centre,
        uint8 spacingPick,
        uint8 widthSteps,
        int16 offset,
        uint256 a0,
        uint256 a1
    ) public view {
        int24[4] memory spacings = [int24(10), 60, 200, 1];
        int24 sp = spacings[spacingPick % 4];
        int24 c = int24(bound(int256(centre), -250_000, 250_000));
        c -= c % sp;
        // half-width 50 to about 2,100 ticks: the vault's rangeBps bound is 50 to 2,000 bp
        int24 half = int24(int256(50 + uint256(widthSteps) * 8));
        int24 tl = ((c - half) / sp) * sp - (((c - half) % sp != 0 && c - half < 0) ? sp : int24(0));
        int24 tu = ((c + half) / sp) * sp + (((c + half) % sp != 0 && c + half > 0) ? sp : int24(0));
        if (tu <= tl) tu = tl + sp;
        // spot anywhere from below the range to above it, on or between ticks
        int256 t = int256(c) + int256(offset) * int256(half) / 8000;
        int24 st = int24(bound(t, int256(tl) - 3 * sp, int256(tu) + 3 * sp));
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(st) + uint160(uint256(keccak256(abi.encode(a0, a1))) % 1000);
        a0 = bound(a0, 1e6, 1e27); // 1e9 tokens of 18 decimals; a larger idle balance overflows uint128 liquidity and reverts (SafeCast)
        a1 = bound(a1, 1e6, 1e27);

        uint128 liq = m.fit(sqrtP, tl, tu, a0, a1);
        (uint256 n0, uint256 n1) = _needed(sqrtP, tl, tu, liq);
        assertLe(n0, a0, "never needs more token0 than is idle");
        assertLe(n1, a1, "never needs more token1 than is idle");
        // the periphery's fit, where it does not overflow a leg the other leg bounds (a spot a hair under the upper edge)
        try this.periphery(sqrtP, tl, tu, a0, a1) returns (uint128 ideal) {
            assertLe(liq, ideal);
            assertGe(uint256(liq) * (1 << 30), uint256(ideal) * ((1 << 30) - 1), "within one part in 2^30 of the unrounded fit");
        } catch {}
    }

    function periphery(uint160 sqrtP, int24 tl, int24 tu, uint256 a0, uint256 a1) external pure returns (uint128) {
        return LiquidityAmounts.getLiquidityForAmounts(sqrtP, TickMath.getSqrtPriceAtTick(tl), TickMath.getSqrtPriceAtTick(tu), a0, a1);
    }

    /// @dev A spot a hair under the upper edge: the periphery overflows the token0 leg, the vault's fit does not.
    function test_fitNextToTheUpperEdgeDoesNotOverflowTheLegTheOtherLegBounds() public {
        int24 tl = 6000;
        int24 tu = 6600;
        uint160 sb = TickMath.getSqrtPriceAtTick(tu);
        uint160 sqrtP = sb - 3; // 3 wei of sqrt price under the edge
        vm.expectRevert(); // the periphery cannot do it
        this.periphery(sqrtP, tl, tu, 1e27, 1e27);
        uint128 liq = m.fit(sqrtP, tl, tu, 1e27, 1e27);
        (uint256 n0, uint256 n1) = _needed(sqrtP, tl, tu, liq);
        assertLe(n0, 1e27);
        assertLe(n1, 1e27);
        assertGt(liq, 0);
    }

    function test_fitAtAFixedRealisticPoint() public view {
        // PLTR-like: usdg token0, price 5.63e33 sqrt, range +-4%, 100 PLTR and 9,700 USDG idle
        int24 tl = 222_800;
        int24 tu = 223_600;
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(223_200);
        uint128 liq = m.fit(sqrtP, tl, tu, 9_700e6, 50e18);
        (uint256 n0, uint256 n1) = _needed(sqrtP, tl, tu, liq);
        assertLe(n0, 9_700e6);
        assertLe(n1, 50e18);
        assertGt(liq, 0);
    }
}
