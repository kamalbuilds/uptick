// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {VaultMath} from "../../../src/VaultMath.sol";
import {StockVaultV4} from "../../../src/v4/StockVaultV4.sol";
import {FreshReviewV4} from "./FreshReview.t.sol";

/// @dev Donates to the in-range liquidity of a v4 pool: the vault books it as uncollected fees of its position.
contract Donor is IUnlockCallback {
    IPoolManager immutable pm;
    PoolKey key;
    uint256 a0;
    uint256 a1;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    function donate(PoolKey memory k, uint256 x0, uint256 x1) external {
        (key, a0, a1) = (k, x0, x1);
        pm.unlock("");
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        require(msg.sender == address(pm));
        BalanceDelta d = pm.donate(key, a0, a1, "");
        _pay(key.currency0, d.amount0());
        _pay(key.currency1, d.amount1());
        return "";
    }

    function _pay(Currency c, int128 a) private {
        if (a < 0) {
            pm.sync(c);
            IERC20(Currency.unwrap(c)).transfer(address(pm), uint128(-a));
            pm.settle();
        }
    }
}

/// @dev Round 1 independent review, accounting lens, of `UptickShareOracle._pendingCutUsdg` after cbdbb37 (C-1 fix).
/// Fork of 4663 at head through the public RPC, inheriting the FreshReview fixture (PLTR v4, Stock Token currency1):
///   forge test --match-contract R1Accounting --match-test test_r1 -j 1 -vv
///
/// Ground truth is read from the vault's private storage (`pendingFee0`/`pendingFee1`, slot 17), not from the oracle,
/// so every bound below is checked against the real pending fees rather than the oracle's own rebuild.
contract R1AccountingV4 is FreshReviewV4 {
    bytes32 constant PENDING_SLOT = bytes32(uint256(17));
    uint256 constant BPS = 1000; // perfFeeBps in the fixture params

    struct Truth {
        uint256 px;
        uint256 nav;
        uint256 pS;
        uint256 pU;
        uint256 cutAtPx; // the treasury's cut of the pending fees at Chainlink, raw USDG (what a holder truly loses)
        uint256 cutAtNav; // the same cut with the stock part at nav (what the fixed oracle claims to deduct)
        uint256 value; // vault value at Chainlink with every cut deducted exactly, raw USDG
    }

    function _pending() internal view returns (uint256 pS, uint256 pU) {
        uint256 w = uint256(vm.load(address(vault), PENDING_SLOT));
        (uint256 p0, uint256 p1) = (w & type(uint128).max, w >> 128);
        (pS, pU) = stockIsToken0 ? (p0, p1) : (p1, p0);
    }

    function _usdOfStock(uint256 amt, uint256 px) internal pure returns (uint256) {
        return Math.mulDiv(amt, px * 1e6, 1e26);
    }

    function _truth() internal view returns (Truth memory t) {
        (, uint256 px,, uint160 sqrtOracle, uint160 sqrtTwap,) = vault.health();
        t.px = px;
        t.nav = Math.min(px, _usdOf(sqrtTwap));
        (t.pS, t.pU) = _pending();
        t.cutAtPx = (_usdOfStock(t.pS, px) + t.pU) * BPS / 1e4;
        t.cutAtNav = (_usdOfStock(t.pS, t.nav) + t.pU) * BPS / 1e4;
        StockVaultV4.PositionInfo memory p = vault.positionInfo();
        uint256 posS;
        uint256 posU;
        if (p.liquidity != 0) {
            (uint256 a0, uint256 a1) =
                VaultMath(vault.vaultMath()).amounts(sqrtOracle, p.tickLower, p.tickUpper, p.liquidity);
            (posS, posU) = stockIsToken0 ? (a0, a1) : (a1, a0);
        }
        uint256 bal = IERC20(STOCK()).balanceOf(address(vault));
        uint256 owed = vault.totalStockOwed();
        uint256 idle = bal > owed ? bal - owed : 0;
        uint256 gross = _usdOfStock(idle + posS + p.uncollectedStock, px) + IERC20(USDG).balanceOf(address(vault)) + posU
            + p.uncollectedUsdg;
        uint256 uncCut = Math.mulDiv(_usdOfStock(p.uncollectedStock, px) + p.uncollectedUsdg, BPS, 1e4, Math.Rounding.Ceil);
        t.value = gross - uncCut - t.cutAtPx;
    }

    function _oracleValue() internal view returns (uint256) {
        (, uint256 px,, uint160 sqrtOracle, uint160 sqrtTwap,) = vault.health();
        return oracle.valueInUsdg(px, sqrtOracle, sqrtTwap);
    }

    /// @dev The C-1 formula (pending in stock units at nav, valued at Chainlink), rebuilt from the same reads: the
    /// must-fail mutant for the "never over-deducts" assertion below.
    function _c1Mutant() internal view returns (uint256) {
        Truth memory t = _truth();
        uint256 atNav = oracle.pendingCutUsdg();
        return t.nav == 0 ? 0 : atNav * t.px / t.nav;
    }

    /// @dev Pending fees with both legs (the fixture's round-trip volume), weekend, ring lapsed. Across pushes 1x (spot
    /// at the pre-weekend pool) to 1e6x below Chainlink: the rebuilt cut equals the storage truth at nav within 2 raw
    /// USDG, never exceeds the true cut at Chainlink (so it cannot lower the price below NAV), and the under-deduction
    /// never exceeds the stock part of the true cut (the documented bound). The C-1 mutant breaks the second bound.
    function test_r1_rebuildMatchesStorageAtEveryPush() public {
        uint256 px = _accrue();
        _weekend(px, true);
        Truth memory t = _truth();
        assertGt(t.pS, 0, "stock fees pending");
        assertGt(t.pU, 0, "usdg fees pending");
        emit log_named_uint("pending stock (1e18)", t.pS);
        emit log_named_uint("pending usdg (raw)", t.pU);
        emit log_named_uint("true pending cut at Chainlink (raw USDG)", t.cutAtPx);
        uint256[6] memory ks = [uint256(1), 2, 10, 100, 1e4, 1e6];
        bool mutantOver;
        for (uint256 i; i < ks.length; ++i) {
            if (ks[i] > 1) _sellTo(px / ks[i]);
            t = _truth();
            uint256 got = oracle.pendingCutUsdg();
            uint256 mut = _c1Mutant();
            emit log_named_uint("--- spot below Chainlink by factor", ks[i]);
            emit log_named_uint("nav (8 dec)", t.nav);
            emit log_named_uint("oracle pending cut (raw USDG)", got);
            emit log_named_uint("truth at nav (raw USDG)", t.cutAtNav);
            emit log_named_uint("C-1 mutant (raw USDG)", mut);
            assertApproxEqAbs(got, t.cutAtNav, 2, "rebuild == storage truth at nav");
            assertLe(got, t.cutAtPx + 2, "never deducts more than the true cut");
            assertLe(t.cutAtPx - Math.min(got, t.cutAtPx), _usdOfStock(t.pS, t.px) * BPS / 1e4 + 2, "under-deduction <= stock part");
            if (mut > t.cutAtPx + 2) mutantOver = true;
        }
        assertTrue(mutantOver, "must-fail: the C-1 formula over-deducts on the same pushes");
    }

    /// @dev Upside: the attacker makes the pending fees all Stock Token (PoolManager.donate of the stock to the in-range
    /// liquidity, then a dust closed-gate redeemInKind), then pushes spot to 1/10,000 so the stock part is deducted at
    /// almost nothing. The oracle value must stay within `true NAV + stock part of the cut`, and the donation must cost
    /// the attacker more than the extra borrow capacity it buys.
    function test_r1_stockHeavyPendingOvervaluationIsBounded() public {
        uint256 px = _accrue();
        Truth memory t = _truth();
        uint256 donation = t.value * 1e26 / (px * 1e6) / 50; // 2% of the vault, in Stock Token
        Donor d = new Donor(PM);
        deal(STOCK(), address(d), donation);
        (uint256 x0, uint256 x1) = stockIsToken0 ? (donation, uint256(0)) : (uint256(0), donation);
        d.donate(key, x0, x1);
        _weekend(px, true);
        t = _truth();
        emit log_named_uint("donated Stock Token (1e18)", donation);
        emit log_named_uint("pending stock (1e18)", t.pS);
        emit log_named_uint("vault true value at Chainlink (raw USDG)", t.value);
        uint256 o0 = _oracleValue();
        emit log_named_int("oracle - truth before push (raw USDG)", int256(o0) - int256(t.value));
        assertLe(o0, t.value + 2, "before the push the oracle is at or below NAV");

        _sellTo(px / 1e4);
        t = _truth();
        uint256 o1 = _oracleValue();
        uint256 stockPart = _usdOfStock(t.pS, t.px) * BPS / 1e4;
        int256 over = int256(o1) - int256(t.value);
        emit log_named_int("oracle - truth after push (raw USDG)", over);
        emit log_named_uint("stock part of the pending cut (raw USDG)", stockPart);
        emit log_named_int("overvaluation, ppm of NAV", over * 1e6 / int256(t.value));
        emit log_named_uint("donation cost at Chainlink (raw USDG)", _usdOfStock(donation, px));
        emit log_named_uint("extra borrow at 62.5% LLTV, whole vault as collateral (raw USDG)", over > 0 ? uint256(over) * 625 / 1000 : 0);
        assertLe(over, int256(stockPart) + 2, "overvaluation <= stock part of the pending cut");
        assertLt(uint256(over > 0 ? over : int256(0)) * 625 / 1000, _usdOfStock(donation, px), "costs more than it buys");
    }

    /// @dev Donations straight to the vault (both tokens) are real value, counted the same in the rebuild's gross and in
    /// `totalAssets()`, so they must not leak into the rebuilt pending cut, with a lapsed ring and spot pushed 100x down.
    function test_r1_directDonationIsNotAttributedToPending() public {
        uint256 px = _accrue();
        _weekend(px, true);
        _sellTo(px / 100);
        uint256 c0 = oracle.pendingCutUsdg();
        uint256 v0 = _oracleValue();
        deal(USDG, address(this), 1_000e6);
        IERC20(USDG).transfer(address(vault), 1_000e6);
        deal(STOCK(), address(this), 10e18);
        IERC20(STOCK()).transfer(address(vault), 10e18);
        uint256 c1 = oracle.pendingCutUsdg();
        uint256 v1 = _oracleValue();
        emit log_named_uint("pending cut before (raw USDG)", c0);
        emit log_named_uint("pending cut after donation (raw USDG)", c1);
        emit log_named_uint("value gain (raw USDG)", v1 - v0);
        emit log_named_uint("donated value at Chainlink (raw USDG)", 1_000e6 + _usdOfStock(10e18, px));
        assertApproxEqAbs(c1, c0, 2, "donation does not move the rebuilt pending cut");
        assertApproxEqAbs(v1 - v0, 1_000e6 + _usdOfStock(10e18, px), 2, "donation counted once, at Chainlink");
    }

    /// @dev Live ring, Chainlink jumps 5% above the TWAP after a sweep (a news print before the ring catches up; poke
    /// moves the average at most MAX_STEP ticks per observation). nav = TWAP = px / 1.05, so the stock part of the
    /// pending cut is under-deducted by 4.8% of itself, not the "at most maxDeviationBps (1%)" the docstring states.
    /// Still bounded by the stock part of the cut and by the cap; the assertion pair pins both the bound and the
    /// docstring's inaccuracy.
    function test_r1_liveRingFeedJumpExceedsDocumentedOnePercent() public {
        uint256 px = _accrue();
        Truth memory t = _truth();
        uint256 donation = t.value * 1e26 / (px * 1e6) / 50;
        Donor d = new Donor(PM);
        deal(STOCK(), address(d), donation);
        (uint256 x0, uint256 x1) = stockIsToken0 ? (donation, uint256(0)) : (uint256(0), donation);
        d.donate(key, x0, x1);
        uint256 ts = vm.getBlockTimestamp() - 91_000;
        vm.mockCall(FEED(), abi.encodeWithSelector(LRD), abi.encode(feedRound, int256(px), ts, ts, feedRound));
        uint256 dust = vault.totalSupply() / 1e6;
        vm.prank(bob);
        vault.redeemInKind(dust, bob, bob);
        _setFeed(px * 105 / 100);
        (StockVaultV4.Status st,,,, uint160 twap, uint160 spot) = vault.health();
        emit log_named_uint("status (4 = TwapDeviates)", uint8(st));
        assertTrue(twap != spot, "ring live: the TWAP is the ring, not spot");
        t = _truth();
        uint256 stockPart = _usdOfStock(t.pS, t.px) * BPS / 1e4;
        int256 over = int256(_oracleValue()) - int256(t.value);
        emit log_named_uint("nav / px, ppm", t.nav * 1e6 / t.px);
        emit log_named_uint("true pending cut at Chainlink (raw USDG)", t.cutAtPx);
        emit log_named_uint("stock part of it (raw USDG)", stockPart);
        emit log_named_int("oracle - truth (raw USDG)", over);
        emit log_named_int("under-deduction, ppm of the cut", over * 1e6 / int256(t.cutAtPx));
        emit log_named_int("overvaluation, ppm of NAV", over * 1e6 / int256(t.value));
        assertLe(over, int256(stockPart) + 2, "bounded by the stock part of the cut");
        assertGt(over, int256(t.cutAtPx * 100 / 1e4), "exceeds the documented 1% of the cut with a live ring");
    }

    /// @dev Nothing pending: the rebuild is rounding dust at every push, so it can never grief the price.
    function test_r1_nothingPendingIsDustAtEveryPush() public {
        uint256 px = _accrue();
        _weekend(px, false);
        (uint256 pS, uint256 pU) = _pending();
        assertEq(pS + pU, 0, "nothing pending in storage");
        uint256[6] memory ks = [uint256(1), 2, 10, 1e3, 1e6, 1e8];
        uint256 worst;
        for (uint256 i; i < ks.length; ++i) {
            if (ks[i] > 1) _sellTo(px / ks[i]);
            uint256 c = oracle.pendingCutUsdg();
            if (c > worst) worst = c;
            Truth memory t = _truth();
            assertLe(_oracleValue(), t.value + 2, "never above NAV with nothing pending");
        }
        emit log_named_uint("worst rebuilt pending cut with nothing pending (raw USDG)", worst);
        assertLe(worst, 1, "rounding dust only");
    }
}

/// @dev Same checks with the Stock Token as currency0 (TSLA, 0.3%), the other `_sqrtToUsd` branch.
contract R1AccountingV4Token0 is R1AccountingV4 {
    function STOCK() internal pure override returns (address) {
        return 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    }

    function FEED() internal pure override returns (address) {
        return 0x4A1166a659A55625345e9515b32adECea5547C38;
    }

    function FEE() internal pure override returns (uint24) {
        return 3000;
    }

    function SPACING() internal pure override returns (int24) {
        return 60;
    }
}
