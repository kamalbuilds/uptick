// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {console2} from "forge-std/console2.sol";

import {Base} from "./Base.t.sol";
import {IMorpho, MarketParams} from "./ShareCollateral.t.sol";
import {StockVault} from "../src/StockVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {UptickShareOracle, IUptickVault, IVaultFactory} from "../src/UptickShareOracle.sol";

interface IMorphoAdmin {
    function enableLltv(uint256 lltv) external;
    function withdraw(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external
        returns (uint256, uint256);
}

/// @dev Replays the worst real weekend gaps of the Chainlink feeds on an Uptick NVDA share used as Morpho Blue collateral,
/// on a fork of Robinhood Chain (4663). The gaps come from keeper/data/weekend-gaps.json (keeper/collateral/weekend_gaps.py
/// read every round of each feed proxy with getRoundData): the close print, the silence, and the first print after it are
/// replayed as a ratio on today's price, because the vault's range sits around today's pool price. The borrower sits at
/// the market's limit through the silence; the oracle answers the close print the whole time (the share oracle and the
/// NVDA market's own oracle both price the last print for up to 97 h); the first print after the silence then decides
/// whether a liquidator can still take the whole debt out of the collateral.
///   max LLTV = 1 - worst adverse close-to-open move - 5 pt
contract WeekendCollateralTest is Base {
    using Math for uint256;

    IMorpho constant MORPHO = IMorpho(0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010);
    address constant IRM = 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1;

    /// NVDA / USD proxy 0x379E...9F15, rounds 0x1...0401 and 0x1...0402 (phase 1, aggregator rounds 1025 and 1026):
    /// Fri 2026-09-11 20:03:43 UTC 218.29793457, Mon 2026-09-14 00:00:29 UTC 215.86219795, -1.1158%, 51.95 h. The
    /// worst adverse silence of the feed's 34 silences of 12 h or more over 123.4 days (2026-06-22 to 2026-10-23).
    uint256 constant NVDA_CLOSE = 21_829_793_457;
    uint256 constant NVDA_OPEN = 21_586_219_795;
    uint256 constant NVDA_GAP = 187_006;
    uint256 constant NVDA_LLTV = 0.9388e18; // 1 - 1.1158% - 5 pt, rounded down to the basis point

    /// USO / USD proxy 0x75a9...431c: Fri 2026-07-31 22:48:04 UTC 133.7572, Mon 2026-08-03 00:00:22 UTC 123.38499999,
    /// -7.7545%, 49.2 h. The worst adverse silence of every launching vault's feed, replayed on the NVDA share: every
    /// vault holds the same +-5% range, so its share answers a feed move the same way.
    uint256 constant USO_CLOSE = 13_375_720_000;
    uint256 constant USO_OPEN = 12_338_499_999;
    uint256 constant USO_GAP = 177_138;
    uint256 constant USO_LLTV = 0.8724e18; // 1 - 7.7545% - 5 pt

    VaultFactory factory;
    UptickShareOracle oracle;
    address lender = makeAddr("lender");
    address liquidator = makeAddr("liquidator");
    address factoryOwner = makeAddr("factoryOwner");
    uint256 shares;
    MarketParams mp;
    bytes32 id;

    function setUp() public override {
        super.setUp();
        bytes memory code = vm.getCode("StockVault.sol:StockVault");
        factory = new VaultFactory(
            factoryOwner,
            keccak256(code),
            bytes32(0),
            address(0),
            VaultFactory.Defaults({
                usdg: USDG,
                positionManager: NPM,
                router: ROUTER,
                vaultOwner: owner,
                keeper: keeper,
                treasury: treasury,
                params: _defaultParams()
            })
        );
        vm.prank(factoryOwner);
        vault = StockVault(factory.createVault(code, NVDA, POOL, FEED, 0));
        _instant();
        shares = _deposit(alice, 200e18);
        assertGt(vault.positionInfo().liquidity, 0, "the deposit opened a real position");
        oracle = new UptickShareOracle(IVaultFactory(address(factory)), IUptickVault(address(vault)));
        deal(USDG, liquidator, 10_000_000e6);
        vm.prank(liquidator);
        IERC20(USDG).approve(address(MORPHO), type(uint256).max);
    }

    // ----------------------------------------------------------------- helpers

    /// @dev A market at `lltv` on the live singleton (the owner enables an LLTV the singleton lacks, as it would for a
    /// real listing), 1M USDG supplied, alice's shares as collateral, alice borrowed to the limit at the close print.
    function _open(uint256 lltv) internal returns (uint256 t0) {
        if (!MORPHO.isLltvEnabled(lltv)) {
            vm.prank(MORPHO.owner());
            IMorphoAdmin(address(MORPHO)).enableLltv(lltv);
        }
        mp = MarketParams(USDG, address(vault), address(oracle), IRM, lltv);
        id = keccak256(abi.encode(mp));
        MORPHO.createMarket(mp);

        deal(USDG, lender, 1_000_000e6);
        vm.startPrank(lender);
        IERC20(USDG).approve(address(MORPHO), type(uint256).max);
        MORPHO.supply(mp, 1_000_000e6, 0, lender, "");
        vm.stopPrank();
        vm.startPrank(alice);
        IERC20(address(vault)).approve(address(MORPHO), type(uint256).max);
        MORPHO.supplyCollateral(mp, shares, alice, "");
        vm.stopPrank();

        t0 = vm.getBlockTimestamp();
        _setFeed(_feedPrice()); // the close print, stamped now
        uint256 limit = shares.mulDiv(oracle.price(), 1e36).mulDiv(lltv, 1e18);
        vm.prank(alice);
        MORPHO.borrow(mp, limit - 20, 0, alice, alice); // Morpho rounds debt up; a few wei of headroom
    }

    function _debt() internal view returns (uint256) {
        (, uint128 bs,) = MORPHO.position(id, alice);
        (,, uint128 tba, uint128 tbs,,) = MORPHO.market(id);
        return uint256(bs).mulDiv(uint256(tba) + 1, uint256(tbs) + 1e6, Math.Rounding.Ceil);
    }

    function _supplyAssets() internal view returns (uint256 a) {
        (uint128 tsa,,,,,) = MORPHO.market(id);
        a = tsa;
    }

    /// @dev Silence of `gap` seconds after the close print at t0, then the first print at close * open / closeAns.
    /// Returns the share price before and after.
    function _weekend(uint256 t0, uint256 gap, uint256 closeAns, uint256 openAns) internal returns (uint256 p0, uint256 p1) {
        p0 = oracle.price();
        uint256 close = _feedPrice();
        vm.warp(t0 + gap);
        assertEq(oracle.price(), p0, "through the silence the oracle answers the close print");
        _setFeed(close.mulDiv(openAns, closeAns));
        p1 = oracle.price();
        console2.log("feed move ppm  ", (closeAns - openAns) * 1e6 / closeAns);
        console2.log("share move ppm ", (p0 - p1) * 1e6 / p0);
    }

    /// @dev Liquidates the whole position at the first print. Repaying every borrow share works when the collateral
    /// covers debt * incentive; otherwise the liquidator takes all the collateral and Morpho writes the rest off
    /// against the lenders. Returns that write-off (USDG raw units).
    function _liquidateAll() internal returns (uint256 badDebt) {
        MORPHO.accrueInterest(mp);
        uint256 supplied = _supplyAssets();
        (, uint128 bs, uint128 col) = MORPHO.position(id, alice);
        vm.prank(liquidator);
        try MORPHO.liquidate(mp, alice, 0, bs, "") {
            (,, uint128 left) = MORPHO.position(id, alice);
            assertGt(left, 0, "the debt was repaid in full and collateral is left");
        } catch {
            vm.prank(liquidator);
            MORPHO.liquidate(mp, alice, col, 0, "");
            (, uint128 bsLeft, uint128 colLeft) = MORPHO.position(id, alice);
            assertEq(colLeft, 0);
            assertEq(bsLeft, 0, "the remainder was written off");
        }
        badDebt = supplied - _supplyAssets();
        console2.log("bad debt USDG raw", badDebt);
    }

    // ---------------------------------------------------------- NVDA's worst gap

    function test_worstNvdaWeekendAtTheDerivedLltvLeavesNoBadDebt() public {
        uint256 t0 = _open(NVDA_LLTV);
        uint256 debt = _debt();
        (uint256 p0, uint256 p1) = _weekend(t0, NVDA_GAP, NVDA_CLOSE, NVDA_OPEN);
        assertLt(p1, p0, "the share fell with the print");
        // the debt is now past the limit: the Monday print makes the borrower liquidatable
        assertGt(debt, shares.mulDiv(p1, 1e36).mulDiv(NVDA_LLTV, 1e18), "liquidatable at the first print");
        assertEq(_liquidateAll(), 0, "no bad debt at the derived LLTV");
    }

    /// @dev Inside the +-5% range the share is about half USDG, so NVDA's -1.12% gap moves it -0.59%. Morpho pays the
    /// liquidator 1 / (1 - 0.3 * (1 - LLTV)), so the whole debt comes out of the collateral while LLTV * that factor
    /// stays under 1 - 0.59%, which holds up to an LLTV of about 99.17%: five points over the derived LLTV is still
    /// covered on this gap, and the write-off starts past the edge.
    function test_worstNvdaWeekendFivePointsAboveIsStillCoveredByTheUsdgLeg() public {
        uint256 t0 = _open(NVDA_LLTV + 0.05e18);
        _weekend(t0, NVDA_GAP, NVDA_CLOSE, NVDA_OPEN);
        assertEq(_liquidateAll(), 0, "98.88%: the share fell half as far as the feed");
    }

    function test_worstNvdaWeekendPastTheEdgeLeavesBadDebt() public {
        uint256 t0 = _open(0.995e18);
        _weekend(t0, NVDA_GAP, NVDA_CLOSE, NVDA_OPEN);
        assertGt(_liquidateAll(), 0, "99.5%: lenders absorb a write-off");
    }

    // ------------------------------------------- the worst gap of any launching feed

    function test_worstLaunchingWeekendAtItsDerivedLltvLeavesNoBadDebt() public {
        uint256 t0 = _open(USO_LLTV);
        _weekend(t0, USO_GAP, USO_CLOSE, USO_OPEN);
        assertEq(_liquidateAll(), 0, "no bad debt at 1 - gap - 5 pt");
    }

    function test_worstLaunchingWeekendFivePointsAboveLeavesBadDebt() public {
        uint256 t0 = _open(USO_LLTV + 0.05e18);
        _weekend(t0, USO_GAP, USO_CLOSE, USO_OPEN);
        assertGt(_liquidateAll(), 0, "the buffer gone, lenders absorb a write-off");
    }

    // ------------------------------------------------------- a feed silent past 97 h

    /// @dev Past MAX_FEED_AGE the oracle reverts, so Morpho can neither liquidate, lend more nor release collateral.
    /// Lender exposure in that window: the whole outstanding debt is frozen at an unknown price, lenders can pull only
    /// the idle supply, and the first print after the silence decides the write-off (none here: the worst NVDA move
    /// at the derived LLTV).
    function test_feedTooOldFreezesLiquidationPast97hAndTheLenderHoldsTheDebt() public {
        uint256 t0 = _open(NVDA_LLTV);
        uint256 debt = _debt();
        uint256 close = _feedPrice();
        vm.warp(t0 + oracle.MAX_FEED_AGE() + 1);
        MORPHO.accrueInterest(mp);
        (, uint128 bs, uint128 col) = MORPHO.position(id, alice);

        bytes memory tooOld = abi.encodeWithSelector(UptickShareOracle.FeedTooOld.selector, t0);
        vm.prank(liquidator);
        vm.expectRevert(tooOld);
        MORPHO.liquidate(mp, alice, 0, bs, "");
        vm.prank(liquidator);
        vm.expectRevert(tooOld);
        MORPHO.liquidate(mp, alice, col, 0, "");
        vm.prank(alice);
        vm.expectRevert(tooOld);
        MORPHO.withdrawCollateral(mp, 1, alice, alice);
        vm.prank(alice);
        vm.expectRevert(tooOld);
        MORPHO.borrow(mp, 1, 0, alice, alice);

        // the lender can take out what is idle and nothing of what is lent
        (uint128 tsa,, uint128 tba,,,) = MORPHO.market(id);
        assertGe(tba, debt, "the frozen debt, interest included");
        console2.log("lender exposure past 97 h, USDG raw", uint256(tba));
        vm.prank(lender);
        vm.expectRevert(bytes("insufficient liquidity"));
        IMorphoAdmin(address(MORPHO)).withdraw(mp, uint256(tsa) - tba + 1, 0, lender, lender);
        vm.prank(lender);
        IMorphoAdmin(address(MORPHO)).withdraw(mp, uint256(tsa) - tba, 0, lender, lender);

        // the first print after the silence reopens liquidation
        _setFeed(close.mulDiv(NVDA_OPEN, NVDA_CLOSE));
        assertEq(_liquidateAll(), 0);
    }
}
