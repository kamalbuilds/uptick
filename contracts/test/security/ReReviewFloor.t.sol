// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ForkPin} from "../ForkPin.sol";
import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAggregatorV3, IUniswapV3Pool, ISwapRouter02} from "../../src/interfaces/IUniswapV3.sol";
import {StockVault} from "../../src/StockVault.sol";
import {UptickRouter, IStockVault, IVaultRegistry} from "../../src/UptickRouter.sol";

/// @dev Re-review 2026-10-20 N1: how much of the deploy-swap floor is left after the pool fee and the price impact of
/// swapping half the vault cap (the swap a rebalance makes once the position has gone fully out of range, run after
/// the vault has pulled its own liquidity). Real pools, public RPC at head.
/// The floor is the reference value less the pool fee less slippageBps (100 bp): allowed cost = 1 - (1 - fee)(1 - slip).
/// margin = allowed cost - (fee + impact) - 10 bp (spot may sit up to maxSpotTwapBps on the wrong side of the TWAP).
/// A negative margin means StockVault._balanceInventory reverts at that size ("Too little received"). Before the fix
/// the allowed cost was 100 bp whatever the tier, and the table read PLTR -2, GME -68, MSTR -70.
contract ReReviewFloorTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;

    /// The GME cap the floor tests size their swaps at. keeper/data/universe.json lists $49,212, sized from the pool's
    /// depth when the universe was built; the live 1% pool has thinned since (2026-10-20: half of $49,212 costs 217 bp
    /// against the 199 bp the floor allows, so a full-cap deposit cannot be deployed in one rebalance and the
    /// rebalance reverts rather than fill). GME's evidence gate is closed and DeployAll refuses it. At this cap the
    /// same swap costs less than the floor allows; `setDepositCap` is the runtime lever for a pool that thins.
    uint256 constant GME_CAP_USD = 25_000;

    struct P {
        string sym;
        address stock;
        address pool;
        uint256 capUsd;
    }

    function setUp() public {
        ForkPin.select(vm);
    }

    function test_floorMarginAtHalfCap() public {
        uint256 pools;
        P[9] memory ps = [
            P("NVDA", 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3, 100000),
            P("AAPL", 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D, 29268),
            P("AMZN", 0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef, 68501),
            P("SPY", 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167, 100000),
            P("QQQ", 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, 0xD60A5d14dB690B7Afad71F76B108071D7175597d, 66787),
            P("GOOGL", 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 0x34D0dC122CF9A8Eb296fC5e0D3A233625D7d19b7, 38950),
            P("PLTR", 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A, 0x851680416A4f4E1c463d45171d61ACDdBc8554c0, 24207),
            P("GME", 0x1b0E319c6A659F002271B69dB8A7df2F911c153E, 0xE9713f453aDB9245B19559790c96F470a18F2fDF, GME_CAP_USD),
            P("MSTR", 0xec262a75e413fAfD0dF80480274532C79D42da09, 0x17578C0e0D15da44f31677263114F71aE76653EA, 22206)
        ];
        address who = makeAddr("swapper");
        for (uint256 i; i < ps.length; ++i) {
            IUniswapV3Pool pool = IUniswapV3Pool(ps[i].pool);
            bool s0 = pool.token0() == ps[i].stock;
            uint24 fee = pool.fee();
            uint256 halfUsdg = ps[i].capUsd * 1e6 / 2;
            (uint160 sq,,,,,,) = pool.slot0();
            uint256 p96 = Math.mulDiv(sq, sq, 1 << 96); // token1 per token0
            // stock wei worth halfUsdg at spot
            uint256 stockIn = s0 ? Math.mulDiv(halfUsdg, 1 << 96, p96) : Math.mulDiv(halfUsdg, p96, 1 << 96);

            uint256 snap = vm.snapshotState();
            deal(ps[i].stock, who, stockIn);
            vm.startPrank(who);
            IERC20(ps[i].stock).approve(ROUTER, stockIn);
            uint256 outU = ISwapRouter02(ROUTER).exactInputSingle(
                ISwapRouter02.ExactInputSingleParams(ps[i].stock, USDG, fee, who, stockIn, 0, 0)
            );
            vm.stopPrank();
            vm.revertToState(snap);

            deal(USDG, who, halfUsdg);
            vm.startPrank(who);
            IERC20(USDG).approve(ROUTER, halfUsdg);
            uint256 outS = ISwapRouter02(ROUTER).exactInputSingle(
                ISwapRouter02.ExactInputSingleParams(USDG, ps[i].stock, fee, who, halfUsdg, 0, 0)
            );
            vm.stopPrank();
            vm.revertToState(snap);

            uint256 allowed = 1e4 - (1e6 - uint256(fee)) * (1e4 - 100) / 1e6; // bp, rounded to the safe side
            uint256 costSell = outU >= halfUsdg ? 0 : (halfUsdg - outU) * 1e4 / halfUsdg;
            uint256 costBuy = outS >= stockIn ? 0 : (stockIn - outS) * 1e4 / stockIn;
            uint256 worst = costSell > costBuy ? costSell : costBuy;
            console2.log(ps[i].sym, fee, halfUsdg / 1e6);
            console2.log("  cost bp sell / buy:", costSell, costBuy);
            int256 margin = int256(allowed) - int256(worst) - 10;
            console2.log("  allowed bp:", allowed);
            console2.log("  margin bp (allowed - cost - 10):", margin);
            assertGt(margin, 0, string.concat(ps[i].sym, ": the floor leaves room at half cap"));
            ++pools;
        }
        assertEq(pools, ps.length);
    }

    struct V {
        string sym;
        address stock;
        address pool;
        address feed;
        uint256 capUsd;
    }

    /// The vault itself, not the arithmetic: a deposit of a full cap sits idle, the keeper's rebalance has to swap
    /// half of it through the pool and open a position. On a 1% pool the swap costs 1.6% and the old floor (1%)
    /// reverted; the fee-aware floor lets it through. Both token orders, three fee tiers.
    function test_vaultRebalancesAFullCapDepositOnEveryTier() public {
        V[4] memory vs = [
            V("AMZN", 0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef, 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C, 68501),
            V("PLTR", 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A, 0x851680416A4f4E1c463d45171d61ACDdBc8554c0, 0x820ABedFF239034956B7A9d2F0a331f9F075eB4c, 24207),
            V("GME", 0x1b0E319c6A659F002271B69dB8A7df2F911c153E, 0xE9713f453aDB9245B19559790c96F470a18F2fDF, 0x27C71df6A64fB476468EdF256CF72c038baB5B67, GME_CAP_USD),
            V("MSTR", 0xec262a75e413fAfD0dF80480274532C79D42da09, 0x17578C0e0D15da44f31677263114F71aE76653EA, 0x396118bdFB181e6240E74D243F266B061c0edc3D, 22206)
        ];
        uint256 opened;
        for (uint256 i; i < vs.length; ++i) {
            uint256 snap = vm.snapshotState();
            opened += _rebalancesFullCap(vs[i]);
            vm.revertToState(snap);
        }
        assertEq(opened, vs.length, "every vault opened a position");
    }

    /// @dev A vault on the live pool with Chainlink pointed at the pool price and the pool's own history aged out of
    /// the TWAP window, so the gate is open.
    function _vaultFor(V memory v, address keeper) internal returns (StockVault vault, uint256 price, uint256 stockWei) {
        (price, stockWei) = _priceAndCap(v);
        (uint80 round,,,,) = IAggregatorV3(v.feed).latestRoundData();
        vault = new StockVault(
            StockVault.Config(v.stock, USDG, v.pool, NPM, ROUTER, v.feed, makeAddr("owner"), keeper, makeAddr("treasury"), 0),
            StockVault.Params({
                rangeBps: 500,
                perfFeeBps: 1000,
                maxDeviationBps: 100,
                slippageBps: 100,
                exitBufferBps: 30,
                maxStaleness: 90_000,
                twapWindow: 600,
                minRebalanceInterval: 6 hours
            }),
            "v",
            "v"
        );
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        _mockFeed(v.feed, round, price);
    }

    function _rebalancesFullCap(V memory v) internal returns (uint256) {
        address keeper = makeAddr("keeper");
        (StockVault vault, uint256 price, uint256 stockWei) = _vaultFor(v, keeper);
        address bob = makeAddr("bob");
        deal(v.stock, bob, stockWei);
        vm.startPrank(bob);
        IERC20(v.stock).approve(address(vault), stockWei);
        vault.deposit(stockWei, bob);
        vm.stopPrank();
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + 7 hours);
        (uint80 round,,,,) = IAggregatorV3(v.feed).latestRoundData();
        _mockFeed(v.feed, round, price);
        vm.prank(keeper);
        vault.rebalance();
        console2.log(v.sym, "position opened, fee tier", vault.poolFee());
        console2.log("  liquidity", vault.positionInfo().liquidity);
        return vault.tokenId() != 0 && vault.positionInfo().liquidity > 0 ? 1 : 0;
    }

    /// The router's floor is the Chainlink value less the pool fee less slippage. On the 1% GME pool a $2,000 zap
    /// pays 100 bp of fee before any impact, so the old 100 bp floor reverted every zap there.
    function test_routerZapOnA1PercentPool() public {
        V memory v = V("GME", 0x1b0E319c6A659F002271B69dB8A7df2F911c153E, 0xE9713f453aDB9245B19559790c96F470a18F2fDF, 0x27C71df6A64fB476468EdF256CF72c038baB5B67, 49212);
        (StockVault vault,,) = _vaultFor(v, makeAddr("keeper"));
        address reg = makeAddr("registry");
        vm.etch(reg, hex"00");
        vm.mockCall(reg, abi.encodeWithSelector(IVaultRegistry.isVault.selector), abi.encode(true));
        UptickRouter r = new UptickRouter(100, IVaultRegistry(reg));
        address bob = makeAddr("bob");
        deal(USDG, bob, 2_000e6);
        vm.startPrank(bob);
        IERC20(USDG).approve(address(r), 2_000e6);
        uint256 shares = r.depositUsdg(IStockVault(address(vault)), 2_000e6, 0, bob);
        vm.stopPrank();
        assertGt(shares, 0, "zap went through");
        assertEq(vault.balanceOf(bob), shares);
    }

    function _mockFeed(address feed, uint80 round, uint256 price) internal {
        uint256 ts = vm.getBlockTimestamp();
        vm.mockCall(
            feed, abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector), abi.encode(round, int256(price), ts, ts, round)
        );
    }

    /// @dev Pool spot as USD per Stock Token (8 decimals) and the stock amount worth the cap at that price.
    function _priceAndCap(V memory v) internal view returns (uint256 price, uint256 stockWei) {
        IUniswapV3Pool pool = IUniswapV3Pool(v.pool);
        (uint160 sq,,,,,,) = pool.slot0();
        uint256 p96 = Math.mulDiv(sq, sq, 1 << 96); // token1 per token0, raw units, Q96
        price = pool.token0() == v.stock ? Math.mulDiv(p96, 1e20, 1 << 96) : Math.mulDiv(1e20, 1 << 96, p96);
        stockWei = v.capUsd * 1e26 / price;
    }
}
