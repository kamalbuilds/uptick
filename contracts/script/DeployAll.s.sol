// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {StockVault} from "../src/StockVault.sol";
import {StockVaultV4} from "../src/v4/StockVaultV4.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {UptickRouter, IVaultRegistry} from "../src/UptickRouter.sol";
import {UptickShareOracleFactory} from "../src/UptickShareOracleFactory.sol";
import {IVaultFactory} from "../src/UptickShareOracle.sol";

/// @notice Deploys the VaultFactory, one StockVault per entry of the deploy list (through the factory, which pins
/// StockVault's creation-code hash and registers every vault) and one UptickRouter bound to the factory registry
/// (the router serves only vaults the factory deployed). The same script runs on the
/// local fork and on mainnet: only --rpc-url and the key env differ. Without --broadcast it only simulates.
/// Env: DEPLOY_LIST (path to the JSON written by scripts/deploy-list.mjs), DEPLOYER_KEY or ANVIL_KEY (the broadcaster,
/// read by vm.envUint, never argv), OWNER (owns every vault, a multisig on mainnet), KEEPER, TREASURY.
/// Optional: DEPLOY_ORACLE_FACTORY (default true) also deploys the UptickShareOracleFactory bound to the new VaultFactory,
/// the only way to deploy a share oracle and the registry (`isOracle`) a Morpho lender checks; its address is logged and
/// kept in `oracleFactory`. ROUTER_SLIPPAGE_BPS (default 100), MIN_REBALANCE_INTERVAL in seconds (default 6 hours, the mainnet value;
/// the fork script shortens it so the keeper's first rebalance needs less warped time). The factory is handed to OWNER (Ownable2Step, OWNER must accept)
/// when OWNER is not the deployer.
/// Each deploy-list entry may carry `rangeBps` (50 to 2000, from keeper/data/params.json via scripts/deploy-list.mjs);
/// an entry without it gets 500. The factory applies one Params set to every vault it creates, so the script sets the
/// factory defaults to that entry's range before each createVault and puts 500 back at the end.
/// Every entry must carry `deployable: true` (scripts/deploy-list.mjs sets it from the evidence gate: open or reduced).
/// An entry without the flag, or with it false, reverts the script before any vault is created, so a closed vault
/// cannot be deployed by accident. ALLOW_CLOSED=true lifts the check for a local anvil fork only: the fork shares chain
/// id 4663 with the real chain, so the script asks the node for `anvil_nodeInfo` and refuses ALLOW_CLOSED on any other
/// RPC. An entry without `symbol` or `depositCapTokens` reverts naming its index, and a zero `depositCapTokens` (an
/// uncapped vault) reverts unless ALLOW_UNCAPPED=true is set.
/// An entry with `"venue": "v4"` (scripts/deploy-list.mjs writes it for a token whose chosen pool is a Uniswap v4 pool)
/// is created through `VaultFactory.createVaultV4` from `token`, `feeTier` (the pool key's fee), `tickSpacing`, `hooks`
/// and `feed`; its `poolId`, when present, must equal the id the pool key hashes to, so a deploy list and a deployed pool
/// cannot disagree. A non-zero `hooks` must already be on the factory's allow-list (`setHookAllowed`): the script never
/// allows a hook itself. An entry without `venue` is a v3 entry.
/// Not parameters of the constructor, so nothing here changes with them: every vault starts with `entryFee` the larger
/// of its pool's fee tier and 35 bp, `maxSpotTwapBps` 10 and `maxTwapOracleBps` 30, and moves them only through its
/// 24-hour queue.
contract DeployAll is Script {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    uint16 constant DEFAULT_RANGE_BPS = 500;

    /// @notice The oracle factory of the last run, zero when DEPLOY_ORACLE_FACTORY is false.
    UptickShareOracleFactory public oracleFactory;

    function run() external returns (VaultFactory factory, UptickRouter router) {
        require(block.chainid == 4663, "not Robinhood Chain");
        uint256 pk = vm.envOr("DEPLOYER_KEY", vm.envOr("ANVIL_KEY", uint256(0)));
        require(pk != 0, "set DEPLOYER_KEY or ANVIL_KEY");
        address me = vm.addr(pk);
        address owner = vm.envAddress("OWNER");

        string memory json = vm.readFile(vm.envString("DEPLOY_LIST"));
        uint256 n;
        while (vm.keyExistsJson(json, string.concat(".[", vm.toString(n), "]"))) ++n;
        require(n > 0, "empty deploy list");
        bool allowClosed = vm.envOr("ALLOW_CLOSED", false);
        bool allowUncapped = vm.envOr("ALLOW_UNCAPPED", false);
        require(
            !allowClosed || _isLocalFork(),
            "ALLOW_CLOSED is refused here: only a local anvil fork may deploy a closed vault"
        );
        for (uint256 i = 0; i < n; ++i) {
            string memory ik = string.concat(".[", vm.toString(i), "]");
            require(
                vm.keyExistsJson(json, string.concat(ik, ".symbol")),
                string.concat("deploy list entry ", vm.toString(i), " has no symbol")
            );
            string memory sym = vm.parseJsonString(json, string.concat(ik, ".symbol"));
            string memory dk = string.concat(ik, ".deployable");
            require(vm.keyExistsJson(json, dk), "deploy list entry has no deployable flag");
            require(allowClosed || vm.parseJsonBool(json, dk), string.concat(sym, " is not deployable"));
            string memory ck = string.concat(ik, ".depositCapTokens");
            require(vm.keyExistsJson(json, ck), string.concat(sym, " has no depositCapTokens"));
            require(
                allowUncapped || vm.parseJsonUint(json, ck) != 0,
                string.concat(sym, " has a zero depositCapTokens (uncapped); set ALLOW_UNCAPPED=true to deploy it")
            );
        }

        bytes memory code = type(StockVault).creationCode;
        bytes memory code4 = type(StockVaultV4).creationCode;
        VaultFactory.Defaults memory d = VaultFactory.Defaults({
            usdg: USDG,
            positionManager: NPM,
            router: ROUTER,
            vaultOwner: owner,
            keeper: vm.envAddress("KEEPER"),
            treasury: vm.envAddress("TREASURY"),
            params: StockVault.Params({
                rangeBps: DEFAULT_RANGE_BPS,
                perfFeeBps: uint16(vm.envOr("PERF_FEE_BPS", uint256(0))), // launch at 0%: published kept APR is what depositors keep
                maxDeviationBps: 100,
                slippageBps: 100,
                exitBufferBps: 30,
                maxStaleness: 90_000,
                twapWindow: 600,
                minRebalanceInterval: uint32(vm.envOr("MIN_REBALANCE_INTERVAL", uint256(6 hours)))
            })
        });
        vm.startBroadcast(pk);
        factory = new VaultFactory(me, keccak256(code), keccak256(code4), POOL_MANAGER, d);
        console.log("VaultFactory", address(factory));
        if (vm.envOr("DEPLOY_ORACLE_FACTORY", true)) {
            oracleFactory = new UptickShareOracleFactory(IVaultFactory(address(factory)));
            console.log("UptickShareOracleFactory", address(oracleFactory));
        } else {
            oracleFactory = UptickShareOracleFactory(address(0));
        }
        for (uint256 i = 0; i < n; ++i) {
            string memory k = string.concat(".[", vm.toString(i), "]");
            string memory rk = string.concat(k, ".rangeBps");
            uint16 range = vm.keyExistsJson(json, rk) ? uint16(vm.parseJsonUint(json, rk)) : DEFAULT_RANGE_BPS;
            if (range != d.params.rangeBps) {
                d.params.rangeBps = range;
                factory.setDefaults(d);
            }
            address vault = _isV4(json, k) ? _createV4(factory, code4, json, k) : factory.createVault(
                code,
                vm.parseJsonAddress(json, string.concat(k, ".token")),
                vm.parseJsonAddress(json, string.concat(k, ".pool")),
                vm.parseJsonAddress(json, string.concat(k, ".feed")),
                vm.parseJsonUint(json, string.concat(k, ".depositCapTokens"))
            );
            console.log(_isV4(json, k) ? "StockVaultV4" : "StockVault", vm.parseJsonString(json, string.concat(k, ".symbol")), vault);
        }
        if (d.params.rangeBps != DEFAULT_RANGE_BPS) {
            d.params.rangeBps = DEFAULT_RANGE_BPS;
            factory.setDefaults(d);
        }
        router = new UptickRouter(vm.envOr("ROUTER_SLIPPAGE_BPS", uint256(100)), IVaultRegistry(address(factory)));
        console.log("UptickRouter", address(router));
        if (owner != me) factory.transferOwnership(owner);
        vm.stopBroadcast();
    }

    function _isV4(string memory json, string memory k) private view returns (bool) {
        string memory vk = string.concat(k, ".venue");
        return vm.keyExistsJson(json, vk) && keccak256(bytes(vm.parseJsonString(json, vk))) == keccak256("v4");
    }

    function _createV4(VaultFactory factory, bytes memory code4, string memory json, string memory k)
        private
        returns (address vault)
    {
        address token = vm.parseJsonAddress(json, string.concat(k, ".token"));
        uint24 fee = uint24(vm.parseJsonUint(json, string.concat(k, ".feeTier")));
        int24 spacing = int24(int256(vm.parseJsonUint(json, string.concat(k, ".tickSpacing"))));
        address hooks = vm.parseJsonAddress(json, string.concat(k, ".hooks"));
        string memory pk = string.concat(k, ".poolId");
        if (vm.keyExistsJson(json, pk)) {
            bool s0 = token < USDG;
            bytes32 id = keccak256(abi.encode(s0 ? token : USDG, s0 ? USDG : token, fee, spacing, hooks));
            require(vm.parseJsonBytes32(json, pk) == id, "deploy list poolId does not match the pool key");
        }
        require(hooks == address(0) || factory.allowedHook(hooks), "hook is not on the factory allow-list");
        vault = factory.createVaultV4(
            code4,
            token,
            fee,
            spacing,
            hooks,
            vm.parseJsonAddress(json, string.concat(k, ".feed")),
            vm.parseJsonUint(json, string.concat(k, ".depositCapTokens"))
        );
    }

    /// @dev True on a local anvil node, which answers `anvil_nodeInfo`; a real RPC does not, and neither does a run
    /// with no fork. Virtual so the test can stand in for the node.
    function _isLocalFork() internal virtual returns (bool) {
        try vm.rpc("anvil_nodeInfo", "[]") returns (bytes memory) {
            return true;
        } catch {
            return false;
        }
    }
}
