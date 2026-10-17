// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base} from "./Base.t.sol";
import {StockVault} from "../src/StockVault.sol";

contract StockVaultTest is Base {
    /// @dev EIP-170: the chain rejects deployments above 24,576 bytes of runtime code.
    function test_runtimeCodeFitsEip170() public view {
        assertLe(address(vault).code.length, 24_576);
        assertGt(address(vault).code.length, 20_000, "measuring the real contract");
    }

    // ------------------------------------------------------------- round trip

    function test_depositWithdrawRoundTrip_instantDeploy() public {
        _instant();
        uint256 amount = 100e18;
        uint256 shares = _deposit(alice, amount);
        assertGt(shares, 0);
        assertEq(vault.balanceOf(alice), shares);

        assertGt(vault.tokenId(), 0, "position opened");
        StockVault.PositionInfo memory info = vault.positionInfo();
        assertGt(info.liquidity, 0);
        assertGt(info.usdgAmount, 0, "usdg leg funded");
        assertGt(info.stockAmount, 0, "stock leg funded");
        assertTrue(info.inRange);

        // NAV right after deploy is within swap cost of the deposit
        _assertClose(vault.totalAssets(), amount, 30, "NAV after deploy");

        uint256 max = vault.maxRedeem(alice);
        assertEq(max, shares);
        uint256 floor_ = vault.previewRedeem(shares);
        uint256 balBefore = IERC20(NVDA).balanceOf(alice);
        vm.prank(alice);
        uint256 got = vault.redeem(shares, alice, alice);
        assertEq(IERC20(NVDA).balanceOf(alice) - balBefore, got);
        assertGe(got, floor_, "proceeds at least the preview floor");
        _assertClose(got, amount, 60, "round trip cost under 0.6%");
        assertEq(vault.balanceOf(alice), 0);
        emit log_named_uint("round trip: NVDA in (wei)", amount);
        emit log_named_uint("round trip: NVDA out (wei)", got);
    }

    function test_depositIdleThenRebalanceDeploys() public {
        uint256 amount = 50e18;
        _deposit(alice, amount);
        assertEq(vault.tokenId(), 0, "idle until rebalance");
        assertEq(vault.totalAssets(), amount);

        vm.warp(block.timestamp + 6 hours + 1);
        _setFeed(_feedPrice());
        vm.prank(keeper);
        vault.rebalance();
        assertGt(vault.tokenId(), 0);
        _assertClose(vault.totalAssets(), amount, 30, "NAV after first deploy");
    }

    function test_withdrawExactAssets() public {
        _instant();
        _deposit(alice, 80e18);
        uint256 want = 30e18;
        uint256 balBefore = IERC20(NVDA).balanceOf(alice);
        uint256 sharesBefore = vault.balanceOf(alice);
        uint256 fair = vault.convertToAssets(vault.previewWithdraw(want));
        vm.prank(alice);
        uint256 burned = vault.withdraw(want, alice, alice);
        assertEq(IERC20(NVDA).balanceOf(alice) - balBefore, want, "exactly the requested assets");
        assertEq(sharesBefore - vault.balanceOf(alice), burned);
        // overpays by at most the exit buffer
        assertLe(fair, want * 10_040 / 10_000);
        assertGe(fair, want);
    }

    function test_redeemOnBehalfNeedsAllowance() public {
        _instant();
        uint256 shares = _deposit(alice, 20e18);
        vm.prank(bob);
        vm.expectRevert();
        vault.redeem(shares, bob, alice);
        vm.prank(alice);
        vault.approve(bob, shares);
        vm.prank(bob);
        vault.redeem(shares, bob, alice);
        assertGt(IERC20(NVDA).balanceOf(bob), 19e18);
    }

    // ------------------------------------------------------- rebalance, price

    function test_rebalanceRecentresAfterRealPriceMove() public {
        _instant();
        _deposit(alice, 100e18);
        int24 oldLower = vault.tickLower();
        int24 oldUpper = vault.tickUpper();
        uint256 oldPrice = _feedPrice();

        // move the real pool 4% (NVDA up) and let the oracle follow
        int24 newTick = _pushPrice(400);
        vm.warp(block.timestamp + 12 minutes);
        uint256 newPrice = oldPrice * 10_400 / 10_000;
        _setFeed(newPrice);
        assertTrue(newTick < oldLower || newTick >= oldLower, "tick moved");

        vm.warp(block.timestamp + 6 hours);
        _setFeed(newPrice);
        vm.prank(keeper);
        vault.rebalance();

        int24 lower = vault.tickLower();
        int24 upper = vault.tickUpper();
        // NVDA is token1, so a higher USD price means lower ticks
        assertLt(lower, oldLower, "range moved with price");
        assertLt(upper, oldUpper);
        int24 spot = _spotTick();
        assertTrue(spot >= lower && spot < upper, "spot inside new range");
        // width ~ ln(1.05/0.95)/ln(1.0001) = 1001 ticks, snapped outward to spacing 10 (at most +20)
        int24 width = upper - lower;
        assertGe(width, 1000);
        assertLe(width, 1030);
        // centre within a tick spacing of the oracle price
        int24 mid = (lower + upper) / 2;
        assertLe(_abs(mid - spot), 40, "centred on price");
        StockVault.PositionInfo memory info = vault.positionInfo();
        assertTrue(info.inRange);
        assertEq(info.tickLower, lower);
        (int24 l, int24 u, uint256 pLo, uint256 pHi) = vault.currentRange();
        assertEq(l, lower);
        assertEq(u, upper);
        assertLt(pLo, newPrice);
        assertGt(pHi, newPrice);
        _assertClose(pLo, newPrice * 9_500 / 10_000, 40, "lower bound ~ -5%");
        _assertClose(pHi, newPrice * 10_500 / 10_000, 40, "upper bound ~ +5%");
    }

    /// @dev After a +8% move the old range holds only USDG and a -8% move leaves it holding only NVDA. A deposit
    /// with instantDeploy then needs a one-sided top-up: every idle NVDA (or USDG) is swapped across first.
    function test_instantDeployIntoOutOfRangePosition_up() public {
        _instant();
        _deposit(alice, 100e18);
        _pushPrice(800);
        vm.warp(block.timestamp + 12 minutes);
        _setFeed(_poolPrice());
        int24 spot = _spotTick();
        assertLt(spot, vault.tickLower(), "price moved above the range (NVDA is token1)");
        StockVault.PositionInfo memory before_ = vault.positionInfo();
        assertEq(before_.stockAmount, 0, "range holds only USDG");
        assertFalse(before_.inRange);

        uint256 navBefore = vault.totalAssets();
        _deposit(bob, 50e18);
        StockVault.PositionInfo memory after_ = vault.positionInfo();
        assertGt(after_.liquidity, before_.liquidity, "top-up added liquidity");
        assertEq(after_.stockAmount, 0);
        assertLe(IERC20(NVDA).balanceOf(address(vault)), 1e15, "NVDA fully swapped across");
        _assertClose(vault.totalAssets(), navBefore + 50e18, 60, "NAV grew by the deposit less swap cost");
    }

    function test_instantDeployIntoOutOfRangePosition_down() public {
        _instant();
        _deposit(alice, 100e18);
        _pushPrice(-800);
        vm.warp(block.timestamp + 12 minutes);
        _setFeed(_poolPrice());
        assertGt(_spotTick(), vault.tickUpper(), "price moved below the range");
        StockVault.PositionInfo memory before_ = vault.positionInfo();
        assertEq(before_.usdgAmount, 0, "range holds only NVDA");

        uint256 navBefore = vault.totalAssets();
        _deposit(bob, 50e18);
        StockVault.PositionInfo memory after_ = vault.positionInfo();
        assertGt(after_.liquidity, before_.liquidity);
        assertEq(after_.usdgAmount, 0);
        assertLe(IERC20(USDG).balanceOf(address(vault)), 1e3, "no idle USDG");
        // NVDA-only range accepts NVDA directly, so the deposit costs nothing
        _assertClose(vault.totalAssets(), navBefore + 50e18, 5, "NAV grew by the deposit");
    }

    /// @dev Found by the invariant run: dust swaps (a few raw units) return nothing because the pool rounds its fee
    /// up, which reverted repeated rebalances and tiny redeems.
    function test_repeatedRebalancesNeverRevert() public {
        _instant();
        _deposit(alice, 300e18);
        uint256 t = block.timestamp; // via-IR may reuse block.timestamp across loop iterations after a warp
        for (uint256 i; i < 6; ++i) {
            t += 6 hours + 1;
            vm.warp(t);
            _setFeed(_feedPrice());
            vm.prank(keeper);
            vault.rebalance();
        }
        assertGt(vault.tokenId(), 0);
        _assertClose(vault.totalAssets(), 300e18, 40, "six rebalances cost under 0.4% in total");
    }

    function test_tinyRedeemDoesNotRevert() public {
        _instant();
        uint256 shares = _deposit(alice, 100e18);
        uint256 before_ = IERC20(NVDA).balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares / 10_000_000, alice, alice); // 1e-7 of the position: its USDG leg is a few raw units
        assertGt(IERC20(NVDA).balanceOf(alice), before_);
        vm.prank(alice);
        vault.redeem(1, alice, alice); // one share unit
    }

    function test_rebalanceRespectsRoles() public {
        _instant();
        _deposit(alice, 50e18);
        vm.prank(keeper);
        vm.expectRevert(StockVault.TooSoon.selector);
        vault.rebalance();
        vm.prank(stranger);
        vm.expectRevert(StockVault.NotKeeper.selector);
        vault.rebalance();
        vm.warp(block.timestamp + 6 hours);
        _setFeed(_feedPrice());
        vm.prank(stranger);
        vm.expectRevert(StockVault.NotKeeper.selector);
        vault.rebalance();
        vm.prank(keeper);
        vault.rebalance();
    }

    // ---------------------------------------------------------- fees and math

    function test_noVolumeNoPerformanceFee() public {
        _instant();
        _deposit(alice, 100e18);
        uint256 supply = vault.totalSupply();
        vm.warp(block.timestamp + 6 hours);
        _setFeed(_feedPrice());
        vm.prank(keeper);
        vault.rebalance();
        assertEq(vault.balanceOf(treasury), 0, "fees are charged on trading fees only");
        assertEq(vault.totalSupply(), supply);
        (uint256 s, uint256 u,) = vault.feesEarnedLifetime();
        assertEq(s + u, 0);
    }

    function test_feeAccrualAndPerformanceFeeMath() public {
        _instant();
        _deposit(alice, 200e18);
        _volume(60_000e6, 12);

        vm.warp(block.timestamp + 6 hours);
        _setFeed(_feedPrice());
        StockVault.PositionInfo memory before_ = vault.positionInfo();
        assertGt(before_.uncollectedStock + before_.uncollectedUsdg, 0, "fees accrued in the pool");
        uint256 navBefore = vault.totalAssets();
        uint256 supplyBefore = vault.totalSupply();
        uint256 pricePerShareBefore = vault.pricePerShare();
        vm.recordLogs();
        vm.prank(keeper);
        vault.rebalance();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 f0;
        uint256 f1;
        uint256 feeValue;
        uint256 minted;
        bool seenFees;
        bool seenRebalanced;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == StockVault.FeesCollected.selector) {
                (f0, f1, feeValue, minted) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                seenFees = true;
            }
            if (logs[i].topics[0] == StockVault.Rebalanced.selector) {
                (,, uint256 e0, uint256 e1) = abi.decode(logs[i].data, (int24, int24, uint256, uint256));
                assertEq(e0, f0);
                assertEq(e1, f1);
                seenRebalanced = true;
            }
        }
        assertTrue(seenFees && seenRebalanced);
        assertGt(feeValue, 0);
        emit log_named_uint("fees collected, USD (whole)", _usd(feeValue));

        // the uncollected-fee view matched what was actually collected (USDG is token0, NVDA token1)
        (uint256 stockFees, uint256 usdgFees,) = vault.feesEarnedLifetime();
        assertEq(f0, usdgFees);
        assertEq(f1, stockFees);
        _assertClose(f0, before_.uncollectedUsdg, 5, "usdg fees equal the view");
        _assertClose(f1, before_.uncollectedStock, 5, "stock fees equal the view");

        // mint = floor((S + 1e6) * cut / (gross - cut + 1)), cut = 10% of fee value, gross = net + cut
        uint256 cut = feeValue * 1000 / 10_000;
        uint256 expected = (supplyBefore + 1e6) * cut / (navBefore + 1);
        assertEq(minted, expected, "minted shares match the dilution formula");
        assertEq(vault.balanceOf(treasury), minted);
        // treasury holds ~10% of the fee value
        _assertClose(vault.convertToAssets(minted), cut, 20, "treasury claim = 10% of trading fees");

        // minting at net price leaves the share price where it was (rebalance swap costs aside)
        _assertClose(vault.pricePerShare(), pricePerShareBefore, 15, "price per share unchanged by the fee mint");
    }

    function test_pricePerShareContinuousThroughHarvest() public {
        _instant();
        _deposit(alice, 200e18);
        _deposit(bob, 50e18);
        _volume(60_000e6, 10);
        uint256 pps = vault.pricePerShare();
        StockVault.PositionInfo memory info = vault.positionInfo();
        assertGt(info.uncollectedUsdg + info.uncollectedStock, 0);

        // a small redeem harvests first; the net valuation of uncollected fees must match what was collected
        uint256 shares = vault.balanceOf(bob) / 10;
        vm.prank(bob);
        vault.redeem(shares, bob, bob);
        _assertClose(vault.pricePerShare(), pps, 2, "NAV per share continuous through harvest");
        assertGt(vault.balanceOf(treasury), 0);
    }

    function test_lifetimeFeesAndViews() public {
        _instant();
        _deposit(alice, 100e18);
        _volume(40_000e6, 6);
        vm.warp(block.timestamp + 6 hours);
        _setFeed(_feedPrice());
        vm.prank(keeper);
        vault.rebalance();
        (uint256 s, uint256 u, uint256 usdVal) = vault.feesEarnedLifetime();
        assertGt(s + u, 0);
        assertGt(usdVal, 0);
        uint256 tv = vault.totalValueInUSDG();
        _assertClose(tv, _usd(100e18) * 1e6, 100, "total value in USDG ~ deposit value");
        assertGt(vault.pricePerShare(), 0);
    }

    // --------------------------------------------------------------- caps, admin

    function test_depositCapAndPause() public {
        vm.prank(owner);
        vault.setDepositCap(100e18);
        assertEq(vault.maxDeposit(alice), 100e18);
        _deposit(alice, 60e18);
        assertEq(vault.maxDeposit(alice), 40e18);
        _fund(bob, 50e18);
        vm.prank(bob);
        vm.expectRevert();
        vault.deposit(50e18, bob);

        vm.prank(owner);
        vault.pause();
        assertEq(vault.maxDeposit(alice), 0);
        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.deposit(10e18, bob);
        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.mint(1e6, bob);
        // withdrawals stay open
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);
    }

    function test_onlyOwnerAdminAndBounds() public {
        StockVault.Params memory p = _defaultParams();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.setParams(p);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.pause();
        vm.prank(owner);
        vm.expectRevert(StockVault.BadConfig.selector);
        vault.renounceOwnership();

        p.twapWindow = 599; // the TWAP must span at least 10 minutes
        vm.prank(owner);
        vm.expectRevert(StockVault.BadParams.selector);
        vault.setParams(p);
        p = _defaultParams();
        p.perfFeeBps = 2001;
        vm.prank(owner);
        vm.expectRevert(StockVault.BadParams.selector);
        vault.setParams(p);
        p = _defaultParams();
        p.maxDeviationBps = 501;
        vm.prank(owner);
        vm.expectRevert(StockVault.BadParams.selector);
        vault.setParams(p);
        p = _defaultParams();
        p.rangeBps = 300;
        vm.prank(owner);
        vault.setParams(p);
        (uint16 rb,,,,,,,) = vault.params();
        assertEq(rb, 300);
    }

    function _abs(int24 x) internal pure returns (int24) {
        return x < 0 ? -x : x;
    }
}
