// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";
import {Base, Addrs} from "./Base.t.sol";
import {IAggregatorV3} from "../src/interfaces/IUniswapV3.sol";
import {StockVault} from "../src/StockVault.sol";

contract Handler is Test, Addrs {
    StockVault public immutable vault;
    address public immutable owner;
    address public immutable keeper;
    uint80 public immutable feedRound;
    uint256 public immutable fixedPrice;
    address[3] public actors;
    uint256 public totalIn;
    uint256 public totalOut;

    constructor(StockVault v, address owner_, address keeper_, uint80 round, uint256 price) {
        vault = v;
        owner = owner_;
        keeper = keeper_;
        feedRound = round;
        fixedPrice = price;
        actors = [makeAddr("h1"), makeAddr("h2"), makeAddr("h3")];
        for (uint256 i; i < 3; ++i) {
            vm.prank(actors[i]);
            IERC20(NVDA).approve(address(v), type(uint256).max);
        }
    }

    function deposit(uint256 who, uint256 amount, bool instant_) external {
        address a = actors[who % 3];
        amount = bound(amount, 1e12, 300e18);
        if (vault.instantDeploy() != instant_) {
            vm.prank(owner);
            vault.setInstantDeploy(instant_);
        }
        deal(NVDA, a, amount);
        vm.prank(a);
        vault.deposit(amount, a);
        totalIn += amount;
    }

    function redeem(uint256 who, uint256 frac) external {
        address a = actors[who % 3];
        uint256 bal = vault.balanceOf(a);
        if (bal == 0) return;
        uint256 shares = bound(frac, 1, 100) * bal / 100;
        if (shares == 0) return;
        uint256 before = IERC20(NVDA).balanceOf(a);
        vm.prank(a);
        try vault.redeem(shares, a, a) {
            totalOut += IERC20(NVDA).balanceOf(a) - before;
        } catch {}
    }

    function redeemInKind(uint256 who, uint256 frac) external {
        address a = actors[who % 3];
        uint256 bal = vault.balanceOf(a);
        if (bal == 0) return;
        uint256 shares = bound(frac, 1, 100) * bal / 100;
        if (shares == 0) return;
        vm.prank(a);
        (uint256 s, uint256 u) = vault.redeemInKind(shares, a, a);
        // the USDG leg is valued at the feed price and counted as stock out
        totalOut += s + u * 1e12 * 1e8 / fixedPrice;
    }

    function rebalance() external {
        vm.warp(block.timestamp + 6 hours + 1);
        vm.mockCall(
            FEED,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(feedRound, int256(fixedPrice), block.timestamp, block.timestamp, feedRound)
        );
        vm.prank(keeper);
        try vault.rebalance() {} catch (bytes memory err) { emit log_named_bytes("REBALANCE_REVERT", err); emit log_named_uint("supply", vault.totalSupply()); emit log_named_uint("tokenId", vault.tokenId()); emit log_named_uint("idleUsdg", IERC20(USDG).balanceOf(address(vault))); emit log_named_uint("idleNvda", IERC20(NVDA).balanceOf(address(vault))); }
    }

    function actorsList() external view returns (address[3] memory) {
        return actors;
    }
}

contract StockVaultInvariantTest is StdInvariant, Base {
    Handler handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(vault, owner, keeper, feedRound, _feedPrice());
        targetContract(address(handler));
        bytes4[] memory sel = new bytes4[](4);
        sel[0] = Handler.deposit.selector;
        sel[1] = Handler.redeem.selector;
        sel[2] = Handler.redeemInKind.selector;
        sel[3] = Handler.rebalance.selector;
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

    /// @dev No money creation: with no trading volume, holders cannot withdraw more than was deposited.
    function invariant_noValueCreated() public view {
        assertLe(handler.totalOut(), handler.totalIn() + handler.totalIn() / 10_000 + 1e12);
    }

    /// @dev Approvals to the position manager and router are always spent back to zero.
    function invariant_noLingeringApprovals() public view {
        assertEq(IERC20(NVDA).allowance(address(vault), NPM), 0);
        assertEq(IERC20(USDG).allowance(address(vault), NPM), 0);
        assertEq(IERC20(NVDA).allowance(address(vault), ROUTER), 0);
        assertEq(IERC20(USDG).allowance(address(vault), ROUTER), 0);
    }
}
