// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./Base.t.sol";

/// @dev A large depositor exits and a dust holder is left. The exit swap runs against a pool that the vault's own
/// deployment swaps pushed off the TWAP, so the proceeds of the exiter's slice differ from the slice's NAV. The
/// proceeds belong to the exiter: `redeem` sends all of them, `withdraw` burns only the shares it needed. Nothing is
/// left idle for the holders who stay to collect, so the dust holder gets back her deposit and no more.
contract DustExitTest is Base {
    uint256 constant ORACLE_TOLERANCE_BPS = 100; // maxDeviationBps
    uint256 constant ROUNDING = 1e12;

    struct Run {
        uint256 a;
        uint256 b;
        uint256 sharesA;
        uint256 sharesB;
        uint256 redeemB;
        uint256 previewB;
        uint256 navShareB;
        uint256 bobOut;
        uint256 ppsBefore;
        uint256 ppsAfter;
        uint256 aliceOut;
    }

    function _log(string memory tag) internal {
        emit log_named_uint(string.concat(tag, " totalAssets"), vault.totalAssets());
        emit log_named_uint(string.concat(tag, " totalSupply"), vault.totalSupply());
        emit log_named_uint(string.concat(tag, " idleUsdg"), IERC20(USDG).balanceOf(address(vault)));
        emit log_named_uint(string.concat(tag, " idleStock"), IERC20(NVDA).balanceOf(address(vault)));
    }

    /// @dev Remaining holders' assets per share across one exit: it never falls (beyond the rounding the vault keeps)
    /// and it does not jump either, since the slice leaves pro-rata and nothing is stranded.
    /// The one thing that may lift it is a USDG leg under one US cent, which the exit leaves in the vault.
    function _assertRemainingHoldersWhole(uint256 ppsBefore, uint256 ppsAfter) internal view {
        // rounding in the liquidity maths is a few raw USDG units (1e-6 USD each) of the vault
        uint256 rawUnits = 3 * 1e12 * 1e8 / _feedPrice();
        assertGe(ppsAfter + ppsBefore * rawUnits / vault.totalAssets(), ppsBefore, "exit lowered assets per share for the holders left");
        uint256 dustLift = ppsBefore * _centInStock() / vault.totalAssets();
        assertLe(ppsAfter, ppsBefore + ppsBefore / 1e4 + dustLift, "exit lifted assets per share");
    }

    function _centInStock() internal view returns (uint256) {
        return 0.01e18 * 1e8 / _feedPrice();
    }

    /// @dev Same sequence as testFuzz_depositWithdrawNoFreeMoney: alice deposits, bob deposits, bob redeems
    /// `pct`% of his shares, alice redeems everything.
    function _run(uint96 rawA, uint96 rawB, uint8 fracB) internal returns (Run memory r) {
        r.a = bound(rawA, 1e15, 400e18);
        r.b = bound(rawB, 1e15, 400e18);
        uint256 pct = bound(fracB, 1, 100);
        _instant();

        r.sharesA = _deposit(alice, r.a);
        r.sharesB = _deposit(bob, r.b);
        _log("after deposits");

        r.redeemB = r.sharesB * pct / 100;
        r.previewB = vault.previewRedeem(r.redeemB);
        r.navShareB = vault.convertToAssets(r.redeemB);
        r.ppsBefore = vault.convertToAssets(1e24);
        uint256 beforeB = IERC20(NVDA).balanceOf(bob);
        vm.prank(bob);
        uint256 returned = vault.redeem(r.redeemB, bob, bob);
        r.bobOut = IERC20(NVDA).balanceOf(bob) - beforeB;
        r.ppsAfter = vault.convertToAssets(1e24);
        _log("after bob exit");
        emit log_named_uint("bob nav share", r.navShareB);
        emit log_named_uint("bob assets out", r.bobOut);

        assertEq(returned, r.bobOut, "redeem returns what was sent");
        // a USDG leg under one US cent is not swapped and stays in the vault, so previewRedeem holds to within a cent
        assertGe(r.bobOut + _centInStock(), r.previewB, "ERC-4626: redeem returns at least previewRedeem");
        _assertRemainingHoldersWhole(r.ppsBefore, r.ppsAfter);

        uint256 beforeA = IERC20(NVDA).balanceOf(alice);
        vm.prank(alice);
        vault.redeem(r.sharesA, alice, alice);
        r.aliceOut = IERC20(NVDA).balanceOf(alice) - beforeA;
        emit log_named_uint("alice assets out", r.aliceOut);
        assertLe(r.aliceOut, r.a * (10_000 + ORACLE_TOLERANCE_BPS) / 10_000 + ROUNDING, "alice cannot gain");
    }

    /// @dev The saved counterexample args = [52919282712885173, 9860, true, 99].
    function test_dustHolderGainsNothingFromPartialExit() public {
        Run memory r = _run(52919282712885173, 9860, 99);
        // the exiter is paid what his slice realised, never less than the NAV floor
        assertGe(r.bobOut, r.previewB);
    }

    /// @dev The same deposits with bob leaving completely: alice is the only holder left but the treasury's
    /// harvest shares, so every wei of exit surplus used to land on her.
    function test_dustHolderGainsNothingFromFullExit() public {
        Run memory r = _run(52919282712885173, 9860, 100);
        assertEq(vault.balanceOf(bob), 0, "bob left completely");
        assertGe(r.bobOut, r.previewB);
    }

    /// @dev Any sizes and any exit fraction: the dust depositor never gains and the exiter is paid in full.
    function testFuzz_exitSurplusBelongsToExiter(uint96 rawA, uint96 rawB, uint8 fracB) public {
        _run(rawA, rawB, fracB);
    }

    /// @dev `withdraw` sends exactly the assets asked for. It grosses the shares up by the exit buffer, and the part
    /// of the buffer the swap does not spend comes back as shares, so bob burns less than previewWithdraw and the
    /// holders left gain nothing from it (34% of a dust holder's deposit here before).
    function test_dustHolderGainsNothingFromWithdraw() public {
        uint256 a = 52919282712885173;
        _instant();
        uint256 sharesA = _deposit(alice, a);
        uint256 sharesB = _deposit(bob, 399999000000000009861);
        uint256 target = vault.convertToAssets(sharesB) * 99 / 100 * 997 / 1000;
        uint256 cap = vault.previewWithdraw(target);
        uint256 ppsBefore = vault.convertToAssets(1e24);
        uint256 sharesBefore = vault.balanceOf(bob);
        uint256 assetsBefore = IERC20(NVDA).balanceOf(bob);

        vm.prank(bob);
        uint256 burned = vault.withdraw(target, bob, bob);
        _log("after bob withdraw");

        assertEq(IERC20(NVDA).balanceOf(bob) - assetsBefore, target, "exactly the requested assets");
        assertEq(sharesBefore - vault.balanceOf(bob), burned, "return value is the shares burned");
        assertLe(burned, cap, "ERC-4626: withdraw burns at most previewWithdraw");
        emit log_named_uint("shares burned", burned);
        emit log_named_uint("previewWithdraw", cap);
        assertLt(burned, cap, "the unspent exit buffer reduces the shares burned");
        _assertRemainingHoldersWhole(ppsBefore, vault.convertToAssets(1e24));

        uint256 beforeA = IERC20(NVDA).balanceOf(alice);
        vm.prank(alice);
        vault.redeem(sharesA, alice, alice);
        uint256 got = IERC20(NVDA).balanceOf(alice) - beforeA;
        emit log_named_uint("alice assets out", got);
        assertLe(got, a * (10_000 + ORACLE_TOLERANCE_BPS) / 10_000 + ROUNDING, "alice cannot gain");
    }

    /// @dev A spender with an allowance equal to what the exit actually burned is enough, and is charged only that.
    function test_withdrawOnBehalfSpendsBurnedSharesOnly() public {
        _instant();
        _deposit(alice, 40e18);
        uint256 sharesB = _deposit(bob, 100e18);
        uint256 target = vault.convertToAssets(sharesB) / 2;
        uint256 cap = vault.previewWithdraw(target);
        vm.prank(bob);
        vault.approve(alice, cap);

        vm.prank(alice);
        uint256 burned = vault.withdraw(target, alice, bob);
        assertEq(vault.allowance(bob, alice), cap - burned, "allowance charged for the burn only");
        assertEq(sharesB - vault.balanceOf(bob), burned);
    }

    /// @dev Bob withdraws everything maxWithdraw allows. The exit buffer he did not spend comes back to him as
    /// shares, and alice's stake is worth what it was before, to within the rounding of the liquidity maths.
    function test_fullWithdrawKeepsOthersWhole() public {
        _instant();
        uint256 sharesA = _deposit(alice, 100e18);
        _deposit(bob, 100e18);
        uint256 target = vault.maxWithdraw(bob);
        uint256 cap = vault.previewWithdraw(target);
        uint256 aliceBefore = vault.convertToAssets(sharesA);
        uint256 beforeB = IERC20(NVDA).balanceOf(bob);
        uint256 sharesBefore = vault.balanceOf(bob);

        vm.prank(bob);
        uint256 burned = vault.withdraw(target, bob, bob);

        assertEq(IERC20(NVDA).balanceOf(bob) - beforeB, target, "exactly the requested assets");
        assertEq(sharesBefore - vault.balanceOf(bob), burned);
        assertLe(burned, cap);
        assertGt(vault.balanceOf(bob), sharesBefore - cap, "unspent buffer came back as shares");
        assertGe(vault.convertToAssets(sharesA) + 3 * 1e12 * 1e8 / _feedPrice(), aliceBefore, "alice diluted");
        assertLe(vault.convertToAssets(sharesA), aliceBefore + aliceBefore / 1e4 + _centInStock(), "alice lifted");
    }
}
