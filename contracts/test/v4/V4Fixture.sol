// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ForkPin} from "../ForkPin.sol";
import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";

import {IAggregatorV3} from "../../src/interfaces/IUniswapV3.sol";
import {StockVaultV4} from "../../src/v4/StockVaultV4.sol";

/// @dev Trades in the real v4 pool the way any swapper does: unlock, swap, settle, take.
contract V4Trader is IUnlockCallback {
    IPoolManager public immutable pm;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    struct Req {
        PoolKey key;
        bool zeroForOne;
        int256 amountSpecified;
        uint160 limit;
    }

    function swap(PoolKey memory key, bool zeroForOne, uint256 amountIn, uint160 limit)
        external
        returns (int128 d0, int128 d1)
    {
        bytes memory r = pm.unlock(abi.encode(Req(key, zeroForOne, -int256(amountIn), limit)));
        return abi.decode(r, (int128, int128));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "pm only");
        Req memory q = abi.decode(data, (Req));
        BalanceDelta d = pm.swap(q.key, IPoolManager.SwapParams(q.zeroForOne, q.amountSpecified, q.limit), "");
        _pay(q.key.currency0, d.amount0());
        _pay(q.key.currency1, d.amount1());
        return abi.encode(d.amount0(), d.amount1());
    }

    function _pay(Currency c, int128 a) private {
        if (a < 0) {
            pm.sync(c);
            IERC20(Currency.unwrap(c)).transfer(address(pm), uint128(-a));
            pm.settle();
        } else if (a > 0) {
            pm.take(c, address(this), uint128(a));
        }
    }
}

/// @dev Fork of Robinhood Chain (4663) at head against the real Uniswap v4 PoolManager and a real pool of the token
/// under test. Only cheatcodes: deal for balances, warp and roll for time, and mockCall on the Chainlink proxy and
/// the Stock Token's corporate-action reads. setUp points the proxy at the pool's own spot price with a fresh
/// timestamp (equity feeds go stale over weekends and trade off the pool by tens of bp) and feeds the vault's
/// observation ring for eleven minutes, which is what the keeper's `poke()` loop does in production.
abstract contract V4Fixture is Test {
    using Math for uint256;
    using StateLibrary for IPoolManager;

    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    IPoolManager internal constant PM = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);

    function STOCK() internal pure virtual returns (address);
    function FEED() internal pure virtual returns (address);
    function FEE() internal pure virtual returns (uint24);
    function SPACING() internal pure virtual returns (int24);
    /// @dev Stock units a test deposits (18 decimals): 0.6% of the pool's +-5% depth, read at setUp, so the suite keeps
    /// its shape as the live pools deepen and thin. VOL() is the USDG a trade leg moves to earn the position fees.
    function UNIT() internal view returns (uint256) {
        return unit;
    }

    function VOL() internal view returns (uint256) {
        return vol;
    }

    uint256 internal unit;
    uint256 internal vol;

    StockVaultV4 internal vault;
    V4Trader internal trader;
    PoolKey internal key;
    PoolId internal pid;
    bool internal stockIsToken0;
    uint80 internal feedRound;

    address internal owner = makeAddr("owner");
    address internal keeper = makeAddr("keeper");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public virtual {
        ForkPin.select(vm);
        (feedRound,,,,) = IAggregatorV3(FEED()).latestRoundData();

        stockIsToken0 = STOCK() < USDG;
        key = PoolKey(
            Currency.wrap(stockIsToken0 ? STOCK() : USDG),
            Currency.wrap(stockIsToken0 ? USDG : STOCK()),
            FEE(),
            SPACING(),
            IHooks(address(0))
        );
        pid = key.toId();
        _setFeed(_poolPrice());
        _size();

        vault = _deploy(_defaultParams());
        trader = new V4Trader(PM);
        deal(USDG, address(trader), 200_000_000e6);
        deal(STOCK(), address(trader), 50_000_000e18);
        _seed();
    }

    /// @dev USDG value of the liquidity within 5% of spot, both sides (twice the USDG leg a 5% fall in the stock holds),
    /// the same measure as `depth_usd_5pct` in keeper/data/universe.json.
    function _depthUsdg() internal view returns (uint256) {
        (uint160 sp,) = _spot();
        uint128 liq = PM.getLiquidity(pid);
        uint256 leg = stockIsToken0
            ? SqrtPriceMath.getAmount1Delta(uint160(uint256(sp) * 97_468 / 100_000), sp, liq, false)
            : SqrtPriceMath.getAmount0Delta(sp, uint160(uint256(sp) * 102_600 / 100_000), liq, false);
        return 2 * leg;
    }

    function _size() internal {
        uint256 depth = _depthUsdg();
        uint256 unitUsdg = depth * 6 / 1000;
        if (unitUsdg < 1500e6) unitUsdg = 1500e6;
        unit = unitUsdg * 1e20 / _poolPrice();
        vol = depth * 12 / 100;
        if (vol < 20_000e6) vol = 20_000e6;
    }

    function _defaultParams() internal pure returns (StockVaultV4.Params memory) {
        return StockVaultV4.Params({
            rangeBps: 500,
            perfFeeBps: 1000,
            maxDeviationBps: 100,
            slippageBps: 100,
            exitBufferBps: 30,
            maxStaleness: 90_000,
            twapWindow: 600,
            minRebalanceInterval: 1 hours
        });
    }

    function _config() internal view returns (StockVaultV4.Config memory) {
        return StockVaultV4.Config({
            stock: STOCK(),
            usdg: USDG,
            poolManager: address(PM),
            hooks: address(0),
            feed: FEED(),
            owner: owner,
            keeper: keeper,
            treasury: treasury,
            depositCap: 0,
            fee: FEE(),
            tickSpacing: SPACING()
        });
    }

    function _deploy(StockVaultV4.Params memory p) internal returns (StockVaultV4) {
        return new StockVaultV4(_config(), p, "Stock Vault V4", "svV4");
    }

    // ----------------------------------------------------------------- clock and feed

    /// @dev Eleven pokes a minute apart, the feed following the pool: a continuous record over the 600 s window.
    function _seed() internal {
        for (uint256 i; i < 12; ++i) {
            vm.warp(vm.getBlockTimestamp() + 60);
            _setFeed(_poolPrice());
            vault.poke();
        }
    }

    /// @dev Moves time forward `secs`, poking every 100 s with the feed following the pool, so the record stays
    /// continuous the way the keeper's loop keeps it.
    function _advance(uint256 secs) internal {
        uint256 end = vm.getBlockTimestamp() + secs;
        while (vm.getBlockTimestamp() + 100 < end) {
            vm.warp(vm.getBlockTimestamp() + 100);
            _setFeed(_poolPrice());
            vault.poke();
        }
        vm.warp(end);
        _setFeed(_poolPrice());
        vault.poke();
    }

    function _setFeed(uint256 price) internal {
        vm.mockCall(
            FEED(),
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(feedRound, int256(price), vm.getBlockTimestamp(), vm.getBlockTimestamp(), feedRound)
        );
    }

    function _spot() internal view returns (uint160 sqrtP, int24 tick) {
        (sqrtP, tick,,) = PM.getSlot0(pid);
    }

    /// @dev USD per Stock Token (8 decimals) implied by the pool's spot price.
    function _poolPrice() internal view returns (uint256) {
        (uint160 sqrtP,) = _spot();
        return _usdOf(sqrtP);
    }

    /// @dev USD per Stock Token (8 decimals) at a sqrt price of the pool.
    function _usdOf(uint160 sqrtP) internal view returns (uint256) {
        uint256 p96 = Math.mulDiv(sqrtP, sqrtP, 1 << 96);
        return stockIsToken0 ? Math.mulDiv(p96, 1e20, 1 << 96) : Math.mulDiv(1e20, 1 << 96, p96);
    }

    // ----------------------------------------------------------------- trading

    /// @dev Trades the real pool until the Stock Token's USD price has moved by `bps` (signed).
    function _pushPrice(int256 bps) internal {
        (uint160 cur,) = _spot();
        uint256 f = Math.sqrt(uint256(int256(1e4) + bps) * 1e36 / 1e4); // sqrt(1 + x) in 1e18
        // Stock token0: its price up means sqrt up. Stock token1: its price up means sqrt down.
        uint256 target = stockIsToken0 ? uint256(cur) * f / 1e18 : uint256(cur) * 1e18 / f;
        bool buyStock = bps > 0;
        bool zeroForOne = buyStock ? !stockIsToken0 : stockIsToken0; // buying the stock spends USDG
        trader.swap(key, zeroForOne, buyStock ? 20_000_000e6 : 40_000e18, uint160(target));
    }

    /// @dev Round trips inside the range so the position earns fees: buy stock with `usdgPerLeg`, sell it all back.
    function _volume(uint256 usdgPerLeg, uint256 trips) internal {
        for (uint256 i; i < trips; ++i) {
            uint256 s0 = IERC20(STOCK()).balanceOf(address(trader));
            trader.swap(key, !stockIsToken0, usdgPerLeg, stockIsToken0 ? TickMath.MAX_SQRT_PRICE - 1 : TickMath.MIN_SQRT_PRICE + 1);
            uint256 got = IERC20(STOCK()).balanceOf(address(trader)) - s0;
            trader.swap(key, stockIsToken0, got, stockIsToken0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1);
        }
    }

    // ----------------------------------------------------------------- vault helpers

    function _ownerDo(bytes memory data) internal {
        uint256 t0 = vm.getBlockTimestamp();
        vm.prank(owner);
        vault.queueChange(data);
        vm.warp(t0 + vault.CHANGE_DELAY());
        vm.prank(owner);
        vault.executeChange(data);
        vm.warp(t0);
    }

    function _instant() internal {
        _ownerDo(abi.encodeCall(StockVaultV4.setInstantDeploy, (true)));
    }

    function _fund(address who, uint256 amount) internal {
        deal(STOCK(), who, amount);
        vm.prank(who);
        IERC20(STOCK()).approve(address(vault), type(uint256).max);
    }

    /// @dev Whether pool spot sits further from the vault's average than its spot-to-TWAP band allows.
    function _bandOff() internal view returns (bool) {
        (,,,, uint160 twap, uint160 spot) = vault.health();
        if (twap == 0 || spot == 0) return false;
        uint256 pt = Math.mulDiv(twap, twap, 1 << 96);
        uint256 ps = Math.mulDiv(spot, spot, 1 << 96);
        (uint256 hi, uint256 lo) = ps > pt ? (ps, pt) : (pt, ps);
        return hi * 1e4 > lo * (1e4 + vault.maxSpotTwapBps());
    }

    /// @dev A vault's own deploy swap moves the pool and the average follows over the window; real markets have
    /// arbitrageurs, the fork has none, so a test that deposits again lets the window pass first.
    function _settle() internal {
        if (_bandOff()) _advance(11 minutes);
    }

    /// @dev Deposits and moves one block on: shares minted in a block cannot leave in that block.
    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        _settle();
        _fund(who, amount);
        vm.prank(who);
        shares = vault.deposit(amount, who);
        vm.roll(vm.getBlockNumber() + 1);
    }

    function _status() internal view returns (StockVaultV4.Status st) {
        (st,,,,,) = vault.health();
    }

    function _feesCollected(Vm.Log[] memory logs) internal view returns (bool found, uint256 f0, uint256 f1, uint256 minted) {
        bytes32 sig = keccak256("FeesCollected(uint256,uint256,uint256,uint256)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(vault) && logs[i].topics[0] == sig) {
                (f0, f1,, minted) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                return (true, f0, f1, minted);
            }
        }
    }
}
