// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

import {Base} from "../../Base.t.sol";
import {ShareCollateralTest, ShareCollateralV4Test, MarketParams, IMorpho} from "../../ShareCollateral.t.sol";
import {StockVault} from "../../../src/StockVault.sol";
import {StockVaultV4} from "../../../src/v4/StockVaultV4.sol";
import {UptickShareOracle, IUptickVault, IVaultFactory} from "../../../src/UptickShareOracle.sol";
import {UptickShareOracleFactory} from "../../../src/UptickShareOracleFactory.sol";
import {ISwapRouter02} from "../../../src/interfaces/IUniswapV3.sol";

/// @dev Security review of UptickShareOracle, 2026-10-23. Run on a fork of 4663:
///   forge test --match-path 'test/security/oracle/*' --match-test 'test_poc|test_measure' -j 1 -vv
/// Each `test_poc_*` asserts the behaviour of the code under review. After the fixes of 2026-10-23 (branch
/// r2-oracle-fix) the O-M1 and O-L1 tests assert the fixed behaviour and go red if the fix is reverted; O-L2 has no
/// code fix and keeps asserting the integration pattern. `test_measure_*` print the numbers the LLTV recommendation
/// rests on.

/// @dev Says yes to every vault. Anyone can deploy this and bind an imitation oracle factory to it.
contract YesFactory {
    function isVault(address) external pure returns (bool) {
        return true;
    }
}

/// @dev A 24-decimal ERC-20 that answers the oracle's vault reads with whatever its deployer wants. It reports the
/// real NVDA token, the real USDG and the real NVDA Chainlink proxy, so the oracle's immutables look like an Uptick
/// NVDA vault's.
contract FakeVault is ERC20 {
    struct PositionInfo {
        uint256 head;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 stockAmount;
        uint256 usdgAmount;
        uint256 uncollectedStock;
        uint256 uncollectedUsdg;
        bool inRange;
    }

    address public immutable stock;
    address public immutable usdg;
    address public immutable feed;
    uint256 public reportedPrice; // feed decimals

    constructor(address stock_, address usdg_, address feed_, uint256 px) ERC20("Uptick NVDA", "svNVDA") {
        stock = stock_;
        usdg = usdg_;
        feed = feed_;
        reportedPrice = px;
        _mint(msg.sender, 1);
    }

    function decimals() public pure override returns (uint8) {
        return 24;
    }

    function health() external view returns (uint8, uint256, uint256, uint160, uint160, uint160) {
        return (0, reportedPrice, block.timestamp, 0, 0, 0);
    }

    function positionInfo() external pure returns (PositionInfo memory p) {}

    function params() external pure returns (uint16, uint16, uint16, uint16, uint16, uint32, uint32, uint32) {}

    function totalAssets() external pure returns (uint256) {
        return type(uint128).max;
    }

    function totalStockOwed() external pure returns (uint256) {}

    function stockIsToken0() external pure returns (bool) {}

    function vaultMath() external pure returns (address) {}
}

/// @dev A Morpho liquidator that repays out of inventory and, inside `onMorphoLiquidate`, redeems the shares it holds
/// in kind: either its whole share balance (the usual "sweep what I hold" bot) or exactly what it seized.
contract FlashLiquidator {
    IMorpho immutable morpho;
    StockVault immutable vault;
    MarketParams mp;
    bool public exact;
    uint256 seizing;

    constructor(IMorpho m, StockVault v, MarketParams memory p) {
        morpho = m;
        vault = v;
        mp = p;
        IERC20(p.loanToken).approve(address(m), type(uint256).max);
    }

    function setExact(bool e) external {
        exact = e;
    }

    function go(address borrower, uint256 seize) external {
        seizing = seize;
        morpho.liquidate(mp, borrower, seize, 0, hex"01");
    }

    function onMorphoLiquidate(uint256, bytes calldata) external {
        uint256 s = exact ? seizing : IERC20(address(vault)).balanceOf(address(this));
        vault.redeemInKind(s, address(this), address(this));
    }
}

/// @dev v3 NVDA vault, real Morpho Blue singleton.
contract OracleReviewV3 is ShareCollateralTest {
    using Math for uint256;

    // ----------------------------------------------------------- M-1 forged registry (fixed by the oracle factory)

    /// @dev What a lender checks before supplying to a market: the oracle is in the published oracle factory's registry,
    /// names the real VaultFactory, and prices a vault that factory knows.
    function _lenderAccepts(UptickShareOracle o) internal view returns (bool) {
        return oracleFactory.isOracle(address(o)) && address(o.factory()) == address(factory)
            && o.oracleFactory() == address(oracleFactory) && factory.isVault(address(o.vault()));
    }

    /// @dev The look-alike oracle of the original PoC (same source, a fake vault, a registry that says yes) can no
    /// longer come out of the oracle factory, and the copy an attacker deploys through an imitation of the factory
    /// fails every leg of the lender's check. Before the fix the same lender had nothing to check: the oracle stored no
    /// registry and the guard consulted whatever the deployer passed.
    function test_poc_forgedFactoryOracleCannotComeFromTheOracleFactory() public {
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        FakeVault fake = new FakeVault(NVDA, USDG, FEED, 1e20); // 1e12 USD per NVDA
        deal(NVDA, address(fake), 1e18); // one NVDA "held"
        assertFalse(factory.isVault(address(fake)), "the real VaultFactory does not know the fake");

        // 1. The oracle factory refuses a vault the VaultFactory did not deploy, for anyone.
        vm.prank(attacker);
        vm.expectRevert(UptickShareOracleFactory.NotRegisteredVault.selector);
        oracleFactory.createOracle(IUptickVault(address(fake)));
        assertEq(oracleFactory.oracleOf(address(fake)), address(0));

        // 2. Nobody can deploy the oracle bare: its constructor asks the deployer for its parameters.
        vm.expectRevert();
        new UptickShareOracle();
        vm.prank(attacker, attacker);
        vm.expectRevert();
        new UptickShareOracle();

        // 3. An imitation of the oracle factory (the same contract, bound to a registry that says yes) still yields a
        // look-alike with the same runtime code that prices one raw unit above 1e9 USDG ...
        vm.startPrank(attacker);
        UptickShareOracleFactory imitation = new UptickShareOracleFactory(IVaultFactory(address(new YesFactory())));
        UptickShareOracle forged = UptickShareOracle(imitation.createOracle(IUptickVault(address(fake))));
        vm.stopPrank();
        assertEq(address(forged).code.length, address(oracle).code.length, "same contract, same runtime size");
        assertGt(forged.price(), 1e45, "the look-alike still prices absurdly");

        // ... and the lender's check tells them apart, leg by leg.
        assertTrue(_lenderAccepts(oracle), "control: the genuine oracle passes");
        assertFalse(_lenderAccepts(forged), "the look-alike fails");
        assertFalse(oracleFactory.isOracle(address(forged)), "not in the published registry");
        assertTrue(address(forged.factory()) != address(factory), "names a different VaultFactory");
        assertTrue(forged.oracleFactory() != address(oracleFactory), "deployed by a different oracle factory");
        assertFalse(factory.isVault(address(forged.vault())), "prices a vault the real VaultFactory never deployed");
    }

    // ----------------------------------------------------------- L-2 dust lock on the liquidator

    /// @dev Pushes NVDA 0.6% down and lets the TWAP and the feed follow, so the max borrower is liquidatable while the
    /// vault's gate is Ok (deposits open). Returns how many shares a liquidator may seize.
    function _liquidatableWithOpenGate() internal returns (uint256 seize) {
        _borrowNearLimit();
        _pushPrice(-60);
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        _setFeed(_poolPrice());
        vm.roll(vm.getBlockNumber() + 1);
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.Ok), "gate open: anyone can deposit");
        seize = _collateral(alice) / 4;
    }

    function _liquidator() internal returns (FlashLiquidator l) {
        l = new FlashLiquidator(MORPHO, vault, mp);
        deal(USDG, address(l), 10_000_000e6);
    }

    /// @dev A griefer mints dust shares to the liquidator in the block of the liquidation: the liquidator's lock now
    /// covers the dust, its whole-balance redeemInKind reverts SharesLocked, and the whole liquidation reverts.
    function test_poc_dustMintToLiquidatorRevertsLiquidation() public {
        uint256 seize = _liquidatableWithOpenGate();
        FlashLiquidator l = _liquidator();

        address griefer = makeAddr("griefer");
        _fund(griefer, 1e12); // 0.000001 NVDA, a fraction of a cent
        vm.prank(griefer);
        uint256 dust = vault.deposit(1e12, address(l));
        assertGt(dust, 0, "dust shares minted to the liquidator");

        vm.expectRevert(StockVault.SharesLocked.selector);
        l.go(alice, seize);

        // Same block, the liquidator redeeming exactly what it seized goes through: the lock only covers the dust.
        l.setExact(true);
        l.go(alice, seize);
        assertEq(IERC20(address(vault)).balanceOf(address(l)), dust, "only the dust is left");
    }

    /// @dev Control: without the dust mint the same sweep-the-balance liquidator succeeds.
    function test_poc_controlSweepLiquidatorWorksWithoutGrief() public {
        uint256 seize = _liquidatableWithOpenGate();
        FlashLiquidator l = _liquidator();
        l.go(alice, seize);
        assertEq(IERC20(address(vault)).balanceOf(address(l)), 0);
    }

    /// @dev Shares minted to Morpho itself cannot block a seizure: Morpho's balance always exceeds any one borrower's
    /// collateral by at least the minted amount.
    function test_poc_dustMintToMorphoCannotBlockLiquidation() public {
        uint256 seize = _liquidatableWithOpenGate();
        address griefer = makeAddr("griefer");
        _fund(griefer, 1e12);
        vm.prank(griefer);
        vault.deposit(1e12, address(MORPHO));
        vm.prank(liquidator);
        (uint256 seized,) = MORPHO.liquidate(mp, alice, seize, 0, "");
        assertEq(seized, seize);
    }
}

/// @dev v3 records no pending fees, so the oracle's rebuilt pending cut (gross - cut(uncollected) - totalAssets, with the
/// vault's own formulas) must come out zero with fees accrued, the USDG leg valued at a lower TWAP than Chainlink, and
/// the vault emptied of liquidity: a non-zero value here would be a rounding or composition mismatch.
contract OracleReviewV3Pending is ShareCollateralTest {
    /// @dev Before the O-L1 change: 323,285 cold and 183,646 warm.
    function test_measure_priceGasV3() public {
        uint256 g = gasleft();
        oracle.price();
        emit log_named_uint("v3 price() gas, first call", g - gasleft());
        g = gasleft();
        oracle.price();
        emit log_named_uint("v3 price() gas, warm", g - gasleft());
    }

    function test_pendingCutIsZeroOnV3() public {
        assertEq(oracle.pendingCutUsdg(), 0, "fresh position");
        _pushPrice(300);
        _pushPrice(-300);
        assertGt(vault.positionInfo().uncollectedStock + vault.positionInfo().uncollectedUsdg, 0, "fees accrued");
        assertEq(oracle.pendingCutUsdg(), 0, "uncollected fees are not pending");
        _setFeed(_poolPrice() * 10_050 / 10_000);
        assertEq(oracle.pendingCutUsdg(), 0, "Chainlink 50 bp above the TWAP");
    }
}

/// @dev The live NVDA/USDG v3 pool with no Uptick liquidity in it: what a liquidator who redeemed in kind meets when
/// it sells the NVDA leg.
contract OracleReviewDepth is Base {
    using Math for uint256;

    function test_measure_liquidationExitDepth() public {
        uint256 px = _poolPrice(); // 8 decimals
        uint256[5] memory usd = [uint256(1_000), 5_000, 25_000, 62_500, 100_000];
        emit log_named_uint("NVDA pool price, USD 1e8", px);
        for (uint256 i; i < usd.length; ++i) {
            uint256 snap = vm.snapshotState();
            uint256 amountIn = usd[i] * 1e8 * 1e18 / px;
            vm.prank(trader);
            uint256 out = ISwapRouter02(ROUTER).exactInputSingle(
                ISwapRouter02.ExactInputSingleParams(NVDA, USDG, 500, trader, amountIn, 0, 0)
            );
            uint256 fair = usd[i] * 1e6;
            emit log_named_uint("sell USD", usd[i]);
            emit log_named_uint("  discount, bp", (fair - Math.min(out, fair)) * 1e4 / fair);
            vm.revertToState(snap);
        }
    }
}

/// @dev v4 PLTR vault, real PoolManager.
contract OracleReviewV4 is ShareCollateralV4Test {
    using Math for uint256;

    /// @dev The builder's own scenario (fees swept into idle by a closed-gate redeemInKind) with one change: the
    /// Chainlink answer sits `offsetBps` above the pool, inside the vault's 100 bp deviation band. Before the fix the
    /// totalAssets() cap was the only thing that carried the treasury's cut of pending fees into the oracle, and the
    /// cap has slack whenever Chainlink is above the TWAP (the vault values its USDG at min(Chainlink, TWAP)), so the
    /// price rose by the cut. The oracle now subtracts the pending cut itself.
    /// Returns the cut at stake (ppm of the price), the signed price change across the sweep (ppm of the price before)
    /// and the oracle's own reading of the pending cut after the sweep (ppm of the price).
    function _sweepWithFeedOffset(uint256 offsetBps) internal returns (uint256 cutPpm, int256 changePpm, uint256 pendingPpm) {
        _deposit(bob, UNIT());
        _volume(VOL() * 2, 3);
        _advance(600);
        _settle();
        uint256 feedPx = _poolPrice() * (1e4 + offsetBps) / 1e4;
        _setFeed(feedPx);
        assertEq(oracle.pendingCutUsdg(), 0, "nothing is pending before the sweep");
        cutPpm = _feeShareValue() * 1e6 / oracle.price() * 1000 / 9000;
        uint256 before = oracle.price();
        uint256 dust = vault.totalSupply() / 1e6;

        vm.mockCall(
            FEED(),
            abi.encodeWithSelector(bytes4(keccak256("latestRoundData()"))),
            abi.encode(feedRound, int256(feedPx), vm.getBlockTimestamp() - 91_000, vm.getBlockTimestamp() - 91_000, feedRound)
        );
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.FeedStale));
        vm.prank(bob);
        vault.redeemInKind(dust, bob, bob);
        vm.clearMockedCalls();
        _setFeed(feedPx);
        assertEq(_feeShareValue(), 0, "the exit swept every uncollected fee into idle");
        uint256 afterP = oracle.price();
        changePpm = (int256(afterP) - int256(before)) * 1e6 / int256(before);
        pendingPpm = oracle.pendingCutUsdg() * 1e36 / (vault.totalSupply() + 1e6) * 1e6 / afterP;
        emit log_named_uint("feed above pool, bp", offsetBps);
        emit log_named_uint("treasury cut at stake, ppm of price", cutPpm);
        emit log_named_uint("pending cut the oracle derived, ppm of price", pendingPpm);
        emit log_named_int("price change across the sweep, ppm (signed)", changePpm);
    }

    /// @dev Chainlink 60 bp above the pool: before the fix the price rose 1,319 ppm (the whole cut, 1,318 ppm) across
    /// the sweep. Now it does not rise (at most 1 ppm). It can fall by a hair, never more than `offset x cut`: the vault
    /// does not say whether the pending fees are stock or USDG, and the oracle takes the dearer reading (all stock), so
    /// the part of the cut that is USDG is deducted at Chainlink / TWAP times its value. Measured: -3 ppm of a 1,263 ppm
    /// cut. That is the lender-side error bound of the rebuild, not a double count: a double count would drop the price
    /// by the whole cut.
    function test_poc_v4PendingCutDoesNotLeakWhenFeedAboveTwap() public {
        (uint256 cutPpm, int256 changePpm, uint256 pendingPpm) = _sweepWithFeedOffset(60);
        assertGe(cutPpm, 300, "a cut of at least 3 bp is at stake");
        assertGe(pendingPpm, cutPpm * 9 / 10, "the oracle sees the pending cut");
        assertLe(changePpm, 1, "the price did not rise by the treasury's cut");
        assertGe(changePpm, -int256(cutPpm * 60 / 1e4 + 1), "and fell by no more than offset x cut");
    }

    /// @dev Before the O-L1 change: 204,748 cold and 118,609 warm.
    function test_measure_priceGasV4() public {
        uint256 g = gasleft();
        oracle.price();
        emit log_named_uint("v4 price() gas, first call", g - gasleft());
        g = gasleft();
        oracle.price();
        emit log_named_uint("v4 price() gas, warm", g - gasleft());
    }

    /// @dev The edge of the deviation gate (100 bp): same bounds.
    function test_poc_v4PendingCutDoesNotLeakAtTheEdgeOfTheGate() public {
        (uint256 cutPpm, int256 changePpm,) = _sweepWithFeedOffset(95);
        assertLe(changePpm, 1);
        assertGe(changePpm, -int256(cutPpm * 95 / 1e4 + 1));
    }

    function test_poc_v4PendingCutControlFeedAtPool() public {
        (uint256 cutPpm, int256 changePpm, uint256 pendingPpm) = _sweepWithFeedOffset(0);
        assertGe(cutPpm, 300);
        assertGe(pendingPpm, cutPpm * 9 / 10, "the oracle sees the pending cut");
        assertLe(changePpm, 2, "with Chainlink at the pool the cap binds, as the builder's test shows");
        assertGe(changePpm, -2);
    }

    /// @dev Hypothesis tested and refuted for this pool. v4's TWAP is the keeper-fed ring: once the feed is older than
    /// maxStaleness poke writes nothing, the ring lapses after MAX_GAP, the vault reports TwapUnavailable and uses spot
    /// as its "TWAP". The oracle reads that only through the totalAssets() cap, and totalAssets() divides by the TWAP's
    /// USD price, which rounds to zero only with spot near the sqrt-price limit (tick below about -666,000 here).
    /// A 200M USDG buy moves the live PLTR pool to tick -31,813: the liquidity in it makes the revert unreachable.
    function test_measure_v4SpotFallbackPushCannotRevertPrice() public {
        uint256 px = _poolPrice();
        vm.warp(vm.getBlockTimestamp() + 200); // > MAX_GAP without a poke
        _setFeed(px);
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.TwapUnavailable));
        uint256 p0 = oracle.price();

        bool zeroForOne = !stockIsToken0; // buying the stock
        trader.swap(key, zeroForOne, 200_000_000e6, zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1);
        (, int24 tk) = _spot();
        emit log_named_int("spot tick after a 200M USDG buy", tk);
        uint256 p1 = oracle.price();
        emit log_named_int("oracle price change, ppm (signed)", (int256(p1) - int256(p0)) * 1e6 / int256(p0));
        assertGt(tk, -666_000, "the push stops far from the zero-price region");
        // With the cap reading spot, the cap still sits above the uncapped figure (concavity, USDG at px/min(px,twap)
        // >= 1), so a push can only add the fees it pays, never lower the price.
        assertGe(p1, p0, "a spot push through the TwapUnavailable fallback does not lower the price");
    }
}
