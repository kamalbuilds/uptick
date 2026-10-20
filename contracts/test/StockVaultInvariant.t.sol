// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";
import {Base, Addrs, Band} from "./Base.t.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAggregatorV3, IUniswapV3Pool} from "../src/interfaces/IUniswapV3.sol";
import {StockVault} from "../src/StockVault.sol";

contract Handler is Test, Addrs {
    StockVault public immutable vault;
    address public immutable owner;
    address public immutable keeper;
    uint80 public immutable feedRound;
    address[3] public actors;
    uint256 public totalIn;
    uint256 public totalOut;
    /// @dev Flows in USD (18 decimals) at the oracle price of the moment: the vault's own swaps move the pool, so
    /// Stock Token units alone are not conserved even when value is.
    uint256 public usdIn;
    uint256 public usdOut;
    /// @dev Worst NAV-per-share ratio (1e18 = unchanged) seen across any single exit.
    uint256 public worstExitPps = type(uint256).max;
    bytes public lastRebalanceRevert;
    bytes public lastRedeemRevert;
    uint256 public lastSupply;
    uint256 public lastTokenId;
    uint256 public lastIdleUsdg;
    uint256 public lastIdleStock;
    bytes public lastDepositRevert;
    uint256 public lastDepositAmount;
    bool public lastDepositInstant;

    constructor(StockVault v, address owner_, address keeper_, uint80 round) {
        vault = v;
        owner = owner_;
        keeper = keeper_;
        feedRound = round;
        actors = [makeAddr("h1"), makeAddr("h2"), makeAddr("h3")];
        for (uint256 i; i < 3; ++i) {
            vm.prank(actors[i]);
            IERC20(NVDA).approve(address(v), type(uint256).max);
        }
    }

    /// @dev Stands in for arbitrage: before every action the oracle is pointed at the pool's own price with a fresh
    /// timestamp, so the vault's own swap impact never trips the deviation gate. Gate behaviour has its own tests.
    function _sync() internal returns (uint256 price) {
        vm.roll(vm.getBlockNumber() + 1); // every action is its own block: shares minted in a block cannot leave in it
        (uint160 sp,,,,,,) = IUniswapV3Pool(POOL).slot0();
        uint256 p96 = Math.mulDiv(sp, sp, 1 << 96);
        price = Math.mulDiv(1e26, 1 << 96, p96) / 1e6;
        vm.mockCall(
            FEED,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(feedRound, int256(price), block.timestamp, block.timestamp, feedRound)
        );
    }

    function deposit(uint256 who, uint256 amount, bool instant_) external {
        if (Band.off(vault)) vm.warp(vm.getBlockTimestamp() + 11 minutes); // no arbitrageurs here: let the TWAP settle
        uint256 price = _sync();
        address a = actors[who % 3];
        amount = bound(amount, 1e12, 300e18);
        if (vault.instantDeploy() != instant_) {
            bytes memory data = abi.encodeCall(StockVault.setInstantDeploy, (instant_));
            uint256 t0 = vm.getBlockTimestamp(); // not block.timestamp: via_ir re-reads it after the warp below
            vm.prank(owner);
            vault.queueChange(data);
            vm.warp(t0 + vault.CHANGE_DELAY());
            vm.prank(owner);
            vault.executeChange(data);
            vm.warp(t0);
        }
        deal(NVDA, a, amount);
        vm.prank(a);
        try vault.deposit(amount, a) {
            totalIn += amount;
            usdIn += amount * price / 1e8;
        } catch (bytes memory err) {
            // a deposit may be refused by the oracle gate (the TWAP lags the vault's own swaps); nothing else may
            if (bytes4(err) == StockVault.OracleUnhealthy.selector) return;
            lastDepositRevert = err;
            lastDepositAmount = amount;
            lastDepositInstant = instant_;
        }
    }

    function redeem(uint256 who, uint256 frac) external {
        uint256 price = _sync();
        address a = actors[who % 3];
        uint256 bal = vault.balanceOf(a);
        if (bal == 0) return;
        uint256 shares = bound(frac, 1, 100) * bal / 100;
        if (shares == 0) return;
        uint256 before = IERC20(NVDA).balanceOf(a);
        uint256 pps = vault.pricePerShare();
        vm.prank(a);
        try vault.redeem(shares, a, a) {
            _trackExit(pps);
            uint256 got = IERC20(NVDA).balanceOf(a) - before;
            totalOut += got;
            usdOut += got * price / 1e8;
        } catch (bytes memory err) {
            // only the oracle gate or the exit buffer may refuse a redeem
            bytes4 sel = bytes4(err);
            if (sel != StockVault.OracleUnhealthy.selector && sel != StockVault.ExitBelowMinimum.selector) {
                lastRedeemRevert = err;
            }
        }
    }

    function withdraw(uint256 who, uint256 frac) external {
        uint256 price = _sync();
        address a = actors[who % 3];
        uint256 assets = bound(frac, 1, 100) * vault.maxWithdraw(a) / 100;
        if (assets == 0) return;
        uint256 before = IERC20(NVDA).balanceOf(a);
        uint256 sharesBefore = vault.balanceOf(a);
        uint256 pps = vault.pricePerShare();
        uint256 cap = vault.previewWithdraw(assets);
        vm.prank(a);
        try vault.withdraw(assets, a, a) returns (uint256 burned) {
            // an exit near the whole vault hands the unspent buffer back to the exiter as shares; what then stays
            // for the others is a sliver whose valuation rounds by whole raw USDG units, so judge it only when
            // the others hold at least 0.001 NVDA
            if ((vault.totalSupply() - vault.balanceOf(a)) * vault.pricePerShare() / 1e24 >= 1e15) _trackExit(pps);
            uint256 got = IERC20(NVDA).balanceOf(a) - before;
            // ERC-4626: exactly the assets out, at most previewWithdraw shares burned, and the return value is the burn
            if (got != assets || burned > cap || sharesBefore - vault.balanceOf(a) != burned) lastRedeemRevert = "withdraw broke ERC-4626";
            totalOut += got;
            usdOut += got * price / 1e8;
        } catch (bytes memory err) {
            bytes4 sel = bytes4(err);
            if (sel != StockVault.OracleUnhealthy.selector && sel != StockVault.ExitBelowMinimum.selector) {
                lastRedeemRevert = err;
            }
        }
    }

    function redeemInKind(uint256 who, uint256 frac) external {
        uint256 price = _sync();
        address a = actors[who % 3];
        uint256 bal = vault.balanceOf(a);
        if (bal == 0) return;
        uint256 shares = bound(frac, 1, 100) * bal / 100;
        if (shares == 0) return;
        uint256 pps = vault.pricePerShare();
        vm.prank(a);
        (uint256 s, uint256 u) = vault.redeemInKind(shares, a, a);
        _trackExit(pps);
        // the USDG leg is valued at the feed price and counted as stock out
        totalOut += s + u * 1e12 * 1e8 / price;
        usdOut += s * price / 1e8 + u * 1e12;
    }

    function rebalance() external {
        vm.warp(block.timestamp + 6 hours + 1);
        _sync();
        vm.prank(keeper);
        try vault.rebalance() {}
        catch (bytes memory err) {
            // the oracle gate and the spot-to-TWAP band are the only refusals
            if (bytes4(err) == StockVault.OracleUnhealthy.selector || bytes4(err) == StockVault.SpotOffTwap.selector) return;
            lastRebalanceRevert = err;
            lastSupply = vault.totalSupply();
            lastTokenId = vault.tokenId();
            lastIdleUsdg = IERC20(USDG).balanceOf(address(vault));
            lastIdleStock = IERC20(NVDA).balanceOf(address(vault));
        }
    }

    uint256 public worstSupply;
    uint256 public worstBefore;
    uint256 public worstAfter;

    function _trackExit(uint256 ppsBefore) internal {
        // below 0.001 NVDA left, one raw USDG unit of rounding (about 5e9 wei) is already over a bp of the vault
        if (vault.totalAssets() < 1e15) return;
        uint256 ratio = vault.pricePerShare() * 1e18 / ppsBefore;
        if (ratio < worstExitPps) {
            worstExitPps = ratio;
            worstSupply = vault.totalSupply();
            worstBefore = ppsBefore;
            worstAfter = vault.pricePerShare();
        }
    }

    function actorsList() external view returns (address[3] memory) {
        return actors;
    }
}

contract StockVaultInvariantTest is StdInvariant, Base {
    Handler handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(vault, owner, keeper, feedRound);
        targetSender(makeAddr("fuzzer")); // few distinct senders keep the fork's account fetches small
        targetContract(address(handler));
        bytes4[] memory sel = new bytes4[](5);
        sel[0] = Handler.deposit.selector;
        sel[1] = Handler.redeem.selector;
        sel[2] = Handler.redeemInKind.selector;
        sel[3] = Handler.rebalance.selector;
        sel[4] = Handler.withdraw.selector;
        targetSelector(StdInvariant.FuzzSelector({addr: address(handler), selectors: sel}));
    }

    /// @dev Sum of what every share is worth never exceeds NAV.
    function invariant_shareValueNeverExceedsAssets() public view {
        address[3] memory a = handler.actorsList();
        uint256 sum;
        for (uint256 i; i < 3; ++i) {
            sum += vault.convertToAssets(vault.balanceOf(a[i]));
        }
        sum += vault.convertToAssets(vault.balanceOf(treasury));
        assertLe(sum, vault.totalAssets());
        uint256 supply;
        for (uint256 i; i < 3; ++i) {
            supply += vault.balanceOf(a[i]);
        }
        supply += vault.balanceOf(treasury);
        assertEq(supply, vault.totalSupply());
    }

    /// @dev No money creation: with no outside trading volume, holders cannot take out more USD than they put in,
    /// beyond the 0.3% the pool-versus-oracle gap and the TWAP-composition NAV can hand to one side.
    function invariant_noValueCreated() public view {
        assertLe(handler.usdOut(), handler.usdIn() + handler.usdIn() * 30 / 10_000 + 1e12);
    }

    /// @dev Pro-rata exits: whatever one holder takes out, NAV per share for everyone left does not fall.
    function invariant_exitsNeverDiluteRemainingHolders() public view {
        assertGe(handler.worstExitPps(), 1e18 - 1e13, string.concat("supply ", vm.toString(handler.worstSupply()), " before ", vm.toString(handler.worstBefore()), " after ", vm.toString(handler.worstAfter())));
    }

    function invariant_redeemsOnlyRefusedByGates() public view {
        assertEq(handler.lastRedeemRevert(), bytes(""), "a redeem reverted for another reason");
    }

    /// @dev A healthy vault never refuses a deposit under these conditions.
    function invariant_depositsNeverRevert() public view {
        assertEq(handler.lastDepositRevert(), bytes(""), "a deposit reverted");
        assertEq(handler.lastDepositAmount(), 0, "amount");
    }

    function invariant_rebalanceNeverReverts() public view {
        assertEq(handler.lastRebalanceRevert(), bytes(""), "a rebalance reverted");
        assertEq(handler.lastSupply(), 0, "supply");
        assertEq(handler.lastTokenId(), 0, "tokenId");
        assertEq(handler.lastIdleUsdg(), 0, "idleUsdg");
        assertEq(handler.lastIdleStock(), 0, "idleStock");
    }

    /// @dev Approvals to the position manager and router are always spent back to zero.
    function invariant_noLingeringApprovals() public view {
        assertEq(IERC20(NVDA).allowance(address(vault), NPM), 0);
        assertEq(IERC20(USDG).allowance(address(vault), NPM), 0);
        assertEq(IERC20(NVDA).allowance(address(vault), ROUTER), 0);
        assertEq(IERC20(USDG).allowance(address(vault), ROUTER), 0);
    }
}
