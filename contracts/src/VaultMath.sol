// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";

import {IUniswapV3Pool, INonfungiblePositionManager} from "./interfaces/IUniswapV3.sol";

/// @title VaultMath
/// @notice Stateless tick, liquidity and fee-growth maths for StockVault. Every StockVault deploys its own copy in
/// its constructor and keeps the address immutable, so the vault's creation code is self-contained and the vault's
/// runtime stays under the EIP-170 limit. Nothing here holds state or funds, and the vault only ever reaches it
/// through STATICCALL (all functions are view or pure).
contract VaultMath {
    uint256 private constant Q96 = 1 << 96;
    uint256 private constant Q128 = 1 << 128;
    uint128 private constant UNIT_LIQUIDITY = 1e24;

    error BadConfig();

    function sqrtAtTick(int24 tick) external pure returns (uint160) {
        return TickMath.getSqrtPriceAtTick(tick);
    }

    /// @notice Token amounts of `liq` liquidity over [tl, tu] at sqrt price `sqrtP`, rounded down.
    function amounts(uint160 sqrtP, int24 tl, int24 tu, uint128 liq) public pure returns (uint256 a0, uint256 a1) {
        uint160 sa = TickMath.getSqrtPriceAtTick(tl);
        uint160 sb = TickMath.getSqrtPriceAtTick(tu);
        if (sqrtP <= sa) {
            a0 = SqrtPriceMath.getAmount0Delta(sa, sb, liq, false);
        } else if (sqrtP < sb) {
            a0 = SqrtPriceMath.getAmount0Delta(sqrtP, sb, liq, false);
            a1 = SqrtPriceMath.getAmount1Delta(sa, sqrtP, liq, false);
        } else {
            a1 = SqrtPriceMath.getAmount1Delta(sa, sb, liq, false);
        }
    }

    /// @notice The swap that leaves balances (a0, a1) in the ratio of one unit of liquidity over [tl, tu] at the
    /// spot price, net of the pool fee. Price impact is ignored; the remainder stays idle.
    function swapNeeded(uint160 sqrtP, int24 tl, int24 tu, uint256 a0, uint256 a1, uint24 poolFee)
        external
        pure
        returns (bool zeroForOne, uint256 amountIn)
    {
        (uint256 u0, uint256 u1) = amounts(sqrtP, tl, tu, UNIT_LIQUIDITY);
        uint256 price96 = Math.mulDiv(sqrtP, sqrtP, Q96); // token1 per token0, Q96
        uint256 netPrice96 = price96 * (1e6 - poolFee) / 1e6;
        uint256 lhs = a0 * u1;
        uint256 rhs = a1 * u0;
        if (lhs > rhs) {
            zeroForOne = true;
            amountIn = (lhs - rhs) / (u1 + Math.mulDiv(u0, netPrice96, Q96));
        } else if (rhs > lhs) {
            amountIn = (rhs - lhs) / (u0 + Math.mulDiv(u1, Q96, netPrice96));
        }
    }

    /// @notice The least a mint or increase of the idle pair (a0, a1) over [tl, tu] may take of each token: the
    /// amounts the liquidity that pair buys at `sqrtP` holds, less `slippageBps`.
    function mintMins(uint160 sqrtP, int24 tl, int24 tu, uint256 a0, uint256 a1, uint256 slippageBps)
        external
        pure
        returns (uint256 m0, uint256 m1)
    {
        (uint256 u0, uint256 u1) = amounts(sqrtP, tl, tu, UNIT_LIQUIDITY);
        uint256 liq = type(uint256).max;
        if (u0 != 0) liq = a0 * UNIT_LIQUIDITY / u0;
        if (u1 != 0) liq = Math.min(liq, a1 * UNIT_LIQUIDITY / u1);
        m0 = u0 * liq / UNIT_LIQUIDITY * (1e4 - slippageBps) / 1e4;
        m1 = u1 * liq / UNIT_LIQUIDITY * (1e4 - slippageBps) / 1e4;
    }

    /// @notice USD per whole Stock Token (feed decimals) as the pool's sqrt price.
    function sqrtFromUsd(uint256 price, uint256 stockScale, uint256 usdgScale, bool stockIsToken0)
        public
        pure
        returns (uint160)
    {
        uint256 price96 = stockIsToken0
            ? Math.mulDiv(price * usdgScale, Q96, stockScale) // token1 (usdg) per token0 (stock)
            : Math.mulDiv(stockScale, Q96, price * usdgScale); // token1 (stock) per token0 (usdg)
        return uint160(Math.sqrt(price96 * Q96));
    }

    /// @notice Range of +-bps around `price`, outward-snapped to the tick spacing.
    function targetTicks(
        uint256 price,
        uint256 bps,
        uint256 stockScale,
        uint256 usdgScale,
        bool stockIsToken0,
        int24 spacing
    ) external pure returns (int24 tl, int24 tu) {
        int24 tA = TickMath.getTickAtSqrtPrice(sqrtFromUsd(price * (1e4 - bps) / 1e4, stockScale, usdgScale, stockIsToken0));
        int24 tB = TickMath.getTickAtSqrtPrice(sqrtFromUsd(price * (1e4 + bps) / 1e4, stockScale, usdgScale, stockIsToken0));
        (int24 lo, int24 hi) = tA < tB ? (tA, tB) : (tB, tA);
        tl = _floorTick(lo, spacing);
        tu = _floorTick(hi, spacing);
        if (tu < hi) tu += spacing;
        int24 minT = TickMath.minUsableTick(spacing);
        int24 maxT = TickMath.maxUsableTick(spacing);
        if (tl < minT) tl = minT;
        if (tu > maxT) tu = maxT;
        if (tu <= tl) revert BadConfig();
    }

    /// @notice Sqrt price of the pool's time-weighted mean tick over `window` seconds. `ok` is false when
    /// pool.observe reverts (history shorter than `window`) or the mean tick is out of range.
    function twapSqrt(IUniswapV3Pool pool, uint32 window) external view returns (bool ok, uint160 sqrtP) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = window;
        try pool.observe(ago) returns (int56[] memory cum, uint160[] memory) {
            int56 delta = cum[1] - cum[0];
            int56 w = int56(uint56(window));
            int56 t = delta / w;
            if (delta < 0 && delta % w != 0) t--;
            if (t < TickMath.MIN_TICK || t > TickMath.MAX_TICK) return (false, 0);
            return (true, TickMath.getSqrtPriceAtTick(int24(t)));
        } catch {
            return (false, 0);
        }
    }

    /// @notice Fees position `id` has earned but not collected: tokensOwed plus growth since its last update,
    /// computed the way the pool does (wrapping subtraction on fee growth).
    function uncollectedFees(IUniswapV3Pool pool, INonfungiblePositionManager npm, uint256 id)
        external
        view
        returns (uint256 f0, uint256 f1)
    {
        int24 tl;
        int24 tu;
        uint128 liq;
        uint256 last0;
        uint256 last1;
        {
            uint128 owed0;
            uint128 owed1;
            (,,,,, tl, tu, liq, last0, last1, owed0, owed1) = npm.positions(id);
            f0 = owed0;
            f1 = owed1;
        }
        if (liq == 0) return (f0, f1);
        (uint256 in0, uint256 in1) = _feeGrowthInside(pool, tl, tu);
        unchecked {
            f0 += Math.mulDiv(in0 - last0, liq, Q128);
            f1 += Math.mulDiv(in1 - last1, liq, Q128);
        }
    }

    function _feeGrowthInside(IUniswapV3Pool pool, int24 tl, int24 tu) private view returns (uint256 in0, uint256 in1) {
        (, int24 tick,,,,,) = pool.slot0();
        uint256 g0 = pool.feeGrowthGlobal0X128();
        uint256 g1 = pool.feeGrowthGlobal1X128();
        (,, uint256 lo0, uint256 lo1,,,,) = pool.ticks(tl);
        (,, uint256 hi0, uint256 hi1,,,,) = pool.ticks(tu);
        unchecked {
            uint256 below0 = tick >= tl ? lo0 : g0 - lo0;
            uint256 below1 = tick >= tl ? lo1 : g1 - lo1;
            uint256 above0 = tick < tu ? hi0 : g0 - hi0;
            uint256 above1 = tick < tu ? hi1 : g1 - hi1;
            in0 = g0 - below0 - above0;
            in1 = g1 - below1 - above1;
        }
    }

    function _floorTick(int24 t, int24 spacing) private pure returns (int24 r) {
        int24 m = t % spacing;
        r = t - m;
        if (m < 0) r -= spacing;
    }
}
