// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {CapRegistry} from "./CapRegistry.sol";
import {CappedTakeHook} from "./CappedTakeHook.sol";

interface IFeed {
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
    function decimals() external view returns (uint8);
}

interface IStockToken {
    function decimals() external view returns (uint8);
    function uiMultiplier() external view returns (uint256);
}

interface IQuoteToken {
    function decimals() external view returns (uint8);
}

/// @notice Dynamic-fee hook for a Stock Token / USD stablecoin v4 pool. The LP fee is the NYSE
/// session fee plus a surcharge on swaps that push the pool price further from the Chainlink
/// reference. Inherits CappedTakeHook, so the fee can never exceed the maxFee registered in
/// CapRegistry at deploy and the swap reverts if it ever would.
contract UptickHook is CappedTakeHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;

    enum Session {
        Regular,
        OffHours,
        Weekend
    }

    struct Params {
        address stock;
        address quote;
        address feed;
        uint32 maxStaleness; // seconds; older feed rounds are ignored
        uint24 regularHoursFee; // pips
        uint24 offHoursFee;
        uint24 weekendFee;
        uint24 surchargePipsPerBp; // pips of fee per bp of away-gap
        uint24 maxSurcharge; // pips
        uint16 maxFeeBps; // declared cap, registered in CapRegistry
    }

    address public immutable stock;
    address public immutable quote;
    bool public immutable stockIsToken1;
    uint8 public immutable stockDecimals;
    uint8 public immutable quoteDecimals;
    IFeed public immutable feed;
    uint8 public immutable feedDecimals;
    uint32 public immutable maxStaleness;
    uint24 public immutable regularHoursFee;
    uint24 public immutable offHoursFee;
    uint24 public immutable weekendFee;
    uint24 public immutable surchargePipsPerBp;
    uint24 public immutable maxSurcharge;
    /// @notice declared cap in pips (maxFeeBps * 100)
    uint24 public immutable maxFee;

    uint256 private constant DAY = 86400;
    uint256 private constant OPEN_EDT = 13 hours + 30 minutes;
    uint256 private constant CLOSE_EDT = 20 hours;

    error WrongPool();
    error FeeAboveCap(uint256 fee, uint256 maxFee);
    error BadSchedule();

    event FeeQuoted(PoolId indexed poolId, Session session, uint256 gapBps, uint24 fee);

    constructor(IPoolManager _pm, CapRegistry _registry, Params memory p) CappedTakeHook(_pm, _registry, p.maxFeeBps, true) {
        uint256 cap = uint256(p.maxFeeBps) * 100;
        uint256 top = p.regularHoursFee > p.offHoursFee ? p.regularHoursFee : p.offHoursFee;
        if (p.weekendFee > top) top = p.weekendFee;
        if (cap > LPFeeLibrary.MAX_LP_FEE || top + p.maxSurcharge > cap) revert BadSchedule();
        stock = p.stock;
        quote = p.quote;
        stockIsToken1 = p.stock > p.quote;
        stockDecimals = IStockToken(p.stock).decimals();
        quoteDecimals = IQuoteToken(p.quote).decimals();
        feed = IFeed(p.feed);
        feedDecimals = IFeed(p.feed).decimals();
        maxStaleness = p.maxStaleness;
        regularHoursFee = p.regularHoursFee;
        offHoursFee = p.offHoursFee;
        weekendFee = p.weekendFee;
        surchargePipsPerBp = p.surchargePipsPerBp;
        maxSurcharge = p.maxSurcharge;
        maxFee = uint24(cap);
    }

    // ------------------------------------------------------------------ hook

    function _beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata)
        internal
        override
        returns (BeforeSwapDelta, uint24)
    {
        _checkPool(key);
        PoolId id = key.toId();
        (Session s, uint256 gapBps, uint256 fee) = _quote(id, params.zeroForOne);
        if (fee > maxFee) revert FeeAboveCap(fee, maxFee);
        emit FeeQuoted(id, s, gapBps, uint24(fee));
        return (BeforeSwapDeltaLibrary.ZERO_DELTA, uint24(fee) | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function _afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        pure
        override
        returns (int128)
    {
        return 0;
    }

    /// @notice fee a swap in this direction would pay right now
    function quoteFee(PoolKey calldata key, bool zeroForOne)
        external
        view
        returns (Session s, uint256 gapBps, uint256 fee)
    {
        _checkPool(key);
        return _quote(key.toId(), zeroForOne);
    }

    function _checkPool(PoolKey calldata key) private view {
        (address a, address b) = stockIsToken1 ? (quote, stock) : (stock, quote);
        if (Currency.unwrap(key.currency0) != a || Currency.unwrap(key.currency1) != b) revert WrongPool();
    }

    function _quote(PoolId id, bool zeroForOne) private view returns (Session s, uint256 gapBps, uint256 fee) {
        s = sessionAt(block.timestamp);
        fee = s == Session.Regular ? regularHoursFee : s == Session.OffHours ? offHoursFee : weekendFee;

        (uint256 ref, bool ok) = _reference();
        if (!ok) return (s, 0, fee);
        (uint160 sqrtP,,,) = poolManager.getSlot0(id);
        uint256 pool = poolPrice(sqrtP);
        bool poolAbove = pool > ref;
        gapBps = FullMath.mulDiv(poolAbove ? pool - ref : ref - pool, 10_000, ref);
        // stock is token1: zeroForOne buys stock and lifts its USD price. stock is token0: zeroForOne sells it.
        bool priceUp = zeroForOne == stockIsToken1;
        if (priceUp == poolAbove && pool != ref) {
            uint256 sur = gapBps * surchargePipsPerBp;
            fee += sur > maxSurcharge ? maxSurcharge : sur;
        }
    }

    // ---------------------------------------------------------------- oracle

    /// @dev Chainlink answer in feed decimals, scaled to the raw token by the ERC-8056 uiMultiplier.
    /// Any failure, a non-positive answer or a round older than maxStaleness returns ok = false.
    function _reference() private view returns (uint256 ref, bool ok) {
        try feed.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > maxStaleness) return (0, false);
            uint256 mult = 1e18;
            try IStockToken(stock).uiMultiplier() returns (uint256 m) {
                if (m == 0) return (0, false);
                mult = m;
            } catch {
                return (0, false);
            }
            ref = FullMath.mulDiv(uint256(answer), mult, 1e18);
            return (ref, ref != 0);
        } catch {
            return (0, false);
        }
    }

    /// @notice USD price (in feed decimals) of one whole raw stock token implied by a pool sqrtPriceX96
    function poolPrice(uint160 sqrtP) public view returns (uint256) {
        uint256 up = 10 ** (uint256(stockDecimals) + feedDecimals);
        uint256 down = 10 ** uint256(quoteDecimals);
        if (stockIsToken1) {
            // price = quoteRaw / stockRaw = 2^192 / sqrtP^2
            return FullMath.mulDiv(FullMath.mulDiv(1 << 96, up, sqrtP), 1 << 96, uint256(sqrtP) * down);
        }
        // price = sqrtP^2 / 2^192
        return FullMath.mulDiv(FullMath.mulDiv(sqrtP, up, 1 << 96), sqrtP, (1 << 96) * down);
    }

    // --------------------------------------------------------------- session

    /// @notice NYSE session at a UTC timestamp. Regular: Mon-Fri open to close (13:30-20:00 UTC in EDT,
    /// 14:30-21:00 in EST). Weekend: Friday close through Sunday 24:00 UTC. Holidays and everything else: OffHours.
    function sessionAt(uint256 ts) public pure returns (Session) {
        uint256 day = ts / DAY;
        uint256 sod = ts % DAY;
        uint256 dow = (day + 4) % 7; // 0 = Sunday
        uint256 shift = _isDst(ts, day) ? 0 : 1 hours;
        uint256 open = OPEN_EDT + shift;
        uint256 close = CLOSE_EDT + shift;

        if (dow == 6 || dow == 0 || (dow == 5 && sod >= close)) return Session.Weekend;
        if (_isHoliday(day)) return Session.OffHours;
        if (sod >= open && sod < close) return Session.Regular;
        return Session.OffHours;
    }

    /// @dev US rule: second Sunday of March 02:00 EST (07:00 UTC) to first Sunday of November 02:00 EDT (06:00 UTC)
    function _isDst(uint256 ts, uint256 day) private pure returns (bool) {
        (uint256 y,,) = _civil(day);
        uint256 mar1 = _days(y, 3, 1);
        uint256 nov1 = _days(y, 11, 1);
        uint256 start = (mar1 + (7 - (mar1 + 4) % 7) % 7 + 7) * DAY + 7 hours;
        uint256 end = (nov1 + (7 - (nov1 + 4) % 7) % 7) * DAY + 6 hours;
        return ts >= start && ts < end;
    }

    /// @dev NYSE full-day closures 2026 and 2027 (observed dates), compiled into the bytecode
    function _isHoliday(uint256 day) private pure returns (bool) {
        (uint256 y, uint256 m, uint256 d) = _civil(day);
        uint256 k = y * 10_000 + m * 100 + d;
        return k == 20260101 || k == 20260119 || k == 20260216 || k == 20260403 || k == 20260525 || k == 20260619
            || k == 20260703 || k == 20260907 || k == 20261126 || k == 20261225 || k == 20270101 || k == 20270118
            || k == 20270215 || k == 20270326 || k == 20270531 || k == 20270618 || k == 20270705 || k == 20270906
            || k == 20271125 || k == 20271224;
    }

    function _civil(uint256 day) private pure returns (uint256 y, uint256 m, uint256 d) {
        uint256 z = day + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        d = doy - (153 * mp + 2) / 5 + 1;
        m = mp < 10 ? mp + 3 : mp - 9;
        y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    }

    function _days(uint256 y, uint256 m, uint256 d) private pure returns (uint256) {
        if (m <= 2) y -= 1;
        uint256 era = y / 400;
        uint256 yoe = y - era * 400;
        uint256 doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }
}
