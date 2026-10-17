// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StockVault} from "../src/StockVault.sol";

/// @notice Local Anvil fork of Robinhood Chain (4663): deploys the NVDA vault, deposits NVDA, opens the position.
/// Env: ANVIL_KEY (anvil's default dev key, never a real key). The deployer is owner, keeper and depositor;
/// the treasury is anvil's third default account. The deployer must already hold DEPOSIT NVDA on the fork.
/// After the run, advance fork time past minRebalanceInterval and call rebalance() as the keeper (see docs/FORK-DEMO.md).
contract DeployFork is Script {
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant POOL = 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3;
    address constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address constant TREASURY = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    uint256 constant DEPOSIT = 233e18; // about $50K at the NVDA price on the fork

    function run() external returns (StockVault vault) {
        require(block.chainid == 4663, "not the RHC fork");
        uint256 pk = vm.envUint("ANVIL_KEY");
        address me = vm.addr(pk);
        StockVault.Config memory c = StockVault.Config({
            stock: NVDA, usdg: USDG, pool: POOL, positionManager: NPM, router: ROUTER, feed: FEED,
            owner: me, keeper: me, treasury: TREASURY, depositCap: 0
        });
        StockVault.Params memory p = StockVault.Params({
            rangeBps: 500, perfFeeBps: 1000, maxDeviationBps: 100, slippageBps: 100,
            exitBufferBps: 30, maxStaleness: 90_000, twapWindow: 600, minRebalanceInterval: 6 hours
        });
        vm.startBroadcast(pk);
        vault = new StockVault(c, p, "Stock Vault NVDA", "svNVDA");
        vault.setInstantDeploy(true); // deposits open the position at once; rebalance() is keeper-gated for 6h after deploy
        IERC20(NVDA).approve(address(vault), DEPOSIT);
        vault.deposit(DEPOSIT, me);
        vm.stopBroadcast();
        console.log("StockVault", address(vault));
    }
}
