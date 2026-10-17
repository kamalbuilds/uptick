// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {StockVault} from "../src/StockVault.sol";

/// @notice Deploys one StockVault. Without --broadcast this only simulates against the RPC.
/// Required env: OWNER (multisig), KEEPER, TREASURY. Optional env: STOCK, POOL, FEED (default to NVDA),
/// DEPOSIT_CAP (Stock Token wei, default 0 = uncapped), VAULT_NAME, VAULT_SYMBOL.
contract Deploy is Script {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;

    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant NVDA_POOL = 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3;
    address constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;

    function run() external returns (StockVault vault) {
        StockVault.Config memory c = StockVault.Config({
            stock: vm.envOr("STOCK", NVDA),
            usdg: USDG,
            pool: vm.envOr("POOL", NVDA_POOL),
            positionManager: NPM,
            router: ROUTER,
            feed: vm.envOr("FEED", NVDA_FEED),
            owner: vm.envAddress("OWNER"),
            keeper: vm.envAddress("KEEPER"),
            treasury: vm.envAddress("TREASURY"),
            depositCap: vm.envOr("DEPOSIT_CAP", uint256(0))
        });
        StockVault.Params memory p = StockVault.Params({
            rangeBps: 500,
            perfFeeBps: 1000,
            maxDeviationBps: 100,
            slippageBps: 100,
            exitBufferBps: 30,
            maxStaleness: 90_000,
            twapWindow: 600,
            minRebalanceInterval: 6 hours
        });
        vm.startBroadcast();
        vault = new StockVault(c, p, vm.envOr("VAULT_NAME", string("Stock Vault NVDA")), vm.envOr("VAULT_SYMBOL", string("svNVDA")));
        vm.stopBroadcast();
        console.log("StockVault", address(vault));
    }
}
