// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StockVault} from "../../src/StockVault.sol";
import {UptickRouter, IStockVault, IVaultRegistry} from "../../src/UptickRouter.sol";
import {IAggregatorV3, IUniswapV3Pool} from "../../src/interfaces/IUniswapV3.sol";
import {Review3NvdaTest, Review3PltrTest} from "./Review3.t.sol";
import {ReReviewFloorTest} from "./ReReviewFloor.t.sol";

/// @dev Fourth review 2026-10-20 (after bd4419c, eb60c45, 02443f8), NVDA / USDG 0.05%, range 150 (deploy list).
/// Public RPC at head, Chainlink mocked at the pool price, no arbitrageurs on the fork: attacker numbers are the
/// attacker-is-alone upper bound. Run with --match-test R4.
contract Review4NvdaTest is Review3NvdaTest {
    /// R3-H1 residual: walks that stay inside the 30 bp bound, launch state (whole $100K cap idle, ~464 NVDA,
    /// rebalance swaps about half). Property checked: the extra holder loss stays under (bound + 10 bp spot band) x the
    /// swap. The attacker's profit is logged, not asserted: it is the residual this review prices.
    function test_R4_nvdaDragSweepInsideBound() public {
        uint256[3] memory drags = [uint256(25), 27, 29];
        for (uint256 i; i < drags.length; ++i) {
            uint256 snap = vm.snapshotState();
            (int256 mevPnl, int256 holders, int256 control, bool refused) = _nvdaDragAtCap(drags[i]);
            assertFalse(refused, "inside the bound");
            int256 extra = control - holders;
            console2.log("drag bp", drags[i]);
            console2.log("  attacker pnl NVDA wei", mevPnl);
            console2.log("  extra holder loss NVDA wei", extra);
            assertLe(extra, int256(232e18 * 40 / 1e4), "extra holder loss exceeds (bound + band) x swap");
            vm.revertToState(snap);
            _setFeed(_poolPrice()); // the revert rewinds the clock under the mock's timestamp
        }
    }

    /// The bound itself: a 40 bp walk is refused and the attacker pays for it. Mutation target (default 30 -> 60).
    function test_R4_nvdaDrag40Refused() public {
        (int256 mevPnl, int256 holders, int256 control, bool refused) = _nvdaDragAtCap(40);
        assertTrue(refused, "a 40 bp walk is outside the 30 bp bound");
        assertLe(mevPnl, 0, "the refused walk cost the attacker");
        assertGe(holders, control - int256(1e16));
    }

    /// The 30 bp bound guards rebalance() only. With instantDeploy queued on, deposit() swaps at a TWAP that may sit up
    /// to the Chainlink swap floor (pool fee + slippageBps, about 105 bp) from the feed. Attacker walks the pool down
    /// `dragBps`, deposits 400 NVDA into a 400 NVDA vault (the vault sells about half of it into the walked pool),
    /// unwinds, exits in kind next block. Property: neither the attacker gains nor alice loses.
    function _instantDrag(uint256 dragBps) internal returns (int256 mevPnl, int256 alicePnl) {
        _setFeed(_poolPrice());
        _vault150();
        _instant();
        _setFeed(_poolPrice());
        uint256 p0 = _poolPrice();
        uint160 sqrt0 = _spotSqrt();
        uint256 before_ = _inKindValue(alice, p0);
        vm.prank(trader);
        IERC20(NVDA).approve(address(vault), type(uint256).max);
        uint256 w0 = _traderValue(p0);
        if (dragBps > 0) _dragNvda(sqrt0, dragBps);
        vm.prank(trader);
        uint256 sh = vault.deposit(400e18, trader);
        _swapToSqrtNvda(sqrt0);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(trader);
        vault.redeemInKind(sh, trader, trader);
        mevPnl = int256(_traderValue(p0)) - int256(w0);
        alicePnl = int256(_inKindValue(alice, p0)) - int256(before_);
        console2.log("instant drag bp", dragBps);
        console2.log("  attacker pnl NVDA wei", mevPnl);
        console2.log("  alice pnl NVDA wei", alicePnl);
    }

    function test_R4_instantDeployDragOutsideTheBound() public {
        uint256 snap = vm.snapshotState();
        (int256 m0, int256 a0) = _instantDrag(0);
        vm.revertToState(snap);
        (int256 m60, int256 a60) = _instantDrag(60);
        vm.revertToState(snap);
        (int256 m90, int256 a90) = _instantDrag(90);
        assertLe(m60 - m0, 0, "60 bp walk + instant deposit beat the no-walk control for the attacker");
        assertLe(m90 - m0, 0, "90 bp walk + instant deposit beat the no-walk control for the attacker");
        assertGe(a60, a0 - int256(1e16), "alice lost more than the control at 60 bp");
        assertGe(a90, a0 - int256(1e16), "alice lost more than the control at 90 bp");
    }

    // ------------------------------------------------------------------ R3-M1: entry fee on every path

    UptickRouter zap;

    function _router() internal returns (UptickRouter r) {
        address reg = makeAddr("registry");
        vm.etch(reg, hex"00");
        vm.mockCall(reg, abi.encodeWithSelector(IVaultRegistry.isVault.selector), abi.encode(true));
        r = new UptickRouter(100, IVaultRegistry(reg));
    }

    /// Alice's NAV gain (convertToAssets, which reads the TWAP and is untouched by a same-block swap) from one entry.
    /// path 0: deposit(x); 1: mint(previewDeposit(x)); 2: UptickRouter.depositUsdg with the USDG x is worth.
    function _entry(uint256 path, uint256 x) internal returns (uint256 assetsIn, uint256 sharesOut, uint256 aliceGain) {
        uint256 aSh = vault.balanceOf(alice);
        uint256 a0 = vault.convertToAssets(aSh);
        uint256 idle0 = IERC20(NVDA).balanceOf(address(vault));
        uint256 navPerShare = vault.totalAssets() * 1e18 / (vault.totalSupply() + 1e6);
        if (path == 0) {
            _fund(bob, x);
            uint256 pv = vault.previewDeposit(x);
            vm.prank(bob);
            sharesOut = vault.deposit(x, bob);
            assertEq(sharesOut, pv, "deposit == previewDeposit");
        } else if (path == 1) {
            _fund(bob, x);
            uint256 s = vault.previewDeposit(x);
            uint256 pm = vault.previewMint(s);
            vm.prank(bob);
            uint256 paid = vault.mint(s, bob);
            assertEq(paid, pm, "mint == previewMint");
            assertLe(paid, x, "mint of deposit's shares never costs more than the deposit");
            assertGe(paid + 2, x, "...nor less, beyond rounding");
            sharesOut = s;
        } else {
            uint256 usdgIn = x * _feedPrice() / 1e20;
            deal(USDG, bob, usdgIn);
            vm.startPrank(bob);
            IERC20(USDG).approve(address(zap), usdgIn);
            sharesOut = zap.depositUsdg(IStockVault(address(vault)), usdgIn, 0, bob);
            vm.stopPrank();
        }
        assetsIn = IERC20(NVDA).balanceOf(address(vault)) - idle0;
        aliceGain = vault.convertToAssets(aSh) - a0;
        uint256 fair = assetsIn * vault.entryFee() / 1e6 * aSh / vault.totalSupply();
        console2.log("path", path);
        console2.log("  assets in", assetsIn);
        console2.log("  alice gain", aliceGain);
        console2.log("  fee x alice share", fair);
        assertGe(aliceGain * 1000, fair * 995, "the entry fee stayed with the holders");
        assertGt(sharesOut, 0);
        // a share bought by any path costs the pre-entry NAV per share plus the 35 bp fee
        assertGe(assetsIn * 1e18 / sharesOut, navPerShare * (1e6 + 3500) / 1e6, "share bought below NAV + fee");
    }

    function test_R4_entryFeeOnEveryPath() public {
        _vault150();
        zap = _router();
        uint256[3] memory sizes = [uint256(1e15), 40e18, 400e18];
        for (uint256 i; i < sizes.length; ++i) {
            for (uint256 path; path < 3; ++path) {
                uint256 snap = vm.snapshotState();
                _entry(path, sizes[i]);
                vm.revertToState(snap);
            }
        }
        assertEq(vault.entryFee(), 3500, "35 bp default on a 5-pip pool");
    }

    /// Splitting an entry into dust deposits does not shave the fee: the fee rounds against the depositor.
    function test_R4_entryFeeNotShavedBySplitting() public {
        _vault150();
        _fund(bob, 1e18);
        uint256 one = vault.previewDeposit(1e18);
        uint256 total;
        vm.startPrank(bob);
        for (uint256 i; i < 50; ++i) total += vault.deposit(2e16, bob);
        vm.stopPrank();
        assertLe(total, one + 50, "fifty small deposits bought more than one large one");
    }

    // ------------------------------------------------------------------ ERC-4626: withdraw(maxWithdraw)

    /// previewRedeem floors buffer then fee; previewWithdraw ceils buffer then fee. Since round 3 added the fee factor
    /// the two no longer invert: for about 15% of asset values on a 5-pip pool previewWithdraw(previewRedeem-derived
    /// assets) asks one wei more, i.e. about 1e6 share units more than the owner holds. Property (EIP-4626): withdraw
    /// of maxWithdraw(owner) succeeds. Twenty holders of different sizes.
    function test_R4_withdrawMaxWithdrawNeverReverts() public {
        _vault150();
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        _setFeed(_poolPrice());
        uint256 reverted;
        for (uint256 i; i < 20; ++i) {
            address h = makeAddr(string(abi.encodePacked("h", i)));
            _fund(h, 1e18 + i * 7_919_113_331);
            vm.prank(h);
            vault.deposit(1e18 + i * 7_919_113_331, h);
        }
        vm.roll(vm.getBlockNumber() + 1);
        for (uint256 i; i < 20; ++i) {
            address h = makeAddr(string(abi.encodePacked("h", i)));
            uint256 snap = vm.snapshotState();
            uint256 m = vault.maxWithdraw(h);
            uint256 need = vault.previewWithdraw(m);
            vm.prank(h);
            try vault.withdraw(m, h, h) {}
            catch (bytes memory err) {
                ++reverted;
                console2.log("withdraw(maxWithdraw) reverted, holder", i);
                console2.log("  shares held / shares asked", vault.balanceOf(h), need);
                console2.logBytes(err);
            }
            vm.revertToState(snap);
        }
        console2.log("reverted of 20", reverted);
        assertEq(reverted, 0, "withdraw(maxWithdraw(owner)) reverts");
    }

    // ------------------------------------------------------------------ end to end money flows

    function test_R4_endToEndMoneyFlows() public {
        StockVault.Params memory p = _defaultParams();
        p.rangeBps = 150;
        vault = _deploy(p);
        zap = _router();
        uint256 px = _poolPrice();

        // deposits: stock and USDG zap, idle until the keeper's rebalance
        _deposit(alice, 300e18);
        deal(USDG, bob, 20_000e6);
        vm.startPrank(bob);
        IERC20(USDG).approve(address(zap), 20_000e6);
        uint256 bobSh = zap.depositUsdg(IStockVault(address(vault)), 20_000e6, 1, bob);
        vm.stopPrank();
        vm.roll(vm.getBlockNumber() + 1);
        assertGt(bobSh, 0);
        assertEq(vault.tokenId(), 0, "idle until rebalance");

        // keeper rebalance
        vm.warp(vm.getBlockTimestamp() + 6 hours);
        _setFeed(_poolPrice());
        vm.prank(keeper);
        vault.rebalance();
        assertGt(vault.positionInfo().liquidity, 0, "position open");

        // instant deploy through the owner queue
        _instant();
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        _setFeed(_poolPrice());
        uint256 liq0 = vault.positionInfo().liquidity;
        uint256 cSh = _deposit(stranger, 50e18);
        assertGt(vault.positionInfo().liquidity, liq0, "instant deposit deployed");

        // trading fees, then a permissionless rebalance 26 h later harvests the performance fee
        _volume(200_000e6, 5);
        vm.warp(vm.getBlockTimestamp() + 26 hours + 11 minutes);
        _setFeed(_poolPrice());
        assertEq(vault.balanceOf(treasury), 0);
        vm.prank(stranger);
        vault.rebalance();
        uint256 tSh = vault.balanceOf(treasury);
        assertGt(tSh, 0, "performance fee minted on harvest");
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        _setFeed(_poolPrice());
        vm.roll(vm.getBlockNumber() + 1);

        // withdraw exact, then redeem the rest next block
        uint256 aSh = vault.balanceOf(alice);
        uint256 w = vault.maxWithdraw(alice) / 10;
        uint256 a0 = IERC20(NVDA).balanceOf(alice);
        vm.prank(alice);
        vault.withdraw(w, alice, alice);
        assertEq(IERC20(NVDA).balanceOf(alice) - a0, w, "withdraw sends exactly");
        assertLt(vault.balanceOf(alice), aSh);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 rest = vault.balanceOf(alice);
        uint256 pr = vault.previewRedeem(rest);
        vm.prank(alice);
        uint256 got = vault.redeem(rest, alice, alice);
        assertGe(got, pr, "redeem pays at least the preview");

        // redeemInKind with the Stock Token transfer to bob reverting, then claimStockOwed
        vm.mockCallRevert(NVDA, abi.encodeWithSelector(IERC20.transfer.selector, bob), "blocked");
        vm.prank(bob);
        (uint256 so, uint256 uo) = vault.redeemInKind(bobSh, bob, bob);
        vm.clearMockedCalls();
        _setFeed(_poolPrice());
        assertEq(vault.stockOwed(bob), so, "stock leg credited");
        assertGt(so, 0);
        assertGt(uo, 0);
        vm.prank(bob);
        vault.claimStockOwed(bob);
        assertEq(IERC20(NVDA).balanceOf(bob), so);
        assertEq(vault.totalStockOwed(), 0);

        // last holders out in kind: nothing is left behind
        vm.prank(stranger);
        vault.redeemInKind(cSh, stranger, stranger);
        for (uint256 i; i < 3 && vault.balanceOf(treasury) > 0; ++i) {
            vm.roll(vm.getBlockNumber() + 1); // shares the harvest just minted to the treasury are locked for the block
            uint256 t = vault.balanceOf(treasury);
            vm.prank(treasury);
            vault.redeemInKind(t, treasury, treasury);
        }
        assertEq(vault.totalSupply(), 0);
        uint256 dustUsd = IERC20(NVDA).balanceOf(address(vault)) * px / 1e26 + IERC20(USDG).balanceOf(address(vault)) / 1e6;
        console2.log("residual after the last exit, USD", dustUsd);
        assertLe(dustUsd, 1, "value stranded in an empty vault");
    }
}

/// @dev R3-H1 residual on PLTR / USDG 0.3%, range 350, the launch state (120 PLTR idle) and the steady state.
contract Review4PltrTest is Review3PltrTest {
    function test_R4_pltrDragSweepInsideBound() public {
        uint256[3] memory drags = [uint256(25), 27, 29];
        for (uint256 j; j < 2; ++j) {
            for (uint256 i; i < drags.length; ++i) {
                uint256 snap = vm.snapshotState();
                _vaultAt(350);
                if (j == 0) _allIdle(60e18, 60e18);
                else _vaultWithIdleDeposits(50e18, 50e18);
                (int256 mevPnl, int256 holders, int256 control, bool refused) = _dragRebalance(drags[i]);
                assertFalse(refused, "inside the bound");
                console2.log(j == 0 ? "launch, drag bp" : "half idle, drag bp", drags[i]);
                console2.log("  attacker pnl PLTR wei", mevPnl);
                console2.log("  extra holder loss PLTR wei", control - holders);
                uint256 swap = j == 0 ? 60e18 : 25e18;
                assertLe(control - holders, int256(swap * 40 / 1e4), "extra holder loss exceeds (bound + band) x swap");
                vm.revertToState(snap);
                _setFeed(_price());
            }
        }
    }
}

/// @dev Round 3's Chainlink term in the deploy-swap floor: does it brick a full-cap rebalance on any open-list vault
/// when the feed sits just inside the 30 bp bound on the demanding side? Per-token range and cap from the deploy list.
contract Review4FloorTest is ReReviewFloorTest {
    struct L {
        V v;
        uint16 range;
    }

    function _list() internal pure returns (L[11] memory) {
        return [
            L(V("AAPL", 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D, 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0, 73983), 750),
            L(V("AMD", 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 0x48D284A2A4d3DC1b3Da08231Fe44317e7e7Aa51f, 0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72, 18436), 2000),
            L(V("AMZN", 0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef, 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C, 68501), 750),
            L(V("GOOGL", 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 0x34D0dC122CF9A8Eb296fC5e0D3A233625D7d19b7, 0xF6f373a037c30F0e5010d854385cA89185AE638b, 100000), 2000),
            L(V("INTC", 0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 0x2e5a92f5013a64661A49312111be2e8aBd33F56a, 0x3f390C5C24628Ac7C489515402235FeAD71D1913, 19116), 2000),
            L(V("META", 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 0x107a7Cb40d8665360ba10E59471Af06150A50922, 0x7C38C00C30BEe9378381E7B6135d7283356D71b1, META_CAP_USD), 1500),
            L(V("MU", 0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 0xd057B1Bc54917855BBee58eAd58647f47caB35E5, 0x425EEFdCf05ed6526C3cE61Af99429A228a6d596, 86710), 1500),
            L(V("NVDA", 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, 100000), 150),
            L(V("QQQ", 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, 0xD60A5d14dB690B7Afad71F76B108071D7175597d, 0x80901d846d5D7B030F26B480776EE3b29374C2ae, 66787), 1000),
            L(V("SPY", 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167, 0x319724394D3A0e3669269846abE664Cd621f9f6A, 100000), 250),
            L(V("USO", 0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344, 0x02175608F1b5E6b5ed221cCFdC7Be197D111D915, 0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c, 100000), 2000)
        ];
    }

    /// sell: a full cap deposited as Stock Token, the feed `gapBps` above the pool (the floor prices the sale at the
    /// feed). buy: the cap in USDG, the feed `gapBps` below the pool (the floor prices the purchase at the feed).
    function caseEdge(L memory l, bool sell, uint256 gapBps) external returns (bool) {
        address keeper = makeAddr("keeper");
        (uint256 price, uint256 stockWei) = _priceAndCap(l.v);
        (uint80 round,,,,) = IAggregatorV3(l.v.feed).latestRoundData();
        vm.warp(vm.getBlockTimestamp() + 11 minutes);
        _mockFeed(l.v.feed, round, price);
        StockVault vault = new StockVault(
            StockVault.Config(l.v.stock, USDG, l.v.pool, NPM, ROUTER, l.v.feed, makeAddr("owner"), keeper, makeAddr("treasury"), 0),
            StockVault.Params({
                rangeBps: l.range,
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
        if (sell) {
            address bob = makeAddr("bob");
            deal(l.v.stock, bob, stockWei);
            vm.startPrank(bob);
            IERC20(l.v.stock).approve(address(vault), stockWei);
            vault.deposit(stockWei, bob);
            vm.stopPrank();
        } else {
            deal(USDG, address(vault), l.v.capUsd * 1e6);
        }
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + 7 hours);
        _mockFeed(l.v.feed, round, sell ? price * (1e4 + gapBps) / 1e4 : price * (1e4 - gapBps) / 1e4);
        vm.prank(keeper);
        vault.rebalance();
        return vault.positionInfo().liquidity > 0;
    }

    /// META's deposit cap on chain (scripts/deploy-list.mjs, LIVENESS_SHARE): 15% of the pool's $96,476 in-range depth,
    /// floor(96475.63 x 0.15 / 0.85). The replay and the published vault size stay at the 20% cap, $24,118.
    uint256 constant META_CAP_USD = 17_025;
    uint256 constant META_REPLAY_CAP_USD = 24_118;

    /// R4-L2, accepted residual. Selling Stock Token the deploy-swap floor prices the input at max(TWAP, feed). Half the
    /// cap through the 0.3% pool costs c bp (fee included) and the floor allows 129 bp, so a sell stops filling once c plus
    /// the feed's gap above the pool plus the sell's own drift uses that up. The keeper-side rebalance bound refuses a gap
    /// above 30 bp, so a cap that fills at 30 bp always fills. At the $24,118 replay cap (c about 102 to 106 bp across reads
    /// of the live pool) META stops filling at a gap between 0 and 25 bp, depending on the block the fork reads; at the
    /// $17,025 deploy cap (c about 80 to 83 bp) it fills at every gap the bound lets through, 16 to 19 bp short of the
    /// floor and 6 to 9 bp after the 10 bp spot band. The replay cap's threshold moves with the live pool, so it is
    /// logged, not asserted; the deploy cap's fills are the asserted bound.
    function test_R4_metaSellFloorThreshold() public {
        L memory meta = _list()[5];
        assertEq(meta.v.capUsd, META_CAP_USD, "the deploy-list cap");
        uint256[7] memory gaps = [uint256(0), 5, 10, 15, 20, 25, 30];
        uint256 filled;
        for (uint256 i; i < gaps.length; ++i) {
            uint256 snap = vm.snapshotState();
            try this.caseEdge(meta, true, gaps[i]) returns (bool opened) {
                if (opened) ++filled;
            } catch {}
            vm.revertToState(snap);
        }
        assertEq(filled, gaps.length, "the deploy-list cap fills at every gap up to the 30 bp bound");

        meta.v.capUsd = META_REPLAY_CAP_USD;
        uint256 firstRefused = type(uint256).max;
        for (uint256 i; i < gaps.length && firstRefused == type(uint256).max; ++i) {
            uint256 snap = vm.snapshotState();
            try this.caseEdge(meta, true, gaps[i]) returns (bool opened) {
                if (!opened) firstRefused = gaps[i];
            } catch {
                firstRefused = gaps[i];
            }
            vm.revertToState(snap);
        }
        console2.log("replay cap $24,118: first refused feed-above-pool gap bp (max = none up to 30)", firstRefused);
    }

    function test_R4_fullCapRebalanceAtTheBoundEdge() public {
        L[11] memory ls = _list();
        uint256 ok;
        for (uint256 side; side < 2; ++side) {
            for (uint256 i; i < ls.length; ++i) {
                uint256 snap = vm.snapshotState();
                try this.caseEdge(ls[i], side == 0, 28) returns (bool opened) {
                    if (opened) ++ok;
                } catch (bytes memory err) {
                    console2.log(side == 0 ? "SELL REVERTED" : "BUY REVERTED", ls[i].v.sym);
                    console2.logBytes(err);
                }
                vm.revertToState(snap);
            }
        }
        console2.log("opened of 22", ok);
        assertEq(ok, 22, "a full-cap rebalance fills with the feed 28 bp off the pool on the demanding side");
    }
}
