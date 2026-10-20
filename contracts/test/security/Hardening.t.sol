// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base} from "../Base.t.sol";
import {StockVault, IStockTokenCorpActions} from "../../src/StockVault.sol";
import {VaultMath} from "../../src/VaultMath.sol";
import {INonfungiblePositionManager} from "../../src/interfaces/IUniswapV3.sol";

/// @dev Security review 2026-10-20 fixes: the owner timelock (M2), the same-block share lock (H1), and the
/// Stock Token corporate-action gate (M3). Fork of Robinhood Chain with the real NVDA Stock Token; only the
/// ERC-8056 answers are mocked where a test needs a state the live token is not in.
contract HardeningTest is Base {
    // ------------------------------------------------------------ M2 timelock

    function _queue(bytes memory data) internal returns (uint256 eta) {
        vm.prank(owner);
        bytes32 id = vault.queueChange(data);
        eta = vault.changeEta(id);
    }

    function test_settersCannotBeCalledDirectly() public {
        StockVault.Params memory p = _defaultParams();
        vm.startPrank(owner);
        vm.expectRevert(StockVault.ChangeNotQueued.selector);
        vault.setParams(p);
        vm.expectRevert(StockVault.ChangeNotQueued.selector);
        vault.setKeeper(stranger);
        vm.expectRevert(StockVault.ChangeNotQueued.selector);
        vault.setInstantDeploy(true);
        vm.expectRevert(StockVault.ChangeNotQueued.selector);
        vault.setSpotTwapBand(20);
        vm.stopPrank();
    }

    function test_changeBeforeDelayReverts() public {
        StockVault.Params memory p = _defaultParams();
        p.slippageBps = 400;
        bytes memory data = abi.encodeCall(StockVault.setParams, (p));
        uint256 eta = _queue(data);
        assertEq(eta, block.timestamp + 24 hours, "eta is 24 h out");

        vm.warp(eta - 1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(StockVault.ChangeTooEarly.selector, eta));
        vault.executeChange(data);
        (,,, uint16 slippage,,,,) = vault.params();
        assertEq(slippage, 100, "params unchanged one second early");
    }

    function test_changeAfterDelayApplies() public {
        StockVault.Params memory p = _defaultParams();
        p.slippageBps = 400;
        p.minRebalanceInterval = 2 hours;
        bytes memory dParams = abi.encodeCall(StockVault.setParams, (p));
        bytes memory dKeeper = abi.encodeCall(StockVault.setKeeper, (stranger));
        bytes memory dInstant = abi.encodeCall(StockVault.setInstantDeploy, (true));
        bytes memory dBand = abi.encodeCall(StockVault.setSpotTwapBand, (25));
        assertEq(vault.maxSpotTwapBps(), 10, "default band is 10 bp");
        uint256 eta = _queue(dParams);
        _queue(dKeeper);
        _queue(dInstant);
        _queue(dBand);

        vm.warp(eta);
        vm.startPrank(owner);
        vault.executeChange(dParams);
        vault.executeChange(dKeeper);
        vault.executeChange(dInstant);
        vault.executeChange(dBand);
        vm.stopPrank();

        (,,, uint16 slippage,,,, uint32 minInterval) = vault.params();
        assertEq(slippage, 400);
        assertEq(minInterval, 2 hours);
        assertEq(vault.keeper(), stranger);
        assertTrue(vault.instantDeploy());
        assertEq(vault.maxSpotTwapBps(), 25);

        vm.prank(owner);
        vm.expectRevert(StockVault.ChangeNotQueued.selector);
        vault.executeChange(dParams); // executing consumes the entry
    }

    function test_cancelledChangeNeverApplies() public {
        bytes memory data = abi.encodeCall(StockVault.setInstantDeploy, (true));
        uint256 eta = _queue(data);
        vm.prank(owner);
        vault.cancelChange(keccak256(data));
        assertEq(vault.changeEta(keccak256(data)), 0);

        vm.warp(eta + 1);
        vm.prank(owner);
        vm.expectRevert(StockVault.ChangeNotQueued.selector);
        vault.executeChange(data);
        assertFalse(vault.instantDeploy());

        vm.prank(owner);
        vm.expectRevert(StockVault.ChangeNotQueued.selector);
        vault.cancelChange(keccak256(data));
    }

    function test_queueRejectsOtherCallsAndDuplicates() public {
        vm.prank(owner);
        vm.expectRevert(StockVault.ChangeNotAllowed.selector);
        vault.queueChange(abi.encodeCall(vault.pause, ()));
        vm.prank(owner);
        vm.expectRevert(StockVault.ChangeNotAllowed.selector);
        vault.queueChange(hex"");

        bytes memory data = abi.encodeCall(StockVault.setKeeper, (stranger));
        _queue(data);
        vm.prank(owner);
        vm.expectRevert(StockVault.ChangeQueuedAlready.selector);
        vault.queueChange(data);
    }

    function test_onlyOwnerQueuesExecutesCancels() public {
        bytes memory data = abi.encodeCall(StockVault.setKeeper, (stranger));
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);
        vm.startPrank(stranger);
        vm.expectRevert(err);
        vault.queueChange(data);
        vm.expectRevert(err);
        vault.executeChange(data);
        vm.expectRevert(err);
        vault.cancelChange(keccak256(data));
        vm.stopPrank();
    }

    /// @dev Only changes that can add risk are delayed: the cap, the pause and the treasury are immediate.
    function test_riskReducingSettersStayImmediate() public {
        vm.startPrank(owner);
        vault.setDepositCap(1e18);
        vault.pause();
        vault.unpause();
        vault.setTreasury(stranger);
        vm.stopPrank();
        assertEq(vault.depositCap(), 1e18);
        assertEq(vault.treasury(), stranger);
    }

    // ------------------------------------------------------------ H1 share lock

    function _dep(address who, uint256 amount) internal returns (uint256 sh) {
        _fund(who, amount);
        vm.prank(who);
        sh = vault.deposit(amount, who);
    }

    function test_sharesCannotLeaveInTheBlockTheyAreMinted() public {
        uint256 sh = _dep(alice, 100e18);

        vm.startPrank(alice);
        vm.expectRevert(StockVault.SharesLocked.selector);
        vault.redeemInKind(sh, alice, alice);
        vm.expectRevert(StockVault.SharesLocked.selector);
        vault.redeem(sh, alice, alice);
        vm.expectRevert(StockVault.SharesLocked.selector);
        vault.withdraw(50e18, alice, alice);
        vm.expectRevert(StockVault.SharesLocked.selector);
        IERC20(address(vault)).transfer(bob, sh);
        vm.stopPrank();

        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        IERC20(address(vault)).transfer(bob, sh / 2);
        vm.prank(alice);
        vault.redeemInKind(sh / 2, alice, alice);
    }

    /// @dev A transfer cannot launder fresh shares: the holder who minted them cannot send them anywhere that block,
    /// and a receiver of old shares is not locked by receiving them.
    function test_transferDoesNotDodgeOrCarryTheLock() public {
        uint256 old = _deposit(alice, 100e18); // minted a block ago
        uint256 fresh = _dep(bob, 100e18);

        vm.prank(bob);
        vm.expectRevert(StockVault.SharesLocked.selector);
        IERC20(address(vault)).transfer(stranger, fresh);

        vm.prank(alice);
        IERC20(address(vault)).transfer(stranger, old);
        vm.prank(stranger);
        vault.redeemInKind(old, stranger, stranger); // old shares, usable at once by the receiver
    }

    /// @dev Only the shares minted this block are locked: dusting a holder in the block she exits cannot trap the
    /// shares she already had.
    function test_dustDepositCannotTrapAnExistingHolder() public {
        uint256 sh = _deposit(alice, 100e18);
        _fund(bob, 1e12);
        vm.prank(bob);
        uint256 dust = vault.deposit(1e12, alice); // bob mints shares to alice in this block
        assertGt(dust, 0);

        vm.prank(alice);
        vm.expectRevert(StockVault.SharesLocked.selector);
        vault.redeemInKind(sh + dust, alice, alice); // the dust itself is locked
        vm.prank(alice);
        vault.redeemInKind(sh, alice, alice); // her old shares are not
    }

    function test_lockAccumulatesWithinABlock() public {
        uint256 a = _dep(alice, 50e18);
        uint256 b = _dep(alice, 50e18);
        vm.prank(alice);
        vm.expectRevert(StockVault.SharesLocked.selector);
        vault.redeemInKind(a + b - 1, alice, alice);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        vault.redeemInKind(a + b, alice, alice);
    }

    // ------------------------------------------------------ M3 corporate actions

    function _mockOraclePaused(bool paused_) internal {
        vm.mockCall(NVDA, abi.encodeWithSelector(IStockTokenCorpActions.oraclePaused.selector), abi.encode(paused_));
    }

    function _mockEffectiveAt(uint256 at) internal {
        vm.mockCall(NVDA, abi.encodeWithSelector(IStockTokenCorpActions.effectiveAt.selector), abi.encode(at));
    }

    function _status() internal view returns (StockVault.Status st) {
        (st,,,,,) = vault.health();
    }

    /// @dev The two ERC-8056 reads the gate depends on exist on the real NVDA token and decode.
    function test_realStockTokenAnswersTheCorporateActionReads() public view {
        IStockTokenCorpActions t = IStockTokenCorpActions(NVDA);
        t.oraclePaused();
        assertGt(t.effectiveAt(), 0, "effectiveAt is the time of the latest multiplier change");
        assertEq(uint8(_status()), uint8(StockVault.Status.Ok), "the unmocked token leaves the gate open");
    }

    function test_pausedOracleClosesEveryPriceCheckedPathButNotRedeemInKind() public {
        _instant();
        uint256 sh = _deposit(alice, 100e18);
        vm.warp(block.timestamp + 6 hours);
        _setFeed(_poolPrice());
        _mockOraclePaused(true);
        assertEq(uint8(_status()), uint8(StockVault.Status.CorporateAction), "health reports it");

        bytes memory closed = abi.encodeWithSelector(StockVault.OracleUnhealthy.selector, StockVault.Status.CorporateAction);
        _fund(bob, 10e18);
        vm.startPrank(bob);
        vm.expectRevert(closed);
        vault.deposit(10e18, bob);
        vm.expectRevert(closed);
        vault.mint(1e24, bob);
        vm.stopPrank();
        vm.startPrank(alice);
        vm.expectRevert(closed);
        vault.redeem(sh / 2, alice, alice);
        vm.expectRevert(closed);
        vault.withdraw(1e18, alice, alice);
        vm.stopPrank();
        vm.prank(keeper);
        vm.expectRevert(closed);
        vault.rebalance();

        uint256 nvdaBefore = IERC20(NVDA).balanceOf(alice);
        uint256 usdgBefore = IERC20(USDG).balanceOf(alice);
        vm.prank(alice);
        (uint256 s, uint256 u) = vault.redeemInKind(sh, alice, alice);
        assertGt(s, 0, "stock leg out");
        assertGt(u, 0, "usdg leg out");
        assertEq(IERC20(NVDA).balanceOf(alice) - nvdaBefore, s);
        assertEq(IERC20(USDG).balanceOf(alice) - usdgBefore, u);
        assertEq(vault.balanceOf(alice), 0);

        _mockOraclePaused(false);
        assertEq(uint8(_status()), uint8(StockVault.Status.Ok), "gate reopens when the token unpauses the oracle");
        vm.prank(bob);
        vault.deposit(10e18, bob);
    }

    function test_windowAroundAMultiplierChange() public {
        uint256 t = block.timestamp;
        uint256 twap = 600; // _defaultParams().twapWindow

        _mockEffectiveAt(t + 1 hours + 1);
        assertEq(uint8(_status()), uint8(StockVault.Status.Ok), "more than an hour ahead: open");
        _mockEffectiveAt(t + 1 hours);
        assertEq(uint8(_status()), uint8(StockVault.Status.CorporateAction), "an hour ahead: closed");
        _mockEffectiveAt(t);
        assertEq(uint8(_status()), uint8(StockVault.Status.CorporateAction), "at effectiveAt: closed");
        _mockEffectiveAt(t - 1 hours - twap);
        assertEq(uint8(_status()), uint8(StockVault.Status.CorporateAction), "1 h plus the TWAP window after: closed");
        _mockEffectiveAt(t - 1 hours - twap - 1);
        assertEq(uint8(_status()), uint8(StockVault.Status.Ok), "past that: open");
        _mockEffectiveAt(type(uint256).max);
        assertEq(uint8(_status()), uint8(StockVault.Status.Ok), "a far-future time does not overflow the check");

        _fund(bob, 10e18);
        _mockEffectiveAt(t + 30 minutes);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(StockVault.OracleUnhealthy.selector, StockVault.Status.CorporateAction)
        );
        vault.deposit(10e18, bob);
    }

    /// @dev A Stock Token without the ERC-8056 reads is not a corporate action.
    function test_tokenWithoutTheReadsLeavesTheGateOpen() public {
        vm.mockCallRevert(NVDA, abi.encodeWithSelector(IStockTokenCorpActions.oraclePaused.selector), "");
        vm.mockCallRevert(NVDA, abi.encodeWithSelector(IStockTokenCorpActions.effectiveAt.selector), "");
        assertEq(uint8(_status()), uint8(StockVault.Status.Ok));
    }

    // ------------------------------------------------------ H1 swap floor and mint minimums

    /// @dev The deploy swap floors at the more demanding of the TWAP value and the Chainlink value of its input. With a
    /// 10 bp slippage allowance: the feed 50 bp BELOW the pool (inside the 100 bp gate) leaves the TWAP the demanding
    /// reference when the vault sells, so an instantDeploy deposit deploys; the feed 50 bp ABOVE the pool puts the
    /// Chainlink value 40 bp over any fill, so the same deposit finds no taker and reverts.
    function test_deploySwapFloorIsTheMoreDemandingOfTwapAndFeed() public {
        StockVault.Params memory p = _defaultParams();
        p.slippageBps = 10;
        _ownerDo(abi.encodeCall(StockVault.setParams, (p)));
        _instant();
        uint256 snap = vm.snapshotState();

        _setFeed(_poolPrice() * 9_950 / 10_000);
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.Ok), "inside the Chainlink gate");
        _deposit(alice, 100e18);
        assertGt(vault.tokenId(), 0, "feed below the pool: the deposit deployed");
        assertGt(vault.positionInfo().liquidity, 0);

        vm.revertToState(snap);
        _setFeed(_poolPrice() * 10_050 / 10_000);
        (st,,,,,) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.Ok), "inside the Chainlink gate");
        _fund(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert();
        vault.deposit(100e18, alice);
        assertEq(vault.tokenId(), 0, "feed above the pool: nothing deployed");
    }

    /// @dev mintMins against the real position manager: minting the idle pair at the spot the vault sees takes at
    /// least the minimums, and the minimums are within slippage of what it takes.
    function test_mintMinimumsMatchWhatThePositionManagerTakes() public {
        VaultMath m = vault.vaultMath();
        int24 spacing = 10;
        int24 spot = _spotTick();
        int24 tl = (spot / spacing) * spacing - 500;
        int24 tu = tl + 1000;
        uint256 a0 = 20_000e6; // USDG is token0 on this pool
        uint256 a1 = 100e18;
        (uint256 m0, uint256 m1) = m.mintMins(_spotSqrt(), tl, tu, a0, a1, 100);
        assertGt(m0 + m1, 0, "non-empty minimums");

        deal(USDG, address(this), a0);
        deal(NVDA, address(this), a1);
        IERC20(USDG).approve(NPM, a0);
        IERC20(NVDA).approve(NPM, a1);
        (,, uint256 got0, uint256 got1) = INonfungiblePositionManager(NPM).mint(
            INonfungiblePositionManager.MintParams(USDG, NVDA, 500, tl, tu, a0, a1, 0, 0, address(this), block.timestamp)
        );
        // the minimums are 99% of the fill (to within a bp of rounding in the liquidity maths) and never above it
        assertLe(m0, got0, "mint took at least the USDG minimum");
        assertLe(m1, got1, "mint took at least the NVDA minimum");
        assertGe(m0 * 10_000, got0 * 9_900 * 9_999 / 10_000, "USDG minimum is within slippage of the fill");
        assertGe(m1 * 10_000, got1 * 9_900 * 9_999 / 10_000, "NVDA minimum is within slippage of the fill");
        assertTrue(got0 > 0 && got1 > 0, "the range holds both tokens");
    }

    // ------------------------------------------------- accrued fees and the deposit cap

    /// @dev A deposit made while the position holds uncollected fees buys shares at a NAV that includes them. If it
    /// did not, the depositor would own a slice of fees he never earned and walk out with it in kind.
    function test_depositIntoAccruedFeesCapturesNothing() public {
        _instant();
        _deposit(alice, 400e18);
        _volume(60_000e6, 12);
        vm.warp(block.timestamp + 11 minutes);
        _setFeed(_poolPrice());
        StockVault.PositionInfo memory info = vault.positionInfo();
        uint256 px = _poolPrice();
        uint256 accrued = info.uncollectedStock + info.uncollectedUsdg * 1e20 / px;
        emit log_named_uint("uncollected fees, NVDA wei", accrued);
        assertGt(accrued, 1e16, "the position holds uncollected fees worth more than 0.01 NVDA");

        _ownerDo(abi.encodeCall(StockVault.setInstantDeploy, (false)));
        uint256 sh = _deposit(bob, 400e18);
        vm.prank(bob);
        (uint256 s, uint256 u) = vault.redeemInKind(sh, bob, bob);
        uint256 out = s + u * 1e20 / px;
        emit log_named_uint("bob out, NVDA wei", out);
        assertLe(out, 400e18 + 1e15, "the round trip pays out no accrued fees");
    }

    /// @dev The cap bounds assets after the deposit, never only the deposit itself.
    function test_capBoundsPostDepositTotals() public {
        vm.prank(owner);
        vault.setDepositCap(100e18);
        _fund(alice, 150e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("ERC4626ExceededMaxDeposit(address,uint256,uint256)", alice, 150e18, 100e18));
        vault.deposit(150e18, alice); // an empty vault still refuses a single deposit above the cap

        _deposit(alice, 60e18);
        _fund(bob, 41e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSignature("ERC4626ExceededMaxDeposit(address,uint256,uint256)", bob, 41e18, 40e18));
        vault.deposit(41e18, bob);
        vm.prank(bob);
        vault.deposit(40e18, bob);
        assertEq(vault.maxDeposit(bob), 0, "full");
        assertLe(vault.totalAssets(), 100e18, "total assets at the cap");
    }

    /// @dev mint(maxMint) never pulls more than maxDeposit: the cap, maxMint and previewMint use one valuation. With
    /// spot a few bp under the TWAP the deposit-side valuation is the larger one, and a maxMint taken on the plain
    /// totalAssets would overshoot the cap by that gap.
    function test_maxMintCostNeverExceedsTheRoom() public {
        _instant();
        _deposit(alice, 400e18);
        vm.warp(block.timestamp + 11 minutes); // the vault's own deploy swap has aged out of the TWAP
        _setFeed(_poolPrice());
        vm.prank(owner);
        vault.setDepositCap(500e18);
        _pushPrice(-8); // inside the band: deposit-side valuation sits above totalAssets
        uint256 room = vault.maxDeposit(bob);
        uint256 shares = vault.maxMint(bob);
        uint256 cost = vault.previewMint(shares);
        emit log_named_uint("room", room);
        emit log_named_uint("cost of maxMint", cost);
        assertGt(room, 90e18, "there is room");
        assertLe(cost, room, "maxMint fits in the room");

        _ownerDo(abi.encodeCall(StockVault.setInstantDeploy, (false)));
        _fund(bob, cost);
        vm.prank(bob);
        uint256 pulled = vault.mint(shares, bob);
        assertEq(pulled, cost);
        assertEq(vault.maxDeposit(bob) <= 1e6, true, "the cap is used up to rounding");
        // the deposit-side valuation of everything now in the vault (previewMint of supply + virtual shares is
        // that valuation plus one) stays at or under the cap: the post-deposit total is what the cap bounds
        uint256 taDeposit = vault.previewMint(vault.totalSupply() + 1e6) * (1e6 - vault.entryFee()) / 1e6 - 1; // net of the entry fee
        emit log_named_uint("deposit-side assets after the mint", taDeposit);
        assertLe(taDeposit, 500e18 + 1e6, "post-deposit total within the cap");
        vm.prank(bob);
        vm.expectRevert();
        vault.mint(shares / 100, bob);
    }
}
