// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";

/// @dev One place that decides which chain state every fork test sees. The public Robinhood RPC keeps no history, so
/// "head" drifts under the suite (pool depth, feed age, protocol fees move) and tests written against one afternoon fail on
/// the next. With FORK_URL set (an archive node, or a local anvil forking one) every suite forks the same block:
/// FORK_BLOCK, else PINNED_BLOCK. With FORK_URL unset the suite forks the public RPC at head, the only state it serves.
///
/// PINNED_BLOCK 93,694,185 is 2026-10-20 19:30 UTC, inside NYSE hours, the block the fork demo and the replay universe
/// (block 93,694,244) were cut at. Run the pinned suite with a local node so state is cached and no RPC rate-limits it:
///   anvil --fork-url <archive rpc> --fork-block-number 93694185 --port 8546 --retries 20 --fork-retry-backoff 500 --no-rate-limit
///   FORK_URL=http://127.0.0.1:8546 forge test -j 2
library ForkPin {
    uint256 internal constant PINNED_BLOCK = 93_694_185;

    function select(Vm vm, string memory defaultUrl) internal returns (uint256 forkId) {
        string memory url = vm.envOr("FORK_URL", string(""));
        if (bytes(url).length == 0) {
            uint256 blk = vm.envOr("FORK_BLOCK", uint256(0));
            return blk == 0 ? vm.createSelectFork(defaultUrl) : vm.createSelectFork(defaultUrl, blk);
        }
        return vm.createSelectFork(url, vm.envOr("FORK_BLOCK", PINNED_BLOCK));
    }

    function select(Vm vm) internal returns (uint256) {
        return select(vm, "robinhood");
    }
}
