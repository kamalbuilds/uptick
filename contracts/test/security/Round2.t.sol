// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Base} from "../Base.t.sol";
import {StockVault} from "../../src/StockVault.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3.sol";

/// @dev Re-review 2026-10-20 fixes (N2, N3, N4 and the lows) on the NVDA / USDG 0.05% pool, real Stock Token, pool
/// and position manager, Chainlink mocked at the pool price. N1 (fee-aware floors on 0.3% and 1% pools) and the
/// router live in ReReviewFloor.t.sol and ReReview.t.sol, which fork the thin pools.
contract Round2Test is Base {
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

    function _executeReverts(bytes memory data, bytes4 err) internal {
        uint256 t0 = vm.getBlockTimestamp();
        vm.prank(owner);
        vault.queueChange(data);
        vm.warp(t0 + vault.CHANGE_DELAY());
        vm.prank(owner);
        vm.expectRevert(err);
        vault.executeChange(data);
        vm.prank(owner);
        vault.cancelChange(keccak256(data));
        vm.warp(t0);
    }

    // ------------------------------------------------------------------ N2: one-sided deposit band

    /// Spot 80 bp above the TWAP cannot make shares cheaper (the price used is the lowest of feed, TWAP and spot), so
    /// deposit and mint go through, at no more shares than before the push. 80 bp is also past the 10 bp band.
    function test_N2_depositAndMintAboveTwapPass() public {
        _deployedVault();
        _fund(bob, 40e18);
        uint256 baseline = vault.previewDeposit(10e18);
        _pushPrice(80);
        assertTrue(_bandOff(), "spot is past the band");
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), 0, "the Chainlink gate is still open");
        vm.startPrank(bob);
        uint256 shares = vault.deposit(10e18, bob);
        assertLe(shares, baseline, "shares are not cheaper than before the push");
        assertGt(shares, baseline * 99 / 100, "and not absurdly dearer");
        vm.roll(vm.getBlockNumber() + 1);
        uint256 cost = vault.mint(shares / 2, bob);
        vm.stopPrank();
        assertGt(cost, 0);
    }

    /// The same distance below the TWAP stays refused, for deposit and mint.
    function test_N2_depositAndMintBelowTwapRevert() public {
        _deployedVault();
        _fund(bob, 40e18);
        _pushPrice(-80);
        assertTrue(_bandOff(), "spot is past the band");
        vm.startPrank(bob);
        vm.expectRevert(StockVault.SpotOffTwap.selector);
        vault.deposit(10e18, bob);
        vm.expectRevert(StockVault.SpotOffTwap.selector);
        vault.mint(1e24, bob);
        vm.stopPrank();
    }

    function _bandOff() internal view returns (bool) {
        (,,,, uint160 twap, uint160 spot) = vault.health();
        uint256 pt = Math.mulDiv(twap, twap, 1 << 96);
        uint256 ps = Math.mulDiv(spot, spot, 1 << 96);
        (uint256 hi, uint256 lo) = ps > pt ? (ps, pt) : (pt, ps);
        return hi * 1e4 > lo * (1e4 + vault.maxSpotTwapBps());
    }

    // ------------------------------------------------------------------ N3: rebalance needs TWAP near Chainlink

    /// Spot and TWAP sit together, 70 bp under the feed: inside the 100 bp gate and the 10 bp band, so every path
    /// opens but the rebalance, which needs the TWAP within maxTwapOracleBps (60) of Chainlink.
    function test_N3_rebalanceRefusedWhenTwapFarFromFeed() public {
        assertEq(vault.maxTwapOracleBps(), 60, "default");
        _deployedVault();
        vm.warp(block.timestamp + 6 hours);
        _setFeed(_poolPrice() * 10_070 / 10_000);
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), 0, "gate open");
        assertFalse(_bandOff());
        vm.prank(keeper);
        vm.expectRevert(StockVault.TwapOffOracle.selector);
        vault.rebalance();
        vm.warp(block.timestamp + 26 hours);
        _setFeed(_poolPrice() * 10_070 / 10_000);
        vm.prank(stranger);
        vm.expectRevert(StockVault.TwapOffOracle.selector);
        vault.rebalance();
        // deposits are not held to it
        _fund(bob, 1e18);
        vm.prank(bob);
        vault.deposit(1e18, bob);
        // 50 bp is inside the bound
        _setFeed(_poolPrice() * 10_050 / 10_000);
        vm.prank(stranger);
        vault.rebalance();
    }

    function test_N3_boundIsQueuedAndRanged() public {
        _executeReverts(abi.encodeCall(StockVault.setTwapOracleBand, (9)), StockVault.BadParams.selector);
        _executeReverts(abi.encodeCall(StockVault.setTwapOracleBand, (501)), StockVault.BadParams.selector);
        vm.prank(owner);
        vm.expectRevert(StockVault.ChangeNotQueued.selector);
        vault.setTwapOracleBand(40);
        _deployedVault();
        _ownerDo(abi.encodeCall(StockVault.setTwapOracleBand, (40)));
        assertEq(vault.maxTwapOracleBps(), 40);
        vm.warp(block.timestamp + 6 hours);
        _setFeed(_poolPrice() * 10_050 / 10_000);
        vm.prank(keeper);
        vm.expectRevert(StockVault.TwapOffOracle.selector);
        vault.rebalance();
    }

    // ------------------------------------------------------------------ N4: entry fee

    function test_N4_defaultIsThePoolTier() public view {
        assertEq(vault.entryFee(), vault.poolFee());
        assertEq(vault.entryFee(), 500);
    }

    /// previewDeposit and previewMint are what deposit and mint then do, to the wei, at default and raised fee.
    function test_N4_previewsAreExact() public {
        _deployedVault();
        _fund(bob, 100e18);
        for (uint256 i; i < 2; ++i) {
            uint256 pd = vault.previewDeposit(10e18);
            vm.prank(bob);
            assertEq(vault.deposit(10e18, bob), pd, "deposit == previewDeposit");
            vm.roll(vm.getBlockNumber() + 1);
            uint256 pm = vault.previewMint(5e24);
            vm.prank(bob);
            assertEq(vault.mint(5e24, bob), pm, "mint == previewMint");
            vm.roll(vm.getBlockNumber() + 1);
            _ownerDo(abi.encodeCall(StockVault.setEntryFee, (uint24(4000))));
            assertEq(vault.entryFee(), 4000);
        }
    }

    /// The fee is retained: the vault gets every asset, shares are minted for the part net of the fee, so the
    /// holders who stay own the difference.
    function test_N4_feeStaysWithHolders() public {
        _deployedVault();
        uint256 aliceShares = vault.balanceOf(alice);
        uint256 aliceBefore = vault.convertToAssets(aliceShares);
        uint256 taBefore = vault.totalAssets();
        uint256 sharesBob = _deposit(bob, 100e18);
        assertApproxEqAbs(vault.totalAssets(), taBefore + 100e18, 1e12, "the vault holds all 100");
        uint256 bobValue = vault.convertToAssets(sharesBob);
        uint256 fee = 100e18 * uint256(vault.entryFee()) / 1e6;
        // bob pays the fee and owns taBefore-weighted nothing of it back except his own pro-rata part of the pot
        uint256 loss = fee * taBefore / (taBefore + 100e18);
        assertApproxEqAbs(100e18 - bobValue, loss, 2e15, "bob's claim is net of the fee");
        uint256 gain = vault.convertToAssets(aliceShares) - aliceBefore;
        assertApproxEqAbs(gain, 100e18 - bobValue, 2e15, "what bob lost, the holders who stay gained");
    }

    /// Entering and leaving in kind in two blocks costs the depositor the fee, so the vault is not the cheapest
    /// venue for a trade on information the feed has not caught up with yet.
    function test_N4_inKindRoundTripCostsTheFee() public {
        _deployedVault();
        uint256 sh = _deposit(bob, 100e18);
        vm.prank(bob);
        (uint256 s, uint256 u) = vault.redeemInKind(sh, bob, bob);
        uint256 out = s + u * 1e12 * 1e8 / _feedPrice();
        assertLe(out, 100e18 - 3e16, "round trip costs the depositor the fee (0.04 of 100)");
    }

    function test_N4_boundsAndQueue() public {
        _executeReverts(abi.encodeCall(StockVault.setEntryFee, (uint24(499))), StockVault.BadParams.selector);
        _executeReverts(abi.encodeCall(StockVault.setEntryFee, (uint24(20_001))), StockVault.BadParams.selector);
        vm.prank(owner);
        vm.expectRevert(StockVault.ChangeNotQueued.selector);
        vault.setEntryFee(600);
        _ownerDo(abi.encodeCall(StockVault.setEntryFee, (uint24(20_000))));
        assertEq(vault.entryFee(), 20_000);
        _ownerDo(abi.encodeCall(StockVault.setEntryFee, (uint24(500))));
        assertEq(vault.entryFee(), 500);
    }

    // ------------------------------------------------------------------ lows

    function test_L_queuedChangeExpires() public {
        bytes memory data = abi.encodeCall(StockVault.setKeeper, (stranger));
        uint256 t0 = vm.getBlockTimestamp();
        vm.prank(owner);
        vault.queueChange(data);
        uint256 eta = t0 + vault.CHANGE_DELAY();
        uint256 expiry = eta + vault.CHANGE_GRACE();

        vm.warp(expiry + 1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(StockVault.ChangeExpired.selector, expiry));
        vault.executeChange(data);
        assertEq(vault.keeper(), keeper, "not executed");

        // an expired entry can be queued afresh, not before
        vm.prank(owner);
        vault.queueChange(data);
        vm.prank(owner);
        vm.expectRevert(StockVault.ChangeQueuedAlready.selector);
        vault.queueChange(data);
        vm.warp(vm.getBlockTimestamp() + vault.CHANGE_DELAY() + vault.CHANGE_GRACE());
        vm.prank(owner);
        vault.executeChange(data); // the last second of the grace window still runs
        assertEq(vault.keeper(), stranger);
    }

    function test_L_twapWindowBoundedByCapAndCardinality() public {
        StockVault.Params memory p = _defaultParams();
        p.twapWindow = 1801;
        _executeReverts(abi.encodeCall(StockVault.setParams, (p)), StockVault.BadParams.selector);
        p.twapWindow = 1800;
        _ownerDo(abi.encodeCall(StockVault.setParams, (p)));
        (,,,,,, uint32 w,) = vault.params();
        assertEq(w, 1800);

        // a pool whose ring buffer holds fewer observations than the window can have the window pushed out of it
        (uint160 sq, int24 tk, uint16 idx,, uint16 nxt, uint8 fp, bool un) = IUniswapV3Pool(POOL).slot0();
        vm.mockCall(POOL, abi.encodeWithSelector(IUniswapV3Pool.slot0.selector), abi.encode(sq, tk, idx, uint16(1500), nxt, fp, un));
        p.twapWindow = 1501;
        _executeReverts(abi.encodeCall(StockVault.setParams, (p)), StockVault.BadParams.selector);
        p.twapWindow = 1500;
        _ownerDo(abi.encodeCall(StockVault.setParams, (p)));
        vm.mockCall(POOL, abi.encodeWithSelector(IUniswapV3Pool.slot0.selector), abi.encode(sq, tk, idx, uint16(599), nxt, fp, un));
        vm.expectRevert(StockVault.BadParams.selector);
        _deploy(_defaultParams());
    }
}
