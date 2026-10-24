// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";

interface IMorphoCreate {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    function createMarket(MarketParams memory marketParams) external;
    function isLltvEnabled(uint256 lltv) external view returns (bool);
    function isIrmEnabled(address irm) external view returns (bool);
    function market(bytes32 id)
        external
        view
        returns (uint128, uint128, uint128, uint128, uint128 lastUpdate, uint128);
}

interface IShareOracle {
    function vault() external view returns (address);
    function usdg() external view returns (address);
}

/// @notice Creates the Morpho Blue market that takes an Uptick vault share as collateral against USDG, priced by that
/// vault's UptickShareOracle. Refuses when the oracle is bound to another vault, the LLTV or IRM is not enabled, or the
/// market already exists. Env: MORPHO, ORACLE, IRM, LLTV (1e18 scale), DEPLOYER_KEY (read here, never argv).
contract CreateMorphoMarket is Script {
    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        IMorphoCreate morpho = IMorphoCreate(vm.envAddress("MORPHO"));
        IShareOracle oracle = IShareOracle(vm.envAddress("ORACLE"));
        IMorphoCreate.MarketParams memory p = IMorphoCreate.MarketParams({
            loanToken: oracle.usdg(),
            collateralToken: oracle.vault(),
            oracle: address(oracle),
            irm: vm.envAddress("IRM"),
            lltv: vm.envUint("LLTV")
        });
        require(morpho.isLltvEnabled(p.lltv), "LLTV not enabled");
        require(morpho.isIrmEnabled(p.irm), "IRM not enabled");
        bytes32 id = keccak256(abi.encode(p));
        (,,,, uint128 lastUpdate,) = morpho.market(id);
        require(lastUpdate == 0, "market already exists");
        vm.startBroadcast(vm.envUint("DEPLOYER_KEY"));
        morpho.createMarket(p);
        vm.stopBroadcast();
        console.log("market id");
        console.logBytes32(id);
    }
}
