// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Base} from "./Base.t.sol";
import {V4Fixture} from "./v4/V4Fixture.sol";
import {StockVault} from "../src/StockVault.sol";
import {StockVaultV4} from "../src/v4/StockVaultV4.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {UptickShareOracle, IUptickVault, IVaultFactory} from "../src/UptickShareOracle.sol";

struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

/// @dev The slice of Morpho Blue the tests call. Addresses and parameters below were read from the chain (Morpho Blue API
/// `blue-api.morpho.org` chainId 4663 and `eth_call` on https://rpc.mainnet.chain.robinhood.com), and setUp asserts
/// the singleton's own `isIrmEnabled` / `isLltvEnabled` / `idToMarketParams` agree.
interface IMorpho {
    function owner() external view returns (address);
    function isIrmEnabled(address irm) external view returns (bool);
    function isLltvEnabled(uint256 lltv) external view returns (bool);
    function idToMarketParams(bytes32 id) external view returns (MarketParams memory);
    function createMarket(MarketParams memory marketParams) external;
    function supply(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external
        returns (uint256, uint256);
    function supplyCollateral(MarketParams memory marketParams, uint256 assets, address onBehalf, bytes memory data) external;
    function withdrawCollateral(MarketParams memory marketParams, uint256 assets, address onBehalf, address receiver) external;
    function borrow(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external
        returns (uint256, uint256);
    function liquidate(
        MarketParams memory marketParams,
        address borrower,
        uint256 seizedAssets,
        uint256 repaidShares,
        bytes memory data
    ) external returns (uint256, uint256);
    function position(bytes32 id, address user) external view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);
    function market(bytes32 id)
        external
        view
        returns (
            uint128 totalSupplyAssets,
            uint128 totalSupplyShares,
            uint128 totalBorrowAssets,
            uint128 totalBorrowShares,
            uint128 lastUpdate,
            uint128 fee
        );
    function accrueInterest(MarketParams memory marketParams) external;
}

interface IStockCorpActions {
    function oraclePaused() external view returns (bool);
}

/// @dev An Uptick NVDA vault share as Morpho Blue collateral against USDG, on a fork of Robinhood Chain (4663). The
/// Morpho Blue singleton, its IRM and its LLTVs are the live ones. The vault comes from VaultFactory like in
/// VaultFactory.t.sol and holds a real Uniswap v3 position; the Chainlink proxy is mocked the way Base does it. The oracle
/// is the production `UptickShareOracle`.
contract ShareCollateralTest is Base {
    using Math for uint256;

    IMorpho constant MORPHO = IMorpho(0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010);
    address constant IRM = 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1; // the one IRM every market on 4663 uses
    uint256 constant LLTV = 0.625e18; // the NVDA/USDG market with the most supply uses it
    /// @dev NVDA/USDG market 0x8b16891f...c3e: ~$729K supplied, LLTV 62.5%, this IRM. Its params anchor the choices above.
    bytes32 constant LIVE_NVDA_MARKET = 0x8b16891f032a93b771347c9cb470a780e6699dd701553d3402aa3cdba6189c3e;

    VaultFactory factory;
    StockVault direct; // Base's vault, built by hand and so not in the registry
    UptickShareOracle oracle;
    MarketParams mp;
    bytes32 id;
    address lender = makeAddr("lender");
    address liquidator = makeAddr("liquidator");
    address factoryOwner = makeAddr("factoryOwner");
    uint256 shares;

    function setUp() public override {
        super.setUp();
        direct = vault;
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

        // Morpho Blue as deployed: the singleton, an enabled IRM and an enabled LLTV, cross-checked against a live market
        assertGt(address(MORPHO).code.length, 0);
        assertTrue(MORPHO.isIrmEnabled(IRM));
        assertTrue(MORPHO.isLltvEnabled(LLTV));
        MarketParams memory live = MORPHO.idToMarketParams(LIVE_NVDA_MARKET);
        assertEq(live.loanToken, USDG);
        assertEq(live.collateralToken, NVDA);
        assertEq(live.irm, IRM);
        assertEq(live.lltv, LLTV);

        oracle = new UptickShareOracle(IVaultFactory(address(factory)), IUptickVault(address(vault)));
        mp = MarketParams(USDG, address(vault), address(oracle), IRM, LLTV);
        id = keccak256(abi.encode(mp));
        MORPHO.createMarket(mp);

        _supplyLoan(1_000_000e6);
        vm.startPrank(alice);
        IERC20(address(vault)).approve(address(MORPHO), type(uint256).max);
        MORPHO.supplyCollateral(mp, shares, alice, "");
        vm.stopPrank();
        deal(USDG, liquidator, 10_000_000e6);
        vm.prank(liquidator);
        IERC20(USDG).approve(address(MORPHO), type(uint256).max);
    }

    // ----------------------------------------------------------------- helpers

    function _supplyLoan(uint256 amount) internal {
        deal(USDG, lender, amount);
        vm.startPrank(lender);
        IERC20(USDG).approve(address(MORPHO), type(uint256).max);
        MORPHO.supply(mp, amount, 0, lender, "");
        vm.stopPrank();
    }

    /// @dev Morpho's own health maths: collateral * price / 1e36 * lltv / 1e18, both rounded down.
    function _maxBorrow() internal view returns (uint256) {
        (,, uint128 col) = MORPHO.position(id, alice);
        return uint256(col).mulDiv(oracle.price(), 1e36).mulDiv(LLTV, 1e18);
    }

    function _debt(address who) internal view returns (uint256) {
        (, uint128 bs,) = MORPHO.position(id, who);
        (,, uint128 tba, uint128 tbs,,) = MORPHO.market(id);
        return uint256(bs).mulDiv(uint256(tba) + 1, uint256(tbs) + 1e6, Math.Rounding.Ceil);
    }

    function _collateral(address who) internal view returns (uint256 c) {
        (,, uint128 col) = MORPHO.position(id, who);
        c = col;
    }

    function _borrowNearLimit() internal returns (uint256 amount) {
        amount = _maxBorrow() - 20; // a few wei of rounding headroom: Morpho rounds borrow shares and debt up
        vm.prank(alice);
        MORPHO.borrow(mp, amount, 0, alice, alice);
    }

    function _sharePriceUsdg(uint256 p) internal pure returns (uint256) {
        return p * 1e24 / 1e36; // raw USDG per whole share (1e24 raw units)
    }

    function _bps(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a > b ? a - b : b - a) * 1e4 / b;
    }

    // ------------------------------------------------------------------ price

    function test_priceIsTheVaultsValuePerShareInRawUnits() public view {
        uint256 p = oracle.price();
        // Reference built from the vault's own public valuation (TWAP composition, Chainlink on the stock) divided
        // the way ERC-4626 divides it, including the 1e6 virtual shares. Both are conservative vs the other only
        // through the composition term, so they must agree to within a few bp on an undisturbed pool.
        uint256 ref = vault.totalValueInUSDG().mulDiv(1e36, vault.totalSupply() + 1e6);
        assertGt(p, 0);
        assertLe(p, ref + ref / 1e6, "never above the vault's own valuation");
        assertLe(_bps(p, ref), 5, "within 5 bp of the vault's valuation on an undisturbed pool");

        // Decimals, independent of the oracle: one whole share (1e24 raw) redeems pricePerShare() NVDA wei, worth
        // that times the feed answer in USDG raw units (6 decimals).
        uint256 usdgPerShare = vault.pricePerShare().mulDiv(_feedPrice() * 1e6, 1e8 * 1e18);
        assertLe(_bps(_sharePriceUsdg(p), usdgPerShare), 5, "share price in raw USDG per whole share");
        // 24-decimal share, 6-decimal loan token: price is 1e36 * 1e6 / 1e24 = 1e18 times USD per share
        assertGt(p, 1e20, "a 200 USD share is ~2e20, not 2e8 or 2e32");
        assertLt(p, 1e22);
    }

    function test_priceFollowsTheChainlinkAnswerAndNotTheStockLegOneForOne() public {
        uint256 p0 = oracle.price();
        _setFeed(_feedPrice() * 90 / 100);
        uint256 p1 = oracle.price();
        assertLt(p1, p0, "a lower feed lowers the price");
        // A concentrated position holds USDG as the stock falls and is not marked 1:1 with the stock
        assertGt(p1 * 1e4 / p0, 9000, "a 10% fall in the stock is a smaller fall in the share");
        assertLt(p1 * 1e4 / p0, 9990);
    }

    // ----------------------------------------------------------------- market

    function test_borrowUpToTheLimitAndNotBeyond() public {
        uint256 limit = _maxBorrow();
        assertGt(limit, 1000e6, "a real position: thousands of USDG");
        // ~62.5% of the share value
        assertLe(_bps(limit, uint256(shares).mulDiv(oracle.price(), 1e36).mulDiv(0.625e18, 1e18)), 1);
        uint256 usdgBefore = IERC20(USDG).balanceOf(alice);
        uint256 amount = _borrowNearLimit();
        assertEq(IERC20(USDG).balanceOf(alice) - usdgBefore, amount, "the lender's USDG reached the borrower");
        assertGe(_debt(alice) + 1000, amount);

        // beyond LLTV reverts, and so does pulling the collateral out from under the debt
        vm.prank(alice);
        vm.expectRevert(bytes("insufficient collateral"));
        MORPHO.borrow(mp, limit / 100, 0, alice, alice);
        vm.prank(alice);
        vm.expectRevert(bytes("insufficient collateral"));
        MORPHO.withdrawCollateral(mp, shares / 10, alice, alice);
    }

    function test_borrowAboveTheLimitOnAFreshPositionReverts() public {
        uint256 limit = _maxBorrow();
        vm.prank(alice);
        vm.expectRevert(bytes("insufficient collateral"));
        MORPHO.borrow(mp, limit + limit / 1000, 0, alice, alice);
    }

    // ---------------------------------------------------- manipulation resistance

    function test_poolPushUpDoesNotMoveThePrice() public {
        _pushAndCheck(300, 250);
    }

    function test_poolPushDownDoesNotMoveThePrice() public {
        _pushAndCheck(-400, 350);
    }

    /// @dev A swap big enough to move the pool several percent also pays the vault's position real fees, which are part of
    /// the vault's value. So the price may rise by that income and by nothing else: price change less the change in the
    /// vault's own uncollected-fee figure (net of the treasury cut) stays within 1 bp (100 ppm), and the fee income itself
    /// is under 3 bp, so the allowance cannot hide a real move.
    function _pushAndCheck(int256 pushBps, uint256 minSpotMoveBps) internal {
        uint256 p0 = oracle.price();
        uint256 f0 = _feeShareValue();
        uint256 spot0 = _poolPrice();
        _pushPrice(pushBps);
        assertGe(_bps(_poolPrice(), spot0), minSpotMoveBps, "the pool spot moved several percent");
        uint256 p1 = oracle.price();
        uint256 f1 = _feeShareValue();
        assertGt(f1, f0, "the swap paid the position fees");
        assertLe((f1 - f0) * 1e4 / p0, 3, "fee income is under 3 bp");
        assertLe(_ppm(p1, p0 + (f1 - f0)), 100, "oracle price unchanged within 1 bp once the fees the swap paid are counted");
    }

    /// @dev Uncollected fees net of the performance cut, as a price per raw share (the oracle's own units).
    function _feeShareValue() internal view returns (uint256) {
        StockVault.PositionInfo memory i = vault.positionInfo();
        uint256 usdgValue = i.uncollectedStock * (_feedPrice() * 1e6) / (1e8 * 1e18) + i.uncollectedUsdg;
        return usdgValue * 9000 / 10_000 * 1e36 / (vault.totalSupply() + 1e6);
    }

    function _ppm(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a > b ? a - b : b - a) * 1e6 / b;
    }

    function test_pushingThePoolDownCannotLiquidateAMaxBorrower() public {
        _borrowNearLimit();
        uint256 feedUsd = _feedPrice();
        _pushPrice(-1000); // a 10% crash of the pool in one block
        assertGe(_bps(_poolPrice(), feedUsd), 900, "spot is far from the feed");
        uint256 half = _collateral(alice) / 2;
        vm.prank(liquidator);
        vm.expectRevert(bytes("position is healthy"));
        MORPHO.liquidate(mp, alice, half, 0, "");
    }

    // -------------------------------------------------------------- liquidation

    function test_aChainlinkFallLiquidatesAndTheLiquidatorCanExitInKind() public {
        uint256 borrowed = _borrowNearLimit();
        uint256 p0 = oracle.price();
        uint256 quarter = _collateral(alice) / 4;
        vm.prank(liquidator);
        vm.expectRevert(bytes("position is healthy"));
        MORPHO.liquidate(mp, alice, quarter, 0, "");

        _setFeed(_feedPrice() * 60 / 100);
        uint256 p1 = oracle.price();
        assertLt(p1 * 1e4 / p0, 9000, "the share fell more than 10%");
        // a 40% fall takes the +-5% range fully into the stock, so the share falls almost as far as the stock does
        assertGt(p1 * 1e4 / p0, 5500, "and less than the stock, the USDG that was in the position stays");

        uint256 col0 = _collateral(alice);
        uint256 debt0 = _debt(alice);
        uint256 seize = col0 / 2;
        vm.prank(liquidator);
        (uint256 seized, uint256 repaid) = MORPHO.liquidate(mp, alice, seize, 0, "");

        assertEq(seized, seize);
        assertEq(IERC20(address(vault)).balanceOf(liquidator), seized, "the liquidator holds the seized shares");
        assertEq(_collateral(alice), col0 - seized);
        assertLt(_debt(alice), debt0);
        assertApproxEqAbs(debt0 - _debt(alice), repaid, 2);
        assertGt(repaid, borrowed / 10);
        // incentive: the shares are worth more than the debt repaid at the oracle's own price
        assertGt(seized.mulDiv(p1, 1e36), repaid);

        // The gate is closed (the feed is 40% off the pool) so the vault will not sell, but redeemInKind never closes.
        (StockVault.Status st,,,,,) = vault.health();
        assertTrue(st != StockVault.Status.Ok, "the vault's priced paths are closed");
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(liquidator);
        (uint256 outStock, uint256 outUsdg) = vault.redeemInKind(seized, liquidator, liquidator);
        assertGt(outStock + outUsdg, 0);
        uint256 basketUsdg = outUsdg + outStock.mulDiv(_feedPrice() * 1e6, 1e8 * 1e18);
        assertGe(basketUsdg, repaid, "the basket the liquidator walks away with is worth more than it repaid");
        assertGt(_collateral(alice), 0, "collateral is left: no bad debt");
    }

    function test_liquidationWorksOnAStaleFeedInsideACorporateActionWindow() public {
        _borrowNearLimit();
        uint256 updatedAt = vm.getBlockTimestamp();
        uint256 quarter = _collateral(alice) / 4;
        vm.prank(liquidator);
        vm.expectRevert(bytes("position is healthy"));
        MORPHO.liquidate(mp, alice, quarter, 0, "");

        // A weekend: the feed prints nothing for 60 h while interest accrues, and the Stock Token reports a paused oracle
        vm.warp(updatedAt + 60 hours);
        vm.mockCall(NVDA, abi.encodeWithSelector(IStockCorpActions.oraclePaused.selector), abi.encode(true));
        (StockVault.Status st,, uint256 feedTs,,,) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.CorporateAction));
        assertEq(vm.getBlockTimestamp() - feedTs, 60 hours);

        uint256 p = oracle.price(); // no revert
        assertGt(p, 0);
        // the vault itself refuses to price a deposit now, which is the point of keeping the oracle answering
        _fund(bob, 1e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(StockVault.OracleUnhealthy.selector, StockVault.Status.CorporateAction));
        vault.deposit(1e18, bob);

        // interest alone pushed the borrower over the limit; the liquidation goes through at the stale price
        vm.prank(liquidator);
        (uint256 seized,) = MORPHO.liquidate(mp, alice, quarter, 0, "");
        assertEq(seized, quarter);
    }

    // ----------------------------------------------------------- feed behaviour

    function test_priceStaysThroughAWeekendAndRevertsPastTheBound() public {
        uint256 updatedAt = vm.getBlockTimestamp();
        uint256 p0 = oracle.price();
        uint256 bound = oracle.MAX_FEED_AGE();
        assertEq(bound, 349_200);

        vm.warp(updatedAt + 80.8 hours); // the longest weekend measured on the equity feeds
        assertLe(_bps(oracle.price(), p0), 1, "same price: no new print, no new fees");

        vm.warp(updatedAt + bound);
        assertGt(oracle.price(), 0, "exactly at the bound still prices");
        vm.warp(updatedAt + bound + 1);
        vm.expectRevert(abi.encodeWithSelector(UptickShareOracle.FeedTooOld.selector, updatedAt));
        oracle.price();
    }

    function test_unusableFeedRevertsInsteadOfPricingZero() public {
        vm.mockCall(
            FEED,
            abi.encodeWithSelector(bytes4(keccak256("latestRoundData()"))),
            abi.encode(feedRound, int256(0), block.timestamp, block.timestamp, feedRound)
        );
        vm.expectRevert(UptickShareOracle.FeedInvalid.selector);
        oracle.price();
    }

    function test_onlyFactoryVaultsGetAnOracle() public {
        vm.expectRevert(UptickShareOracle.NotRegisteredVault.selector);
        new UptickShareOracle(IVaultFactory(address(factory)), IUptickVault(address(direct)));
        vm.expectRevert(UptickShareOracle.NotRegisteredVault.selector);
        new UptickShareOracle(IVaultFactory(address(factory)), IUptickVault(makeAddr("anything")));
    }
}

/// @dev The same oracle on a StockVaultV4 (PLTR, 1% pool, real PoolManager): the price matches the vault's valuation and
/// a push of the v4 pool does not move it.
contract ShareCollateralV4Test is V4Fixture {
    address internal constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address internal constant V3_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;

    VaultFactory factory;
    UptickShareOracle oracle;
    address factoryOwner = makeAddr("factoryOwner");

    function STOCK() internal pure override returns (address) {
        return 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A;
    }

    function FEED() internal pure override returns (address) {
        return 0x820ABedFF239034956B7A9d2F0a331f9F075eB4c;
    }

    function FEE() internal pure override returns (uint24) {
        return 10_000;
    }

    function SPACING() internal pure override returns (int24) {
        return 200;
    }

    function setUp() public override {
        super.setUp();
        bytes memory code3 = vm.getCode("StockVault.sol:StockVault");
        bytes memory code4 = vm.getCode("StockVaultV4.sol:StockVaultV4");
        StockVault.Params memory p = StockVault.Params(500, 1000, 100, 100, 30, 90_000, 600, 1 hours);
        factory = new VaultFactory(
            factoryOwner,
            keccak256(code3),
            keccak256(code4),
            address(PM),
            VaultFactory.Defaults(USDG, NPM, V3_ROUTER, owner, keeper, treasury, p)
        );
        vm.prank(factoryOwner);
        vault = StockVaultV4(factory.createVaultV4(code4, STOCK(), FEE(), SPACING(), address(0), FEED(), 0));
        _seed();
        _instant();
        _deposit(alice, UNIT());
        oracle = new UptickShareOracle(IVaultFactory(address(factory)), IUptickVault(address(vault)));
    }

    function _bps(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a > b ? a - b : b - a) * 1e4 / b;
    }

    function _ppm(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a > b ? a - b : b - a) * 1e6 / b;
    }

    function test_v4PriceMatchesTheVaultsValuation() public view {
        (,,, uint128 liq,,,,,) = _info();
        assertGt(liq, 0, "a real v4 position");
        uint256 p = oracle.price();
        uint256 value = vault.totalAssets() * (_feedNow() * 1e6) / (1e8 * 1e18);
        uint256 ref = value * 1e36 / (vault.totalSupply() + 1e6);
        assertLe(p, ref + ref / 1e6, "never above the vault's own valuation");
        assertLe(_bps(p, ref), 10, "within 10 bp");
        assertGt(p, 0);
    }

    /// @dev A push through a 1% pool pays the position real fees, so the price rises by exactly that income and by
    /// nothing the spot did: the price change, less the vault's own uncollected-fee figure (net of the treasury cut),
    /// is under 1 bp.
    function test_v4PoolPushMovesThePriceOnlyByTheFeesItPays() public {
        uint256 p0 = oracle.price();
        uint256 f0 = _feeShareValue();
        uint256 spot0 = _poolPrice();
        _pushPrice(300);
        assertGe(_bps(_poolPrice(), spot0), 250, "the v4 pool moved several percent");
        uint256 p1 = oracle.price();
        uint256 f1 = _feeShareValue();
        assertGt(f1, f0, "the push paid the position fees");
        assertLe((f1 - f0) * 1e4 / p0, 30, "the income is a real, bounded amount");
        assertLe(_ppm(p1, p0 + (f1 - f0)), 100, "all of the movement is fee income, within 1 bp");
        _pushPrice(-700);
        uint256 p2 = oracle.price();
        uint256 f2 = _feeShareValue();
        assertLe(_ppm(p2, p0 + (f2 - f0)), 100, "and after a push the other way");
    }

    /// @dev Uncollected fees net of the performance cut, as a price per raw share (the oracle's own units).
    function _feeShareValue() internal view returns (uint256) {
        StockVaultV4.PositionInfo memory i = vault.positionInfo();
        (, uint256 px,,,,) = vault.health();
        uint256 usdg = i.uncollectedStock * (px * 1e6) / (1e8 * 1e18) + i.uncollectedUsdg;
        return usdg * 9000 / 10_000 * 1e36 / (vault.totalSupply() + 1e6);
    }

    function _feedNow() internal view returns (uint256) {
        (, uint256 px,,,,) = vault.health();
        return px;
    }

    function _info() internal view returns (bool a, int24 b, int24 c, uint128 liq, uint256 d, uint256 e, uint256 f, uint256 g, bool h) {
        StockVaultV4.PositionInfo memory i = vault.positionInfo();
        return (i.open, i.tickLower, i.tickUpper, i.liquidity, i.stockAmount, i.usdgAmount, i.uncollectedStock, i.uncollectedUsdg, i.inRange);
    }
}
