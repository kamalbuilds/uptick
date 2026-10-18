// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./Base.t.sol";
import {StockVault} from "../src/StockVault.sol";
import {ISwapRouter02} from "../src/interfaces/IUniswapV3.sol";

/// @dev Sandwich harness for the zero-minimum decreaseLiquidity calls in _release and _closePosition, plus the
/// deposit then redeemInKind cycle under a lagging feed. The attacker (`trader`) moves the real pool inside the
/// oracle gate, the victim call runs, and the attacker restores the price. Values are Stock Token wei at the
/// (mocked, fixed) Chainlink price. See MINOUT.md for the measured numbers.
contract MinOutTest is Base {
    // ---------------------------------------------------------------- helpers

    /// @dev Stock Token wei value of an account's NVDA plus USDG at the feed price.
    function _val(address who) internal view returns (uint256) {
        return IERC20(NVDA).balanceOf(who) + IERC20(USDG).balanceOf(who) * 1e20 / _feedPrice();
    }

    /// @dev Swap back until the pool sqrt price reaches `target`.
    function _restore(uint160 target) internal {
        uint160 cur = _spotSqrt();
        if (cur == target) return;
        bool usdgIn = cur > target; // sqrt falls when USDG (token0) is sold
        vm.prank(trader);
        ISwapRouter02(ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(
                usdgIn ? USDG : NVDA, usdgIn ? NVDA : USDG, 500, trader, usdgIn ? 150_000_000e6 : 900_000e18, 0, target
            )
        );
    }

    function _devBps(uint256 before_) internal view returns (int256) {
        return (int256(_poolPrice()) - int256(before_)) * 1e4 / int256(before_);
    }

    function _bps(uint256 a, uint256 b) internal pure returns (int256) {
        return (int256(a) - int256(b)) * 1e4 / int256(b);
    }

    function _signed(uint256 mag, bool neg) internal pure returns (int256) {
        return neg ? -int256(mag) : int256(mag);
    }

    // ------------------------------------------------- exits (withdraw/redeem)

    /// @dev Victim exits while the pool price sits `push` bps off the oracle. Returns whether the exit went through,
    /// the victim's shortfall against the shares' NAV, and the attacker's net result in bps of the victim's assets.
    function _sandwichRedeem(int256 push) internal returns (bool ok, int256 devBps, int256 lossBps, int256 atkBps) {
        _instant();
        uint256 shares = _deposit(alice, 100e18);
        _deposit(bob, 100e18);
        uint256 p0 = _poolPrice();
        uint160 sqrt0 = _spotSqrt();
        uint256 fair = vault.convertToAssets(shares);
        uint256 atk0 = _val(trader);

        _pushPrice(push);
        devBps = _devBps(p0);
        uint256 bal0 = IERC20(NVDA).balanceOf(alice);
        vm.prank(alice);
        (ok,) = address(vault).call(abi.encodeCall(vault.redeem, (shares, alice, alice)));
        uint256 got = IERC20(NVDA).balanceOf(alice) - bal0;
        _restore(sqrt0);

        if (ok) lossBps = _bps(fair, got);
        atkBps = (int256(_val(trader)) - int256(atk0)) * 1e4 / int256(fair);
    }

    /// @dev Exact-assets withdraw under the same push: either it reverts, or the victim gets exactly the assets and
    /// the other holder's NAV has not fallen, before or after the attacker restores the price.
    function _sandwichWithdraw(int256 push) internal returns (bool ok, int256 holderBps) {
        _instant();
        uint256 shares = _deposit(alice, 100e18);
        uint256 bobShares = _deposit(bob, 100e18);
        uint160 sqrt0 = _spotSqrt();
        uint256 assets = vault.previewRedeem(shares) * 9_999 / 10_000;
        uint256 bobBefore = vault.convertToAssets(bobShares);
        _pushPrice(push);
        uint256 bal0 = IERC20(NVDA).balanceOf(alice);
        vm.prank(alice);
        (ok,) = address(vault).call(abi.encodeCall(vault.withdraw, (assets, alice, alice)));
        if (ok) assertEq(IERC20(NVDA).balanceOf(alice) - bal0, assets, "withdraw pays exactly the assets");
        // the other holder's NAV right after the exit, with the pool still pushed, and again once the price is restored
        holderBps = _bps(vault.convertToAssets(bobShares), bobBefore);
        _restore(sqrt0);
        int256 restored = _bps(vault.convertToAssets(bobShares), bobBefore);
        if (restored < holderBps) holderBps = restored;
    }

    function test_redeemSandwichBoundedByExitBuffer() public {
        uint256[4] memory mags = [uint256(40), 60, 70, 90];
        uint256 succeeded;
        uint256 reverted;
        int256 worst;
        for (uint256 i; i < mags.length; ++i) {
            for (uint256 j; j < 2; ++j) {
                uint256 snap = vm.snapshotState();
                (bool ok, int256 dev, int256 loss, int256 atk) = _sandwichRedeem(_signed(mags[i], j == 1));
                emit log_named_int("redeem pool dev bps", dev);
                emit log_named_uint("  exit ok", ok ? 1 : 0);
                emit log_named_int("  victim shortfall vs NAV bps", loss);
                emit log_named_int("  attacker net bps of victim assets", atk);
                if (ok) {
                    succeeded++;
                    if (loss > worst) worst = loss;
                    assertLe(loss, int256(uint256(_defaultParams().exitBufferBps)) + 1, "shortfall within exit buffer");
                } else {
                    reverted++;
                }
                assertLe(atk, 0, "attacker never profits");
                vm.revertToState(snap);
                _setFeed(_poolPrice());
            }
        }
        assertGt(succeeded, 0, "some pushes still exit");
        assertGt(reverted, 0, "the buffer reverts the rest");
        assertGt(worst, 10, "the measured loss is not zero");
    }

    function test_withdrawSandwichNeverCostsTheOtherHolder() public {
        uint256[3] memory mags = [uint256(40), 70, 90];
        uint256 ok_;
        uint256 rev_;
        for (uint256 i; i < mags.length; ++i) {
            for (uint256 j; j < 2; ++j) {
                uint256 snap = vm.snapshotState();
                (bool ok, int256 holder) = _sandwichWithdraw(_signed(mags[i], j == 1));
                emit log_named_int("withdraw push bps", _signed(mags[i], j == 1));
                emit log_named_uint("  ok", ok ? 1 : 0);
                emit log_named_int("  other holder NAV change bps", holder);
                if (ok) {
                    ok_++;
                    assertGe(holder, -3, "other holder NAV moves only by the spot-lift noise measured at -2");
                } else {
                    rev_++;
                }
                vm.revertToState(snap);
                _setFeed(_poolPrice());
            }
        }
        assertGt(ok_, 0, "some pushes still withdraw");
        assertGt(rev_, 0, "the buffer reverts the rest");
    }

    // ------------------------------------------------------------- rebalance

    /// @dev Both holders deposit, the market moves `honest` bps with the feed following, then after the keeper
    /// interval the attacker pushes the pool `push` bps off the oracle around the keeper's rebalance.
    function _rebalanceNav(int256 push, uint256 size, int256 honest)
        internal
        returns (bool ok, uint256 nav, int256 atkBps, int256 devBps)
    {
        _instant();
        _deposit(alice, size);
        _deposit(bob, size);
        _pushPrice(honest);
        _setFeed(_poolPrice());
        vm.warp(block.timestamp + 6 hours + 1);
        _setFeed(_feedPrice());
        uint256 p0 = _poolPrice();
        uint160 sqrt0 = _spotSqrt();
        uint256 atk0 = _val(trader);
        if (push != 0) {
            _pushPrice(push);
            devBps = _devBps(p0);
        }
        vm.prank(keeper);
        (ok,) = address(vault).call(abi.encodeCall(vault.rebalance, ()));
        _restore(sqrt0);
        nav = vault.totalAssets();
        atkBps = (int256(_val(trader)) - int256(atk0)) * 1e4 / int256(nav);
    }

    function _rebalanceLoss(int256 push, uint256 size, int256 honest)
        internal
        returns (bool ok, int256 devBps, int256 lossBps, int256 atkBps)
    {
        uint256 price = _feedPrice();
        uint256 snap = vm.snapshotState();
        (, uint256 navControl,,) = _rebalanceNav(0, size, honest);
        vm.revertToState(snap);
        _setFeed(price);
        uint256 navAttack;
        (ok, navAttack, atkBps, devBps) = _rebalanceNav(push, size, honest);
        if (ok) lossBps = _bps(navControl, navAttack);
    }

    /// @dev After a 3% market move the keeper's recentre has to swap a large share of the vault. The attacker pushes
    /// the pool the other way inside the gate. The vault's cost is bounded by the swap minOut, so it stays well under
    /// the push, and an oversized vault whose swap would cross minOut reverts instead.
    function test_rebalanceSandwichBoundedByPush() public {
        uint256 lossesSeen;
        for (uint256 j; j < 2; ++j) {
            uint256 snap = vm.snapshotState();
            (bool ok, int256 dev, int256 loss, int256 atk) = _rebalanceLoss(_signed(90, j == 1), 100e18, 300);
            emit log_named_int("rebalance pool dev bps", dev);
            emit log_named_int("  vault NAV loss vs unattacked rebalance bps", loss);
            emit log_named_int("  attacker net bps of NAV", atk);
            assertTrue(ok, "rebalance goes through at 100 NVDA");
            int256 push = dev < 0 ? -dev : dev;
            assertLe(loss, push / 2, "vault loss under half the push");
            assertLe(atk, 0, "attacker never profits");
            if (loss > 10) lossesSeen++;
            vm.revertToState(snap);
            _setFeed(_poolPrice());
        }
        assertGt(lossesSeen, 0, "the unfavourable direction does cost the vault something");
    }

    /// @dev Larger vault, same push: the recentre swap would fill below Chainlink less slippage, so it reverts.
    function test_rebalanceSandwichOversizedSwapReverts() public {
        (bool ok,,,) = _rebalanceLoss(90, 300e18, 300);
        assertFalse(ok, "swap minOut stops the keeper from rebalancing into a pushed pool");
    }

    // ------------------------------------------------------------ redeemInKind

    function _inKind(int256 push) internal returns (int256 loss, int256 atk) {
        _instant();
        uint256 shares = _deposit(alice, 100e18);
        _deposit(bob, 100e18);
        uint160 sqrt0 = _spotSqrt();
        uint256 fair = vault.convertToAssets(shares);
        uint256 atk0 = _val(trader);
        if (push != 0) _pushPrice(push);
        uint256 v0 = _val(alice);
        vm.prank(alice);
        vault.redeemInKind(shares, alice, alice);
        loss = _bps(fair, _val(alice) - v0);
        _restore(sqrt0);
        atk = (int256(_val(trader)) - int256(atk0)) * 1e4 / int256(fair);
    }

    /// @dev redeemInKind has no gate and no swap. A pushed pool hands the redeemer a composition worth at least what
    /// the unpushed pool would, so the sandwich costs the attacker and cannot cost the redeemer.
    function test_inKindSandwichNeverCostsTheRedeemer() public {
        uint256 snap = vm.snapshotState();
        (int256 base,) = _inKind(0);
        vm.revertToState(snap);
        _setFeed(_poolPrice());
        emit log_named_int("in-kind control shortfall bps", base);
        uint256[3] memory mags = [uint256(50), 90, 300];
        for (uint256 i; i < mags.length; ++i) {
            for (uint256 j; j < 2; ++j) {
                snap = vm.snapshotState();
                (int256 loss, int256 atk) = _inKind(_signed(mags[i], j == 1));
                emit log_named_int("in-kind push bps", _signed(mags[i], j == 1));
                emit log_named_int("  redeemer shortfall vs NAV bps", loss);
                emit log_named_int("  attacker net bps of redeemer assets", atk);
                assertLe(loss, base + 1, "redeemer is not worse off than the unpushed pool");
                assertLt(atk, 0, "attacker loses");
                vm.revertToState(snap);
                _setFeed(_poolPrice());
            }
        }
    }

    // ------------------------------------------- deposit then redeemInKind

    /// @dev Attacker deposits `d` while Chainlink sits `gapBps` above the pool, leaves in kind and sells the USDG leg
    /// back into the pool. Returns the Stock Token gained (negative = lost) in bps of `d`.
    function _lagCycle(int256 gapBps, uint256 d, bool deployed) internal returns (int256) {
        _instant();
        _deposit(bob, 100e18);
        if (!deployed) {
            vm.prank(owner);
            vault.setInstantDeploy(false);
        }
        _setFeed(uint256(int256(_poolPrice()) * (1e4 + gapBps) / 1e4));
        uint256 shares = _deposit(alice, d);
        vm.startPrank(alice);
        vault.redeemInKind(shares, alice, alice);
        uint256 u = IERC20(USDG).balanceOf(alice);
        IERC20(USDG).approve(ROUTER, u);
        ISwapRouter02(ROUTER).exactInputSingle(ISwapRouter02.ExactInputSingleParams(USDG, NVDA, 500, alice, u, 0, 0));
        vm.stopPrank();
        return (int256(IERC20(NVDA).balanceOf(alice)) - int256(d)) * 1e4 / int256(d);
    }

    function test_depositThenInKindCannotHarvestFeedLag() public {
        int256[4] memory gaps = [int256(0), 60, 90, -90];
        for (uint256 i; i < gaps.length; ++i) {
            for (uint256 k; k < 2; ++k) {
                uint256 snap = vm.snapshotState();
                int256 gain = _lagCycle(gaps[i], 50e18, k == 0);
                emit log_named_int("feed above pool bps", gaps[i]);
                emit log_named_string("  mode", k == 0 ? "instantDeploy" : "idle");
                emit log_named_int("  attacker gain bps of deposit", gain);
                // Without _navPrice the gain measured 27 to 28 bps; with it 0 to 1 bps (whole-bps truncation and TWAP vs spot
                // residual inside one block). 2 bps keeps a wide margin below the bug.
                assertLe(gain, 2, "deposit then redeemInKind never gains beyond rounding");
                vm.revertToState(snap);
                _setFeed(_poolPrice());
            }
        }
    }

    /// @dev The attacker makes the gap itself: pushes the pool 60 bps below an unchanged feed (inside the gate),
    /// runs the deposit then in-kind cycle, and restores the pool. Net of what the push costs, it must not pay.
    function test_selfMadeFeedLagIsUnprofitable() public {
        for (uint256 k; k < 2; ++k) {
            uint256 snap = vm.snapshotState();
            _instant();
            _deposit(bob, 100e18);
            if (k == 1) {
                vm.prank(owner);
                vault.setInstantDeploy(false);
            }
            uint160 sqrt0 = _spotSqrt();
            uint256 t0 = _val(trader);
            _pushPrice(-60);
            uint256 d = 50e18;
            uint256 shares = _deposit(alice, d);
            vm.startPrank(alice);
            vault.redeemInKind(shares, alice, alice);
            uint256 u = IERC20(USDG).balanceOf(alice);
            IERC20(USDG).approve(ROUTER, u);
            ISwapRouter02(ROUTER).exactInputSingle(
                ISwapRouter02.ExactInputSingleParams(USDG, NVDA, 500, alice, u, 0, 0)
            );
            vm.stopPrank();
            _restore(sqrt0);
            int256 net = (int256(IERC20(NVDA).balanceOf(alice)) - int256(d) + int256(_val(trader)) - int256(t0)) * 1e4
                / int256(d);
            emit log_named_string("self-made lag mode", k == 0 ? "instantDeploy" : "idle");
            emit log_named_int("  attacker net bps of deposit", net);
            assertLt(net, 0, "pushing the gap costs more than the cycle returns");
            vm.revertToState(snap);
            _setFeed(_poolPrice());
        }
    }
}
