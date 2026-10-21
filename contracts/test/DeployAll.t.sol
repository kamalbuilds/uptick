// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ForkPin} from "./ForkPin.sol";
import {Test} from "forge-std/Test.sol";
import {DeployAll} from "../script/DeployAll.s.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {StockVault} from "../src/StockVault.sol";

/// @dev The deploy script against the real chain state (public RPC fork, chain id 4663). One test, one step after the
/// other: the script reads its inputs from process environment variables, which parallel tests would overwrite.
/// 1. an entry whose `deployable` flag is false reverts before anything is created;
/// 2. an entry without the flag reverts the same way;
/// 3. an open entry deploys with the 35 bp entry fee, the 30 bp rebalance bound and its own range;
/// 4. ALLOW_CLOSED lifts the refusal on a local anvil fork (stood in for by DeployAllLocalFork) and a 1% pool keeps its
///    own tier as the entry fee;
/// 5. ALLOW_CLOSED on a real RPC at chain id 4663 reverts, whatever the list holds;
/// 6. a zero depositCapTokens reverts unless ALLOW_UNCAPPED is set; a missing one always reverts;
/// 7. an entry without `symbol` reverts naming its index, however many valid entries precede it.
contract DeployAllLocalFork is DeployAll {
    function _isLocalFork() internal pure override returns (bool) {
        return true;
    }
}

contract DeployAllTest is Test {
    DeployAll script;
    DeployAll forkScript;

    function setUp() public {
        ForkPin.select(vm);
        vm.setEnv("ANVIL_KEY", vm.toString(uint256(keccak256("deploy-all-test-signer"))));
        vm.setEnv("OWNER", vm.toString(makeAddr("owner")));
        vm.setEnv("KEEPER", vm.toString(makeAddr("keeper")));
        vm.setEnv("TREASURY", vm.toString(makeAddr("treasury")));
        script = new DeployAll();
        forkScript = new DeployAllLocalFork();
    }

    function _env(string memory file, bool allowClosed) internal {
        vm.setEnv("DEPLOY_LIST", file);
        vm.setEnv("ALLOW_CLOSED", allowClosed ? "true" : "false");
        vm.setEnv("ALLOW_UNCAPPED", "false");
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
        (f,) = forkScript.run();
        assertEq(f.vaultCount(), 2);
        StockVault gme = StockVault(f.entryAt(1).vault);
        assertEq(gme.poolFee(), 10_000);
        assertEq(gme.entryFee(), 10_000, "a 1% pool keeps its own tier as the entry fee");
    }

    function test_allowClosedRefusedOnARealChain() public {
        assertEq(block.chainid, 4663);
        // through a local anvil fork the node answers anvil_nodeInfo, so the script rightly allows the flag
        try vm.rpc("anvil_nodeInfo", "[]") returns (bytes memory) { vm.skip(true); } catch {}
        _env("test/fixtures/deploy-list-closed.json", true);
        vm.expectRevert(bytes("ALLOW_CLOSED is refused here: only a local anvil fork may deploy a closed vault"));
        script.run();

        // the same flag on a list of open vaults is refused too: the switch itself is what a real chain rejects
        _env("test/fixtures/deploy-list-open.json", true);
        vm.expectRevert(bytes("ALLOW_CLOSED is refused here: only a local anvil fork may deploy a closed vault"));
        script.run();

        // control: without the flag the same list deploys
        _env("test/fixtures/deploy-list-open.json", false);
        (VaultFactory f,) = script.run();
        assertEq(f.vaultCount(), 1);
    }

    function test_zeroCapNeedsAllowUncapped() public {
        _env("test/fixtures/deploy-list-uncapped.json", false);
        vm.expectRevert(bytes("NVDA has a zero depositCapTokens (uncapped); set ALLOW_UNCAPPED=true to deploy it"));
        script.run();

        vm.setEnv("ALLOW_UNCAPPED", "true");
        (VaultFactory f,) = script.run();
        assertEq(StockVault(f.entryAt(0).vault).depositCap(), 0, "deployed uncapped on request");

        _env("test/fixtures/deploy-list-nocap.json", false);
        vm.setEnv("ALLOW_UNCAPPED", "true");
        vm.expectRevert(bytes("NVDA has no depositCapTokens"));
        script.run();

        _env("test/fixtures/deploy-list-open.json", false);
        (f,) = script.run();
        assertGt(StockVault(f.entryAt(0).vault).depositCap(), 0, "a capped entry deploys without the flag");
    }

    function test_entryWithoutSymbolReverts() public {
        _env("test/fixtures/deploy-list-nosymbol.json", false);
        vm.expectRevert(bytes("deploy list entry 1 has no symbol"));
        script.run();
    }
}
