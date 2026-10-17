// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {StockVault} from "../src/StockVault.sol";
import {IAggregatorV3, IUniswapV3Pool, ISwapRouter02} from "../src/interfaces/IUniswapV3.sol";

/// @dev SPCX sorts below USDG, so here the Stock Token is token0 and USDG token1. NVDA is the opposite, which
/// makes this the only coverage of the stockIsToken0 branch of every conversion in the vault.
contract StockVaultSpcxTest is Test {
    address constant SPCX = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant POOL = 0xc61284332117c3FB23A2A56cceFFD07F7aF60029;
    address constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant FEED = 0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb;

    StockVault vault;
    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address trader = makeAddr("trader");
    uint80 feedRound;

    function setUp() public {
        uint256 blk = vm.envOr("FORK_BLOCK", uint256(0));
        string memory url = vm.envOr("FORK_URL", string("robinhood"));
        if (blk == 0) vm.createSelectFork(url);
        else vm.createSelectFork(url, blk);
        (feedRound,,,,) = IAggregatorV3(FEED).latestRoundData();
        _setFeed(_poolPrice());
        vault = new StockVault(
            StockVault.Config({
                stock: SPCX,
                usdg: USDG,
                pool: POOL,
                positionManager: NPM,
                router: ROUTER,
                feed: FEED,
                owner: owner,
                keeper: keeper,
                treasury: treasury,
                depositCap: 0
            }),
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
            "Stock Vault SPCX",
            "svSPCX"
        );
        assertTrue(vault.stockIsToken0());
        deal(USDG, trader, 50_000_000e6);
        deal(SPCX, trader, 5_000_000e18);
        vm.startPrank(trader);
        IERC20(USDG).approve(ROUTER, type(uint256).max);
        IERC20(SPCX).approve(ROUTER, type(uint256).max);
        vm.stopPrank();
    }

    function _spot() internal view returns (uint160 s) {
        (s,,,,,,) = IUniswapV3Pool(POOL).slot0();
    }

    /// @dev USD per SPCX (8 decimals) from the pool: SPCX is token0, so price = token1 per token0 scaled by decimals.
    function _poolPrice() internal view returns (uint256) {
        uint256 p96 = Math.mulDiv(_spot(), _spot(), 1 << 96); // USDG units per SPCX wei, Q96
        return Math.mulDiv(p96, 1e8 * 1e18, (1 << 96) * 1e6);
    }

    function _setFeed(uint256 price) internal {
        vm.mockCall(
            FEED,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(feedRound, int256(price), block.timestamp, block.timestamp, feedRound)
        );
    }

    function _deposit(uint256 amount) internal returns (uint256 shares) {
        deal(SPCX, alice, amount);
        vm.startPrank(alice);
        IERC20(SPCX).approve(address(vault), type(uint256).max);
        shares = vault.deposit(amount, alice);
        vm.stopPrank();
    }

    function test_oracleMappingMatchesPoolForTokenZeroStock() public view {
        (StockVault.Status st,, , uint160 sqrtOracle,, uint160 sqrtSpot) = vault.health();
        assertEq(uint8(st), uint8(StockVault.Status.Ok));
        uint256 diff = sqrtOracle > sqrtSpot ? sqrtOracle - sqrtSpot : sqrtSpot - sqrtOracle;
        assertLe(diff * 1e5, uint256(sqrtSpot), "feed-as-sqrt within 1bp of spot");
    }

    function test_roundTripAndRebalanceWithTokenZeroStock() public {
        vm.prank(owner);
        vault.setInstantDeploy(true);
        uint256 amount = 100e18;
        uint256 shares = _deposit(amount);
        StockVault.PositionInfo memory info = vault.positionInfo();
        assertGt(info.liquidity, 0);
        assertGt(info.stockAmount, 0);
        assertGt(info.usdgAmount, 0);
        assertTrue(info.inRange);
        (, uint256 priceLow, uint256 priceHigh) = _range();
        uint256 price = _poolPrice();
        assertLt(priceLow, price);
        assertGt(priceHigh, price);
        assertApproxEqRel(priceLow, price * 9_500 / 10_000, 5e15);
        assertApproxEqRel(priceHigh, price * 10_500 / 10_000, 5e15);
        assertApproxEqRel(vault.totalAssets(), amount, 5e15, "NAV after deploy");

        vm.warp(block.timestamp + 6 hours);
        _setFeed(price);
        vm.prank(keeper);
        vault.rebalance();
        assertApproxEqRel(vault.totalAssets(), amount, 8e15, "NAV after a rebalance");

        vm.prank(alice);
        uint256 got = vault.redeem(shares, alice, alice);
        assertApproxEqRel(got, amount, 8e15, "round trip within 0.8%");
        assertEq(vault.balanceOf(alice), 0);
    }

    function _range() internal view returns (int24 lower, uint256 low, uint256 high) {
        (lower,, low, high) = vault.currentRange();
    }
}
