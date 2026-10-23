// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Fork-only Chainlink stand-in. Its runtime code is copied over a feed proxy with `anvil_setCode`; every value is an
/// immutable, so the copy keeps them. scripts/e2e-fork.sh uses it to publish a new round at a lower price on the local fork.
contract SettableFeed {
    uint8 public immutable decimals;
    uint80 private immutable roundId;
    int256 private immutable answer;
    uint256 private immutable startedAt;
    uint256 private immutable updatedAt;

    constructor(uint8 decimals_, uint80 roundId_, int256 answer_, uint256 startedAt_, uint256 updatedAt_) {
        decimals = decimals_;
        roundId = roundId_;
        answer = answer_;
        startedAt = startedAt_;
        updatedAt = updatedAt_;
    }

    function description() external pure returns (string memory) {
        return "fork round";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, roundId);
    }
}
