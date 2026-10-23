// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StockVault} from "../../src/StockVault.sol";
import {VaultMath} from "../../src/VaultMath.sol";
import {Base} from "../Base.t.sol";
import {ReReviewPltrTest} from "./ReReview.t.sol";
import {ReReviewFloorTest} from "./ReReviewFloor.t.sol";
import {IAggregatorV3, IUniswapV3Pool, ISwapRouter02} from "../../src/interfaces/IUniswapV3.sol";

/// @dev Third review 2026-10-20 (after d837da2 and bcc64ee), PLTR / USDG 0.3%, the thin pool, with the deploy-list
/// range (350 bp). Fork of the public RPC at head, Chainlink mocked at the pool price, no arbitrageurs on the fork.
/// Run with --match-test R3 (the parent's own tests are inherited). Measurements log; assertions state the property
/// that should hold, so a red test is a finding.
contract Review3PltrTest is ReReviewPltrTest {
    function _vaultAt(uint16 rangeBps) internal {
        vault = new StockVault(
            StockVault.Config(STOCK, USDG, POOL, NPM, ROUTER, FEED, owner, keeper, treasury, 0),
            StockVault.Params({
                rangeBps: rangeBps,
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
        vm.prank(mev);
        IERC20(STOCK).approve(address(vault), type(uint256).max);
    }

    /// @dev sqrt price at which PLTR's USD price is `bps` above the price of `s` (PLTR is token1: sqrt falls).
    function _sqrtAbove(uint160 s, uint256 bps) internal pure returns (uint160) {
        return uint160(uint256(s) * Math.sqrt(1e4 * 1e36 / (1e4 + bps)) / 1e18);
    }

    /// @dev Everything idle, no rebalance ever run: the state of every vault between launch and its first rebalance.
    function _allIdle(uint256 aliceAmt, uint256 bobAmt) internal {
        _deposit(alice, aliceAmt);
        if (bobAmt > 0) _deposit(bob, bobAmt);
        vm.warp(vm.getBlockTimestamp() + 26 hours);
        p0 = _price();
        sqrt0 = _spot();
        _setFeed(p0);
        (StockVault.Status st,,) = _status();
        assertEq(uint8(st), 0, "gate open at start");
    }

    /// @dev N3 with a drag of `dragBps` against the vault's TWAP-to-Chainlink bound. Control (no attacker) measured on
    /// the same state. A rebalance the vault refuses must be refused with TwapOffOracle and nothing else; the attacker
    /// then unwinds anyway and pays for the round trip.
    function _dragRebalance(uint256 dragBps)
        internal
        returns (int256 mevPnl, int256 holders, int256 control, bool refused)
    {
        uint256 before_ = _holders(p0);
        uint256 snap = vm.snapshotState();
        vm.prank(mev);
        vault.rebalance();
        control = int256(_holders(p0)) - int256(before_);
        vm.revertToState(snap);

        uint256 w0 = _wallet(mev, p0);
        (uint256 notional, uint256 secs) = _drag(dragBps);
        vm.prank(mev);
        try vault.rebalance() {}
        catch (bytes memory err) {
            assertEq(bytes4(err), StockVault.TwapOffOracle.selector, "refused for the TWAP bound and nothing else");
            refused = true;
        }
        _swapToSqrt(mev, sqrt0);
        vm.roll(vm.getBlockNumber() + 1);
        mevPnl = int256(_wallet(mev, p0)) - int256(w0);
        holders = int256(_holders(p0)) - int256(before_);
        emit log_named_decimal_uint("drag notional USDG", notional, 6);
        emit log_named_uint("drag seconds", secs);
        emit log_named_int("mev pnl, PLTR wei at p0", mevPnl);
        emit log_named_int("holders pnl, PLTR wei at p0", holders);
        emit log_named_int("control holders pnl, PLTR wei at p0", control);
        emit log_named_int("extra holder loss vs control, PLTR wei", holders - control);
        emit log_named_string("rebalance", refused ? "refused (TwapOffOracle)" : "executed");
        emit log_named_decimal_uint("p0 USD", p0, 8);
    }

    /// N3 residual, steady state: 50 PLTR deployed, 50 idle, drag 55 bp (the bound is 30).
    function test_R3_N3r_drag55_halfIdle() public {
        _vaultAt(350);
        _vaultWithIdleDeposits(50e18, 50e18);
        (int256 mevPnl, int256 holders, int256 control, bool refused) = _dragRebalance(55);
        assertTrue(refused, "a 55 bp drag is outside the 30 bp bound");
        assertLe(mevPnl, 0, "the drag paid");
        assertGe(holders, control - int256(1e16), "holders lost more to the drag than to the control");
    }

    /// N3 residual, launch state: 120 PLTR (about the $24.2K PLTR cap) all idle before the first rebalance, which
    /// is open to anyone 26 h after deploy. Drag 55 bp.
    function test_R3_N3r_drag55_firstRebalanceAtCap() public {
        _vaultAt(350);
        _allIdle(60e18, 60e18);
        (int256 mevPnl, int256 holders, int256 control, bool refused) = _dragRebalance(55);
        assertTrue(refused, "a 55 bp drag is outside the 30 bp bound");
        assertLe(mevPnl, 0, "the drag paid");
        assertGe(holders, control - int256(1e16), "holders lost more to the drag than to the control");
    }

    /// One-sided deposit band: a spot pushed UP is let through. With instantDeploy the vault swaps and mints at the
    /// pushed spot; the attacker unwinds in the same block and exits in kind the next. Range 350 bp (PLTR's).
    function test_R3_upPushInstantDepositSandwich() public {
        _vaultAt(350);
        _vaultWithIdleDeposits(50e18, 0);
        _queueInstant();
        uint256 before_ = _holders(p0);
        uint256 w0 = _wallet(mev, p0);
        uint256 n = _swapToSqrt(mev, _sqrtAbove(sqrt0, 90));
        (StockVault.Status st,,) = _status();
        assertEq(uint8(st), 0, "Chainlink gate open with spot 90 bp up");
        vm.prank(mev);
        uint256 sh = vault.deposit(50e18, mev);
        _swapToSqrt(mev, sqrt0);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(mev);
        vault.redeemInKind(sh, mev, mev);
        int256 mevPnl = int256(_wallet(mev, p0)) - int256(w0);
        int256 alicePnl = int256(_holders(p0)) - int256(before_);
        emit log_named_decimal_uint("push notional USDG", n, 6);
        emit log_named_int("mev pnl, PLTR wei at p0", mevPnl);
        emit log_named_int("alice pnl, PLTR wei at p0", alicePnl);
        assertGe(alicePnl, -int256(1e16), "alice lost to an up-push around an instant deposit");
    }

    /// Grief: what it costs to close every price-checked path (spot more than maxDeviationBps off Chainlink) and to
    /// close only rebalance (TWAP more than maxTwapOracleBps off Chainlink), and that redeemInKind stays open.
    function test_R3_griefCloseGateCost() public {
        _vaultAt(350);
        _vaultWithIdleDeposits(50e18, 0);
        uint256 w0 = _wallet(mev, p0);

        // (a) 101 bp: SpotDeviates closes deposit, mint, withdraw, redeem, rebalance
        uint256 n101 = _swapToSqrt(mev, _sqrtBelow(sqrt0, 101));
        (StockVault.Status st,,) = _status();
        assertEq(uint8(st), uint8(StockVault.Status.SpotDeviates), "closed");
        vm.warp(vm.getBlockTimestamp() + 12 hours);
        vm.roll(vm.getBlockNumber() + 1);
        _setFeed(p0);
        (st,,) = _status();
        assertTrue(st != StockVault.Status.Ok, "still closed 12 h later with no arbitrage");
        uint256 aliceSh = vault.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert();
        vault.redeem(aliceSh / 2, alice, alice);
        uint256 snap = vm.snapshotState();
        vm.prank(alice);
        (uint256 s, uint256 u) = vault.redeemInKind(aliceSh, alice, alice);
        assertGt(s + u, 0, "redeemInKind open");
        vm.revertToState(snap);
        _swapToSqrt(mev, sqrt0);
        int256 cost101 = int256(_wallet(mev, p0)) - int256(w0);

        // (b) 61 bp held for one TWAP window: only rebalance closes (TwapOffOracle); deposits reopen
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        vm.roll(vm.getBlockNumber() + 1);
        _setFeed(p0);
        uint256 w1 = _wallet(mev, p0);
        uint256 n61 = _swapToSqrt(mev, _sqrtBelow(sqrt0, 61));
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        vm.roll(vm.getBlockNumber() + 1);
        _setFeed(p0);
        (st,,) = _status();
        assertEq(uint8(st), 0, "gate open");
        vm.warp(vm.getBlockTimestamp() + 26 hours);
        _setFeed(p0);
        vm.prank(mev);
        vm.expectRevert(StockVault.TwapOffOracle.selector);
        vault.rebalance();
        _swapToSqrt(mev, sqrt0);
        int256 cost61 = int256(_wallet(mev, p0)) - int256(w1);

        emit log_named_decimal_uint("notional to push 101 bp, USDG", n101, 6);
        emit log_named_int("round-trip cost of the 101 bp close, PLTR wei at p0", cost101);
        emit log_named_decimal_uint("notional to push 61 bp, USDG", n61, 6);
        emit log_named_int("round-trip cost of the 61 bp rebalance block, PLTR wei at p0", cost61);
        emit log_named_decimal_uint("p0 USD", p0, 8);
    }
}

/// @dev NVDA / USDG 0.05% with the deploy-list range (150 bp): entry fee 5 bp, the lowest tier.
contract Review3NvdaTest is Base {
    function _vault150() internal {
        StockVault.Params memory p = _defaultParams();
        p.rangeBps = 150;
        vault = _deploy(p);
        _deposit(alice, 400e18);
        vm.warp(block.timestamp + 6 hours);
        _setFeed(_poolPrice());
        vm.prank(keeper);
        vault.rebalance();
        vm.warp(block.timestamp + 20 minutes);
        _setFeed(_poolPrice());
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), 0, "gate open at start");
    }

    function _inKindValue(address who, uint256 price) internal returns (uint256 v) {
        uint256 sh = vault.balanceOf(who);
        uint256 snap = vm.snapshotState();
        vm.prank(who);
        (uint256 s, uint256 u) = vault.redeemInKind(sh, who, who);
        v = s + u * 1e12 * 1e8 / price;
        vm.revertToState(snap);
    }

    /// N4 residual on a 5-pip pool: the real price falls 50 bp before the feed and the pool move. Bob deposits 400
    /// NVDA, exits in kind the next block. Property: he gains nothing.
    function test_R3_N4r_offChainMoveOnFivePipPool() public {
        _vault150();
        uint256 p1 = _feedPrice() * 9950 / 1e4;
        uint256 aliceBefore = _inKindValue(alice, p1);
        uint256 sh = _deposit(bob, 400e18);
        vm.prank(bob);
        (uint256 s, uint256 u) = vault.redeemInKind(sh, bob, bob);
        int256 gain = int256(s + u * 1e12 * 1e8 / p1) - int256(400e18);
        int256 alice_ = int256(_inKindValue(alice, p1)) - int256(aliceBefore);
        emit log_named_int("bob gain vs holding, NVDA wei at the new price", gain);
        emit log_named_int("alice pnl, NVDA wei at the new price", alice_);
        emit log_named_decimal_uint("feed USD", _feedPrice(), 8);
        assertLe(gain, 0, "the vault sold its USDG leg at the stale price for less than the entry fee");
    }

    function _swapToSqrtNvda(uint160 target) internal returns (uint256 usdgNotional) {
        uint160 cur = _spotSqrt();
        if (cur == target) return 0;
        bool sellNvda = target > cur; // NVDA is token1: selling it raises sqrtPrice
        uint256 u0 = IERC20(USDG).balanceOf(trader);
        vm.prank(trader);
        ISwapRouter02(ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(
                sellNvda ? NVDA : USDG, sellNvda ? USDG : NVDA, 500, trader, sellNvda ? 900_000e18 : 150_000_000e6, 0, target
            )
        );
        uint256 u1 = IERC20(USDG).balanceOf(trader);
        usdgNotional = u1 > u0 ? u1 - u0 : u0 - u1;
    }

    function _below(uint160 s, uint256 bps) internal pure returns (uint160) {
        return uint160(uint256(s) * Math.sqrt(1e4 * 1e36 / (1e4 - bps)) / 1e18);
    }

    function _offBps(uint160 a, uint160 b, uint256 bps) internal pure returns (bool) {
        uint256 pa = Math.mulDiv(a, a, 1 << 96);
        uint256 pb = Math.mulDiv(b, b, 1 << 96);
        (uint256 hi, uint256 lo) = pa > pb ? (pa, pb) : (pb, pa);
        return hi * 1e4 > lo * (1e4 + bps);
    }

    /// @dev Same walk as ReReview._drag: every 30 s push spot to 9 bp under the current TWAP, never past `fin`.
    function _dragNvda(uint160 sqrt0, uint256 totalBps) internal returns (uint256 notional, uint256 secs) {
        uint160 fin = _below(sqrt0, totalBps);
        for (uint256 i; i < 400; ++i) {
            vm.warp(vm.getBlockTimestamp() + 30);
            vm.roll(vm.getBlockNumber() + 1);
            secs += 30;
            (StockVault.Status st,,,, uint160 twap, uint160 spot) = vault.health();
            assertEq(uint8(st), 0, "gate stays open during the drag");
            uint160 target = _below(twap, 9);
            if (target > fin) target = fin;
            if (target > spot) notional += _swapToSqrtNvda(target);
            (,,,, twap, spot) = vault.health();
            if (spot >= fin && !_offBps(twap, spot, 9)) return (notional, secs);
        }
        revert("drag did not converge");
    }

    function _traderValue(uint256 price) internal view returns (uint256) {
        return IERC20(NVDA).balanceOf(trader) + IERC20(USDG).balanceOf(trader) * 1e12 * 1e8 / price;
    }

    /// @dev N3 on the 5-pip NVDA pool at launch: the whole cap ($100K, about 464 NVDA) idle, first rebalance open to
    /// anyone 26 h after deploy, drag of `dragBps`, rebalance, unwind. A refusal must be TwapOffOracle.
    function _nvdaDragAtCap(uint256 dragBps)
        internal
        returns (int256 mevPnl, int256 holders, int256 control, bool refused)
    {
        StockVault.Params memory p = _defaultParams();
        p.rangeBps = 150;
        vault = _deploy(p);
        uint256 amt = 100_000e26 / _poolPrice();
        _deposit(alice, amt);
        vm.warp(vm.getBlockTimestamp() + 26 hours);
        uint256 p0 = _poolPrice();
        uint160 sqrt0 = _spotSqrt();
        _setFeed(p0);
        uint256 before_ = _inKindValue(alice, p0);

        uint256 snap = vm.snapshotState();
        vm.prank(stranger);
        vault.rebalance();
        control = int256(_inKindValue(alice, p0)) - int256(before_);
        vm.revertToState(snap);

        uint256 w0 = _traderValue(p0);
        (uint256 notional, uint256 secs) = _dragNvda(sqrt0, dragBps);
        vm.prank(trader);
        try vault.rebalance() {}
        catch (bytes memory err) {
            assertEq(bytes4(err), StockVault.TwapOffOracle.selector, "refused for the TWAP bound and nothing else");
            refused = true;
        }
        _swapToSqrtNvda(sqrt0);
        vm.roll(vm.getBlockNumber() + 1);
        mevPnl = int256(_traderValue(p0)) - int256(w0);
        holders = int256(_inKindValue(alice, p0)) - int256(before_);
        emit log_named_decimal_uint("idle NVDA", amt, 18);
        emit log_named_decimal_uint("drag notional USDG", notional, 6);
        emit log_named_uint("drag seconds", secs);
        emit log_named_int("mev pnl, NVDA wei at p0", mevPnl);
        emit log_named_int("holders pnl, NVDA wei at p0", holders);
        emit log_named_int("control holders pnl, NVDA wei at p0", control);
        emit log_named_string("rebalance", refused ? "refused (TwapOffOracle)" : "executed");
        emit log_named_decimal_uint("p0 USD", p0, 8);
    }

    /// N3 residual on the 5-pip NVDA pool at launch, drag 55 bp against the 30 bp bound.
    function test_R3_N3r_drag55_nvdaFirstRebalanceAtCap() public {
        (int256 mevPnl, int256 holders, int256 control, bool refused) = _nvdaDragAtCap(55);
        assertTrue(refused, "a 55 bp drag is outside the 30 bp bound");
        assertLe(mevPnl, 0, "the drag paid");
        assertGe(holders, control - int256(1e16), "holders lost more to the drag than to the control");
    }

    /// What a walk that stays inside the bound can still take: drag 29 bp against the 30 bp bound, same launch state.
    /// The rebalance goes through; the extra holder loss against the control is bounded by the bound plus the 10 bp
    /// spot-to-TWAP band (the walk keeps spot that far under the TWAP) times the one swap the rebalance makes (half the
    /// idle cap, about 232 NVDA).
    function test_R3_N3r_dragInsideBound_nvdaResidual() public {
        (int256 mevPnl, int256 holders, int256 control, bool refused) = _nvdaDragAtCap(29);
        assertFalse(refused, "29 bp is inside the 30 bp bound");
        int256 extra = control - holders;
        emit log_named_int("attacker pnl at the bound, NVDA wei", mevPnl);
        emit log_named_int("extra holder loss at the bound, NVDA wei", extra);
        assertLe(extra, int256(232e18 * 40 / 1e4), "extra holder loss exceeds (bound + spot band) x swap");
    }

    /// Entry fee capture: MEV deposits A ahead of a deposit D far larger than the vault and exits in kind the block
    /// after. The fee D pays accrues pro rata to everyone holding, A included, so the capture is positive for
    /// D > V(V+A)/A. Property: it never exceeds half the fee A itself paid, entryFee x A / 2 (profit =
    /// f x [D A/(V+A+D) - A V/(V+A)], and the first term is below A as D grows), needs the front-runner to see D before
    /// it is included and is capped by the deposit cap.
    function test_R3_L1_entryFeeCaptureByFrontRunIsBounded() public {
        _vault150();
        uint256 p = _feedPrice();
        uint256 sh = _deposit(stranger, 400e18);
        _deposit(bob, 4_000e18);
        uint256 v = _inKindValue(stranger, p);
        emit log_named_int("front-runner pnl, NVDA wei", int256(v) - int256(400e18));
        assertLe(v, 400e18 + uint256(vault.entryFee()) * 400e18 / 2e6, "capture exceeds half the front-runner's own fee");
        assertGt(sh, 0);
    }

    /// The queue admits only the six setters: no queue-management, ownership, treasury, pause, token or exit call can
    /// be laundered through the vault's self-call, and an unqueued or cancelled change never runs.
    function test_R3_queueAdmitsOnlyTheSixSetters() public {
        bytes[10] memory bad = [
            abi.encodeCall(vault.executeChange, (hex"")),
            abi.encodeCall(vault.queueChange, (hex"")),
            abi.encodeCall(vault.cancelChange, (bytes32(0))),
            abi.encodeCall(vault.transferOwnership, (stranger)),
            abi.encodeCall(vault.setTreasury, (stranger)),
            abi.encodeCall(vault.setDepositCap, (0)),
            abi.encodeCall(vault.transfer, (stranger, 1)),
            abi.encodeCall(vault.approve, (stranger, 1)),
            abi.encodeCall(vault.redeemInKind, (1, stranger, address(vault))),
            abi.encodeCall(vault.unpause, ())
        ];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(owner);
            vm.expectRevert(StockVault.ChangeNotAllowed.selector);
            vault.queueChange(bad[i]);
        }
        bytes memory k = abi.encodeCall(StockVault.setKeeper, (stranger));
        vm.prank(owner);
        vm.expectRevert(StockVault.ChangeNotQueued.selector);
        vault.executeChange(k);
        vm.prank(owner);
        vault.queueChange(k);
        vm.prank(owner);
        vault.cancelChange(keccak256(k));
        vm.warp(block.timestamp + 2 days);
        vm.prank(owner);
        vm.expectRevert(StockVault.ChangeNotQueued.selector);
        vault.executeChange(k);
        vm.prank(keeper);
        vm.expectRevert(StockVault.ChangeNotQueued.selector);
        vault.setKeeper(stranger);
        assertEq(vault.keeper(), keeper);
    }
}

/// @dev targetTicks at the deploy-list extremes (150 and 2000 bp) on every tick spacing in the list (10, 60, 200),
/// both token orders, 18-decimal stock, 6-decimal USDG, 8-decimal feed, prices $1 to $100K. No fork.
contract Review3TicksTest is Test {
    VaultMath m;

    function setUp() public {
        m = new VaultMath();
    }

    function testFuzz_R3_rangeIsAlignedAndCoversTheGate(uint256 price, uint256 bpsSeed, uint8 sp, bool s0) public view {
        price = bound(price, 1e8, 100_000e8);
        uint256 bps = bpsSeed % 2 == 0 ? 150 : 2000;
        if (bpsSeed % 3 == 0) bps = bound(bpsSeed, 150, 2000);
        int24 spacing = [int24(10), 60, 200][sp % 3];
        (int24 tl, int24 tu) = m.targetTicks(price, bps, 1e26, 1e6, s0, spacing);
        assertEq(tl % spacing, 0, "lower aligned");
        assertEq(tu % spacing, 0, "upper aligned");
        assertGe(tu - tl, 2 * spacing, "at least two spacings wide");
        // the oracle price and the whole 100 bp gate around it sit inside the range
        int24 lo = TickMath.getTickAtSqrtPrice(m.sqrtFromUsd(price * 9900 / 1e4, 1e26, 1e6, s0));
        int24 hi = TickMath.getTickAtSqrtPrice(m.sqrtFromUsd(price * 10100 / 1e4, 1e26, 1e6, s0));
        (lo, hi) = lo < hi ? (lo, hi) : (hi, lo);
        assertGe(lo, tl, "gate low inside");
        assertLt(hi, tu, "gate high inside");
    }
}

/// @dev The web app's only exit buttons are `redeem` (max) and `withdraw`; it never calls redeemInKind. Does the
/// ERC-4626 exit work on a deployed vault when the market has not moved, on each fee tier? Real pools; after the
/// keeper's rebalance an arbitrageur puts the pool back where it was and the TWAP window passes.
contract Review3ExitTierTest is ReReviewFloorTest {
    function _swapTo(IUniswapV3Pool pool, uint160 target) internal {
        (uint160 cur,,,,,,) = pool.slot0();
        if (cur == target) return;
        address t0 = pool.token0();
        address t1 = pool.token1();
        bool sell1 = target > cur; // selling token1 raises sqrt
        address a = makeAddr("arb");
        address tin = sell1 ? t1 : t0;
        deal(tin, a, sell1 ? (t1 == USDG ? 1e14 : 1e26) : (t0 == USDG ? 1e14 : 1e26));
        vm.startPrank(a);
        IERC20(tin).approve(ROUTER, type(uint256).max);
        ISwapRouter02(ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(tin, sell1 ? t0 : t1, pool.fee(), a, IERC20(tin).balanceOf(a), 0, target)
        );
        vm.stopPrank();
    }

    /// @return ok whether a full redeem by the only holder went through; logs the error selector otherwise.
    function _redeemAfterRebalance(V memory v, uint256 usd) internal returns (bool ok) {
        address keeper = makeAddr("keeper");
        (StockVault vault, uint256 price,) = _vaultFor(v, keeper);
        IUniswapV3Pool pool = IUniswapV3Pool(v.pool);
        (uint160 sqrt0,,,,,,) = pool.slot0();
        uint256 amt = usd * 1e26 / price;
        address alice = makeAddr("alice");
        deal(v.stock, alice, amt);
        vm.startPrank(alice);
        IERC20(v.stock).approve(address(vault), amt);
        uint256 sh = vault.deposit(amt, alice);
        vm.stopPrank();
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + 7 hours);
        (uint80 round,,,,) = IAggregatorV3(v.feed).latestRoundData();
        _mockFeed(v.feed, round, price);
        vm.prank(keeper);
        vault.rebalance();
        _swapTo(pool, sqrt0);
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        vm.roll(vm.getBlockNumber() + 1);
        _mockFeed(v.feed, round, price);
        (StockVault.Status st,,,,,) = vault.health();
        assertEq(uint8(st), 0, "gate open");
        StockVault.PositionInfo memory pi = vault.positionInfo();
        emit log_named_string("vault", v.sym);
        emit log_named_uint("fee tier", vault.poolFee());
        emit log_named_uint("USDG share of position, bp", pi.usdgAmount * 1e20 / price * 1e4 / (pi.stockAmount + pi.usdgAmount * 1e20 / price));
        bool wOk;
        vm.prank(alice);
        try vault.withdraw(amt / 10, alice, alice) {
            emit log("withdraw 10% ok");
            wOk = true;
        } catch (bytes memory err) {
            emit log_named_bytes("withdraw 10% reverted", err);
        }
        // withdraw mints the unspent buffer back as shares, which are locked for the rest of this block
        vm.roll(vm.getBlockNumber() + 1);
        sh = vault.balanceOf(alice);
        vm.prank(alice);
        try vault.redeem(sh, alice, alice) returns (uint256 out) {
            emit log_named_decimal_uint("redeem out / deposit, bp", out * 1e4 / amt, 0);
            ok = wOk;
        } catch (bytes memory err) {
            emit log_named_bytes("redeem reverted", err);
        }
    }

    function _open() internal pure returns (V[11] memory) {
        return [
            V("AAPL", 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D, 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0, 29268),
            V("AMD", 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 0x48D284A2A4d3DC1b3Da08231Fe44317e7e7Aa51f, 0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72, 18436),
            V("AMZN", 0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef, 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C, 68501),
            V("GOOGL", 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 0x34D0dC122CF9A8Eb296fC5e0D3A233625D7d19b7, 0xF6f373a037c30F0e5010d854385cA89185AE638b, 38950),
            V("INTC", 0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 0x2e5a92f5013a64661A49312111be2e8aBd33F56a, 0x3f390C5C24628Ac7C489515402235FeAD71D1913, 19116),
            V("META", 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 0x107a7Cb40d8665360ba10E59471Af06150A50922, 0x7C38C00C30BEe9378381E7B6135d7283356D71b1, 24118),
            V("MU", 0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 0xd057B1Bc54917855BBee58eAd58647f47caB35E5, 0x425EEFdCf05ed6526C3cE61Af99429A228a6d596, 86710),
            V("NVDA", 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, 100000),
            V("QQQ", 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, 0xD60A5d14dB690B7Afad71F76B108071D7175597d, 0x80901d846d5D7B030F26B480776EE3b29374C2ae, 66787),
            V("SPY", 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167, 0x319724394D3A0e3669269846abE664Cd621f9f6A, 100000),
            V("USO", 0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344, 0x02175608F1b5E6b5ed221cCFdC7Be197D111D915, 0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c, 100000)
        ];
    }

    function caseFullCap(V memory v) external returns (uint256) {
        return _rebalancesFullCap(v);
    }

    function caseExit(V memory v, uint256 usd) external returns (bool) {
        return _redeemAfterRebalance(v, usd);
    }

    /// Every vault of the --open-only mainnet list: a full-cap deposit, then the keeper's first rebalance (it swaps
    /// about half the cap in one go). Property: a position opens on all eleven.
    function test_R3_fullCapFirstRebalanceOnOpenList() public {
        V[11] memory vs = _open();
        uint256 opened;
        for (uint256 i; i < vs.length; ++i) {
            uint256 snap = vm.snapshotState();
            try this.caseFullCap(vs[i]) returns (uint256 ok) {
                opened += ok;
            } catch (bytes memory err) {
                emit log_named_string("REVERTED", vs[i].sym);
                emit log_named_bytes("  error", err);
            }
            vm.revertToState(snap);
        }
        emit log_named_uint("opened", opened);
        assertEq(opened, vs.length, "every open-list vault deploys a full-cap deposit");
    }

    /// redeem (the web app's max button) and withdraw on a $5K deployed vault, market unmoved, one vault per 0.3%
    /// and 1% pool in the universe plus NVDA. Property: both work.
    function test_R3_erc4626ExitOnTiers() public {
        V[5] memory vs = [
            V("AMZN", 0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef, 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C, 68501),
            V("MU", 0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 0xd057B1Bc54917855BBee58eAd58647f47caB35E5, 0x425EEFdCf05ed6526C3cE61Af99429A228a6d596, 86710),
            V("NVDA", 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, 100000),
            V("GME", 0x1b0E319c6A659F002271B69dB8A7df2F911c153E, 0xE9713f453aDB9245B19559790c96F470a18F2fDF, 0x27C71df6A64fB476468EdF256CF72c038baB5B67, GME_CAP_USD),
            V("MSTR", 0xec262a75e413fAfD0dF80480274532C79D42da09, 0x17578C0e0D15da44f31677263114F71aE76653EA, 0x396118bdFB181e6240E74D243F266B061c0edc3D, 22206)
        ];
        uint256 okCount;
        for (uint256 i; i < vs.length; ++i) {
            uint256 snap = vm.snapshotState();
            try this.caseExit(vs[i], 5_000) returns (bool ok) {
                if (ok) ++okCount;
            } catch (bytes memory err) {
                emit log_named_string("SETUP REVERTED", vs[i].sym);
                emit log_named_bytes("  error", err);
            }
            vm.revertToState(snap);
        }
        assertEq(okCount, vs.length, "redeem and withdraw work on every tier with the market unmoved");
    }

    /// The same exit on every token of scripts/deploy-list.mjs (17: six 0.05% pools, nine 0.3%, two 1%), $5K deployed
    /// each. Property: withdraw and redeem work on all of them, whether or not the evidence gate lets the vault deploy.
    function test_R3_erc4626ExitOnEveryListedToken() public {
        V[17] memory vs = [
            V("AAPL", 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D, 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0, 29268),
            V("AMD", 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 0x48D284A2A4d3DC1b3Da08231Fe44317e7e7Aa51f, 0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72, 18436),
            V("AMZN", 0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef, 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C, 68501),
            V("CRCL", 0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5, 0x654E4143e82a5824445Ade0824351C2A9ACD95a8, 0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a, 100000),
            V("GME", 0x1b0E319c6A659F002271B69dB8A7df2F911c153E, 0xE9713f453aDB9245B19559790c96F470a18F2fDF, 0x27C71df6A64fB476468EdF256CF72c038baB5B67, 49212),
            V("GOOGL", 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 0x34D0dC122CF9A8Eb296fC5e0D3A233625D7d19b7, 0xF6f373a037c30F0e5010d854385cA89185AE638b, 38950),
            V("INTC", 0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 0x2e5a92f5013a64661A49312111be2e8aBd33F56a, 0x3f390C5C24628Ac7C489515402235FeAD71D1913, 19116),
            V("META", 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 0x107a7Cb40d8665360ba10E59471Af06150A50922, 0x7C38C00C30BEe9378381E7B6135d7283356D71b1, 24118),
            V("MSTR", 0xec262a75e413fAfD0dF80480274532C79D42da09, 0x17578C0e0D15da44f31677263114F71aE76653EA, 0x396118bdFB181e6240E74D243F266B061c0edc3D, 22206),
            V("MU", 0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 0xd057B1Bc54917855BBee58eAd58647f47caB35E5, 0x425EEFdCf05ed6526C3cE61Af99429A228a6d596, 86710),
            V("NVDA", 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, 100000),
            V("PLTR", 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A, 0x851680416A4f4E1c463d45171d61ACDdBc8554c0, 0x820ABedFF239034956B7A9d2F0a331f9F075eB4c, 24207),
            V("QQQ", 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, 0xD60A5d14dB690B7Afad71F76B108071D7175597d, 0x80901d846d5D7B030F26B480776EE3b29374C2ae, 66787),
            V("SPCX", 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, 0xc61284332117c3FB23A2A56cceFFD07F7aF60029, 0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb, 100000),
            V("SPY", 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167, 0x319724394D3A0e3669269846abE664Cd621f9f6A, 100000),
            V("TSLA", 0x322F0929c4625eD5bAd873c95208D54E1c003b2d, 0xf4ACdAEEB7022862A763C9B1B885e11191c889E3, 0x4A1166a659A55625345e9515b32adECea5547C38, 83206),
            V("USO", 0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344, 0x02175608F1b5E6b5ed221cCFdC7Be197D111D915, 0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c, 100000)
        ];
        uint256 okCount;
        for (uint256 i; i < vs.length; ++i) {
            uint256 snap = vm.snapshotState();
            try this.caseExit(vs[i], 5_000) returns (bool ok) {
                if (ok) ++okCount;
                else emit log_named_string("EXIT FAILED", vs[i].sym);
            } catch (bytes memory err) {
                emit log_named_string("SETUP REVERTED", vs[i].sym);
                emit log_named_bytes("  error", err);
            }
            vm.revertToState(snap);
        }
        assertEq(okCount, vs.length, "redeem and withdraw work on every listed token with the market unmoved");
    }
}
