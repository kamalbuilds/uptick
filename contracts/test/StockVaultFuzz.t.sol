// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./Base.t.sol";
import {StockVault} from "../src/StockVault.sol";

contract StockVaultFuzzTest is Base {
    /// @dev Two depositors, one partial and one full exit, with and without instant deployment.
    /// Nobody leaves with more than they put in (no trading volume), and the sum of what every share is worth
    /// never exceeds NAV at any step.
    function testFuzz_depositWithdrawNoFreeMoney(uint96 rawA, uint96 rawB, bool instant_, uint8 fracB) public {
        uint256 a = bound(rawA, 1e15, 400e18);
        uint256 b = bound(rawB, 1e15, 400e18);
        uint256 pct = bound(fracB, 1, 100);
        if (instant_) _instant();

        uint256 sharesA = _deposit(alice, a);
        _assertShareValueBounded();
        uint256 sharesB = _deposit(bob, b);
        _assertShareValueBounded();

        uint256 redeemB = sharesB * pct / 100;
        if (redeemB > 0) {
            uint256 before_ = IERC20(NVDA).balanceOf(bob);
            vm.prank(bob);
            try vault.redeem(redeemB, bob, bob) {
                uint256 got = IERC20(NVDA).balanceOf(bob) - before_;
                // a depositor can capture at most the pool-versus-oracle gap the gate tolerates (maxDeviationBps = 1%)
                assertLe(got, (b * redeemB / sharesB) * 10_100 / 10_000 + 1e12, "bob cannot gain on a partial exit");
            } catch {}
            _assertShareValueBounded();
        }

        uint256 beforeA = IERC20(NVDA).balanceOf(alice);
        vm.prank(alice);
        try vault.redeem(sharesA, alice, alice) {
            assertLe(IERC20(NVDA).balanceOf(alice) - beforeA, a * 10_100 / 10_000 + 1e12, "alice cannot gain");
        } catch {
            // an exit costlier than the buffer reverts; the in-kind path must always work
            vm.prank(alice);
            vault.redeemInKind(sharesA, alice, alice);
        }
        assertEq(vault.balanceOf(alice), 0);
        _assertShareValueBounded();
    }

    /// @dev The first-depositor donation attack never profits the attacker, whatever the sizes.
    function testFuzz_donationAttackNeverProfits(uint96 rawDonation, uint96 rawVictim) public {
        uint256 donation = bound(rawDonation, 1, 1_000e18);
        uint256 victimDeposit = bound(rawVictim, 1, 1_000e18);

        _fund(alice, 1 + donation);
        vm.prank(alice);
        uint256 attackerShares = vault.deposit(1, alice);
        vm.prank(alice);
        IERC20(NVDA).transfer(address(vault), donation);

        uint256 victimShares = _deposit(bob, victimDeposit);
        uint256 attackerValue = vault.convertToAssets(attackerShares);
        uint256 victimValue = vault.convertToAssets(victimShares);

        assertLe(attackerValue, 1 + donation, "attacker never profits");
        // the victim's loss is paid for by the attacker's loss, at least
        uint256 victimLoss = victimDeposit > victimValue ? victimDeposit - victimValue : 0;
        uint256 attackerLoss = 1 + donation - attackerValue;
        assertLe(victimLoss, attackerLoss + 1, "victim loses no more than the attacker does");
    }

    /// @dev Rounding never mints a share of nothing: depositing then immediately redeeming returns <= deposit.
    function testFuzz_depositThenRedeemRoundsDown(uint96 rawA) public {
        uint256 a = bound(rawA, 1, 500e18);
        uint256 shares = _deposit(alice, a);
        uint256 preview = vault.previewRedeem(shares);
        assertLe(preview, a);
        assertLe(vault.convertToAssets(shares), a);
        assertLe(vault.previewDeposit(a), vault.convertToShares(a));
        assertGe(vault.previewMint(shares), vault.convertToAssets(shares));
    }

    function _assertShareValueBounded() internal view {
        uint256 sum = vault.convertToAssets(vault.balanceOf(alice)) + vault.convertToAssets(vault.balanceOf(bob))
            + vault.convertToAssets(vault.balanceOf(treasury));
        assertLe(sum, vault.totalAssets(), "sum of share values <= total assets");
    }
}
