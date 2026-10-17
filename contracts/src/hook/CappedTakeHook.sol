// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {CapRegistry} from "./CapRegistry.sol";

/// @notice Base hook that makes a declared maximum take a property of the bytecode.
/// A builder inherits it and implements `_beforeSwap` / `_afterSwap`. Every swap is checked in
/// afterSwap: the take implied by the deltas the hook returns (beforeSwap specified and unspecified,
/// afterSwap unspecified) plus the dynamic LP fee in force is summed in bps of the leg it was taken
/// from. Above `maxTakeBps` the swap reverts. Otherwise `Take` is emitted.
/// Address bits must be 0xCC: BEFORE_SWAP | AFTER_SWAP | BEFORE_SWAP_RETURNS_DELTA | AFTER_SWAP_RETURNS_DELTA.
abstract contract CappedTakeHook {
    using PoolIdLibrary for PoolKey;
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using LPFeeLibrary for uint24;

    IPoolManager public immutable poolManager;
    CapRegistry public immutable registry;
    /// @dev Immutable: the cap can never be raised. Only-decreasable storage would cost an SLOAD per swap.
    uint16 public immutable maxTakeBps;
    /// @dev Spike switch so the self-swap attack can be shown passing without the guard. Always true in a product.
    bool public immutable nestedGuard;

    // Literal transient slots (assembly cannot read keccak constants).
    uint256 private constant T_BSD = 0xc7a1f3e0d2b94a6c8e51b7d3f09a24c6118e5f7d3a9b0c4e62f8d1a7b3c5e901;
    uint256 private constant T_FEE = 0xc7a1f3e0d2b94a6c8e51b7d3f09a24c6118e5f7d3a9b0c4e62f8d1a7b3c5e902;
    uint256 private constant PRICE_TICK_MASK = (1 << 184) - 1;

    error NotPoolManager();
    error TakeExceedsCap(uint256 takeBps, uint256 maxTakeBps);
    error NestedStateChange();

    /// @param takeAmount total take in INPUT currency units; output-leg takes converted at the swap's own execution price
    event Take(PoolId indexed poolId, address indexed sender, uint256 amountIn, uint256 takeAmount, uint256 takeBps);
    /// @dev exact per-leg amounts in the currency each was taken in, plus the dynamic LP fee in force
    event TakeLegs(PoolId indexed poolId, uint256 specifiedTake, uint256 unspecifiedTake, uint24 dynamicLpFee);

    constructor(IPoolManager _poolManager, CapRegistry _registry, uint16 _maxTakeBps, bool _nestedGuard) {
        poolManager = _poolManager;
        registry = _registry;
        maxTakeBps = _maxTakeBps;
        nestedGuard = _nestedGuard;
        _registry.register(_maxTakeBps);
        Hooks.validateHookPermissions(IHooks(address(this)), _permissions());
    }

    /// @dev builder logic, runs between the guard snapshots
    function _beforeSwap(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata hookData)
        internal
        virtual
        returns (BeforeSwapDelta delta, uint24 lpFeeOverride);

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal virtual returns (int128 unspecifiedDelta);

    function beforeSwap(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata hookData)
        external
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        bytes32 id = PoolId.unwrap(key.toId());
        (bytes32 pre,) = _fingerprint(id);
        (BeforeSwapDelta d, uint24 fee) = _beforeSwap(sender, key, params, hookData);
        if (nestedGuard) {
            (bytes32 post,) = _fingerprint(id);
            if (post != pre) revert NestedStateChange();
        }
        uint256 d256 = uint256(BeforeSwapDelta.unwrap(d));
        assembly ("memory-safe") {
            tstore(T_BSD, d256)
            tstore(T_FEE, fee)
        }
        return (IHooks.beforeSwap.selector, d, fee);
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external returns (bytes4, int128) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        PoolId pid = key.toId();
        (bytes32 pre, uint24 lpFeeNow) = _fingerprint(PoolId.unwrap(pid));
        int128 afterTake = _afterSwap(sender, key, params, delta, hookData);
        if (nestedGuard) {
            (bytes32 post,) = _fingerprint(PoolId.unwrap(pid));
            if (post != pre) revert NestedStateChange();
        }
        _enforce(pid, sender, key, params, delta, afterTake, lpFeeNow);
        return (IHooks.afterSwap.selector, afterTake);
    }

    struct Legs {
        uint256 specTake;
        uint256 unspecTake;
        uint256 feePips;
        uint256 specGross;
        uint256 unspecGross;
        bool exactIn;
    }

    function _enforce(
        PoolId pid,
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        int128 afterTake,
        uint24 lpFeeNow
    ) private {
        Legs memory l;
        {
            uint256 bsdRaw;
            uint256 beforeFee;
            assembly ("memory-safe") {
                bsdRaw := tload(T_BSD)
                beforeFee := tload(T_FEE)
            }
            BeforeSwapDelta bsd = BeforeSwapDelta.wrap(int256(bsdRaw));
            l.exactIn = params.amountSpecified < 0;
            l.specGross = l.exactIn ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
            int256 unspec = int256((l.exactIn == params.zeroForOne) ? delta.amount1() : delta.amount0());
            l.unspecGross = uint256(unspec < 0 ? -unspec : unspec);
            int256 st = bsd.getSpecifiedDelta();
            int256 ut = int256(bsd.getUnspecifiedDelta()) + afterTake;
            l.specTake = st > 0 ? uint256(st) : 0; // negative legs (rebates) never offset a take
            l.unspecTake = ut > 0 ? uint256(ut) : 0;
            if (key.fee.isDynamicFee()) {
                l.feePips = (beforeFee & LPFeeLibrary.OVERRIDE_FEE_FLAG) != 0
                    ? beforeFee & ~uint256(LPFeeLibrary.OVERRIDE_FEE_FLAG)
                    : lpFeeNow;
            }
        }

        // upward-rounded bps per leg: the check can over-count by < 1 bps per leg, never under-count
        uint256 takeBps = _ceilBps(l.specTake, l.specGross) + _ceilBps(l.unspecTake, l.unspecGross) + (l.feePips + 99) / 100;
        if (takeBps > maxTakeBps) revert TakeExceedsCap(takeBps, maxTakeBps);

        uint256 amountIn;
        uint256 takeAmount;
        if (l.exactIn) {
            uint256 ammIn = l.specGross - l.specTake;
            amountIn = l.specGross;
            takeAmount = l.specTake + FullMath.mulDivRoundingUp(ammIn, l.feePips, 1e6);
            if (l.unspecGross != 0) takeAmount += FullMath.mulDiv(l.unspecTake, ammIn, l.unspecGross);
        } else {
            uint256 ammOut = l.specGross + l.specTake;
            amountIn = l.unspecGross + l.unspecTake;
            takeAmount = l.unspecTake + FullMath.mulDivRoundingUp(l.unspecGross, l.feePips, 1e6);
            if (ammOut != 0) takeAmount += FullMath.mulDiv(l.specTake, l.unspecGross, ammOut);
        }
        emit Take(pid, sender, amountIn, takeAmount, takeBps);
        emit TakeLegs(pid, l.specTake, l.unspecTake, uint24(l.feePips));
    }

    function _ceilBps(uint256 take, uint256 gross) private pure returns (uint256) {
        if (take == 0) return 0;
        if (gross == 0) return type(uint128).max;
        return FullMath.mulDivRoundingUp(take, 10_000, gross);
    }

    /// @dev One extsload for slot0 and liquidity. Fingerprint covers sqrtPrice, tick and active liquidity (not lpFee/protocolFee).
    function _fingerprint(bytes32 poolId) private view returns (bytes32 fp, uint24 lpFee) {
        bytes32 base = keccak256(abi.encode(poolId, StateLibrary.POOLS_SLOT));
        bytes32[] memory slots = new bytes32[](2);
        slots[0] = base;
        slots[1] = bytes32(uint256(base) + StateLibrary.LIQUIDITY_OFFSET);
        bytes32[] memory v = poolManager.extsload(slots);
        uint256 s0 = uint256(v[0]);
        lpFee = uint24(s0 >> 208);
        fp = keccak256(abi.encode(s0 & PRICE_TICK_MASK, v[1]));
    }

    function _permissions() internal pure returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }
}
