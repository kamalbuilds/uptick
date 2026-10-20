// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {StockVault} from "../src/StockVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {UptickRouter, IVaultRegistry} from "../src/UptickRouter.sol";

/// @notice Deploys the VaultFactory, one StockVault per entry of the deploy list (through the factory, which pins
/// StockVault's creation-code hash and registers every vault) and one UptickRouter bound to the factory registry
/// (the router serves only vaults the factory deployed). The same script runs on the
/// local fork and on mainnet: only --rpc-url and the key env differ. Without --broadcast it only simulates.
/// Env: DEPLOY_LIST (path to the JSON written by scripts/deploy-list.mjs), DEPLOYER_KEY or ANVIL_KEY (the broadcaster,
/// read by vm.envUint, never argv), OWNER (owns every vault, a multisig on mainnet), KEEPER, TREASURY.
/// Optional: ROUTER_SLIPPAGE_BPS (default 100), MIN_REBALANCE_INTERVAL in seconds (default 6 hours, the mainnet value;
/// the fork script shortens it so the keeper's first rebalance needs less warped time). The factory is handed to OWNER (Ownable2Step, OWNER must accept)
/// when OWNER is not the deployer.
contract DeployAll is Script {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;

    function run() external returns (VaultFactory factory, UptickRouter router) {
        require(block.chainid == 4663, "not Robinhood Chain");
        uint256 pk = vm.envOr("DEPLOYER_KEY", vm.envOr("ANVIL_KEY", uint256(0)));
        require(pk != 0, "set DEPLOYER_KEY or ANVIL_KEY");
        address me = vm.addr(pk);
        address owner = vm.envAddress("OWNER");

        string memory json = vm.readFile(vm.envString("DEPLOY_LIST"));
        uint256 n = abi.decode(vm.parseJson(json, "$[*].symbol"), (string[])).length;
        require(n > 0, "empty deploy list");

        bytes memory code = type(StockVault).creationCode;
        vm.startBroadcast(pk);
        factory = new VaultFactory(
            me,
            keccak256(code),
            VaultFactory.Defaults({
                usdg: USDG,
                positionManager: NPM,
                router: ROUTER,
                vaultOwner: owner,
                keeper: vm.envAddress("KEEPER"),
                treasury: vm.envAddress("TREASURY"),
                params: StockVault.Params({
                    rangeBps: 500,
                    perfFeeBps: 1000,
                    maxDeviationBps: 100,
                    slippageBps: 100,
                    exitBufferBps: 30,
                    maxStaleness: 90_000,
                    twapWindow: 600,
                    minRebalanceInterval: uint32(vm.envOr("MIN_REBALANCE_INTERVAL", uint256(6 hours)))
                })
            })
        );
        console.log("VaultFactory", address(factory));
        for (uint256 i = 0; i < n; ++i) {
            string memory k = string.concat(".[", vm.toString(i), "]");
            address vault = factory.createVault(
                code,
                vm.parseJsonAddress(json, string.concat(k, ".token")),
                vm.parseJsonAddress(json, string.concat(k, ".pool")),
                vm.parseJsonAddress(json, string.concat(k, ".feed")),
                vm.parseJsonUint(json, string.concat(k, ".depositCapTokens"))
            );
            console.log("StockVault", vm.parseJsonString(json, string.concat(k, ".symbol")), vault);
        }
        router = new UptickRouter(vm.envOr("ROUTER_SLIPPAGE_BPS", uint256(100)), IVaultRegistry(address(factory)));
        console.log("UptickRouter", address(router));
        if (owner != me) factory.transferOwnership(owner);
        vm.stopBroadcast();
    }
}
