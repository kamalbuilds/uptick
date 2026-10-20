// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "../Base.t.sol";
import {StockVault} from "../../src/StockVault.sol";

/// @dev Review 3 fixes (2026-10-20) on the NVDA / USDG 0.05% pool, real Stock Token, pool and position manager,
/// Chainlink mocked at the pool price. The review's own reproductions are in Review3.t.sol; these pin the fixes from
/// the other side: what now reverts, where the break-even sits, and what the vault no longer emits.
contract Round3Test is Base {
    function _vault150() internal {
        _setFeed(_poolPrice()); // a snapshot revert rewinds the clock under the mock's timestamp
        StockVault.Params memory p = _defaultParams();
        p.rangeBps = 150;
        vault = _deploy(p);
        _deposit(alice, 400e18);
        vm.warp(block.timestamp + 6 hours);
        _setFeed(_poolPrice());
        vm.prank(keeper);
        vault.rebalance();
        vm.warp(block.timestamp + 20 minutes);
        _setFeed(_poolPrice());
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), 0, "gate open at start");
    }

    function _inKindValue(address who, uint256 price) internal returns (uint256 v) {
        uint256 sh = vault.balanceOf(who);
        uint256 snap = vm.snapshotState();
        vm.prank(who);
        (uint256 s, uint256 u) = vault.redeemInKind(sh, who, who);
        v = s + u * 1e12 * 1e8 / price;
        vm.revertToState(snap);
    }

    // ------------------------------------------------------------------ H1: Chainlink floor on the deploy swap

    /// @dev Idle inventory a rebalance has to swap, the feed `gapBps` away from a pool that has not moved, the
    /// TWAP-to-Chainlink bound widened to 100 bp (queued) so that the swap floor, not the bound, is what answers.
    function _rebalanceWithFeedGap(bool feedAbove, uint256 gapBps) internal returns (bool ok) {
        _setFeed(_poolPrice());
        vault = _deploy(_defaultParams());
        _ownerDo(abi.encodeCall(StockVault.setTwapOracleBand, (uint16(100))));
        _deposit(alice, 460e18); // about $100K idle, all Stock Token: the rebalance sells half of it
        vm.warp(block.timestamp + 6 hours);
        uint256 p0 = _poolPrice();
        _setFeed(feedAbove ? p0 * (1e4 + gapBps) / 1e4 : p0 * (1e4 - gapBps) / 1e4);
        vm.prank(keeper);
        try vault.rebalance() {
            ok = true;
        } catch {}
    }

    /// The pool pays less for the Stock Token than the feed says by more than the floor allows: no fill. Control: the
    /// same inventory with the feed on the pool fills. A TWAP-only floor (the pool and its TWAP agree here) fills both.
    function test_R3_H1_sellSwapRevertsWhenPoolIsBelowTheFeed() public {
        uint256 snap = vm.snapshotState();
        assertTrue(_rebalanceWithFeedGap(true, 0), "control: feed on the pool fills");
        vm.revertToState(snap);
        assertFalse(_rebalanceWithFeedGap(true, 90), "feed 90 bp above the pool: the swap does not fill");
    }

    /// The mirror: the vault buys the Stock Token with idle USDG, the feed says it is worth less than the pool charges.
    function test_R3_H1_buySwapRevertsWhenPoolIsAboveTheFeed() public {
        uint256 snap = vm.snapshotState();
        assertTrue(_idleUsdgRebalance(0), "control: feed on the pool fills");
        vm.revertToState(snap);
        assertFalse(_idleUsdgRebalance(90), "feed 90 bp below the pool: the swap does not fill");
    }

    function _idleUsdgRebalance(uint256 gapBps) internal returns (bool ok) {
        _setFeed(_poolPrice());
        vault = _deploy(_defaultParams());
        _ownerDo(abi.encodeCall(StockVault.setTwapOracleBand, (uint16(100))));
        deal(USDG, address(vault), 100_000e6); // a donated USDG balance: the rebalance buys Stock Token with half of it
        vm.warp(block.timestamp + 6 hours);
        uint256 p0 = _poolPrice();
        _setFeed(p0 * (1e4 - gapBps) / 1e4);
        vm.prank(keeper);
        try vault.rebalance() {
            ok = true;
        } catch {}
    }

    // ------------------------------------------------------------------ M1: entry fee against an off-chain move

    /// Bob deposits 400 NVDA into a 400 NVDA vault while feed, TWAP and pool still show the price from before a
    /// real `moveBps` fall, and exits in kind the next block. Returns his gain in NVDA wei at the new price.
    function _offChainRoundTrip(uint256 moveBps) internal returns (int256 gain) {
        _vault150();
        uint256 p1 = _feedPrice() * (1e4 - moveBps) / 1e4;
        uint256 sh = _deposit(bob, 400e18);
        vm.prank(bob);
        (uint256 s, uint256 u) = vault.redeemInKind(sh, bob, bob);
        gain = int256(s + u * 1e12 * 1e8 / p1) - int256(400e18);
    }

    /// Break-even at fee = move x USDG share (about one half): 35 bp covers a 60 bp move and loses to a 100 bp move.
    /// The second half is what keeps the first half honest: the check goes red when the move outgrows the fee.
    function test_R3_M1_breakEvenIsWhereTheFeeSays() public {
        uint256 snap = vm.snapshotState();
        int256 g60 = _offChainRoundTrip(60);
        vm.revertToState(snap);
        int256 g100 = _offChainRoundTrip(100);
        emit log_named_int("bob gain at a 60 bp move, NVDA wei", g60);
        emit log_named_int("bob gain at a 100 bp move, NVDA wei", g100);
        assertLe(g60, 0, "35 bp entry fee covers a 60 bp off-chain move");
        assertGt(g100, 0, "a move twice the fee over the USDG share pays: the break-even is real");
    }

    // ------------------------------------------------------------------ I3: no duplicate events

    function test_R3_depositAndWithdrawEmitOnlyTheErc4626Events() public {
        _vault150();
        _fund(bob, 10e18);
        vm.recordLogs();
        vm.prank(bob);
        uint256 sh = vault.deposit(10e18, bob);
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(block.timestamp + 11 minutes);
        _setFeed(_poolPrice());
        vm.prank(bob);
        vault.redeem(sh, bob, bob);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 deposit = keccak256("Deposit(address,address,uint256,uint256)");
        bytes32 withdraw = keccak256("Withdraw(address,address,address,uint256,uint256)");
        bytes32 deposited = keccak256("Deposited(address,address,uint256,uint256,bool)");
        bytes32 withdrawn = keccak256("Withdrawn(address,address,address,uint256,uint256)");
        uint256 nDeposit;
        uint256 nWithdraw;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(vault)) continue;
            assertTrue(logs[i].topics[0] != deposited && logs[i].topics[0] != withdrawn, "duplicate event");
            if (logs[i].topics[0] == deposit) ++nDeposit;
            if (logs[i].topics[0] == withdraw) ++nWithdraw;
        }
        assertEq(nDeposit, 1, "one Deposit");
        assertEq(nWithdraw, 1, "one Withdraw");
    }

    // ------------------------------------------------------------------ I1: the withdraw refund and the block lock

    /// withdraw mints the unspent exit buffer back as shares; they are minted in this block, so they are locked in it.
    /// A whole-balance redeem right after reverts SharesLocked, the next block it goes through.
    function test_R3_withdrawRefundSharesAreLockedForTheBlock() public {
        _vault150();
        vm.warp(block.timestamp + 11 minutes);
        _setFeed(_poolPrice());
        uint256 sh = vault.balanceOf(alice);
        uint256 w = vault.previewRedeem(sh) / 10;
        vm.prank(alice);
        vault.withdraw(w, alice, alice);
        uint256 left = vault.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(StockVault.SharesLocked.selector);
        vault.redeem(left, alice, alice);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        assertGt(vault.redeem(left, alice, alice), 0);
    }
}
