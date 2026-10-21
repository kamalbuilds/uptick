// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

import {V4Fixture} from "../../v4/V4Fixture.sol";
import {StockVaultV4} from "../../../src/v4/StockVaultV4.sol";
import {TickOracleV4} from "../../../src/v4/TickOracleV4.sol";

/// @dev Writes one manipulated observation with no capital: inside its own unlock it pushes spot to `target`, calls the
/// vault's permissionless poke() (which reads slot0 mid-unlock), swaps the proceeds back and settles only the net,
/// which is the two legs' fees. Returns that net cost per currency.
contract PokeSandwicher is IUnlockCallback {
    IPoolManager public immutable pm;
    StockVaultV4 public immutable vault;

    constructor(IPoolManager pm_, StockVaultV4 vault_) {
        pm = pm_;
        vault = vault_;
    }

    function run(PoolKey memory key, bool zeroForOne, uint160 target) external returns (int256 net0, int256 net1, bool wrote) {
        return abi.decode(pm.unlock(abi.encode(key, zeroForOne, target)), (int256, int256, bool));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "pm only");
        (PoolKey memory key, bool zf1, uint160 target) = abi.decode(data, (PoolKey, bool, uint160));
        BalanceDelta a = pm.swap(key, IPoolManager.SwapParams(zf1, -int256(uint256(1e30)), target), "");
        bool wrote = vault.poke();
        uint256 back = uint256(int256(zf1 ? a.amount1() : a.amount0()));
        BalanceDelta b = pm.swap(
            key,
            IPoolManager.SwapParams(!zf1, -int256(back), !zf1 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1),
            ""
        );
        int256 n0 = int256(a.amount0()) + int256(b.amount0());
        int256 n1 = int256(a.amount1()) + int256(b.amount1());
        _net(key.currency0, n0);
        _net(key.currency1, n1);
        return abi.encode(n0, n1, wrote);
    }

    function _net(Currency c, int256 n) private {
        if (n < 0) {
            pm.sync(c);
            IERC20(Currency.unwrap(c)).transfer(address(pm), uint256(-n));
            pm.settle();
        } else if (n > 0) {
            pm.take(c, address(this), uint256(n));
        }
    }
}

/// @dev A hook with only beforeSwap and afterSwap permission bits: no return-delta flag, no remove-liquidity callback,
/// so StockVaultV4's constructor accepts it. It still sandwiches the vault inside the vault's own swap: in beforeSwap
/// it swaps in the vault's direction to a price `pushBps` worse, in afterSwap it swaps back and settles its own net.
/// It is also the pool's LP (as the creator of a hooked pool typically is), so the round trip's LP fees come back to it.
contract EvilSwapHook is IUnlockCallback {
    IPoolManager public immutable pm;
    address public victim;
    uint256 public pushBps;
    BalanceDelta private front;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    function arm(address victim_, uint256 pushBps_) external {
        victim = victim_;
        pushBps = pushBps_;
    }

    function addLiquidity(PoolKey memory key, int24 tl, int24 tu, uint256 liq) external {
        pm.unlock(abi.encode(key, tl, tu, liq));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (PoolKey memory key, int24 tl, int24 tu, uint256 liq) = abi.decode(data, (PoolKey, int24, int24, uint256));
        (BalanceDelta d,) = pm.modifyLiquidity(key, IPoolManager.ModifyLiquidityParams(tl, tu, int256(liq), 0), "");
        _net(key.currency0, d.amount0());
        _net(key.currency1, d.amount1());
        return "";
    }

    function beforeSwap(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata p, bytes calldata)
        external
        returns (bytes4, int256, uint24)
    {
        if (sender == victim && pushBps != 0) {
            (uint160 cur,,,) = StateLibrary.getSlot0(pm, key.toId());
            uint256 f = Math.sqrt((1e4 - pushBps) * 1e36 / 1e4);
            uint160 target = uint160(p.zeroForOne ? uint256(cur) * f / 1e18 : uint256(cur) * 1e18 / f);
            front = pm.swap(key, IPoolManager.SwapParams(p.zeroForOne, -int256(uint256(1e30)), target), "");
        }
        return (this.beforeSwap.selector, 0, 0);
    }

    function afterSwap(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata p, BalanceDelta, bytes calldata)
        external
        returns (bytes4, int128)
    {
        if (sender == victim && pushBps != 0) {
            BalanceDelta a = front;
            uint256 got = uint256(int256(p.zeroForOne ? a.amount1() : a.amount0()));
            BalanceDelta b = pm.swap(
                key,
                IPoolManager.SwapParams(
                    !p.zeroForOne, -int256(got), !p.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                ),
                ""
            );
            _net(key.currency0, a.amount0() + b.amount0());
            _net(key.currency1, a.amount1() + b.amount1());
        }
        return (this.afterSwap.selector, 0);
    }

    function _net(Currency c, int128 n) private {
        if (n < 0) {
            pm.sync(c);
            IERC20(Currency.unwrap(c)).transfer(address(pm), uint128(-n));
            pm.settle();
        } else if (n > 0) {
            pm.take(c, address(this), uint128(n));
        }
    }
}

/// @dev Fourth-round style review of the v4 adapter, on the live PLTR v4 pool (USDG currency0, PLTR currency1, 1% fee,
/// spacing 200, protocol fee live). Same fixture as test/v4: real PoolManager, Chainlink mocked at the pool price.
contract ReviewV4PltrTest is V4Fixture {
    using Math for uint256;

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

    /// @dev Value of the position's uncollected fees in stock at the feed price, and the treasury's cut of it.
    function _feeCut() internal view returns (uint256 feeValue, uint256 cut) {
        StockVaultV4.PositionInfo memory info = vault.positionInfo();
        (, uint256 price,,,,) = vault.health();
        feeValue = info.uncollectedStock + info.uncollectedUsdg * 1e20 / price;
        (, uint16 perf,,,,,,) = vault.params();
        cut = feeValue * perf / 1e4;
    }

    function _accrue() internal returns (uint256 dust) {
        _instant();
        _deposit(alice, UNIT() * 2);
        _deposit(bob, UNIT() * 2);
        _volume(VOL() * 2, 3);
        _advance(600);
        _settle();
        dust = vault.totalSupply() / 1e6; // 1 ppm of supply: enough that the removal is non-zero liquidity
    }

    function _staleFeed() internal {
        vm.mockCall(
            FEED(),
            abi.encodeWithSelector(bytes4(keccak256("latestRoundData()"))),
            abi.encode(feedRound, int256(_poolPrice()), vm.getBlockTimestamp() - 91_000, vm.getBlockTimestamp() - 91_000, feedRound)
        );
    }

    /// @notice V4R-M1. A dust `redeemInKind` while the gate is not Ok (here: the weekend stale feed, free) makes the
    /// PoolManager pay the whole position's accrued fees into idle balances with no performance-fee mint; they are
    /// principal from then on and no later harvest sees them. StockVault (v3) leaves them owed in the NPM position for
    /// the next healthy harvest. Property the fix must restore: the treasury still gets its cut.
    function test_V4R_M1_closedGateInKindExitForfeitsTheTreasuryCut() public {
        uint256 dust = _accrue();
        (uint256 feeValue, uint256 cut) = _feeCut();
        assertGt(cut, 0, "fees accrued: the check is not run on an empty position");
        emit log_named_decimal_uint("uncollected fees (PLTR)", feeValue, 18);
        emit log_named_decimal_uint("treasury cut owed (PLTR)", cut, 18);

        uint256 snap = vm.snapshotState();
        // control: the same dust exit with the gate Ok harvests first and mints the cut
        vm.prank(bob);
        vault.redeemInKind(dust, bob, bob);
        uint256 controlTreasury = vault.convertToAssets(vault.balanceOf(treasury));
        emit log_named_decimal_uint("control: treasury holds (PLTR)", controlTreasury, 18);
        assertApproxEqRel(controlTreasury, cut, 0.02e18, "control mints the cut");

        vm.revertToState(snap);
        _staleFeed();
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.FeedStale));
        uint256 pps0 = vault.convertToAssets(1e24);
        vm.prank(bob);
        vault.redeemInKind(dust, bob, bob);
        // feed back, ring still continuous (no time passed): any harvest now finds nothing
        vm.clearMockedCalls();
        _setFeed(_poolPrice());
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.Ok));
        (uint256 left,) = _feeCut();
        emit log_named_decimal_uint("fees left in the position after the exit (PLTR)", left, 18);
        uint256 pps1 = vault.convertToAssets(1e24);
        emit log_named_decimal_uint("price per 1e24 shares before", pps0, 18);
        emit log_named_decimal_uint("price per 1e24 shares after (holders absorbed the cut)", pps1, 18);
        vm.prank(bob);
        vault.redeemInKind(dust, bob, bob); // a healthy harvest
        uint256 attackTreasury = vault.convertToAssets(vault.balanceOf(treasury));
        (uint256 lifeStock, uint256 lifeUsdg,) = vault.feesEarnedLifetime();
        emit log_named_decimal_uint("attack: treasury holds (PLTR)", attackTreasury, 18);
        emit log_named_uint("feesEarnedLifetime stock", lifeStock);
        emit log_named_uint("feesEarnedLifetime usdg", lifeUsdg);
        assertGe(attackTreasury * 100, cut * 90, "V4R-M1: the treasury's performance cut survives a closed-gate in-kind exit");
        assertApproxEqRel(pps1, pps0, 2e14, "V4R-M1: the holders do not absorb the cut when a closed-gate exit sweeps the fees");
        (lifeStock, lifeUsdg,) = vault.feesEarnedLifetime();
        assertGt(lifeStock + lifeUsdg, 0, "the swept fees are counted in feesEarnedLifetime at the harvest");
    }

    /// @notice V4R-M1, later exits. While fees are pending, other closed-gate exits (a whole holder leaving) must not
    /// carry the treasury's cut out with their idle slice.
    function test_V4R_M1_laterClosedGateExitsCannotTakeThePendingCut() public {
        uint256 dust = _accrue();
        (, uint256 cut) = _feeCut();
        assertGt(cut, 0);
        _staleFeed();
        vm.prank(bob);
        vault.redeemInKind(dust, bob, bob); // sweeps the fees: pending
        uint256 bobShares = vault.balanceOf(bob);
        uint256 ppsMid = vault.convertToAssets(1e24);
        vm.prank(bob);
        vault.redeemInKind(bobShares, bob, bob); // the gate is still closed: half the supply leaves with its idle slice
        assertApproxEqRel(vault.convertToAssets(1e24), ppsMid, 1e12, "the holders who stay do not pay the exiter's share of the treasury's cut");
        vm.clearMockedCalls();
        _setFeed(_poolPrice());
        assertEq(uint8(_status()), uint8(StockVaultV4.Status.Ok));
        vm.prank(alice);
        vault.redeemInKind(dust, alice, alice); // a healthy harvest mints the cut
        uint256 treasuryValue = vault.convertToAssets(vault.balanceOf(treasury));
        assertGe(treasuryValue * 100, cut * 90, "the cut survives later closed-gate exits");
    }

    /// @notice Measures the ring walk the R3-H1 residual now rests on: an attacker who owns every observation (pokes every
    /// MIN_GAP, each one a zero-capital sandwich inside its own unlock) for one twapWindow. Logs the cost and the TWAP
    /// offset reached, and checks the bounds that keep the residual at (30 + 10) bp x the swap.
    function test_V4R_ringWalkCost() public {
        uint256 p0 = _poolPrice();
        PokeSandwicher atk = new PokeSandwicher(PM, vault);
        deal(STOCK(), address(atk), 1_000e18);
        deal(USDG, address(atk), 1_000_000e6);
        uint256 s0 = IERC20(STOCK()).balanceOf(address(atk));
        uint256 u0 = IERC20(USDG).balanceOf(address(atk));
        (, int24 base) = vault.oracle().latest();

        // push the stock 32 bp down at every poke (selling stock): a 30 tick walk target
        bool sellZf1 = stockIsToken0; // selling the stock: zeroForOne when it is currency0
        (uint160 cur,) = _spot();
        uint256 f = Math.sqrt(uint256(1e4 - 32) * 1e36 / 1e4);
        uint160 target = uint160(stockIsToken0 ? uint256(cur) * f / 1e18 : uint256(cur) * 1e18 / f);
        uint256 n;
        for (uint256 t; t < 31; ++t) {
            vm.warp(vm.getBlockTimestamp() + 20);
            _setFeed(p0); // Chainlink does not move
            (,, bool wrote) = atk.run(key, sellZf1, target);
            assertTrue(wrote, "the sandwiched poke writes");
            ++n;
        }
        uint256 sCost = s0 - IERC20(STOCK()).balanceOf(address(atk));
        uint256 uCost = u0 - IERC20(USDG).balanceOf(address(atk));
        uint256 costUsdg = uCost + sCost * p0 / 1e20;
        (bool ok, int24 tw) = vault.oracle().twap(600);
        assertTrue(ok);
        int24 off = tw - base;
        emit log_named_uint("sandwiched pokes", n);
        emit log_named_decimal_uint("attacker cost, USDG", costUsdg, 6);
        emit log_named_decimal_uint("cost per poke, USDG", costUsdg / n, 6);
        emit log_named_int("TWAP offset reached (ticks, sign = pool orientation)", off);
        emit log_named_decimal_uint("pool spot after the walk vs before (bp)", _poolPrice() * 1e4 / p0, 4);
        // the walk reached the bound, so the cost is the price of the R3-H1 residual on this pool
        assertGe(_abs(off), 28, "the walk reached about 30 ticks");
        // the most the walk can buy at the deploy cap: (30 + 10) bp of a half-cap swap of $24,207
        uint256 maxGain = 24_207e6 / 2 * 40 / 1e4;
        emit log_named_decimal_uint("upper bound of the extraction at the cap, USDG", maxGain, 6);
        assertGt(costUsdg, maxGain, "the walk costs more than it can extract at the cap");
    }

    /// @notice V4R-L1. SECURITY.md: "a hook without return-delta flags cannot take value". A beforeSwap/afterSwap hook
    /// (bits 7 and 6, which the constructor accepts) sandwiches the vault's own deploy swap from inside it. The vault's
    /// floor (swap fee + slippageBps off Chainlink) is the only bound. Measured on a hooked PLTR/USDG 1% pool the hook
    /// creates and supplies with the live pool's in-range liquidity.
    function test_V4R_L1_aSwapHookSandwichesTheVaultInsideItsOwnSwap() public {
        // The hook is real and supplied with the live pool's liquidity: the pool works for any other LP. The vault refuses
        // it at construction, so it can never be sandwiched from inside the vault's own swap or add.
        (uint160 sp,) = _spot();
        address hookAddr = address(uint160((uint256(0xE1) << 152) | (1 << 7) | (1 << 6)));
        deployCodeTo("test/security/v4/ReviewV4.t.sol:EvilSwapHook", abi.encode(address(PM)), hookAddr);
        EvilSwapHook hook = EvilSwapHook(hookAddr);
        key = PoolKey(key.currency0, key.currency1, FEE(), SPACING(), IHooks(hookAddr));
        pid = key.toId();
        PM.initialize(key, sp);
        deal(STOCK(), hookAddr, 1_000_000e18);
        deal(USDG, hookAddr, 500_000_000e6);
        (, int24 t0) = _spot();
        int24 c = t0 - (t0 % SPACING());
        hook.addLiquidity(key, c - 20 * SPACING(), c + 20 * SPACING(), 614802414821935295);

        StockVaultV4.Config memory cfg = _config();
        cfg.hooks = hookAddr;
        vm.expectRevert(StockVaultV4.ForbiddenHook.selector);
        new StockVaultV4(cfg, _defaultParams(), "Stock Vault V4", "svV4");
        // the add-liquidity callbacks can move the price between the vault's fit and its add: refused the same way
        cfg.hooks = address(uint160((uint256(0xE2) << 152) | (1 << 11)));
        vm.expectRevert(StockVaultV4.ForbiddenHook.selector);
        new StockVaultV4(cfg, _defaultParams(), "Stock Vault V4", "svV4");
        cfg.hooks = address(uint160((uint256(0xE3) << 152) | (1 << 10)));
        vm.expectRevert(StockVaultV4.ForbiddenHook.selector);
        new StockVaultV4(cfg, _defaultParams(), "Stock Vault V4", "svV4");
    }

    /// @notice Declared residual "the balancing swap ignores its own impact (under 10% idle)", measured at the PLTR deploy
    /// cap (124.84 PLTR, about $24.2K) and the deploy range (350 bp) instead of the suite's 0.6%-of-depth unit.
    function test_V4R_idleRemainderAtTheCap() public {
        StockVaultV4.Params memory p = _defaultParams();
        p.rangeBps = 350;
        _ownerDo(abi.encodeCall(StockVaultV4.setParams, (p)));
        _deposit(alice, 124_839_483_252_107_991_026);
        _advance(1 hours + 1);
        vm.prank(keeper);
        vault.rebalance();
        (, uint256 price,,,,) = vault.health();
        uint256 idle = IERC20(STOCK()).balanceOf(address(vault)) + IERC20(USDG).balanceOf(address(vault)) * 1e20 / price;
        uint256 nav = vault.totalAssets();
        emit log_named_decimal_uint("idle after a full-cap rebalance, % of NAV", idle * 1e4 / nav, 2);
        assertLe(idle * 10, nav, "idle remainder under 10% of NAV at the cap");
    }

    function _abs(int24 x) internal pure returns (uint256) {
        return uint256(int256(x < 0 ? -x : x));
    }
}
