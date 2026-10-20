// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StockVault} from "../src/StockVault.sol";
import {IAggregatorV3, IUniswapV3Pool, ISwapRouter02} from "../src/interfaces/IUniswapV3.sol";

/// @dev Fork of Robinhood Chain (4663) at head (the public RPC keeps no historical state, so a fixed block cannot
/// be replayed later; set FORK_BLOCK to a recent block to pin one). Everything the vault touches (pool, position
/// manager, router, tokens) is the real deployed contract. The only cheatcodes are deal for balances, warp for
/// time, and mockCall on the Chainlink proxy: setUp points it at the pool's own spot price with a fresh timestamp
/// (the equity feeds go stale over weekends and trade off the pool by tens of bp), and tests then move it to
/// follow, or deliberately diverge from, the price moves they make in the real pool. test_realFeedUnmocked reads
/// the real feed untouched.
/// @dev Whether pool spot sits further from the pool TWAP than the vault's spot-to-TWAP band allows.
library Band {
    function off(StockVault v) internal view returns (bool) {
        (,,,, uint160 twap, uint160 spot) = v.health();
        if (twap == 0 || spot == 0) return false; // feed unusable: no snapshot to compare
        uint256 pt = Math.mulDiv(twap, twap, 1 << 96);
        uint256 ps = Math.mulDiv(spot, spot, 1 << 96);
        uint256 hi = ps > pt ? ps : pt;
        uint256 lo = ps > pt ? pt : ps;
        return hi * 1e4 > lo * (1e4 + v.maxSpotTwapBps());
    }
}

abstract contract Addrs {
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant POOL = 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3;
    address constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
}

abstract contract Base is Test, Addrs {
    using Math for uint256;

    StockVault vault;
    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address trader = makeAddr("trader");
    address stranger = makeAddr("stranger");

    uint80 feedRound;

    function setUp() public virtual {
        uint256 blk = vm.envOr("FORK_BLOCK", uint256(0));
        string memory url = vm.envOr("FORK_URL", string("robinhood"));
        if (blk == 0) vm.createSelectFork(url);
        else vm.createSelectFork(url, blk);
        (feedRound,,,,) = IAggregatorV3(FEED).latestRoundData();
        // The live pool trades while tests run: spot can sit tens of bp off its 10-minute TWAP at fork time. Moving
        // past the TWAP window makes the TWAP equal to spot, so every test starts inside the spot-to-TWAP band.
        vm.warp(block.timestamp + 11 minutes);
        _setFeed(_poolPrice());

        vault = _deploy(_defaultParams());
        deal(USDG, trader, 200_000_000e6);
        deal(NVDA, trader, 2_000_000e18);
        vm.startPrank(trader);
        IERC20(USDG).approve(ROUTER, type(uint256).max);
        IERC20(NVDA).approve(ROUTER, type(uint256).max);
        vm.stopPrank();
    }

    function _defaultParams() internal pure returns (StockVault.Params memory) {
        return StockVault.Params({
            rangeBps: 500,
            perfFeeBps: 1000,
            maxDeviationBps: 100,
            slippageBps: 100,
            exitBufferBps: 30,
            maxStaleness: 90_000,
            twapWindow: 600,
            minRebalanceInterval: 6 hours
        });
    }

    function _deploy(StockVault.Params memory p) internal returns (StockVault) {
        StockVault.Config memory c = StockVault.Config({
            stock: NVDA,
            usdg: USDG,
            pool: POOL,
            positionManager: NPM,
            router: ROUTER,
            feed: FEED,
            owner: owner,
            keeper: keeper,
            treasury: treasury,
            depositCap: 0
        });
        return new StockVault(c, p, "Stock Vault NVDA", "svNVDA");
    }

    // ---------------------------------------------------------------- helpers

    function _fund(address who, uint256 amount) internal {
        deal(NVDA, who, amount);
        vm.prank(who);
        IERC20(NVDA).approve(address(vault), type(uint256).max);
    }

    /// @dev Deposits and moves to the next block: shares minted in a block cannot leave the account in that block
    /// (StockVault._update), so every test that exits after depositing starts from the next block. Tests of the
    /// lock itself call vault.deposit directly.
    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        _settle();
        _fund(who, amount);
        vm.prank(who);
        shares = vault.deposit(amount, who);
        vm.roll(vm.getBlockNumber() + 1);
    }

    /// @dev Deposits are refused while spot sits off the TWAP, and the vault's own deploy swap (or a test's push)
    /// does that until arbitrage and time pull them together. Tests have no arbitrageurs, so a test that deposits
    /// after moving the pool lets the TWAP window pass first. Tests of the band call vault.deposit directly.
    function _settle() internal {
        if (Band.off(vault)) vm.warp(vm.getBlockTimestamp() + 11 minutes);
    }

    /// @dev The owner's timelocked path: queue, wait CHANGE_DELAY, execute, then put the clock back so the test's
    /// own timeline (feed timestamps, rebalance intervals) is unchanged.
    function _ownerDo(bytes memory data) internal {
        uint256 t0 = vm.getBlockTimestamp(); // not block.timestamp: via_ir re-reads it after the warp below
        vm.prank(owner);
        vault.queueChange(data);
        vm.warp(t0 + vault.CHANGE_DELAY());
        vm.prank(owner);
        vault.executeChange(data);
        vm.warp(t0);
    }

    function _instant() internal {
        _ownerDo(abi.encodeCall(StockVault.setInstantDeploy, (true)));
    }

    function _spotTick() internal view returns (int24 t) {
        (, t,,,,,) = IUniswapV3Pool(POOL).slot0();
    }

    /// @dev USD per NVDA (8 decimals) implied by the pool's spot price. NVDA is token1, USDG token0.
    function _poolPrice() internal view returns (uint256) {
        uint256 p96 = Math.mulDiv(_spotSqrt(), _spotSqrt(), 1 << 96); // NVDA wei per USDG unit, Q96
        return Math.mulDiv(1e26, 1 << 96, p96) / 1e6;
    }

    function _spotSqrt() internal view returns (uint160 s) {
        (s,,,,,,) = IUniswapV3Pool(POOL).slot0();
    }

    /// @dev Chainlink price in feed decimals as the vault reads it.
    function _feedPrice() internal view returns (uint256) {
        (, int256 a,,,) = IAggregatorV3(FEED).latestRoundData();
        return uint256(a);
    }

    /// @dev Point the Chainlink proxy at `price` with a fresh timestamp.
    function _setFeed(uint256 price) internal {
        vm.mockCall(
            FEED,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(feedRound, int256(price), block.timestamp, block.timestamp, feedRound)
        );
    }

    /// @dev Trade the real pool until the NVDA price has moved by `bps` (signed). Returns the new spot tick.
    function _pushPrice(int256 bps) internal returns (int24) {
        uint256 cur = _spotSqrt();
        // NVDA is token1: its USD price up means token1 per token0 down, so sqrt moves by 1/sqrt(1+x)
        uint256 denom = uint256(int256(1e4) + bps);
        uint256 factor = Math.sqrt(uint256(1e4) * 1e36 / denom);
        uint160 limit = uint160(cur * factor / 1e18);
        bool buyNvda = bps > 0;
        vm.prank(trader);
        ISwapRouter02(ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(
                buyNvda ? USDG : NVDA, buyNvda ? NVDA : USDG, 500, trader, buyNvda ? 150_000_000e6 : 900_000e18, 0, limit
            )
        );
        return _spotTick();
    }

    /// @dev Round-trip volume inside the position's range so it earns fees.
    function _volume(uint256 usdgPerLeg, uint256 trips) internal {
        for (uint256 i; i < trips; ++i) {
            vm.startPrank(trader);
            uint256 got = ISwapRouter02(ROUTER).exactInputSingle(
                ISwapRouter02.ExactInputSingleParams(USDG, NVDA, 500, trader, usdgPerLeg, 0, 0)
            );
            ISwapRouter02(ROUTER).exactInputSingle(
                ISwapRouter02.ExactInputSingleParams(NVDA, USDG, 500, trader, got, 0, 0)
            );
            vm.stopPrank();
        }
    }

    function _usd(uint256 stockWei) internal view returns (uint256) {
        return stockWei * _feedPrice() / 1e8 / 1e18;
    }

    function _assertClose(uint256 a, uint256 b, uint256 relBps, string memory what) internal pure {
        uint256 diff = a > b ? a - b : b - a;
        uint256 ref = a > b ? a : b;
        assertLe(diff * 1e4, ref * relBps, what);
    }
}
