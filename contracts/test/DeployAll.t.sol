// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DeployAll} from "../script/DeployAll.s.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {StockVault} from "../src/StockVault.sol";

/// @dev The deploy script against the real chain state (public RPC fork, chain id 4663). One test, one step after the
/// other: the script reads its inputs from process environment variables, which parallel tests would overwrite.
/// 1. an entry whose `deployable` flag is false reverts before anything is created;
/// 2. an entry without the flag reverts the same way;
/// 3. an open entry deploys with the 35 bp entry fee, the 30 bp rebalance bound and its own range;
/// 4. ALLOW_CLOSED lifts the refusal (the local fork's switch) and a 1% pool keeps its own tier as the entry fee.
contract DeployAllTest is Test {
    DeployAll script;

    function setUp() public {
        vm.createSelectFork("robinhood");
        vm.setEnv("ANVIL_KEY", vm.toString(uint256(keccak256("deploy-all-test-signer"))));
        vm.setEnv("OWNER", vm.toString(makeAddr("owner")));
        vm.setEnv("KEEPER", vm.toString(makeAddr("keeper")));
        vm.setEnv("TREASURY", vm.toString(makeAddr("treasury")));
        script = new DeployAll();
    }

    function _env(string memory file, bool allowClosed) internal {
        vm.setEnv("DEPLOY_LIST", file);
        vm.setEnv("ALLOW_CLOSED", allowClosed ? "true" : "false");
    }

    function test_deployabilityGate() public {
        _env("test/fixtures/deploy-list-closed.json", false);
        vm.expectRevert(bytes("GME is not deployable"));
        script.run();

        _env("test/fixtures/deploy-list-noflag.json", false);
        vm.expectRevert(bytes("deploy list entry has no deployable flag"));
        script.run();

        _env("test/fixtures/deploy-list-open.json", false);
        (VaultFactory f,) = script.run();
        assertEq(f.vaultCount(), 1);
        StockVault v = StockVault(f.entryAt(0).vault);
        assertEq(v.entryFee(), 3500, "entry fee: the larger of the 5 bp tier and the 35 bp floor");
        assertEq(v.maxTwapOracleBps(), 30);
        (uint16 range,,,,,,,) = v.params();
        assertEq(range, 150);

        _env("test/fixtures/deploy-list-closed.json", true);
        (f,) = script.run();
        assertEq(f.vaultCount(), 2);
        StockVault gme = StockVault(f.entryAt(1).vault);
        assertEq(gme.poolFee(), 10_000);
        assertEq(gme.entryFee(), 10_000, "a 1% pool keeps its own tier as the entry fee");
    }
}
