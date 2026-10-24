// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {UptickShareOracleFactory} from "../src/UptickShareOracleFactory.sol";
import {IUptickVault} from "../src/UptickShareOracle.sol";

/// @notice Creates the share oracle of each listed vault through the deployed UptickShareOracleFactory, the only way to
/// deploy one. A vault that already has an oracle is skipped, so a rerun spends nothing on it.
/// Env: ORACLE_FACTORY, VAULTS (comma-separated vault addresses), DEPLOYER_KEY (read here, never argv).
contract CreateOracles is Script {
    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        UptickShareOracleFactory oracles = UptickShareOracleFactory(vm.envAddress("ORACLE_FACTORY"));
        address[] memory vaults = vm.envAddress("VAULTS", ",");
        vm.startBroadcast(vm.envUint("DEPLOYER_KEY"));
        for (uint256 i = 0; i < vaults.length; ++i) {
            address existing = oracles.oracleOf(vaults[i]);
            if (existing != address(0)) {
                console.log("exists", vaults[i], existing);
                continue;
            }
            console.log("UptickShareOracle", vaults[i], oracles.createOracle(IUptickVault(vaults[i])));
        }
        vm.stopBroadcast();
    }
}
