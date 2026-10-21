// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";

/// @title VaultMathV4
/// @notice The Uniswap v4 position reads and liquidity fitting StockVaultV4 needs, kept outside the vault so its
/// runtime stays under EIP-170. Stateless: every function is view or pure and the vault reaches it by STATICCALL.
/// The tick, liquidity and price maths shared with StockVault stay in VaultMath.
contract VaultMathV4 {
    using StateLibrary for IPoolManager;

    uint256 private constant Q128 = 1 << 128;

    error CannotFit();

    /// @notice Liquidity of the position `owner` holds over [tl, tu] (salt 0) and the fees it has earned but not
    /// collected, computed the way the PoolManager does on the next `modifyLiquidity` (wrapping subtraction on fee
    /// growth, rounded down). v4 pays these out to the caller on any change of the position, so unlike v3 there
    /// is no owed balance to add.
    function position(IPoolManager pm, bytes32 poolId, address owner, int24 tl, int24 tu)
        external
        view
        returns (uint128 liq, uint256 f0, uint256 f1)
    {
        PoolId id = PoolId.wrap(poolId);
        uint256 last0;
        uint256 last1;
        (liq, last0, last1) = pm.getPositionInfo(id, owner, tl, tu, bytes32(0));
        if (liq == 0) return (0, 0, 0);
        (uint256 in0, uint256 in1) = pm.getFeeGrowthInside(id, tl, tu);
        unchecked {
            f0 = FullMath.mulDiv(in0 - last0, liq, Q128);
            f1 = FullMath.mulDiv(in1 - last1, liq, Q128);
        }
    }

    /// @notice Everything the app shows about the vault's position in one call: liquidity, both legs at `sqrtTwap`
    /// (rounded down), uncollected fees and whether spot sits inside the range.
    function info(IPoolManager pm, bytes32 poolId, address owner, int24 tl, int24 tu, uint160 sqrtTwap)
        external
        view
        returns (uint128 liq, uint256 a0, uint256 a1, uint256 f0, uint256 f1, bool inRange)
    {
        PoolId id = PoolId.wrap(poolId);
        uint256 last0;
        uint256 last1;
        (liq, last0, last1) = pm.getPositionInfo(id, owner, tl, tu, bytes32(0));
        (, int24 tick,,) = pm.getSlot0(id);
        inRange = tick >= tl && tick < tu;
        if (liq == 0) return (0, 0, 0, 0, 0, inRange);
        (uint256 in0, uint256 in1) = pm.getFeeGrowthInside(id, tl, tu);
        unchecked {
            f0 = FullMath.mulDiv(in0 - last0, liq, Q128);
            f1 = FullMath.mulDiv(in1 - last1, liq, Q128);
        }
        uint160 sa = TickMath.getSqrtPriceAtTick(tl);
        uint160 sb = TickMath.getSqrtPriceAtTick(tu);
        if (sqrtTwap <= sa) {
            a0 = SqrtPriceMath.getAmount0Delta(sa, sb, liq, false);
        } else if (sqrtTwap < sb) {
            a0 = SqrtPriceMath.getAmount0Delta(sqrtTwap, sb, liq, false);
            a1 = SqrtPriceMath.getAmount1Delta(sa, sqrtTwap, liq, false);
        } else {
            a1 = SqrtPriceMath.getAmount1Delta(sa, sb, liq, false);
        }
    }

    /// @notice The largest liquidity the idle pair (a0, a1) can add over [tl, tu] at `sqrtP`, checked against the
    /// amounts the PoolManager will then take, which round up on an add: the unrounded fit (the periphery's
    /// `getLiquidityForAmounts` formulas, kept in 256 bits until the final cast so a spot within a hair of a range
    /// edge does not overflow a leg that the other leg bounds anyway) rounds down but can come out a wei or two over
    /// one leg, so liquidity is stepped down until both legs fit.
    function fit(uint160 sqrtP, int24 tl, int24 tu, uint256 a0, uint256 a1) external pure returns (uint128 liq) {
        uint160 sa = TickMath.getSqrtPriceAtTick(tl);
        uint160 sb = TickMath.getSqrtPriceAtTick(tu);
        uint256 l;
        if (sqrtP <= sa) {
            l = _liq0(sa, sb, a0);
        } else if (sqrtP < sb) {
            l = _min(_liq0(sqrtP, sb, a0), _liq1(sa, sqrtP, a1));
        } else {
            l = _liq1(sa, sb, a1);
        }
        liq = SafeCast.toUint128(l);
        for (uint256 i; i < 6; ++i) {
            (uint256 n0, uint256 n1) = _needed(sqrtP, sa, sb, liq);
            if (n0 <= a0 && n1 <= a1) return liq;
            liq -= uint128((uint256(liq) >> 40) + 1);
        }
        revert CannotFit();
    }

    function _liq0(uint160 a, uint160 b, uint256 amount0) private pure returns (uint256) {
        return FullMath.mulDiv(amount0, FullMath.mulDiv(a, b, 1 << 96), b - a);
    }

    function _liq1(uint160 a, uint160 b, uint256 amount1) private pure returns (uint256) {
        return FullMath.mulDiv(amount1, 1 << 96, b - a);
    }

    function _min(uint256 x, uint256 y) private pure returns (uint256) {
        return x < y ? x : y;
    }

    function _needed(uint160 sqrtP, uint160 sa, uint160 sb, uint128 liq) private pure returns (uint256 n0, uint256 n1) {
        if (sqrtP <= sa) {
            n0 = SqrtPriceMath.getAmount0Delta(sa, sb, liq, true);
        } else if (sqrtP < sb) {
            n0 = SqrtPriceMath.getAmount0Delta(sqrtP, sb, liq, true);
            n1 = SqrtPriceMath.getAmount1Delta(sa, sqrtP, liq, true);
        } else {
            n1 = SqrtPriceMath.getAmount1Delta(sa, sb, liq, true);
        }
    }
}
