// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {StockVault} from "../../src/StockVault.sol";
import {IAggregatorV3, IUniswapV3Pool, ISwapRouter02} from "../../src/interfaces/IUniswapV3.sol";
import {UptickRouter, IStockVault, IVaultRegistry} from "../../src/UptickRouter.sol";

/// @dev Re-review 2026-10-20 of commit 3612c71, on a thin pool: PLTR / USDG 0.3% (universe.json: about $97K of depth
/// inside 5%, about $106K a day of volume, a $100K vault would be 51% of in-range liquidity). Fork of the public RPC
/// at head. No arbitrageurs exist on the fork, so every number is the attacker-is-alone case.
/// Measurements log their numbers; assertions state the property that should hold, so a red test is a finding.
contract ReReviewPltrTest is Test {
    address constant STOCK = 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A; // PLTR, token1
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168; // token0
    address constant POOL = 0x851680416A4f4E1c463d45171d61ACDdBc8554c0;
    address constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant FEED = 0x820ABedFF239034956B7A9d2F0a331f9F075eB4c;
    uint24 constant FEE = 3000;

    StockVault vault;
    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address mev = makeAddr("mev");
    uint80 feedRound;
    uint256 p0;
    uint160 sqrt0;

    function setUp() public {
        vm.createSelectFork("robinhood");
        (feedRound,,,,) = IAggregatorV3(FEED).latestRoundData();
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        _setFeed(_price());
        vault = new StockVault(
            StockVault.Config(STOCK, USDG, POOL, NPM, ROUTER, FEED, owner, keeper, treasury, 0),
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
            "Stock Vault PLTR",
            "svPLTR"
        );
        deal(STOCK, mev, 100_000e18);
        deal(USDG, mev, 50_000_000e6);
        vm.startPrank(mev);
        IERC20(STOCK).approve(ROUTER, type(uint256).max);
        IERC20(USDG).approve(ROUTER, type(uint256).max);
        IERC20(STOCK).approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ helpers

    function _setFeed(uint256 price) internal {
        uint256 ts = vm.getBlockTimestamp();
        vm.mockCall(
            FEED,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(feedRound, int256(price), ts, ts, feedRound)
        );
    }

    function _spot() internal view returns (uint160 s) {
        (s,,,,,,) = IUniswapV3Pool(POOL).slot0();
    }

    /// @dev USD per PLTR, 8 decimals, from a sqrt price (PLTR is token1).
    function _usdAt(uint160 s) internal pure returns (uint256) {
        uint256 p96 = Math.mulDiv(s, s, 1 << 96);
        return Math.mulDiv(1e26, 1 << 96, p96) / 1e6;
    }

    function _price() internal view returns (uint256) {
        return _usdAt(_spot());
    }

    function _at(uint256 s, uint256 u, uint256 price) internal pure returns (uint256) {
        return s + u * 1e12 * 1e8 / price;
    }

    function _wallet(address who, uint256 price) internal view returns (uint256) {
        return _at(IERC20(STOCK).balanceOf(who), IERC20(USDG).balanceOf(who), price);
    }

    /// @dev Swaps as `who` until spot reaches `target`. Selling PLTR (token1) raises sqrtPrice.
    function _swapToSqrt(address who, uint160 target) internal returns (uint256 usdgNotional) {
        uint160 cur = _spot();
        if (cur == target) return 0;
        bool sellStock = target > cur;
        uint256 u0 = IERC20(USDG).balanceOf(who);
        vm.prank(who);
        ISwapRouter02(ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(
                sellStock ? STOCK : USDG, sellStock ? USDG : STOCK, FEE, who, sellStock ? 50_000e18 : 20_000_000e6, 0, target
            )
        );
        uint256 u1 = IERC20(USDG).balanceOf(who);
        usdgNotional = u1 > u0 ? u1 - u0 : u0 - u1;
    }

    /// @dev sqrt price at which PLTR's USD price is `bps` below the price of `s` (sqrt rises as PLTR falls).
    function _sqrtBelow(uint160 s, uint256 bps) internal pure returns (uint160) {
        return uint160(uint256(s) * Math.sqrt(1e4 * 1e36 / (1e4 - bps)) / 1e18);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 sh) {
        deal(STOCK, who, amount);
        vm.startPrank(who);
        IERC20(STOCK).approve(address(vault), amount);
        sh = vault.deposit(amount, who);
        vm.stopPrank();
        vm.roll(vm.getBlockNumber() + 1);
    }

    function _exitValue(address who, uint256 price) internal returns (uint256 v) {
        uint256 sh = vault.balanceOf(who);
        if (sh == 0) return 0;
        uint256 snap = vm.snapshotState();
        vm.prank(who);
        (uint256 s, uint256 u) = vault.redeemInKind(sh, who, who);
        v = _at(s, u, price);
        vm.revertToState(snap);
    }

    function _holders(uint256 price) internal returns (uint256) {
        return _exitValue(alice, price) + _exitValue(bob, price);
    }

    function _status() internal view returns (StockVault.Status st, uint160 twap, uint160 spot) {
        (st,,,, twap, spot) = vault.health();
    }

    /// @dev Alice is deployed by the keeper; Bob deposits 50 PLTR that sit idle (instantDeploy off, the default) until
    /// the next rebalance; 26 h pass so rebalance() is open to anyone. Feed = pool price (no real move).
    function _vaultWithIdleDeposits(uint256 aliceAmt, uint256 bobAmt) internal {
        _deposit(alice, aliceAmt);
        vm.warp(vm.getBlockTimestamp() + 6 hours);
        _setFeed(_price());
        vm.prank(keeper);
        vault.rebalance();
        vm.warp(vm.getBlockTimestamp() + 20 minutes);
        _setFeed(_price());
        if (bobAmt > 0) _deposit(bob, bobAmt);
        vm.warp(vm.getBlockTimestamp() + 26 hours);
        p0 = _price();
        sqrt0 = _spot();
        _setFeed(p0);
        (StockVault.Status st,,) = _status();
        assertEq(uint8(st), 0, "gate open at start");
    }

    /// @dev Walks spot and the 600 s TWAP down by `totalBps` without ever leaving the 9 bp band: every 30 s, push spot
    /// to 9 bp under the current TWAP. Returns the USDG notional traded and the minutes it took.
    function _drag(uint256 totalBps) internal returns (uint256 notional, uint256 secs) {
        uint160 fin = _sqrtBelow(sqrt0, totalBps);
        for (uint256 i; i < 400; ++i) {
            vm.warp(vm.getBlockTimestamp() + 30);
            vm.roll(vm.getBlockNumber() + 1);
            secs += 30;
            (StockVault.Status st, uint160 twap, uint160 spot) = _status();
            assertEq(uint8(st), 0, "Chainlink gate stays open during the drag");
            uint160 target = _sqrtBelow(twap, 9);
            if (target > fin) target = fin;
            if (target > spot) notional += _swapToSqrt(mev, target);
            (, twap, spot) = _status();
            if (spot >= fin && !_off(twap, spot, 9)) return (notional, secs);
        }
        revert("drag did not converge");
    }

    function _off(uint160 a, uint160 b, uint256 bps) internal pure returns (bool) {
        uint256 pa = Math.mulDiv(a, a, 1 << 96);
        uint256 pb = Math.mulDiv(b, b, 1 << 96);
        (uint256 hi, uint256 lo) = pa > pb ? (pa, pb) : (pb, pa);
        return hi * 1e4 > lo * (1e4 + bps);
    }

    // ------------------------------------------------------------------ H1 across blocks: TWAP drag

    /// Control: the permissionless rebalance of 50 deployed + 50 idle PLTR with no attacker.
    function test_H1x_control_rebalanceOnly() public {
        _vaultWithIdleDeposits(50e18, 50e18);
        uint256 before_ = _holders(p0);
        vm.prank(mev);
        vault.rebalance();
        int256 d = int256(_holders(p0)) - int256(before_);
        emit log_named_int("holders pnl, PLTR wei at p0", d);
        emit log_named_decimal_uint("p0 USD", p0, 8);
    }

    /// Control: drag 90 bp and unwind, no rebalance. Isolates what the drag costs the attacker against the vault's
    /// own LP position and the other LPs.
    function test_H1x_control_dragAndUnwindOnly() public {
        _vaultWithIdleDeposits(50e18, 50e18);
        uint256 before_ = _holders(p0);
        uint256 w0 = _wallet(mev, p0);
        (uint256 notional, uint256 secs) = _drag(90);
        _swapToSqrt(mev, sqrt0);
        emit log_named_decimal_uint("drag notional USDG", notional, 6);
        emit log_named_uint("drag seconds", secs);
        emit log_named_int("mev pnl, PLTR wei at p0", int256(_wallet(mev, p0)) - int256(w0));
        emit log_named_int("holders pnl, PLTR wei at p0", int256(_holders(p0)) - int256(before_));
    }

    /// Attack: drag spot and TWAP 90 bp under the (unchanged, correct) Chainlink price, inside the 100 bp gate and
    /// never more than 9 bp from the TWAP, call the permissionless rebalance (the vault sells Bob's idle PLTR into
    /// the depressed pool and re-centres around Chainlink), unwind. No deposit, so the share lock is irrelevant.
    /// Property: holders lose no more than in the control rebalance (to 0.01 PLTR). The control is measured in the
    /// same test on the same state. Since N3 the rebalance refuses a TWAP 90 bp off Chainlink (bound 60 bp), so the
    /// attacker pays for the drag and the vault does not trade at all.
    function test_H1x_dragThenPermissionlessRebalance() public {
        _vaultWithIdleDeposits(50e18, 50e18);
        uint256 before_ = _holders(p0);
        uint256 snap = vm.snapshotState();
        vm.prank(mev);
        vault.rebalance();
        int256 control = int256(_holders(p0)) - int256(before_);
        vm.revertToState(snap);

        uint256 w0 = _wallet(mev, p0);
        (uint256 notional, uint256 secs) = _drag(90);
        vm.prank(mev);
        try vault.rebalance() {
            emit log("rebalance went through");
        } catch (bytes memory err) {
            assertEq(bytes4(err), StockVault.TwapOffOracle.selector, "refused for the right reason");
            emit log("rebalance refused: TwapOffOracle");
        }
        _swapToSqrt(mev, sqrt0);
        vm.roll(vm.getBlockNumber() + 1);
        int256 mevPnl = int256(_wallet(mev, p0)) - int256(w0);
        int256 holders = int256(_holders(p0)) - int256(before_);
        emit log_named_decimal_uint("drag notional USDG", notional, 6);
        emit log_named_uint("drag seconds", secs);
        emit log_named_int("mev pnl, PLTR wei at p0", mevPnl);
        emit log_named_int("holders pnl, PLTR wei at p0", holders);
        emit log_named_int("control holders pnl, PLTR wei at p0", control);
        emit log_named_decimal_uint("p0 USD", p0, 8);
        assertGe(holders, control - int256(1e16), "holders lost more to a band-respecting TWAP drag than to the control");
    }

    /// Same drag, then an instantDeploy deposit by the attacker, unwind, exit in kind the next block.
    function test_H1x_dragThenInstantDepositExitNextBlock() public {
        _vaultWithIdleDeposits(50e18, 0);
        _queueInstant();
        uint256 before_ = _holders(p0);
        uint256 w0 = _wallet(mev, p0);
        _drag(90);
        vm.prank(mev);
        uint256 sh = vault.deposit(50e18, mev);
        _swapToSqrt(mev, sqrt0);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(mev);
        vault.redeemInKind(sh, mev, mev);
        int256 mevPnl = int256(_wallet(mev, p0)) - int256(w0);
        int256 holders = int256(_holders(p0)) - int256(before_);
        emit log_named_int("mev pnl, PLTR wei at p0", mevPnl);
        emit log_named_int("alice pnl, PLTR wei at p0", holders);
        assertGe(holders, -int256(1e16), "alice lost to drag + instant deposit");
    }

    function _queueInstant() internal {
        bytes memory data = abi.encodeCall(StockVault.setInstantDeploy, (true));
        uint256 t0 = vm.getBlockTimestamp();
        vm.prank(owner);
        vault.queueChange(data);
        vm.warp(t0 + 24 hours);
        vm.prank(owner);
        vault.executeChange(data);
        vm.warp(t0);
        _setFeed(p0);
    }

    // ------------------------------------------------------------------ H1 residual: back-run own deploy

    /// instantDeploy, no push: the attacker deposits, the vault swaps about half of it through the thin pool, the
    /// attacker back-runs the vault's own impact to sqrt0, exits in kind next block.
    function test_H1r_instantDepositBackrunOwnDeploy() public {
        _vaultWithIdleDeposits(50e18, 0);
        _queueInstant();
        uint256 before_ = _holders(p0);
        uint256 w0 = _wallet(mev, p0);
        vm.prank(mev);
        uint256 sh = vault.deposit(50e18, mev);
        uint256 back = _swapToSqrt(mev, sqrt0);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(mev);
        vault.redeemInKind(sh, mev, mev);
        emit log_named_decimal_uint("back-run notional USDG", back, 6);
        emit log_named_int("mev pnl, PLTR wei at p0", int256(_wallet(mev, p0)) - int256(w0));
        emit log_named_int("alice pnl, PLTR wei at p0", int256(_holders(p0)) - int256(before_));
    }

    // ------------------------------------------------------------------ M1 residual: off-chain information

    /// The real price falls 50 bp off chain (earnings print, other venue). Feed, TWAP and pool have not moved yet:
    /// Chainlink's deviation trigger is 50 bp and the pool waits for an arbitrageur. Bob deposits PLTR, exits in kind
    /// the next block, and holds Alice's USDG leg bought at the stale price, fee-free. Property: he gains nothing.
    function test_M1r_offChainMoveRoundTrip() public {
        _vaultWithIdleDeposits(50e18, 0);
        uint256 p1 = p0 * 9950 / 1e4;
        uint256 aliceBefore = _exitValue(alice, p1);
        uint256 sh = _deposit(bob, 50e18);
        vm.prank(bob);
        (uint256 s, uint256 u) = vault.redeemInKind(sh, bob, bob);
        int256 gain = int256(_at(s, u, p1)) - int256(50e18);
        emit log_named_int("bob gain vs holding, PLTR wei at the new price", gain);
        emit log_named_int("alice pnl, PLTR wei at the new price", int256(_exitValue(alice, p1)) - int256(aliceBefore));
        assertLe(gain, int256(1e15), "vault sold its USDG leg at the stale price");
    }

    // ------------------------------------------------------------------ band liveness and grief cost

    /// What it costs to move PLTR spot 11 bp off the TWAP (closes deposit, mint and rebalance until the TWAP follows).
    function test_bandGriefCost() public {
        _vaultWithIdleDeposits(50e18, 0);
        uint256 n = _swapToSqrt(mev, _sqrtBelow(sqrt0, 11));
        emit log_named_decimal_uint("USDG notional to push 11 bp", n, 6);
        emit log_named_decimal_uint("pool fee paid, USDG", n * FEE / 1e6, 6);
        _setFeed(p0);
        deal(STOCK, bob, 1e18);
        vm.startPrank(bob);
        IERC20(STOCK).approve(address(vault), 1e18);
        vm.expectRevert(StockVault.SpotOffTwap.selector);
        vault.deposit(1e18, bob);
        vm.stopPrank();
        // how long until the TWAP alone (no arbitrage) lets deposits back in
        uint256 waited;
        while (true) {
            vm.warp(vm.getBlockTimestamp() + 5);
            waited += 5;
            (, uint160 twap, uint160 spot) = _status();
            if (!_off(twap, spot, 10)) break;
        }
        emit log_named_uint("seconds closed after one push", waited);
    }

    /// UptickRouter.depositUsdg swaps USDG to PLTR in the vault's own pool and then calls vault.deposit in the same
    /// transaction. Its own buy moves spot off the TWAP, so past about $1.1K (the notional that moves PLTR 11 bp,
    /// test_bandGriefCost) the deposit it makes reverted SpotOffTwap. Property: $2K and $10K deposits into the vault
    /// (cap $24K) go through, and the shares are what previewDeposit says for the stock the swap delivered.
    function test_routerDepositRevertsOnItsOwnImpact() public {
        _vaultWithIdleDeposits(50e18, 0);
        address reg = makeAddr("registry");
        vm.etch(reg, hex"00");
        vm.mockCall(reg, abi.encodeWithSelector(IVaultRegistry.isVault.selector), abi.encode(true));
        UptickRouter r = new UptickRouter(100, IVaultRegistry(reg));
        deal(USDG, bob, 20_000e6);
        vm.prank(bob);
        IERC20(USDG).approve(address(r), type(uint256).max);
        uint256[3] memory sizes = [uint256(500e6), 2_000e6, 10_000e6];
        for (uint256 i; i < sizes.length; ++i) {
            uint256 snap = vm.snapshotState();
            vm.prank(bob);
            uint256 shares = r.depositUsdg(IStockVault(address(vault)), sizes[i], 0, bob);
            assertGt(shares, 0, "shares minted");
            emit log_named_decimal_uint("zap USDG", sizes[i], 6);
            emit log_named_uint("shares", shares);
            vm.revertToState(snap);
        }
    }
}
