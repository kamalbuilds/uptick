// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

import {ShareCollateralTest, ShareCollateralV4Test, MarketParams, IMorpho} from "../../ShareCollateral.t.sol";
import {V4Trader} from "../../v4/V4Fixture.sol";
import {StockVaultV4} from "../../../src/v4/StockVaultV4.sol";
import {UptickShareOracle, IUptickVault, IVaultFactory, IOracleDeployer} from "../../../src/UptickShareOracle.sol";
import {UptickShareOracleFactory} from "../../../src/UptickShareOracleFactory.sol";
import {FreshReviewV4} from "./FreshReview.t.sol";

/// @dev A deployer that imitates UptickShareOracleFactory: it hands the oracle constructor any (registry, vault) it likes.
contract LookalikeDeployer is IOracleDeployer {
    IVaultFactory immutable reg;
    IUptickVault immutable v;

    constructor(IVaultFactory r, IUptickVault v_) {
        reg = r;
        v = v_;
    }

    function deployParams() external view returns (IVaultFactory, IUptickVault) {
        return (reg, v);
    }

    function deploy() external returns (address) {
        return address(new UptickShareOracle());
    }
}

/// @dev A registry that says yes to everything.
contract YesRegistry is IVaultFactory {
    function isVault(address) external pure returns (bool) {
        return true;
    }
}

/// @dev Round 1 independent review of r2-oracle-fix, liveness and trust lens. Fork of 4663 at head (public RPC):
///   forge test -j 1 --match-path test/security/oracle/R1_liveness_and_trust.t.sol --match-test test_r1 -vv
///
/// R1-L1: once the v4 observation ring has lapsed (weekend, keeper outage) the vault reports spot as its TWAP. Pushing the
/// pool until the Stock Token trades under 1e-8 USD (raw feed unit 0) makes `nav = min(px, TWAP)` round to 0; the vault's
/// `totalAssets()` then divides by zero (frozen code) and so does the oracle's own `_pendingCutUsdg`, so `price()` panics
/// and every Morpho `liquidate` in the market reverts until spot is restored. These tests measure what the push costs on
/// the live pools and show the revert, the blocked liquidation, and the restore that unblocks it. Measured: the push
/// leaves ~$96M (PLTR) / ~$655M (TSLA) of Stock Token in the pool for the next swapper to take, so it is Low; the revert
/// is pre-existing (integration's oracle already called `totalAssets()`), the C-1 fix adds no new revert state.
/// R1-L2: the factory NatSpec's two-leg curator check passes a market with junk collateral (SECURITY.md's four legs do not).
/// R1ResidualV4: the accepted C-1 residual, measured as the drop of `pendingCutUsdg()` under pushes up to 1e8x.
contract R1LivenessV4 is ShareCollateralV4Test {
    using StateLibrary for IPoolManager;

    IMorpho constant MORPHO = IMorpho(0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010);
    address constant IRM = 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1;
    uint256 constant LLTV = 0.625e18;
    bytes4 constant LRD = bytes4(keccak256("latestRoundData()"));

    address lender = makeAddr("lender");
    address liq = makeAddr("liq");

    function _market() internal returns (MarketParams memory mp) {
        mp = MarketParams(USDG, address(vault), address(oracle), IRM, LLTV);
        MORPHO.createMarket(mp);
        deal(USDG, lender, 1_000_000e6);
        vm.startPrank(lender);
        IERC20(USDG).approve(address(MORPHO), type(uint256).max);
        MORPHO.supply(mp, 1_000_000e6, 0, lender, "");
        vm.stopPrank();
        uint256 coll = vault.balanceOf(alice);
        vm.startPrank(alice);
        IERC20(address(vault)).approve(address(MORPHO), type(uint256).max);
        MORPHO.supplyCollateral(mp, coll, alice, "");
        MORPHO.borrow(mp, coll * oracle.price() / 1e36 * LLTV / 1e18 * 99 / 100, 0, alice, alice);
        vm.stopPrank();
        deal(USDG, liq, 10_000_000e6);
        vm.prank(liq);
        IERC20(USDG).approve(address(MORPHO), type(uint256).max);
    }

    /// @dev Weekend after a Friday close 15% below where the borrower borrowed: feed 25.3 h old, ring lapsed.
    function _weekendAfterDrop() internal returns (uint256 px) {
        px = _poolPrice() * 85 / 100;
        uint256 t = vm.getBlockTimestamp() - 91_000;
        vm.mockCall(FEED(), abi.encodeWithSelector(LRD), abi.encode(feedRound, int256(px), t, t, feedRound));
        vm.warp(vm.getBlockTimestamp() + 200);
        vm.roll(vm.getBlockNumber() + 1);
        (StockVaultV4.Status st,,,, uint160 twap, uint160 spot) = vault.health();
        assertEq(uint8(st), uint8(StockVaultV4.Status.FeedStale));
        assertEq(twap, spot, "ring lapsed: spot is the TWAP");
    }

    /// @dev The pool sqrt price at which the Stock Token is worth half a raw feed unit (5e-9 USD): `_sqrtToUsd` floors to 0.
    function _zeroNavSqrt() internal view returns (uint160) {
        if (stockIsToken0) return uint160(Math.sqrt(Math.mulDiv(1, 1 << 192, 2e20)));
        return uint160(Math.sqrt(2e20) * (1 << 96));
    }

    function _liquidateQuarter(MarketParams memory mp) internal returns (bool ok, bytes memory why) {
        (,, uint128 c) = MORPHO.position(keccak256(abi.encode(mp)), alice);
        vm.prank(liq);
        try MORPHO.liquidate(mp, alice, c / 4, 0, "") {
            ok = true;
        } catch (bytes memory w) {
            why = w;
        }
    }

    function test_r1_weekendPushToZeroNavBlocksLiquidation() public {
        MarketParams memory mp = _market();
        uint256 px = _weekendAfterDrop();
        uint256 p0 = oracle.price();
        emit log_named_uint("oracle price after the drop", p0);

        // control: the borrower is liquidatable at the weekend price
        uint256 snap = vm.snapshotState();
        (bool ok,) = _liquidateQuarter(mp);
        assertTrue(ok, "control: an unhealthy borrower is liquidated");
        vm.revertToState(snap);

        // the push
        (uint160 sqrt0,) = _spot();
        V4Trader atk = new V4Trader(PM);
        deal(STOCK(), address(atk), 5_000_000e18);
        uint256 s0 = IERC20(STOCK()).balanceOf(address(atk));
        atk.swap(key, stockIsToken0, s0, _zeroNavSqrt());
        uint256 spent = s0 - IERC20(STOCK()).balanceOf(address(atk));
        uint256 got = IERC20(USDG).balanceOf(address(atk));
        (, int24 tk) = _spot();
        emit log_named_int("spot tick after the push", tk);
        emit log_named_uint("Stock Token sold to reach nav 0 (1e18)", spent);
        emit log_named_uint("its value at Chainlink (raw USDG)", spent * px / 1e20);
        emit log_named_uint("USDG received (raw)", got);
        emit log_named_uint("full-range liquidity left at spot", PM.getLiquidity(pid));

        vm.expectRevert();
        vault.totalAssets();
        vm.expectRevert();
        oracle.price();
        bytes memory why;
        (ok, why) = _liquidateQuarter(mp);
        assertFalse(ok, "liquidation of an unhealthy borrower reverts");
        emit log_named_bytes("liquidate revert", why);
        assertEq(bytes4(why), bytes4(0x4e487b71), "Panic");

        // a restore swap (what a bundling liquidator or any arbitrageur does) unblocks it, and pays the restorer
        V4Trader fix = new V4Trader(PM);
        deal(USDG, address(fix), 50_000_000e6);
        uint256 u1 = IERC20(USDG).balanceOf(address(fix));
        fix.swap(key, !stockIsToken0, u1, sqrt0);
        uint256 bought = IERC20(STOCK()).balanceOf(address(fix));
        uint256 paid = u1 - IERC20(USDG).balanceOf(address(fix));
        emit log_named_uint("restorer: Stock Token bought (1e18)", bought);
        emit log_named_uint("restorer: USDG paid (raw)", paid);
        emit log_named_int("restorer PnL at Chainlink (raw USDG)", int256(bought * px / 1e20) - int256(paid));
        assertGt(oracle.price(), 0);
        (ok,) = _liquidateQuarter(mp);
        assertTrue(ok, "after the restore the liquidation goes through");
    }

    /// @dev Must-fail control: the same push with the ring live (feed fresh, keeper poking) does not reach the oracle,
    /// because the ring's ticks are clamped to Chainlink +- maxDeviationBps.
    function test_r1_controlSamePushWithLiveRingKeepsPricing() public {
        uint256 p0 = oracle.price();
        V4Trader atk = new V4Trader(PM);
        deal(STOCK(), address(atk), 5_000_000e18);
        atk.swap(key, stockIsToken0, 5_000_000e18, _zeroNavSqrt());
        uint256 p1 = oracle.price();
        assertGe(p1, p0, "live ring: the push cannot lower or revert the price");
    }

    function test_r1_gasOfPrice() public {
        uint256 g = gasleft();
        oracle.price();
        uint256 live = g - gasleft();
        _weekendAfterDrop();
        g = gasleft();
        oracle.price();
        uint256 lapsed = g - gasleft();
        emit log_named_uint("price() gas, live ring", live);
        emit log_named_uint("price() gas, lapsed ring", lapsed);
        assertLt(live, 500_000);
        assertLt(lapsed, 500_000);
    }

    /// @dev Trust: a look-alike deployer can build an oracle against a yes-to-everything registry; the real registry
    /// does not know it, its `factory()` and `oracleFactory()` give it away, and it cannot occupy the real CREATE2 slot.
    function test_r1_lookalikeOracleIsDistinguishable() public {
        LookalikeDeployer d = new LookalikeDeployer(new YesRegistry(), IUptickVault(address(vault)));
        UptickShareOracle fake = UptickShareOracle(d.deploy());
        assertEq(address(fake.vault()), address(vault), "it names the real vault");
        assertFalse(oracleFactory.isOracle(address(fake)));
        assertTrue(address(fake.factory()) != address(factory), "its registry is not the real VaultFactory");
        assertEq(fake.oracleFactory(), address(d));
        assertEq(oracleFactory.oracleOf(address(vault)), address(oracle));
        // a look-alike over the REAL registry and vault is the same code with the same immutables: same price
        LookalikeDeployer d2 = new LookalikeDeployer(IVaultFactory(address(factory)), IUptickVault(address(vault)));
        UptickShareOracle twin = UptickShareOracle(d2.deploy());
        assertEq(twin.price(), oracle.price(), "an unregistered twin prices identically");
        assertFalse(oracleFactory.isOracle(address(twin)));
        assertEq(twin.oracleFactory(), address(d2), "the twin names its own deployer");
        assertTrue(address(twin).codehash != address(oracle).codehash, "oracleFactory is an immutable: runtime differs");
    }

    /// @dev Trust: the factory NatSpec's two-leg check (`isOracle(oracle)` and `oracle.factory() == VaultFactory`) passes
    /// a Morpho market whose collateral is NOT the oracle's vault share. A junk 24-decimal token posted as collateral
    /// borrows USDG at the vault share's price. SECURITY.md's four-leg check (plus collateral == vault(), loan == usdg())
    /// catches it; the factory NatSpec, the text a curator reading the contract sees first, does not.
    function test_r1_twoLegCuratorCheckPassesAJunkCollateralMarket() public {
        JunkShare junk = new JunkShare();
        MarketParams memory mp = MarketParams(USDG, address(junk), address(oracle), IRM, LLTV);
        MORPHO.createMarket(mp);
        bool natspecCheck = oracleFactory.isOracle(mp.oracle)
            && address(UptickShareOracle(mp.oracle).factory()) == address(factory);
        bool fullCheck = natspecCheck && mp.collateralToken == address(UptickShareOracle(mp.oracle).vault())
            && mp.loanToken == address(UptickShareOracle(mp.oracle).usdg());
        assertTrue(natspecCheck, "the factory NatSpec check passes the junk market");
        assertFalse(fullCheck, "the SECURITY.md check rejects it");

        deal(USDG, lender, 100_000e6);
        vm.startPrank(lender);
        IERC20(USDG).approve(address(MORPHO), type(uint256).max);
        MORPHO.supply(mp, 100_000e6, 0, lender, "");
        vm.stopPrank();
        address mallory = makeAddr("mallory");
        uint256 coll = 1_000e24; // 1,000 "shares" minted for free
        junk.mint(mallory, coll);
        vm.startPrank(mallory);
        junk.approve(address(MORPHO), type(uint256).max);
        MORPHO.supplyCollateral(mp, coll, mallory, "");
        uint256 b = coll * oracle.price() / 1e36 * LLTV / 1e18 * 99 / 100;
        if (b > 100_000e6) b = 100_000e6;
        MORPHO.borrow(mp, b, 0, mallory, mallory);
        vm.stopPrank();
        emit log_named_uint("USDG borrowed against free junk collateral (raw)", b);
        assertEq(IERC20(USDG).balanceOf(mallory), b);
    }
}

contract JunkShare {
    string public constant name = "junk";
    string public constant symbol = "JUNK";
    uint8 public constant decimals = 24;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

/// @dev (b) The accepted residual of the C-1 fix: with the ring lapsed, a push lowers `nav` and the stock part of the
/// pending cut is deducted at nav instead of Chainlink. Measures the under-deduction (drop of `pendingCutUsdg()`), the
/// price rise it causes, and whether a borrower can turn it into lender loss at LLTV 62.5%.
contract R1ResidualV4 is FreshReviewV4 {
    function test_r1_lapsedRingResidualIsBoundedAndNotExploitable() public {
        uint256 px = _accrue();
        _weekend(px, true);
        uint256 supply = vault.totalSupply() + 1e6;
        uint256 p0 = oracle.price();
        uint256 cut0 = oracle.pendingCutUsdg();
        uint256 value0 = p0 * supply / 1e36;
        emit log_named_uint("vault value at Chainlink (raw USDG)", value0);
        emit log_named_uint("pending cut before push (raw USDG)", cut0);
        emit log_named_uint("pending cut, ppm of value", cut0 * 1e6 / value0);
        assertGt(cut0, 0, "fees are pending");

        uint256[4] memory ks = [uint256(2), 100, 1e4, 1e8];
        uint256 maxUnderPpm;
        for (uint256 i; i < ks.length; ++i) {
            _sellTo(px / ks[i]);
            uint256 cut1 = oracle.pendingCutUsdg();
            uint256 p1 = oracle.price();
            uint256 under = cut0 > cut1 ? cut0 - cut1 : 0;
            emit log_named_uint("--- spot pushed down by factor", ks[i]);
            emit log_named_uint("under-deduction (raw USDG)", under);
            emit log_named_uint("under-deduction, ppm of value", under * 1e6 / value0);
            emit log_named_int("oracle price change, ppm", _dppm(p1, p0));
            assertLe(cut1, cut0, "a push never raises the deduction");
            assertLe(under, cut0, "under-deduction is at most the whole pending cut");
            if (under * 1e6 / value0 > maxUnderPpm) maxUnderPpm = under * 1e6 / value0;
        }
        // The rest of the price rise is the swap fees the push paid into the vault's range (real value, at Chainlink).
        // Over-borrowing turns into lender loss only when debt exceeds collateral value at the honest price, i.e. a price
        // overstatement above 1 / LLTV - 1 = 60%.
        emit log_named_uint("max under-deduction over the pushes, ppm of value", maxUnderPpm);
        assertLt(maxUnderPpm, 600_000, "residual below the LLTV headroom");
        assertLt(maxUnderPpm, cut0 * 1e6 / value0 + 1, "residual at most the whole pending cut");
    }
}

/// @dev TSLA, Stock Token currency0: the other orientation of `_sqrtToUsd`.
contract R1LivenessV4Token0 is R1LivenessV4 {
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

/// @dev v3 (NVDA): `price()` and a full Morpho liquidation, gas.
contract R1LivenessV3 is ShareCollateralTest {
    function test_r1_v3GasOfPriceAndLiquidate() public {
        uint256 g = gasleft();
        oracle.price();
        uint256 gp = g - gasleft();
        _borrowNearLimit();
        _setFeed(_feedPrice() * 60 / 100);
        uint256 c = _collateral(alice);
        vm.prank(liquidator);
        g = gasleft();
        MORPHO.liquidate(mp, alice, c, 0, "");
        uint256 gl = g - gasleft();
        emit log_named_uint("v3 price() gas", gp);
        emit log_named_uint("v3 Morpho liquidate (whole collateral) gas", gl);
        assertLt(gl, 1_500_000);
    }
}
