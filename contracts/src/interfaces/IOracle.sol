// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The oracle a Morpho Blue market calls: `price()` of one raw unit of collateral in raw units of the loan
/// token, scaled by 1e36 (no decimals adjustment beyond the raw ratio).
interface IOracle {
    function price() external view returns (uint256);
}
