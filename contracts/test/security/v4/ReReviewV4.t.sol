// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {V4Fixture} from "../../v4/V4Fixture.sol";
import {StockVaultV4} from "../../../src/v4/StockVaultV4.sol";

/// @dev Re-review of the V4R-M1 fix (pendingFee0/1) on the live PLTR v4 pool.
contract ReReviewV4PltrTest is V4Fixture {
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

    function _staleFeed() internal {
        vm.mockCall(
            FEED(),
            abi.encodeWithSelector(bytes4(keccak256("latestRoundData()"))),
            abi.encode(feedRound, int256(_poolPrice()), vm.getBlockTimestamp() - 91_000, vm.getBlockTimestamp() - 91_000, feedRound)
        );
    }

    /// @dev Launch shape: one holder, the keeper opens the position (nothing to harvest, so the treasury holds no
    /// shares), the position earns fees, the weekend feed goes stale.
    function _launchThenStale() internal returns (uint256 shares) {
        return _launchThenStale(0);
    }

    function _launchThenStale(uint256 bobAmount) internal returns (uint256 shares) {
        shares = _deposit(alice, UNIT() * 2);
        if (bobAmount > 0) _deposit(bob, bobAmount);
        _advance(1 hours + 1);
        vm.prank(keeper);
        vault.rebalance();
        assertEq(vault.balanceOf(treasury), 0, "no harvest has minted the treasury anything yet");
        _volume(VOL() * 2, 3);
        _advance(600);
        _staleFeed();
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.FeedStale));
    }

    /// @notice V4R-RR-L1. Two closed-gate in-kind exits that empty the vault (the first sweeps the fees into pending,
    /// the second takes the holders' idle net of the per-leg rounded-down cut) leave gross a few wei below the cut that
    /// `_valuationAt` deducts from the combined value. `v.gross - cut` underflows: totalAssets, every preview, deposit,
    /// mint and the harvest that would clear `pending` all revert, until someone donates to the vault.
    function test_RR_emptiedVaultWithPendingCutDoesNotBrickNav() public {
        uint256 shares = _launchThenStale();
        vm.startPrank(alice);
        vault.redeemInKind(shares / 2, alice, alice); // sweeps every accrued fee into pending
        vault.redeemInKind(vault.balanceOf(alice), alice, alice); // the last holder leaves
        vm.stopPrank();
        assertEq(vault.totalSupply(), 0, "the vault is empty");
        emit log_named_uint("stock left in the vault (wei)", IERC20(STOCK()).balanceOf(address(vault)));
        emit log_named_uint("usdg left in the vault", IERC20(USDG).balanceOf(address(vault)));

        vm.clearMockedCalls();
        _setFeed(_poolPrice());
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.Ok), "the gate reopens");

        bool navOk;
        try vault.totalAssets() returns (uint256 ta) {
            navOk = true;
            emit log_named_uint("totalAssets", ta);
        } catch (bytes memory err) {
            emit log_named_bytes("totalAssets reverted", err);
        }
        _fund(bob, UNIT());
        bool depositOk;
        vm.prank(bob);
        try vault.deposit(UNIT(), bob) {
            depositOk = true;
        } catch (bytes memory err) {
            emit log_named_bytes("deposit reverted", err);
        }
        _advance(1 hours + 1);
        bool rebalanceOk;
        vm.prank(keeper);
        try vault.rebalance() {
            rebalanceOk = true;
        } catch (bytes memory err) {
            emit log_named_bytes("keeper rebalance (the harvest that clears pending) reverted", err);
        }
        emit log_named_uint("totalAssets ok", navOk ? 1 : 0);
        emit log_named_uint("deposit ok", depositOk ? 1 : 0);
        emit log_named_uint("rebalance ok", rebalanceOk ? 1 : 0);
        emit log_named_uint("treasury shares after the keeper harvest", vault.balanceOf(treasury));
        assertTrue(navOk && depositOk && rebalanceOk, "V4R-RR-L1: an emptied vault with a pending cut stays usable");
    }

    /// @notice The recovery: any account donating a few wei lifts gross above the cut.
    function test_RR_aDonationUnbricksTheEmptiedVault() public {
        uint256 shares = _launchThenStale();
        vm.startPrank(alice);
        vault.redeemInKind(shares / 2, alice, alice);
        vault.redeemInKind(vault.balanceOf(alice), alice, alice);
        vm.stopPrank();
        vm.clearMockedCalls();
        _setFeed(_poolPrice());
        deal(STOCK(), address(this), 1e12);
        IERC20(STOCK()).transfer(address(vault), 1e12);
        vault.totalAssets();
        _advance(1 hours + 1);
        vm.prank(keeper);
        vault.rebalance(); // harvests: the cut is minted to the treasury against the near-empty vault
        assertGt(vault.balanceOf(treasury), 0, "the treasury's cut is minted after the donation");
    }

    /// @notice Ordering around a pending cut: a depositor who enters after a closed-gate sweep and before the harvest
    /// buys at NAV net of the cut, the harvest then mints the cut without moving the share price, and the depositor's
    /// immediate in-kind round trip gains nothing.
    function test_RR_depositBetweenSweepAndHarvestGainsNothing() public {
        uint256 shares = _launchThenStale(UNIT()); // bob: a second holder so the vault stays non-empty
        vm.prank(alice);
        vault.redeemInKind(shares / 4, alice, alice); // sweep
        vm.clearMockedCalls();
        _setFeed(_poolPrice());
        uint256 pps0 = vault.convertToAssets(1e24);
        uint256 amt = UNIT() * 2;
        _fund(address(0xBEEF), amt);
        vm.prank(address(0xBEEF));
        uint256 got = vault.deposit(amt, address(0xBEEF));
        vm.roll(vm.getBlockNumber() + 1);
        uint256 pps1 = vault.convertToAssets(1e24);
        vm.prank(alice);
        vault.redeemInKind(1e12, alice, alice); // healthy: harvests the pending fees, mints the cut
        uint256 pps2 = vault.convertToAssets(1e24);
        assertGt(vault.balanceOf(treasury), 0, "the cut is minted");
        assertApproxEqRel(pps2, pps1, 1e13, "the harvest of a pending cut does not move the share price");
        assertGe(pps1, pps0, "a deposit does not dilute");
        vm.prank(address(0xBEEF));
        (uint256 s, uint256 u) = vault.redeemInKind(got, address(0xBEEF), address(0xBEEF));
        uint256 back = s + u * 1e20 / _poolPrice();
        emit log_named_decimal_uint("depositor round trip, PLTR out per PLTR in", back * 1e18 / amt, 18);
        assertLe(back, amt, "no gain from entering between the sweep and the harvest");
    }
}
