// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {V4Fixture} from "./V4Fixture.sol";
import {StockVault} from "../../src/StockVault.sol";
import {StockVaultV4} from "../../src/v4/StockVaultV4.sol";
import {VaultFactory} from "../../src/VaultFactory.sol";
import {UptickRouter, IVaultRegistry, IStockVault} from "../../src/UptickRouter.sol";

/// @dev The v4 vault inside the registry the router trusts: VaultFactory.createVaultV4 against the real PoolManager,
/// and UptickRouter.depositUsdgV4 / redeemInKindMin on a registered v4 vault, with the unregistered and
/// off-floor cases refused. Same fork and cheatcode rules as V4Fixture.
abstract contract V4RegistrySuite is V4Fixture {
    address internal constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address internal constant V3_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;

    VaultFactory internal factory;
    UptickRouter internal router;
    StockVaultV4 internal direct; // deployed straight from its constructor: not in any registry
    bytes internal code3;
    bytes internal code4;
    address internal factoryOwner = makeAddr("factoryOwner");

    function setUp() public override {
        super.setUp();
        direct = vault;
        code3 = vm.getCode("StockVault.sol:StockVault");
        code4 = vm.getCode("StockVaultV4.sol:StockVaultV4");
        factory = new VaultFactory(factoryOwner, keccak256(code3), keccak256(code4), address(PM), _factoryDefaults());
        vm.prank(factoryOwner);
        vault = StockVaultV4(factory.createVaultV4(code4, STOCK(), FEE(), SPACING(), address(0), FEED(), 0));
        _seed(); // the registry's vault needs its own observations
        router = new UptickRouter(100, IVaultRegistry(address(factory)));
        deal(USDG, alice, 1_000_000e6);
        vm.prank(alice);
        IERC20(USDG).approve(address(router), type(uint256).max);
    }

    function _factoryDefaults() internal view returns (VaultFactory.Defaults memory) {
        return VaultFactory.Defaults({
            usdg: USDG,
            positionManager: NPM,
            router: V3_ROUTER,
            vaultOwner: owner,
            keeper: keeper,
            treasury: treasury,
            params: StockVault.Params({
                rangeBps: 500,
                perfFeeBps: 1000,
                maxDeviationBps: 100,
                slippageBps: 100,
                exitBufferBps: 30,
                maxStaleness: 90_000,
                twapWindow: 600,
                minRebalanceInterval: 1 hours
            })
        });
    }

    // ---------------------------------------------------------------- factory

    function test_factoryRegistersTheV4Vault() public view {
        assertTrue(factory.isVault(address(vault)), "the one registry covers both vault types");
        assertEq(factory.vaultOfV4(STOCK(), vault.poolId()), address(vault));
        assertEq(factory.vaultCountV4(), 1);
        assertEq(factory.vaultCount(), 0, "the v3 registry is untouched");
        VaultFactory.EntryV4 memory e = factory.entryAtV4(0);
        assertEq(e.stock, STOCK());
        assertEq(e.poolId, vault.poolId());
        assertEq(e.vault, address(vault));
        assertEq(e.feed, FEED());
        assertEq(e.feeTier, FEE());
        assertEq(factory.entriesV4(0, 10).length, 1);
        assertEq(factory.entriesV4(1, 10).length, 0);
        assertEq(factory.vaultsOfStock(STOCK())[0], address(vault));
        // the vault the factory built holds the defaults and the right pool
        assertEq(vault.owner(), owner);
        assertEq(vault.keeper(), keeper);
        assertEq(address(vault.poolManager()), address(PM));
        assertFalse(factory.isVault(address(direct)), "a vault built by hand is not registered");
    }

    function test_factoryEmitsTheCreationEvent() public {
        VaultFactory f2 = new VaultFactory(factoryOwner, keccak256(code3), keccak256(code4), address(PM), _factoryDefaults());
        vm.recordLogs();
        vm.prank(factoryOwner);
        address v = f2.createVaultV4(code4, STOCK(), FEE(), SPACING(), address(0), FEED(), 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("VaultCreatedV4(address,bytes32,address,address,uint24,uint256)");
        uint256 seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(f2) || logs[i].topics[0] != sig) continue;
            ++seen;
            assertEq(address(uint160(uint256(logs[i].topics[1]))), STOCK());
            assertEq(logs[i].topics[2], StockVaultV4(v).poolId());
            assertEq(address(uint160(uint256(logs[i].topics[3]))), v);
            (address feed_, uint24 feeTier, uint256 index) = abi.decode(logs[i].data, (address, uint24, uint256));
            assertEq(feed_, FEED());
            assertEq(feeTier, FEE());
            assertEq(index, 0);
        }
        assertEq(seen, 1, "exactly one VaultCreatedV4");
    }

    function test_createV4RefusesWrongCodeDuplicateAndStrangers() public {
        vm.startPrank(factoryOwner);
        vm.expectRevert(VaultFactory.WrongCreationCode.selector);
        factory.createVaultV4(code3, STOCK(), FEE(), SPACING(), address(0), FEED(), 0);
        vm.expectRevert(abi.encodeWithSelector(VaultFactory.VaultExists.selector, address(vault)));
        factory.createVaultV4(code4, STOCK(), FEE(), SPACING(), address(0), FEED(), 0);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        factory.createVaultV4(code4, STOCK(), FEE(), SPACING(), address(0), FEED(), 0);
    }

    function test_createV4RefusesAFeedOfAnotherTicker() public {
        address otherFeed = STOCK() == 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A
            ? 0x4A1166a659A55625345e9515b32adECea5547C38
            : 0x820ABedFF239034956B7A9d2F0a331f9F075eB4c;
        // another fee tier, so the (stock, pool) key is new and only the feed is wrong; the feed check runs before the
        // vault is built, so the pool need not exist for it to trip
        vm.prank(factoryOwner);
        vm.expectRevert(abi.encodeWithSelector(VaultFactory.BadFeed.selector, otherFeed));
        factory.createVaultV4(code4, STOCK(), 500, 10, address(0), otherFeed, 0);
    }

    function test_createV4RefusesADynamicFeePoolAndForbiddenHooks() public {
        vm.startPrank(factoryOwner);
        vm.expectRevert(StockVaultV4.DynamicFeePool.selector);
        factory.createVaultV4(code4, STOCK(), 0x800000, 60, address(0), FEED(), 0);
        // a hook must be on the allow-list ...
        address hook = address(uint160((uint256(0xAB) << 152) | (1 << 13)));
        vm.expectRevert(abi.encodeWithSelector(VaultFactory.HookNotAllowed.selector, hook));
        factory.createVaultV4(code4, STOCK(), FEE(), SPACING(), hook, FEED(), 0);
        // ... and an allow-listed hook is still refused by the vault when its permissions can take value
        address taker = address(uint160((uint256(0xAB) << 152) | (1 << 2)));
        factory.setHookAllowed(taker, true);
        vm.expectRevert(StockVaultV4.ForbiddenHook.selector);
        factory.createVaultV4(code4, STOCK(), FEE(), SPACING(), taker, FEED(), 0);
        // an allow-listed hook with an initialize callback only passes both checks and then finds no such pool
        address swapper = address(uint160((uint256(0xAC) << 152) | (1 << 7)));
        factory.setHookAllowed(swapper, true);
        vm.expectRevert(StockVaultV4.ForbiddenHook.selector); // a swap hook can sandwich the vault inside its own swap
        factory.createVaultV4(code4, STOCK(), FEE(), SPACING(), swapper, FEED(), 0);
        factory.setHookAllowed(hook, true);
        vm.expectRevert(StockVaultV4.PoolNotInitialised.selector);
        factory.createVaultV4(code4, STOCK(), FEE(), SPACING(), hook, FEED(), 0);
        vm.stopPrank();
    }

    function test_theHookAllowListIsOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        factory.setHookAllowed(address(0x1234), true);
    }

    function test_aFactoryWithoutAV4HashCreatesNoV4Vault() public {
        VaultFactory v3only = new VaultFactory(factoryOwner, keccak256(code3), bytes32(0), address(0), _factoryDefaults());
        vm.prank(factoryOwner);
        vm.expectRevert(VaultFactory.V4Disabled.selector);
        v3only.createVaultV4(code4, STOCK(), FEE(), SPACING(), address(0), FEED(), 0);
    }

    // ---------------------------------------------------------------- router

    function _ownerSetParams(StockVaultV4.Params memory p) internal {
        _ownerDo(abi.encodeCall(StockVaultV4.setParams, (p)));
    }

    function test_routerZapsUsdgIntoARegisteredV4Vault() public {
        _instant();
        uint256 usdgIn = _usdgFor(UNIT());
        uint256 aliceUsdg = IERC20(USDG).balanceOf(alice);
        uint256 expectShares = vault.previewDeposit(UNIT()); // about what the swap delivers
        vm.prank(alice);
        uint256 shares = router.depositUsdgV4(IStockVault(address(vault)), usdgIn, 1, alice);
        assertGt(shares, 0);
        assertEq(vault.balanceOf(alice), shares);
        assertEq(aliceUsdg - IERC20(USDG).balanceOf(alice), usdgIn, "the caller paid exactly the input");
        assertLt(shares, expectShares * 101 / 100, "no more than the Stock Token the same dollars buy");
        assertGt(shares, expectShares * 90 / 100);
        assertTrue(vault.positionOpen(), "instantDeploy opened the position");
        // the router holds nothing and approves nothing
        assertEq(IERC20(USDG).balanceOf(address(router)), 0);
        assertEq(IERC20(STOCK()).balanceOf(address(router)), 0);
        assertEq(IERC20(STOCK()).allowance(address(router), address(vault)), 0);
    }

    function test_routerEnforcesMinShares() public {
        uint256 usdgIn = _usdgFor(UNIT());
        vm.prank(alice);
        vm.expectPartialRevert(UptickRouter.InsufficientShares.selector);
        router.depositUsdgV4(IStockVault(address(vault)), usdgIn, type(uint256).max, alice);
    }

    function test_routerRefusesAVaultTheFactoryDidNotDeploy() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UptickRouter.NotRegisteredVault.selector, address(direct)));
        router.depositUsdgV4(IStockVault(address(direct)), 1000e6, 0, alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UptickRouter.NotRegisteredVault.selector, address(direct)));
        router.redeemInKindMin(IStockVault(address(direct)), 1, 0, 0, alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UptickRouter.NotRegisteredVault.selector, address(0xBEEF)));
        router.depositUsdgV4(IStockVault(address(0xBEEF)), 1000e6, 0, alice);
    }

    function test_routerRefusesWhenTheVaultGateIsNotOk() public {
        vm.warp(vm.getBlockTimestamp() + 3 minutes); // the observation ring is stale
        _setFeed(_poolPrice());
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UptickRouter.Unhealthy.selector, IStockVault.Status.TwapUnavailable));
        router.depositUsdgV4(IStockVault(address(vault)), 1000e6, 0, alice);
    }

    function test_routerSwapFloorFollowsChainlinkNotThePool() public {
        // widen the vault's gate so a 3% gap between feed and pool passes the health check and reaches the floor
        StockVaultV4.Params memory p = _defaultParams();
        p.maxDeviationBps = 500;
        _ownerSetParams(p);
        _setFeed(_poolPrice() * 97 / 100); // the feed says the stock is 3% cheaper than the pool sells it
        vm.warp(vm.getBlockTimestamp() + 60);
        _setFeed(_poolPrice() * 97 / 100);
        vault.poke();
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.Ok));
        uint256 usdgIn = _usdgFor(UNIT() / 4);
        vm.prank(alice);
        vm.expectPartialRevert(UptickRouter.MinStockOut.selector);
        router.depositUsdgV4(IStockVault(address(vault)), usdgIn, 0, alice);
        // control: the feed back on the pool fills
        for (uint256 i; i < 13; ++i) {
            vm.warp(vm.getBlockTimestamp() + 60);
            _setFeed(_poolPrice());
            vault.poke();
        }
        vm.prank(alice);
        assertGt(router.depositUsdgV4(IStockVault(address(vault)), usdgIn, 0, alice), 0);
    }

    function test_routerRedeemsInKindFromAV4Vault() public {
        _instant();
        uint256 usdgIn = _usdgFor(UNIT()); // evaluated before the prank: reading the pool is an external call
        vm.prank(alice);
        uint256 shares = router.depositUsdgV4(IStockVault(address(vault)), usdgIn, 1, alice);
        vm.roll(block.number + 1);
        vm.prank(alice);
        vault.approve(address(router), shares);
        uint256 sBefore = IERC20(STOCK()).balanceOf(alice);
        uint256 uBefore = IERC20(USDG).balanceOf(alice);
        vm.prank(alice);
        (uint256 s, uint256 u) = router.redeemInKindMin(IStockVault(address(vault)), shares, 1, 1, alice);
        assertEq(IERC20(STOCK()).balanceOf(alice) - sBefore, s);
        assertEq(IERC20(USDG).balanceOf(alice) - uBefore, u);
        assertGt(s, 0);
        assertGt(u, 0);
        vm.prank(alice);
        vm.expectPartialRevert(UptickRouter.ZeroAmount.selector);
        router.redeemInKindMin(IStockVault(address(vault)), 0, 0, 0, alice);
    }

    function test_theRoutersUnlockCallbackIsClosedOutsideItsOwnSwap() public {
        vm.expectRevert(UptickRouter.NotPoolManager.selector);
        router.unlockCallback("");
        vm.prank(address(PM));
        vm.expectRevert(UptickRouter.NotPoolManager.selector);
        router.unlockCallback("");
    }

    function _usdgFor(uint256 stockAmt) internal view returns (uint256) {
        return stockAmt * _poolPrice() / 1e8 / 1e12;
    }
}

contract V4RegistryPltrTest is V4RegistrySuite {
    function STOCK() internal pure override returns (address) {
        return 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A;
    }

    function FEED() internal pure override returns (address) {
        return 0x820ABedFF239034956B7A9d2F0a331f9F075eB4c;
    }

    function FEE() internal pure override returns (uint24) {
        return 10_000;
    }

    function SPACING() internal pure override returns (int24) {
        return 200;
    }

}

contract V4RegistryTslaTest is V4RegistrySuite {
    function STOCK() internal pure override returns (address) {
        return 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    }

    function FEED() internal pure override returns (address) {
        return 0x4A1166a659A55625345e9515b32adECea5547C38;
    }

    function FEE() internal pure override returns (uint24) {
        return 3000;
    }

    function SPACING() internal pure override returns (int24) {
        return 60;
    }

}
