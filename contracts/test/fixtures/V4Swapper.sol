// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";

/// @notice The smallest Uniswap v4 trader: an exact-input swap in one pool, paid from and delivered to the caller (who approves this
/// contract). It is what a swap router is to a v3 pool, so scripts/e2e-fork.sh can move a v4 pool the way a trader does.
contract V4Swapper is IUnlockCallback {
    IPoolManager public immutable poolManager;

    constructor(IPoolManager pm) {
        poolManager = pm;
    }

    function swap(PoolKey calldata key, bool zeroForOne, uint256 amountIn) external returns (uint256 out) {
        return abi.decode(poolManager.unlock(abi.encode(msg.sender, key, zeroForOne, amountIn)), (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "not the PoolManager");
        (address payer, PoolKey memory key, bool zeroForOne, uint256 amountIn) =
            abi.decode(data, (address, PoolKey, bool, uint256));
        BalanceDelta d = poolManager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? 4295128740 : 1461446703485210103287273052203988822378723970341
            }),
            ""
        );
        (Currency cin, Currency cout, int128 din, int128 dout) =
            zeroForOne ? (key.currency0, key.currency1, d.amount0(), d.amount1()) : (key.currency1, key.currency0, d.amount1(), d.amount0());
        poolManager.sync(cin);
        require(IERC20(Currency.unwrap(cin)).transferFrom(payer, address(poolManager), uint128(-din)), "pay failed");
        poolManager.settle();
        poolManager.take(cout, payer, uint128(dout));
        return abi.encode(uint256(uint128(dout)));
    }
}
