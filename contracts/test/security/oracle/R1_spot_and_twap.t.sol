// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";

import {StockVaultV4} from "../../../src/v4/StockVaultV4.sol";
import {FreshReviewV4, PreFixOracle} from "./FreshReview.t.sol";
import {IUptickVault, IVaultFactory, IOracleDeployer} from "../../../src/UptickShareOracle.sol";
import {IOracle} from "../../../src/interfaces/IOracle.sol";
import {IAggregatorV3} from "../../../src/interfaces/IUniswapV3.sol";
import {VaultMath} from "../../../src/VaultMath.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @dev Donates to the pool's in-range liquidity in one unlock and pays for it.
contract Donor is IUnlockCallback {
    IPoolManager immutable pm;
    PoolKey key;
    uint256 a0;
    uint256 a1;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    function donate(PoolKey memory k, uint256 x0, uint256 x1) external {
        key = k;
        (a0, a1) = (x0, x1);
        pm.unlock("");
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
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

/// @dev Must-fail reference: the oracle as of 9035e61 (before the C-1 fix), verbatim but for the name and comments.
contract PreC1Oracle is IOracle {
    using Math for uint256;

    uint256 public constant MAX_FEED_AGE = 349_200;
    uint256 private constant Q96 = 1 << 96;
    uint8 private constant FEED_INVALID = 1; // Status.FeedInvalid in StockVault and StockVaultV4

    IVaultFactory public immutable factory;
    IUptickVault public immutable vault;
    address public immutable oracleFactory;
    IERC20 public immutable stock;
    IERC20 public immutable usdg;
    bool public immutable stockIsToken0;
    VaultMath public immutable vaultMath;
    uint256 private immutable virtualShares;
    uint256 private immutable stockScale;
    uint256 private immutable usdgScale;

    error NotRegisteredVault();
    error FeedInvalid();
    error FeedTooOld(uint256 updatedAt);

    constructor() {
        (IVaultFactory factory_, IUptickVault vault_) = IOracleDeployer(msg.sender).deployParams();
        if (!factory_.isVault(address(vault_))) revert NotRegisteredVault();
        factory = factory_;
        oracleFactory = msg.sender;
        vault = vault_;
        IERC20Metadata stock_ = IERC20Metadata(vault_.stock());
        IERC20Metadata usdg_ = IERC20Metadata(vault_.usdg());
        stock = stock_;
        usdg = usdg_;
        stockIsToken0 = vault_.stockIsToken0();
        vaultMath = VaultMath(vault_.vaultMath());
        virtualShares = 10 ** (vault_.decimals() - stock_.decimals());
        stockScale = 10 ** (uint256(stock_.decimals()) + IAggregatorV3(vault_.feed()).decimals());
        usdgScale = 10 ** uint256(usdg_.decimals());
    }

    function price() external view returns (uint256) {
        (uint8 status, uint256 px, uint256 updatedAt, uint160 sqrtOracle, uint160 sqrtTwap,) = vault.health();
        if (status == FEED_INVALID) revert FeedInvalid();
        if (block.timestamp - updatedAt > MAX_FEED_AGE) revert FeedTooOld(updatedAt);
        return valueInUsdg(px, sqrtOracle, sqrtTwap).mulDiv(1e36, vault.totalSupply() + virtualShares);
    }

    function valueInUsdg(uint256 px, uint160 sqrtOracle, uint160 sqrtTwap) public view returns (uint256) {
        IUptickVault.PositionInfo memory p = vault.positionInfo();
        uint256 posStock;
        uint256 posUsdg;
        if (p.liquidity != 0) {
            (uint256 a0, uint256 a1) = vaultMath.amounts(sqrtOracle, p.tickLower, p.tickUpper, p.liquidity);
            (posStock, posUsdg) = stockIsToken0 ? (a0, a1) : (a1, a0);
        }
        uint256 owed = vault.totalStockOwed();
        uint256 idle = stock.balanceOf(address(vault));
        idle = idle > owed ? idle - owed : 0;
        uint256 idleUsdg = usdg.balanceOf(address(vault));
        uint256 usdgPerStock = px * usdgScale;
        uint256 value = (idle + posStock + p.uncollectedStock).mulDiv(usdgPerStock, stockScale) + idleUsdg + posUsdg
            + p.uncollectedUsdg;
        (, uint16 perfFeeBps,,,,,,) = vault.params();
        uint256 feeValue = p.uncollectedStock.mulDiv(usdgPerStock, stockScale) + p.uncollectedUsdg;
        uint256 cut = feeValue.mulDiv(perfFeeBps, 1e4, Math.Rounding.Ceil);
        uint256 ta = vault.totalAssets();
        cut += _pendingCutUsdg(p, idle, idleUsdg, px, sqrtTwap, perfFeeBps, ta);
        value = value > cut ? value - cut : 0;

        return Math.min(value, ta.mulDiv(usdgPerStock, stockScale));
    }

    function pendingCutUsdg() external view returns (uint256) {
        (, uint256 px,,, uint160 sqrtTwap,) = vault.health();
        IUptickVault.PositionInfo memory p = vault.positionInfo();
        uint256 owed = vault.totalStockOwed();
        uint256 idle = stock.balanceOf(address(vault));
        (, uint16 perfFeeBps,,,,,,) = vault.params();
        return _pendingCutUsdg(
            p, idle > owed ? idle - owed : 0, usdg.balanceOf(address(vault)), px, sqrtTwap, perfFeeBps, vault.totalAssets()
        );
    }

    function _pendingCutUsdg(
        IUptickVault.PositionInfo memory p,
        uint256 idle,
        uint256 idleUsdg,
        uint256 px,
        uint160 sqrtTwap,
        uint16 perfFeeBps,
        uint256 ta
    ) private view returns (uint256) {
        uint256 navScale = Math.min(px, _sqrtToUsd(sqrtTwap)) * usdgScale;
        uint256 gross = idle + p.stockAmount + p.uncollectedStock
            + (idleUsdg + p.usdgAmount + p.uncollectedUsdg).mulDiv(stockScale, navScale);
        uint256 uncollectedCut = (p.uncollectedStock + p.uncollectedUsdg.mulDiv(stockScale, navScale)) * perfFeeBps / 1e4;
        uint256 pending = gross > uncollectedCut + ta ? gross - uncollectedCut - ta : 0;
        return pending.mulDiv(px * usdgScale, stockScale);
    }

    function _sqrtToUsd(uint160 sqrtP) private view returns (uint256) {
        uint256 price96 = Math.mulDiv(sqrtP, sqrtP, Q96);
        return stockIsToken0
            ? Math.mulDiv(price96, stockScale, Q96) / usdgScale
            : Math.mulDiv(stockScale, Q96, price96) / usdgScale;
    }
}

/// @dev Round 1 independent review of r2-oracle-fix (cbdbb37), lens: every path by which pool spot or a stale/derived
/// TWAP reaches `UptickShareOracle.price()`. Fork of 4663 at head through the public RPC:
///   forge test --match-contract R1Spot --match-test test_r1 -j 1 -vv
/// Both orientations: PLTR (Stock Token currency1, 1%, spacing 200) here, TSLA (currency0, 0.3%, spacing 60) below.
contract R1SpotTwapV4 is FreshReviewV4 {
    /// @dev Must-fail switch: with R1_PREC1=true the tests that guard C-1 run against the pre-fix oracle (9035e61),
    /// etched over the deployed one, and must go red. Default off.
    function _mutant() internal {
        if (!vm.envOr("R1_PREC1", false)) return;
        PreC1Oracle m = new PreC1Oracle();
        vm.etch(address(oracle), address(m).code);
    }

    function deployParams() external view returns (IVaultFactory, IUptickVault) {
        return (IVaultFactory(address(factory)), IUptickVault(address(vault)));
    }
    /// @dev Vault value in raw USDG at the oracle price.
    function _value() internal view returns (uint256) {
        return oracle.price() * (vault.totalSupply() + 1e6) / 1e36;
    }

    /// @dev Buys the Stock Token from the pool until it trades at `usd` (or the trader's USDG runs out).
    function _buyTo(uint256 usd) internal {
        uint256 u = IERC20(USDG).balanceOf(address(trader));
        trader.swap(key, !stockIsToken0, u, _sqrtAtUsd(usd));
    }

    function _stockUsd(uint256 amt, uint256 px) internal pure returns (uint256) {
        return amt * px / 1e20;
    }

    /// @dev Weekend, ring lapsed, fees pending: push the Stock Token UP by up to 10,000x and to the sqrt-price limit.
    /// nav = min(Chainlink, spot) stays at Chainlink, the position legs in `totalAssets()` are valued at Chainlink, so
    /// neither the pending-cut deduction nor the cap may move the price below its pre-push value.
    function test_r1_weekendPushUpWithPendingNeverLowersPrice() public {
        _mutant();
        uint256 px = _accrue();
        _weekend(px, true);
        uint256 p0 = oracle.price();
        assertGt(oracle.pendingCutUsdg(), 0, "fees pending");
        uint256 floor = p0 - p0 / 1e6;
        uint256[5] memory ks = [uint256(2), 10, 100, 1e3, 1e4];
        for (uint256 i; i < ks.length; ++i) {
            _buyTo(px * ks[i]);
            uint256 p = oracle.price();
            emit log_named_uint("--- spot pushed UP by factor", ks[i]);
            emit log_named_uint("spot USD (8 dec)", _poolPrice());
            emit log_named_int("oracle price change, ppm", _dppm(p, p0));
            assertGe(p, floor, "an upward spot push lowered the price");
        }
    }

    /// @dev The residual the fix accepts: a downward push values the stock part of the pending cut at nav < Chainlink,
    /// so the deduction shrinks. The shrink must be at most perfFee x pendingStock x Chainlink (the O-L1 Low), and the
    /// price rise at most that plus the fees the push itself pays the position (net of the cut).
    function test_r1_weekendPushDownUpsideBoundedByStockPartOfPendingCut() public {
        _mutant();
        uint256 px = _accrue();
        StockVaultV4.PositionInfo memory i0 = vault.positionInfo();
        _weekend(px, true);
        StockVaultV4.PositionInfo memory i1 = vault.positionInfo();
        assertEq(i1.uncollectedStock + i1.uncollectedUsdg, 0, "swept into pending");
        uint256 pc0 = oracle.pendingCutUsdg();
        uint256 v0 = _value();
        uint256 p0 = oracle.price();
        uint256 expect = (_stockUsd(i0.uncollectedStock, px) + i0.uncollectedUsdg) / 10;
        emit log_named_uint("pending stock fees (1e18)", i0.uncollectedStock);
        emit log_named_uint("pending USDG fees (raw)", i0.uncollectedUsdg);
        emit log_named_uint("pendingCutUsdg at spot = Chainlink (raw)", pc0);
        emit log_named_uint("perf x pending fees at Chainlink (raw)", expect);
        assertApproxEqRel(pc0, expect, 0.01e18, "rebuild recovers the vault's pending cut");

        _sellTo(px / 1e4);
        uint256 pc1 = oracle.pendingCutUsdg();
        uint256 p1 = oracle.price();
        StockVaultV4.PositionInfo memory i2 = vault.positionInfo();
        uint256 bound = _stockUsd(i0.uncollectedStock, px) / 10;
        uint256 pushIncome = (_stockUsd(i2.uncollectedStock, px) + i2.uncollectedUsdg) * 9 / 10;
        uint256 rise = p1 > p0 ? (p1 - p0) * (vault.totalSupply() + 1e6) / 1e36 : 0;
        emit log_named_uint("pendingCutUsdg after push to 1/10,000 (raw)", pc1);
        emit log_named_uint("deduction shrink (raw USDG)", pc0 - pc1);
        emit log_named_uint("bound: perf x pendingStock x Chainlink (raw)", bound);
        emit log_named_uint("value rise (raw USDG)", rise);
        emit log_named_uint("fee income the push paid the position, net (raw)", pushIncome);
        emit log_named_uint("residual upside, ppm of value", (pc0 - pc1) * 1e6 / v0);
        assertLe(pc0 - pc1, bound + bound / 100 + 2, "deduction shrinks by at most the stock part of the cut");
        assertLe(rise, pushIncome + bound + bound / 100 + 2, "price rises by no more than income + residual");
    }

    /// @dev Worst case of the residual: the attacker manufactures pending stock fees during the weekend (round trips
    /// through the pool, then a dust redeemInKind to sweep them), then pushes spot down. The over-valuation must be a
    /// small fraction of the price and cost the attacker more in pool fees than it could ever over-borrow.
    function test_r1_manufacturedPendingThenPushIsUnprofitable() public {
        uint256 px = _accrue();
        _deposit(attacker, UNIT());
        uint256 t = vm.getBlockTimestamp() - 91_000;
        vm.mockCall(FEED(), abi.encodeWithSelector(LRD), abi.encode(feedRound, int256(px), t, t, feedRound));
        vm.warp(vm.getBlockTimestamp() + 200);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 s0 = IERC20(STOCK()).balanceOf(address(trader));
        uint256 u0 = IERC20(USDG).balanceOf(address(trader));
        _volume(VOL() * 3, 10);
        uint256 cost = (s0 - IERC20(STOCK()).balanceOf(address(trader))) * px / 1e20;
        uint256 uAfter = IERC20(USDG).balanceOf(address(trader));
        cost = uAfter < u0 ? cost + (u0 - uAfter) : (cost > uAfter - u0 ? cost - (uAfter - u0) : 0);
        uint256 shares = vault.balanceOf(attacker);
        vm.prank(attacker);
        vault.redeemInKind(shares / 1e6, attacker, attacker);
        uint256 pc0 = oracle.pendingCutUsdg();
        uint256 v0 = _value();
        _sellTo(px / 1e6);
        uint256 pc1 = oracle.pendingCutUsdg();
        uint256 upside = pc0 - pc1;
        emit log_named_uint("vault value (raw USDG)", v0);
        emit log_named_uint("round-trip fees paid by attacker at Chainlink (raw USDG)", cost);
        emit log_named_uint("pendingCutUsdg after sweep (raw)", pc0);
        emit log_named_uint("over-valuation from the push (raw USDG)", upside);
        emit log_named_uint("over-valuation, bp of value", upside * 1e4 / v0);
        emit log_named_uint("max extra borrow at LLTV 62.5% (raw USDG)", upside * 625 / 1000);
        assertGt(pc0, 0, "manufactured pending");
        assertLt(upside * 625 / 1000, cost, "over-borrow is worth less than the fees paid to create it");
        assertLt(upside * 1e4 / v0, 6000, "far from the 60% needed for bad debt at LLTV 62.5%");
    }

    /// @dev Keeper outage on a weekday: feed fresh, nobody pokes for 200 s, status TwapUnavailable and spot reported
    /// as the TWAP. Sweep, then push down and up: the price must not fall.
    function test_r1_keeperOutagePushBothWaysNeverLowersPrice() public {
        _mutant();
        uint256 px = _accrue();
        vm.warp(vm.getBlockTimestamp() + 200);
        vm.roll(vm.getBlockNumber() + 1);
        _setFeed(px);
        (StockVaultV4.Status st,,,, uint160 twap, uint160 spot) = vault.health();
        assertEq(uint8(st), uint8(StockVaultV4.Status.TwapUnavailable), "outage: ring lapsed with a fresh feed");
        assertEq(twap, spot);
        uint256 part = vault.balanceOf(bob) / 1e6;
        vm.prank(bob);
        vault.redeemInKind(part, bob, bob);
        uint256 p0 = oracle.price();
        uint256 floor = p0 - p0 / 1e6;
        assertGt(oracle.pendingCutUsdg(), 0, "fees pending");
        _sellTo(px / 1e3);
        emit log_named_int("push down 1000x, ppm", _dppm(oracle.price(), p0));
        assertGe(oracle.price(), floor, "outage push down lowered the price");
        _buyTo(px * 1e3);
        emit log_named_int("push up 1000x, ppm", _dppm(oracle.price(), p0));
        assertGe(oracle.price(), floor, "outage push up lowered the price");
    }

    /// @dev Live ring, fees pending: the attacker holds spot at 1/10 of Chainlink for 11 minutes and pokes every 21 s
    /// (the MIN_GAP floor) with the feed fresh. Every observation is clamped to Chainlink +-maxDeviationBps ticks and
    /// MAX_STEP per write, so the TWAP, and with it nav, stays within 1% of Chainlink; the price must not fall. A
    /// same-block poke after a push (the in-unlock sandwich) writes a tick that weighs 0 s and cannot move the TWAP.
    function test_r1_liveRingPokeSandwichAndHeldPush() public {
        _mutant();
        uint256 px = _accrue();
        _weekend(px, true);
        _setFeed(px);
        _advance(15 minutes); // the first poke after the lapse restarts the record; a whole window must follow it
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.Ok), "ring live, gate open");
        px = _poolPrice();
        _setFeed(px);
        uint256 pc = oracle.pendingCutUsdg();
        assertGt(pc, 0, "pending survives: poke never harvests");
        uint256 p0 = oracle.price();
        uint256 floor = p0 - p0 / 1e6;
        (,,,, uint160 tw0,) = vault.health();

        _sellTo(px / 10);
        vault.poke();
        (,,,, uint160 tw1,) = vault.health();
        assertEq(tw1, tw0, "same-block poke after a push does not move the TWAP");
        assertGe(oracle.price(), floor, "sandwich lowered the price");

        uint256 minTwapUsd = type(uint256).max;
        for (uint256 i; i < 32; ++i) {
            vm.warp(vm.getBlockTimestamp() + 21);
            vm.roll(vm.getBlockNumber() + 1);
            _setFeed(px);
            vault.poke();
            (,,,, uint160 tw,) = vault.health();
            uint256 u = _usdOf(tw);
            if (u < minTwapUsd) minTwapUsd = u;
            assertGe(oracle.price(), floor, "held push lowered the price");
        }
        emit log_named_uint("Chainlink (8 dec)", px);
        emit log_named_uint("lowest TWAP reached holding spot at 1/10 (8 dec)", minTwapUsd);
        emit log_named_int("oracle price change at the end, ppm", _dppm(oracle.price(), p0));
        assertGe(minTwapUsd * 10_000, px * 9_890, "TWAP held within maxDeviationBps (+1 tick) of Chainlink");
    }

    /// @dev donate(): the attacker pays X USDG into the pool's in-range fee growth. The vault's value may rise by at
    /// most its share of X net of the cut: real income, paid for in full by the attacker.
    function test_r1_donateRaisesPriceByLessThanItCosts() public {
        uint256 px = _accrue();
        _weekend(px, true);
        uint256 v0 = _value();
        Donor d = new Donor(PM);
        uint256 x = 100_000e6;
        deal(USDG, address(d), x);
        (uint256 x0, uint256 x1) = stockIsToken0 ? (uint256(0), x) : (x, uint256(0));
        d.donate(key, x0, x1);
        uint256 v1 = _value();
        emit log_named_uint("donated (raw USDG)", x);
        emit log_named_uint("vault value rise (raw USDG)", v1 - v0);
        assertLe(v1 - v0, x * 9 / 10 + 1, "value rises by at most the vault's share of the donation, net of the cut");
    }

    /// @dev Position out of range (spot walked 8% away with the feed following, no rebalance), fees pending, weekend:
    /// the vault is one-sided, the case the review said the tighter alternative fails. Push both ways.
    function _outOfRange(int256 bps) internal {
        _mutant();
        uint256 px = _accrue();
        _pushPrice(bps);
        _advance(40 minutes);
        _setFeed(_poolPrice());
        assertFalse(vault.positionInfo().inRange, "position out of range");
        px = _poolPrice();
        _weekend(px, true);
        uint256 p0 = oracle.price();
        uint256 floor = p0 - p0 / 1e6;
        assertGt(oracle.pendingCutUsdg(), 0, "fees pending");
        _sellTo(px / 1e4);
        emit log_named_int("out of range, push down 10,000x, ppm", _dppm(oracle.price(), p0));
        assertGe(oracle.price(), floor, "out-of-range push down lowered the price");
        _buyTo(px * 1e4);
        emit log_named_int("out of range, then push up 10,000x, ppm", _dppm(oracle.price(), p0));
        assertGe(oracle.price(), floor, "out-of-range push up lowered the price");
    }


    /// @dev Judges the loosened O-L1 bound (review question a). Chainlink 95 bp above the pool (edge of the gate), ring
    /// live, a weekend sweep moves every uncollected fee to pending. Math: the fixed oracle deducts the pending cut as
    /// perf x (S x nav + U) instead of perf x (S x px + U), so the price rises by exactly perf x S x (px - nav), the stock
    /// part of the cut times (px - nav)/px <= offset. The measured rise must match that prediction (not merely sit under
    /// the loose bound), and the pre-O-L1 oracle, run beside it, must break the bound by two orders of magnitude, so the
    /// loosened assertion still fails on the regression it guards.
    function test_r1_feedAboveTwapRiseIsExactlyTheStockPartResidual() public {
        _mutant();
        _deposit(bob, UNIT());
        _volume(VOL() * 2, 3);
        _advance(600);
        _settle();
        uint256 feedPx = _poolPrice() * (1e4 + 95) / 1e4;
        _setFeed(feedPx);
        PreFixOracle pre = new PreFixOracle(IVaultFactory(address(factory)), IUptickVault(address(vault)));
        StockVaultV4.PositionInfo memory i0 = vault.positionInfo();
        (, uint16 perf,,,,,,) = vault.params();
        uint256 b = oracle.price();
        uint256 qb = pre.price();
        uint256 sb = vault.totalSupply() + 1e6;
        uint256 cut = (_stockUsd(i0.uncollectedStock, feedPx) + i0.uncollectedUsdg) * perf / 1e4;
        uint256 cutPpm = cut * 1e36 / sb * 1e6 / b;

        vm.mockCall(FEED(), abi.encodeWithSelector(LRD), abi.encode(feedRound, int256(feedPx), vm.getBlockTimestamp() - 91_000, vm.getBlockTimestamp() - 91_000, feedRound));
        uint256 dust = vault.totalSupply() / 1e6;
        vm.prank(bob);
        vault.redeemInKind(dust, bob, bob);
        vm.clearMockedCalls();
        _setFeed(feedPx);

        (,,,, uint160 tw,) = vault.health();
        uint256 nav = Math.min(feedPx, _usdOf(tw));
        uint256 a = oracle.price();
        uint256 qa = pre.price();
        int256 dPpm = _dppm(a, b);
        int256 dPre = _dppm(qa, qb);
        uint256 predicted = i0.uncollectedStock * (feedPx - nav) / 1e20 * perf / 1e4;
        uint256 predictedPpm = predicted * 1e36 / (vault.totalSupply() + 1e6) * 1e6 / a;
        uint256 bound = cutPpm * 95 / 1e4 + 1;
        emit log_named_uint("treasury cut at stake, ppm of price", cutPpm);
        emit log_named_uint("(px - nav)/px, ppm", (feedPx - nav) * 1e6 / feedPx);
        emit log_named_uint("predicted rise perf x S x (px - nav), ppm", predictedPpm);
        emit log_named_int("measured rise, fixed oracle, ppm", dPpm);
        emit log_named_uint("loosened test bound offset x cut + 1, ppm", bound);
        emit log_named_int("pre-O-L1 oracle, same sweep, ppm", dPre);
        assertGe(cutPpm, 300, "a real cut is at stake");
        assertApproxEqAbs(dPpm, int256(predictedPpm), 2, "the rise is the stock-part residual and nothing else");
        assertLe(dPpm, int256(bound), "within the loosened bound");
        assertGt(dPre, int256(bound) * 50, "the loosened bound still catches the O-L1 leak");
    }

    /// @dev Liveness, pre-existing (integration has it through the totalAssets() cap): with the ring lapsed, a push to
    /// the sqrt-price limit makes `_sqrtToUsd(spot)` round to 0 (or divide by 0), and both the vault's totalAssets() and
    /// the oracle revert. Morpho then refuses liquidate/borrow/withdrawCollateral while spot sits there. A live ring
    /// (clamped ticks) is immune. Measured: the Stock Token the push needs, and whether each read reverts.
    function test_r1_limitPushWithLapsedRingRevertsPrice() public {
        uint256 px = _accrue();
        _weekend(px, true);
        PreFixOracle pre = new PreFixOracle(IVaultFactory(address(factory)), IUptickVault(address(vault)));
        uint256 s0 = IERC20(STOCK()).balanceOf(address(trader));
        trader.swap(key, stockIsToken0, s0, stockIsToken0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1);
        (, int24 tk) = _spot();
        emit log_named_uint("Stock Token sold to reach the limit (1e18)", s0 - IERC20(STOCK()).balanceOf(address(trader)));
        emit log_named_int("spot tick", tk);
        bool fixedReverts;
        bool preReverts;
        bool taReverts;
        try oracle.price() returns (uint256) {} catch { fixedReverts = true; }
        try pre.price() returns (uint256) {} catch { preReverts = true; }
        try vault.totalAssets() returns (uint256) {} catch { taReverts = true; }
        emit log_named_string("fixed oracle price()", fixedReverts ? "reverts" : "answers");
        emit log_named_string("pre-O-L1 oracle price()", preReverts ? "reverts" : "answers");
        emit log_named_string("vault totalAssets()", taReverts ? "reverts" : "answers");
        assertEq(fixedReverts, taReverts, "the oracle reverts exactly when the vault's own valuation does");
        assertEq(fixedReverts, preReverts, "no new revert path versus integration");
    }

    function test_r1_outOfRangeAboveWeekendPushes() public {
        _outOfRange(800);
    }

    function test_r1_outOfRangeBelowWeekendPushes() public {
        _outOfRange(-800);
    }
}

/// @dev TSLA: Stock Token is currency0 (0.3%, spacing 60).
contract R1SpotTwapV4Token0 is R1SpotTwapV4 {
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

    function test_r1_token0IsTheStockCurrency() public view {
        assertTrue(oracle.stockIsToken0());
    }
}
