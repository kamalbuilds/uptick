// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./Base.t.sol";
import {StockVault} from "../src/StockVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {UptickRouter, IStockVault, IVaultRegistry} from "../src/UptickRouter.sol";

/// @dev Drives the real vault on the real Robinhood Chain fork. USDG is dealt to the actors and the router swaps
/// against the same pool the vault uses. The oracle is the mocked Chainlink proxy from Base, pointed at the pool by
/// default; tests move it to sit inside the gate (slippage) or outside it (Unhealthy).
contract UptickRouterTest is Base {
    uint256 internal constant USDG_IN = 100e6;

    UptickRouter internal rt;
    VaultFactory internal factory;

    /// @dev The vault under test comes out of a VaultFactory, which is what the router trusts.
    function setUp() public override {
        super.setUp();
        bytes memory code = vm.getCode("StockVault.sol:StockVault");
        factory = new VaultFactory(
            address(this),
            keccak256(code),
            bytes32(0),
            address(0),
            VaultFactory.Defaults({
                usdg: USDG,
                positionManager: NPM,
                router: ROUTER,
                vaultOwner: owner,
                keeper: keeper,
                treasury: treasury,
                params: _defaultParams()
            })
        );
        vault = StockVault(factory.createVault(code, NVDA, POOL, FEED, 0));
        rt = new UptickRouter(100, IVaultRegistry(address(factory)));
    }

    // ---------------------------------------------------------------- helpers

    /// @dev Stock Token units the mocked feed price implies for `usdgIn`, matching StockVault._usdgToStock.
    function _impliedStock(uint256 usdgIn) internal view returns (uint256) {
        return usdgIn * 1e26 / (_feedPrice() * 1e6); // NVDA 18 decimals, feed 8, USDG 6
    }

    function _dealUsdg(address who, uint256 amount) internal {
        deal(USDG, who, amount);
        vm.prank(who);
        IERC20(USDG).approve(address(rt), type(uint256).max);
    }

    function _assertRouterEmpty() internal view {
        assertEq(IERC20(NVDA).balanceOf(address(rt)), 0, "no stock left in router");
        assertEq(IERC20(USDG).balanceOf(address(rt)), 0, "no usdg left in router");
        assertEq(IERC20(USDG).allowance(address(rt), ROUTER), 0, "usdg approval reset");
        assertEq(IERC20(NVDA).allowance(address(rt), address(vault)), 0, "stock approval reset");
    }

    // ------------------------------------------------------------- depositUsdg

    /// @dev A USDG deposit mints shares worth about the same as depositing the oracle-implied stock directly, and
    /// leaves the router with no balances and no allowances.
    function test_depositUsdgMintsSharesNearDirectDeposit() public {
        _dealUsdg(alice, USDG_IN);
        uint256 sharesRef = vault.previewDeposit(_impliedStock(USDG_IN));

        vm.prank(alice);
        uint256 shares = rt.depositUsdg(IStockVault(address(vault)), USDG_IN, 0, alice);

        assertGt(shares, 0, "shares minted");
        assertEq(vault.balanceOf(alice), shares, "shares to alice");
        assertEq(IERC20(USDG).balanceOf(alice), 0, "usdg fully spent");
        _assertClose(shares, sharesRef, 100, "shares within 1% of a direct deposit");
        _assertRouterEmpty();
    }

    /// @dev minShares above what the deposit yields reverts the whole call.
    function test_depositUsdgRevertsBelowMinShares() public {
        _dealUsdg(alice, USDG_IN);

        vm.prank(alice);
        vm.expectPartialRevert(UptickRouter.InsufficientShares.selector);
        rt.depositUsdg(IStockVault(address(vault)), USDG_IN, type(uint256).max, alice);
    }

    /// @dev A stale feed closes the gate: depositUsdg reverts Unhealthy(FeedStale).
    function test_depositUsdgRevertsOnStaleFeed() public {
        _dealUsdg(alice, USDG_IN);
        vm.warp(block.timestamp + _defaultParams().maxStaleness + 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UptickRouter.Unhealthy.selector, IStockVault.Status.FeedStale));
        rt.depositUsdg(IStockVault(address(vault)), USDG_IN, 0, alice);
    }

    /// @dev A feed far from the pool closes the gate: depositUsdg reverts Unhealthy, this time TwapDeviates.
    function test_depositUsdgRevertsWhenOracleDeviates() public {
        _dealUsdg(alice, USDG_IN);
        _setFeed(_poolPrice() * 12 / 10); // 20% above the pool, well past the 100 bps gate

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UptickRouter.Unhealthy.selector, IStockVault.Status.TwapDeviates));
        rt.depositUsdg(IStockVault(address(vault)), USDG_IN, 0, alice);
    }

    /// @dev With a tight tolerance, a pool that sits inside the oracle gate (so health stays Ok) but below the feed
    /// still fails the swap's minimum output. The gate and the slippage floor are separate guards.
    function test_depositUsdgRevertsOnPoolSlippage() public {
        UptickRouter tight = new UptickRouter(10, IVaultRegistry(address(factory))); // 0.10%
        deal(USDG, alice, USDG_IN);
        vm.prank(alice);
        IERC20(USDG).approve(address(tight), type(uint256).max);

        _setFeed(_poolPrice() * 9950 / 10000); // 50 bps below the pool, inside the gate
        (StockVault.Status status,,,,,) = vault.health();
        assertEq(uint256(status), uint256(IStockVault.Status.Ok), "gate still open at 50 bps");

        vm.prank(alice);
        vm.expectRevert();
        tight.depositUsdg(IStockVault(address(vault)), USDG_IN, 0, alice);
    }

    // --------------------------------------------------------- redeemInKindMin

    /// @dev A holder exits entirely in kind through the router: both legs are delivered to the receiver, the minimums
    /// are enforced and the router ends empty.
    function test_redeemInKindMinDeliversBothLegs() public {
        _instant();
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(alice);
        IERC20(address(vault)).approve(address(rt), shares);

        // an unmeetable minimum reverts
        vm.prank(alice);
        vm.expectPartialRevert(UptickRouter.MinUsdgOut.selector);
        rt.redeemInKindMin(IStockVault(address(vault)), shares, 0, type(uint256).max, alice);

        uint256 s0 = IERC20(NVDA).balanceOf(alice);
        uint256 u0 = IERC20(USDG).balanceOf(alice);
        vm.prank(alice);
        (uint256 stockOut, uint256 usdgOut) = rt.redeemInKindMin(IStockVault(address(vault)), shares, 0, 0, alice);

        assertGt(stockOut, 0, "stock leg delivered");
        assertGt(usdgOut, 0, "usdg leg delivered");
        assertEq(IERC20(NVDA).balanceOf(alice) - s0, stockOut, "stock received");
        assertEq(IERC20(USDG).balanceOf(alice) - u0, usdgOut, "usdg received");
        assertEq(vault.balanceOf(alice), 0, "shares burned");
        assertEq(IERC20(NVDA).balanceOf(address(rt)), 0, "no stock left in router");
        assertEq(IERC20(USDG).balanceOf(address(rt)), 0, "no usdg left in router");
    }

    // -------------------------------------------------------------- hygiene

    /// @dev Zero amount is rejected before any transfer.
    function test_depositUsdgRejectsZero() public {
        vm.prank(alice);
        vm.expectRevert(UptickRouter.ZeroAmount.selector);
        rt.depositUsdg(IStockVault(address(vault)), 0, 0, alice);
    }

    /// @dev A tolerance above 100% cannot be configured.
    function test_constructorRejectsBadSlippage() public {
        vm.expectRevert(UptickRouter.BadConfig.selector);
        new UptickRouter(10_001, IVaultRegistry(address(factory)));
    }

    function test_constructorRejectsZeroRegistry() public {
        vm.expectRevert(UptickRouter.BadConfig.selector);
        new UptickRouter(100, IVaultRegistry(address(0)));
    }

    // ------------------------------------------------------------ registry (L3)

    /// @dev A StockVault the factory did not deploy is refused on both entry points, before any transfer.
    function test_unregisteredVaultIsRefused() public {
        StockVault rogue = _deploy(_defaultParams());
        assertFalse(factory.isVault(address(rogue)), "setup: not registered");
        _dealUsdg(alice, USDG_IN);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UptickRouter.NotRegisteredVault.selector, address(rogue)));
        rt.depositUsdg(IStockVault(address(rogue)), USDG_IN, 0, alice);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UptickRouter.NotRegisteredVault.selector, address(rogue)));
        rt.redeemInKindMin(IStockVault(address(rogue)), 1, 0, 0, alice);
        assertEq(IERC20(USDG).balanceOf(alice), USDG_IN, "nothing was pulled");
    }

    /// @dev An address that is not a vault at all is refused the same way.
    function test_arbitraryAddressIsRefused() public {
        _dealUsdg(alice, USDG_IN);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UptickRouter.NotRegisteredVault.selector, stranger));
        rt.depositUsdg(IStockVault(stranger), USDG_IN, 0, alice);
    }

    /// @dev Stock Token stranded in the router is not swept into the next caller's deposit: the deposit is the swap
    /// output measured as a balance delta, and the stranded balance stays where it was.
    function test_strandedStockIsNotDeposited() public {
        deal(NVDA, address(rt), 5e18);
        _dealUsdg(alice, USDG_IN);
        uint256 sharesRef = vault.previewDeposit(_impliedStock(USDG_IN));

        vm.prank(alice);
        uint256 shares = rt.depositUsdg(IStockVault(address(vault)), USDG_IN, 0, alice);

        assertEq(IERC20(NVDA).balanceOf(address(rt)), 5e18, "stranded stock untouched");
        _assertClose(shares, sharesRef, 100, "shares are for the swap output only");
    }
}
