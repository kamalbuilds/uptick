// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

/// @title TickOracleV4
/// @notice The time-weighted tick source of one StockVaultV4. A Uniswap v4 pool keeps no observations, so this
/// contract keeps them: a ring of (timestamp, tick, tick cumulative) written by `record`, which only the vault calls
/// and which anyone reaches through `StockVaultV4.poke()`. An observation holds the pool's current tick read from
/// the PoolManager (the caller supplies no tick), bounded three ways so a manipulated tick cannot be written whole:
///   1. at least MIN_GAP seconds after the previous observation, so the ring cannot be flooded and always spans
///      the longest TWAP window;
///   2. within `maxDeviationBps` ticks of the Chainlink price's tick (one tick is one basis point), so the ring
///      never holds a tick the vault's own oracle gate calls deviant;
///   3. within MAX_STEP ticks of the previous observation, so one observation moves the average by at most
///      MAX_STEP ticks however far spot is pushed.
/// An observation is credited forward until the next one, as in a Uniswap v3 oracle, so a tick written at time t
/// weighs nothing at t and at most MAX_GAP seconds of the window by the time the next honest observation lands.
/// `twap` answers only from a continuous record: the newest observation at most MAX_GAP old, and no gap longer
/// than MAX_GAP anywhere inside the window. A longer gap restarts the record, and the TWAP is unavailable until a
/// whole window has been observed again (the vault reads that as `TwapUnavailable` and closes its price-checked
/// paths; `redeemInKind` does not read it).
contract TickOracleV4 {
    using StateLibrary for IPoolManager;

    uint16 public constant RING = 128;
    uint32 public constant MIN_GAP = 20;
    uint32 public constant MAX_GAP = 120;
    int24 public constant MAX_STEP = 50;

    /// @dev 14 bytes: one storage slot per observation.
    struct Obs {
        uint32 ts;
        int24 tick;
        int56 cum; // sum of tick * seconds up to ts
    }

    IPoolManager public immutable poolManager;
    bytes32 public immutable poolId;
    /// @notice The only caller of `record`: the vault that deployed this oracle.
    address public immutable vault;

    Obs[RING] private obs;
    uint16 public head; // index of the newest observation
    uint16 public count; // observations written, capped at RING
    uint32 public continuousSince; // start of the current gap-free record

    error NotVault();

    event Observed(uint32 ts, int24 tick, int24 spotTick, int24 oracleTick);

    constructor(IPoolManager pm, bytes32 poolId_) {
        poolManager = pm;
        poolId = poolId_;
        vault = msg.sender;
    }

    /// @notice Writes one observation. Returns false, writing nothing, when the previous one is under MIN_GAP old.
    /// @param sqrtOracle the Chainlink price as the pool's sqrt price (the vault computes it).
    /// @param maxDeviationBps the vault's `maxDeviationBps`, used as a tick bound around the oracle price.
    function record(uint160 sqrtOracle, uint16 maxDeviationBps) external returns (bool) {
        if (msg.sender != vault) revert NotVault();
        uint32 nowT = uint32(block.timestamp);
        uint16 n = count;
        Obs memory last;
        uint16 h = head;
        if (n != 0) {
            last = obs[h];
            if (nowT - last.ts < MIN_GAP) return false;
        }
        (, int24 spotTick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        int24 oracleTick = TickMath.getTickAtSqrtPrice(sqrtOracle);
        int24 dev = int24(uint24(maxDeviationBps));
        int24 t = _clamp(spotTick, oracleTick - dev, oracleTick + dev);
        int56 cum;
        if (n == 0) {
            continuousSince = nowT;
        } else {
            uint32 dt = nowT - last.ts;
            cum = last.cum + int56(last.tick) * int56(uint56(dt));
            if (dt <= MAX_GAP) t = _clamp(t, last.tick - MAX_STEP, last.tick + MAX_STEP);
            else continuousSince = nowT;
            h = (h + 1) % RING;
            head = h;
        }
        obs[h] = Obs(nowT, t, cum);
        if (n < RING) count = n + 1;
        emit Observed(nowT, t, spotTick, oracleTick);
        return true;
    }

    /// @notice Arithmetic-mean tick over the last `window` seconds. `ok` is false unless the record is continuous
    /// over the whole window and its newest observation is at most MAX_GAP old.
    function twap(uint32 window) external view returns (bool ok, int24 tick) {
        uint16 n = count;
        if (n == 0 || window == 0) return (false, 0);
        uint32 nowT = uint32(block.timestamp);
        Obs memory last = obs[head];
        if (nowT - last.ts > MAX_GAP) return (false, 0);
        if (nowT < window || continuousSince > nowT - window) return (false, 0);
        uint32 target = nowT - window;
        Obs memory b = _atOrBefore(target, n);
        if (b.ts == 0 || b.ts > target) return (false, 0);
        int56 cumTarget = b.cum + int56(b.tick) * int56(uint56(target - b.ts));
        int56 cumNow = last.cum + int56(last.tick) * int56(uint56(nowT - last.ts));
        int56 delta = cumNow - cumTarget;
        int56 w = int56(uint56(window));
        int56 t = delta / w;
        if (delta < 0 && delta % w != 0) t--;
        return (true, int24(t));
    }

    /// @notice `twap` as a sqrt price, the form the vault prices with.
    function twapSqrt(uint32 window) external view returns (bool ok, uint160 sqrtP) {
        int24 t;
        (ok, t) = this.twap(window);
        if (ok) sqrtP = TickMath.getSqrtPriceAtTick(t);
    }

    /// @notice Newest observation, for the keeper and the app.
    function latest() external view returns (uint32 ts, int24 tick) {
        if (count == 0) return (0, 0);
        Obs memory o = obs[head];
        return (o.ts, o.tick);
    }

    /// @dev Newest observation with ts <= target among the last `n`, or a zero Obs when the ring does not reach back.
    function _atOrBefore(uint32 target, uint16 n) private view returns (Obs memory r) {
        uint16 h = head;
        uint256 lo;
        uint256 hi = n; // first logical index known to be > target, or n
        // logical index i (0 oldest) lives at (h + RING - (n - 1 - i)) % RING
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            Obs memory m = obs[(h + RING - (n - 1 - mid)) % RING];
            if (m.ts <= target) lo = mid + 1;
            else hi = mid;
        }
        if (lo == 0) return r;
        return obs[(h + RING - (n - lo)) % RING];
    }

    function _clamp(int24 v, int24 lo, int24 hi) private pure returns (int24) {
        return v < lo ? lo : (v > hi ? hi : v);
    }
}
