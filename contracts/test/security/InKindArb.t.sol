// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "../Base.t.sol";
import {StockVault} from "../../src/StockVault.sol";
import {ISwapRouter02} from "../../src/interfaces/IUniswapV3.sol";

/// @dev Security review 2026-10-20. Each test asserts the property that should hold; a red run is the finding.
/// The control tests run the same sequence without the adversarial step and must stay green.
contract InKindArbTest is Base {
    address mev = makeAddr("mev");
    uint256 constant TOL = 1e15; // 0.001 NVDA

    /// @dev Stock-unit value of (stock, usdg) at `price` (8 decimals).
    function _at(uint256 s, uint256 u, uint256 price) internal pure returns (uint256) {
        return s + u * 1e12 * 1e8 / price;
    }

    /// @dev Alice's in-kind exit value at `price`, measured on a throwaway snapshot.
    function _aliceExit(uint256 price) internal returns (uint256 v) {
        uint256 snap = vm.snapshotState();
        uint256 sh = vault.balanceOf(alice);
        vm.prank(alice);
        (uint256 s, uint256 u) = vault.redeemInKind(sh, alice, alice);
        v = _at(s, u, price);
        vm.revertToState(snap);
    }

    /// @dev Alice deposits, the keeper deploys, the TWAP settles on the post-deploy pool, the feed agrees with it.
    function _deployedVault() internal {
        _deposit(alice, 400e18);
        vm.warp(block.timestamp + 6 hours);
        _setFeed(_poolPrice());
        vm.prank(keeper);
        vault.rebalance();
        vm.warp(block.timestamp + 20 minutes);
        _setFeed(_poolPrice());
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.Ok), "gate open at start");
    }

    function _bobRoundTrip(uint256 amount, uint256 price) internal returns (uint256 valueOut) {
        uint256 sh = _deposit(bob, amount);
        vm.prank(bob);
        (uint256 s, uint256 u) = vault.redeemInKind(sh, bob, bob);
        valueOut = _at(s, u, price);
    }

    function _m1(int256 moveBps) internal {
        _deployedVault();
        if (moveBps != 0) _pushPrice(moveBps); // a real seller, not bob
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.Ok), "gate open after the move");
        uint256 px = _poolPrice(); // the market after the move; bob's round trip does not swap, so it holds
        uint256 aliceBefore = _aliceExit(px);
        uint256 out = _bobRoundTrip(400e18, px);
        uint256 aliceAfter = _aliceExit(px);
        emit log_named_int("bob pnl, NVDA wei at market", int256(out) - int256(400e18));
        emit log_named_int("alice pnl, NVDA wei at market", int256(aliceAfter) - int256(aliceBefore));
        assertLe(out, 400e18 + TOL, "deposit -> redeemInKind round trip is profitable");
        assertGe(aliceAfter + TOL, aliceBefore, "remaining holder diluted by the round trip");
    }

    /// M1 control: no move, the fee-free round trip is value-neutral. Must be green.
    function test_M1_control_noMove() public {
        _m1(0);
    }

    /// M1: the market drops 0.9% (inside the 1% gate) and the TWAP has not caught up (10-minute window), Chainlink
    /// has not printed (0.5% deviation trigger, or off-hours). _navPrice = min(feed, TWAP) sat above the market, so
    /// deposit -> redeemInKind sold NVDA to the vault's USDG leg at the stale price, fee-free and atomically. Now the
    /// deposit is refused: spot is 90 bp from the TWAP, past the 10 bp band.
    function test_M1_inKindRoundTripAfterDrop() public {
        _deployedVault();
        _pushPrice(-90);
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.Ok), "the Chainlink gate is still open: the band is what closes it");
        _fund(bob, 400e18);
        vm.prank(bob);
        vm.expectRevert(StockVault.SpotOffTwap.selector);
        vault.deposit(400e18, bob);
    }

    /// M1 inside the band: a 9 bp drop passes the band, and the deposit is priced at the lowest of feed, TWAP and
    /// spot, so the round trip is neutral. Without the spot term the stale TWAP and feed leave about 0.08 NVDA on
    /// the table here (0.844 at 90 bp), far above TOL.
    function test_M1_roundTripAfterDropInsideBandIsNeutral() public {
        _m1(-9);
    }

    // ----------------------------------------------------------------- M2

    function _swapToSqrt(uint160 target) internal {
        uint160 cur = _spotSqrt();
        if (cur == target) return;
        bool sellNvda = target > cur; // NVDA is token1: selling it raises sqrtPrice
        vm.prank(mev);
        ISwapRouter02(ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(
                sellNvda ? NVDA : USDG, sellNvda ? USDG : NVDA, 500, mev, sellNvda ? 900_000e18 : 150_000_000e6, 0, target
            )
        );
    }

    /// @dev Once 26 h have passed since the last rebalance (every Monday, after the weekend feed silence keeps the
    /// keeper out), anyone can in one transaction: optionally push spot, deposit, call rebalance() so the vault
    /// swaps the deposit's share of inventory at that spot, restore spot, exit in kind. Returns the attacker's and
    /// Alice's profit and loss in NVDA at the pre-attack price. `exitNextBlock` rolls one block before the exit.
    function _m2Setup() internal returns (uint256 p0, uint160 sqrt0) {
        _deployedVault();
        vm.warp(block.timestamp + 26 hours);
        p0 = _poolPrice();
        _setFeed(p0);
        sqrt0 = _spotSqrt();

        deal(NVDA, mev, 1_000_000e18);
        deal(USDG, mev, 200_000_000e6);
        vm.startPrank(mev);
        IERC20(NVDA).approve(ROUTER, type(uint256).max);
        IERC20(USDG).approve(ROUTER, type(uint256).max);
        IERC20(NVDA).approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _push(int256 pushBps) internal {
        uint256 cur = _spotSqrt();
        uint256 denom = uint256(int256(1e4) + pushBps);
        _swapToSqrt(uint160(cur * Math_sqrt(uint256(1e4) * 1e36 / denom) / 1e18));
    }

    function _m2(int256 pushBps, uint256 amt, bool exitNextBlock) internal returns (int256 mevPnl, int256 alicePnl) {
        (uint256 p0, uint160 sqrt0) = _m2Setup();
        uint256 aliceBefore = _aliceExit(p0);
        uint256 start = _at(IERC20(NVDA).balanceOf(mev), IERC20(USDG).balanceOf(mev), p0);

        if (pushBps != 0) _push(pushBps);
        vm.startPrank(mev);
        uint256 sh = amt == 0 ? 0 : vault.deposit(amt, mev);
        vault.rebalance();
        vm.stopPrank();
        _swapToSqrt(sqrt0);
        if (exitNextBlock) vm.roll(vm.getBlockNumber() + 1);
        if (sh > 0) {
            vm.prank(mev);
            if (!exitNextBlock) vm.expectRevert(StockVault.SharesLocked.selector);
            vault.redeemInKind(sh, mev, mev);
        }

        uint256 end = _at(IERC20(NVDA).balanceOf(mev), IERC20(USDG).balanceOf(mev), p0);
        uint256 aliceAfter = _aliceExit(p0);
        mevPnl = int256(end) - int256(start);
        alicePnl = int256(aliceAfter) - int256(aliceBefore);
        emit log_named_int("mev pnl, NVDA wei at p0", mevPnl);
        emit log_named_int("alice pnl, NVDA wei at p0", alicePnl);
    }

    function Math_sqrt(uint256 x) internal pure returns (uint256 r) {
        if (x == 0) return 0;
        r = x;
        uint256 y = (x + 1) / 2;
        while (y < r) {
            r = y;
            y = (x / y + y) / 2;
        }
    }

    /// M2 control: the same permissionless rebalance with no attacker deposit. Must be green.
    function test_M2_control_rebalanceAlone() public {
        (, int256 alicePnl) = _m2(0, 0, false);
        assertGe(alicePnl + int256(TOL), 0, "remaining holder paid for the attacker's deploy");
    }

    /// M2 without the front-run: deposit, permissionless rebalance, restore spot, in-kind exit in the same block.
    /// The exit is refused: shares minted in a block cannot leave in it (the expectRevert inside _m2). Whole-sequence
    /// atomicity is gone: the attacker is left holding the shares, and the vault's cost of deploying them is shared
    /// with him from here on.
    function test_M2_depositRebalanceExit() public {
        _m2(0, 400e18, false);
        assertGt(vault.balanceOf(mev), 0, "the attacker still holds the shares");
    }

    /// M2 with a 60 bp front-run push inside the 1% gate: spot is 60 bp from the TWAP, past the 10 bp band, so
    /// the deposit and the permissionless rebalance are both refused.
    function test_M2_sandwichedPermissionlessRebalance() public {
        _m2Setup();
        _push(-60);
        vm.startPrank(mev);
        vm.expectRevert(StockVault.SpotOffTwap.selector);
        vault.deposit(400e18, mev);
        vm.expectRevert(StockVault.SpotOffTwap.selector);
        vault.rebalance();
        vm.stopPrank();
    }

    /// M2 through instantDeploy: the same push, but the deposit would deploy itself. It is refused before any swap:
    /// no trade at the pushed price, no position change.
    function test_M2_sandwichedInstantDepositIsRefused() public {
        _m2Setup();
        _instant();
        uint128 liqBefore = vault.positionInfo().liquidity;
        uint256 usdgBefore = IERC20(USDG).balanceOf(address(vault));
        _push(-60);
        vm.prank(mev);
        vm.expectRevert(StockVault.SpotOffTwap.selector);
        vault.deposit(400e18, mev);
        assertEq(vault.positionInfo().liquidity, liqBefore, "position untouched");
        assertEq(IERC20(USDG).balanceOf(address(vault)), usdgBefore, "no swap at the pushed price");
    }

    /// M2 across blocks, no push: the attacker holds the shares through the block boundary and exits in kind. He
    /// carries the price risk in between and bears his pro-rata share of the deploy cost, so the round trip does not
    /// pay.
    function test_M2_exitNextBlockDoesNotProfitTheDepositor() public {
        (int256 mevPnl,) = _m2(0, 400e18, true);
        assertLe(mevPnl, int256(TOL), "attacker profited");
    }

    /// M2 across blocks with the largest push the band allows (8 bp): the attacker pays the pool fee on the push,
    /// the vault's fill is at most 8 bp worse, and the extraction does not cover his cost.
    function test_M2_inBandPushAcrossBlocksIsUnprofitable() public {
        (int256 mevPnl,) = _m2(-8, 400e18, true);
        assertLe(mevPnl, int256(TOL), "attacker profited from an in-band push");
    }
}
