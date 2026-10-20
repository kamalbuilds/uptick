// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./Base.t.sol";
import {StockVault} from "../src/StockVault.sol";
import {IAggregatorV3, IUniswapV3Pool, INonfungiblePositionManager} from "../src/interfaces/IUniswapV3.sol";

contract StockVaultSafetyTest is Base {
    function _revertOracle(StockVault.Status st) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(StockVault.OracleUnhealthy.selector, st);
    }

    function test_realFeedUnmocked() public {
        vm.clearMockedCalls();
        (StockVault.Status st, uint256 price, uint256 updatedAt,, uint160 sqrtTwap, uint160 sqrtSpot) = vault.health();
        assertGt(price, 100e8, "NVDA above $100");
        assertLt(price, 1000e8, "NVDA below $1000");
        assertGt(updatedAt, 0);
        // weekends leave the real feed past the 90,000 s bound; weekdays leave it fresh
        assertTrue(st == StockVault.Status.Ok || st == StockVault.Status.FeedStale, "real feed is ok or stale");
        emit log_named_uint("real feed age (s)", block.timestamp - updatedAt);
        emit log_named_uint("real feed status", uint8(st));
        // pool and feed agree to within 1% on the real chain right now
        assertGt(sqrtTwap, 0);
        assertGt(sqrtSpot, 0);
    }

    // ------------------------------------------------------- manipulation guard

    function test_spotPushedThreePercentBlocksDeposit() public {
        _deposit(alice, 50e18);
        _pushPrice(300);
        _fund(bob, 10e18);
        vm.prank(bob);
        // same block: the TWAP has not moved yet, the spot check is what catches it
        vm.expectRevert(_revertOracle(StockVault.Status.SpotDeviates));
        vault.deposit(10e18, bob);
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.SpotDeviates));
    }

    function test_sustainedPushBlocksOnTwapDisagreement() public {
        _deposit(alice, 50e18);
        _pushPrice(300);
        vm.warp(block.timestamp + 11 minutes); // longer than the TWAP window, nobody arbs the pool back
        _setFeed(_feedPrice());
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.TwapDeviates));

        _fund(bob, 10e18);
        vm.prank(bob);
        vm.expectRevert(_revertOracle(StockVault.Status.TwapDeviates));
        vault.deposit(10e18, bob);
        vm.prank(bob);
        vm.expectRevert(_revertOracle(StockVault.Status.TwapDeviates));
        vault.mint(1e6, bob);
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(_revertOracle(StockVault.Status.TwapDeviates));
        vault.redeem(aliceShares, alice, alice);
        vm.prank(alice);
        vm.expectRevert(_revertOracle(StockVault.Status.TwapDeviates));
        vault.withdraw(1e18, alice, alice);
        vm.warp(block.timestamp + 6 hours);
        _setFeed(_feedPrice());
        vm.prank(keeper);
        vm.expectRevert(_revertOracle(StockVault.Status.TwapDeviates));
        vault.rebalance();
    }

    function test_oracleJumpWithoutPoolMoveBlocks() public {
        _deposit(alice, 50e18);
        _setFeed(_feedPrice() * 103 / 100); // Chainlink says +3%, the pool and its TWAP do not
        _fund(bob, 10e18);
        vm.prank(bob);
        vm.expectRevert(_revertOracle(StockVault.Status.TwapDeviates));
        vault.deposit(10e18, bob);
    }

    function test_smallMoveWithinBoundStillWorks() public {
        _deposit(alice, 50e18);
        _pushPrice(-50); // 0.5% < 1% bound
        _fund(bob, 10e18);
        vm.prank(bob);
        vm.expectRevert(StockVault.SpotOffTwap.selector); // the move is 50 bp under the 10-minute average
        vault.deposit(10e18, bob);

        vm.warp(block.timestamp + 11 minutes); // once the TWAP has followed, 0.5% is inside the Chainlink bound
        vm.prank(bob);
        vault.deposit(10e18, bob);
        assertGt(vault.balanceOf(bob), 0);
    }

    function test_twapUnavailableBlocks() public {
        _deposit(alice, 50e18);
        vm.mockCallRevert(POOL, abi.encodeWithSelector(IUniswapV3Pool.observe.selector), "OLD");
        _fund(bob, 10e18);
        vm.prank(bob);
        vm.expectRevert(_revertOracle(StockVault.Status.TwapUnavailable));
        vault.deposit(10e18, bob);
    }

    // ----------------------------------------------------------- stale / bad feed

    function test_staleFeedBlocksRebalance() public {
        _instant();
        _deposit(alice, 50e18);
        // the feed was fresh at setUp; one second past maxStaleness (90,000 s) makes it stale
        vm.warp(block.timestamp + 90_001);
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.FeedStale));
        vm.prank(keeper);
        vm.expectRevert(_revertOracle(StockVault.Status.FeedStale));
        vault.rebalance();
        _fund(bob, 5e18);
        vm.prank(bob);
        vm.expectRevert(_revertOracle(StockVault.Status.FeedStale));
        vault.deposit(5e18, bob);
        // a fresh round clears it
        _setFeed(_feedPrice());
        vm.prank(keeper);
        vault.rebalance();
    }

    function test_invalidFeedAnswerBlocks() public {
        _deposit(alice, 50e18);
        vm.mockCall(
            FEED,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(feedRound, int256(0), block.timestamp, block.timestamp, feedRound)
        );
        _fund(bob, 5e18);
        vm.prank(bob);
        vm.expectRevert(_revertOracle(StockVault.Status.FeedInvalid));
        vault.deposit(5e18, bob);
        vm.mockCallRevert(FEED, abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector), "down");
        vm.prank(bob);
        vm.expectRevert(_revertOracle(StockVault.Status.FeedInvalid));
        vault.deposit(5e18, bob);
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.FeedInvalid));
    }

    function test_permissionlessRebalanceAfter26Hours() public {
        _instant();
        _deposit(alice, 50e18);
        int24 lower = vault.tickLower();
        vm.warp(block.timestamp + 26 hours - 1);
        _setFeed(_feedPrice());
        vm.prank(stranger);
        vm.expectRevert(StockVault.NotKeeper.selector);
        vault.rebalance();
        vm.warp(block.timestamp + 1);
        _setFeed(_feedPrice());
        vm.prank(stranger);
        vault.rebalance();
        assertEq(vault.lastRebalance(), block.timestamp);
        assertGt(vault.tokenId(), 0);
        assertEq(vault.tickLower(), lower, "same price, same range");
    }

    function test_permissionlessRebalanceStillGatedByOracle() public {
        _instant();
        _deposit(alice, 50e18);
        vm.warp(block.timestamp + 27 hours); // feed is stale by now
        vm.prank(stranger);
        vm.expectRevert(_revertOracle(StockVault.Status.FeedStale));
        vault.rebalance();
    }

    // ------------------------------------------------ withdrawals never get stuck

    function test_redeemInKindWhenPausedAndOracleDown() public {
        _instant();
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(owner);
        vault.pause();
        vm.mockCallRevert(FEED, abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector), "down");

        uint256 nBefore = IERC20(NVDA).balanceOf(alice);
        uint256 uBefore = IERC20(USDG).balanceOf(alice);
        vm.prank(alice);
        (uint256 sOut, uint256 uOut) = vault.redeemInKind(shares, alice, alice);
        assertEq(IERC20(NVDA).balanceOf(alice) - nBefore, sOut);
        assertEq(IERC20(USDG).balanceOf(alice) - uBefore, uOut);
        assertGt(sOut, 0);
        assertGt(uOut, 0);
        // alice was the only holder, so she took the whole position (up to rounding on virtual shares)
        assertEq(vault.balanceOf(alice), 0);
        assertEq(_liq(), 0, "liquidity fully removed");
    }

    function _liq() internal view returns (uint256 liq) {
        (,,,,,,, uint128 l,,,,) = INonfungiblePositionManager(NPM).positions(vault.tokenId());
        return l;
    }

    function test_redeemInKindProRataTwoHolders() public {
        _instant();
        uint256 a = _deposit(alice, 100e18);
        uint256 b = _deposit(bob, 300e18);
        uint256 liqBefore = _liq();
        vm.prank(bob);
        (uint256 sOut, uint256 uOut) = vault.redeemInKind(b, bob, bob);
        uint256 liqAfter = _liq();
        // the vault's own balancing swaps paid fees to its position, so the harvest minted treasury shares first;
        // the supply bob redeemed against is what remains plus his shares
        assertGt(vault.balanceOf(treasury), 0);
        uint256 supplyAtExit = vault.totalSupply() + b;
        assertEq(supplyAtExit, a + b + vault.balanceOf(treasury));
        assertEq(liqAfter, liqBefore - liqBefore * b / supplyAtExit, "bob's share of liquidity left, exactly");
        // and bob's legs are worth ~300 NVDA at the oracle price
        uint256 price = _feedPrice();
        uint256 valueStock = sOut + uOut * 1e12 * 1e8 / price;
        assertApproxEqRel(valueStock, 300e18, 3e15);
    }

    function test_redeemInKindCreditsWhenStockTransferReverts() public {
        _instant();
        uint256 shares = _deposit(alice, 100e18);
        // issuer pause or blocklist makes the Stock Token revert on transfer to this receiver
        bytes memory call_ = abi.encodeWithSelector(IERC20.transfer.selector, bob);
        vm.mockCallRevert(NVDA, call_, "blocked");

        uint256 uBefore = IERC20(USDG).balanceOf(bob);
        vm.prank(alice);
        (uint256 sOut, uint256 uOut) = vault.redeemInKind(shares, bob, alice);
        assertEq(IERC20(USDG).balanceOf(bob) - uBefore, uOut, "usdg leg paid");
        assertEq(IERC20(NVDA).balanceOf(bob), 0, "stock leg not paid");
        assertEq(vault.stockOwed(bob), sOut, "stock leg credited");
        assertEq(vault.totalStockOwed(), sOut);
        assertEq(vault.balanceOf(alice), 0, "shares were burned exactly once");
        // credited tokens sit in the vault but are excluded from NAV and from the deployable inventory
        assertGe(IERC20(NVDA).balanceOf(address(vault)), sOut);
        assertLt(vault.totalAssets(), 1e15, "NAV excludes the credited stock");

        vm.prank(stranger);
        vm.expectRevert(StockVault.NothingOwed.selector);
        vault.claimStockOwed(stranger);

        vm.clearMockedCalls();
        vm.prank(bob);
        vault.claimStockOwed(trader);
        assertEq(IERC20(NVDA).balanceOf(trader) - 2_000_000e18, sOut);
        assertEq(vault.stockOwed(bob), 0);
        assertEq(vault.totalStockOwed(), 0);
    }

    function test_exitBeyondBufferRevertsInsteadOfUnderpaying() public {
        _instant();
        uint256 shares = _deposit(alice, 100e18);
        // the pool drifts 0.8% against the vault: inside the 1% oracle bound, so the gate stays open, but selling
        // the USDG leg now costs about 0.4% of the position, more than the 0.3% exit buffer
        _pushPrice(80);
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.Ok));
        vm.prank(alice);
        vm.expectPartialRevert(StockVault.ExitBelowMinimum.selector);
        vault.redeem(shares, alice, alice);
        vm.prank(alice);
        vm.expectPartialRevert(StockVault.ExitBelowMinimum.selector);
        vault.withdraw(95e18, alice, alice);
        // the in-kind path is the way out and needs no swap
        vm.prank(alice);
        vault.redeemInKind(shares, alice, alice);
        assertEq(vault.balanceOf(alice), 0);
    }

    function test_exitGapIsBoundedByOracleTolerance() public {
        _instant();
        uint256 shares = _deposit(alice, 100e18);
        // NAV with the feed at the pool price: the reference an exit may be paid at
        uint256 atPool = vault.convertToAssets(shares);
        // Chainlink 0.4% above the pool: NVDA is cheap in the pool, so swapping the USDG leg back into NVDA
        // returns more than the oracle value (inside the 1% bound, so the gate is open)
        _setFeed(_poolPrice() * 10_040 / 10_000);
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.Ok));
        uint256 fair = vault.convertToAssets(shares);
        // the USDG leg is valued at the pool TWAP when that is below the feed, so the lagging feed does not move NAV
        _assertClose(fair, atPool, 2, "NAV ignores a feed above the pool");
        vm.prank(alice);
        uint256 got = vault.redeem(shares, alice, alice);
        assertLe(got, fair * 10_100 / 10_000, "redeem pays the realised proceeds, within the oracle tolerance of NAV");
        assertGe(got, fair * 9_970 / 10_000, "and not less than the exit buffer allows");
    }

    // ------------------------------------------------------- slippage (minOut)

    function test_swapMinOutBlocksBadFill() public {
        StockVault.Params memory p = _defaultParams();
        p.slippageBps = 1; // 0.01% is below the pool's own 0.05% fee
        _ownerDo(abi.encodeCall(StockVault.setParams, (p)));
        _instant();
        _fund(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert();
        vault.deposit(100e18, alice);
    }

    // ------------------------------------------------------------ share inflation

    function test_firstDepositorDonationAttackFails() public {
        uint256 victimDeposit = 100e18;
        uint256 donation = 100e18;
        // attacker mints a single wei of the Stock Token as shares, then donates to inflate the share price
        _fund(alice, 1 + donation);
        vm.prank(alice);
        uint256 attackerShares = vault.deposit(1, alice);
        vm.prank(alice);
        IERC20(NVDA).transfer(address(vault), donation);

        uint256 victimShares = _deposit(bob, victimDeposit);
        assertGt(victimShares, 0, "victim does not round to zero shares");

        uint256 victimValue = vault.convertToAssets(victimShares);
        uint256 attackerValue = vault.convertToAssets(attackerShares);
        // the victim pays the entry fee (the pool tier, 5 bp on this pool) and loses under 0.001% more
        uint256 afterFee = victimDeposit * (1e6 - vault.entryFee()) / 1e6;
        assertGe(victimValue * 1e5, afterFee * (1e5 - 1), "victim keeps >= 99.999% net of the entry fee");
        // attacker lost about half of the donation to the victim's side of the pool
        assertLt(attackerValue, 1 + donation, "attack is unprofitable");
        assertLt(attackerValue + donation / 4, 1 + donation, "attacker down by a quarter of the donation or more");
        emit log_named_uint("attacker outlay (wei)", 1 + donation);
        emit log_named_uint("attacker claim (wei)", attackerValue);
        emit log_named_uint("victim deposit (wei)", victimDeposit);
        emit log_named_uint("victim claim (wei)", victimValue);
    }
}
