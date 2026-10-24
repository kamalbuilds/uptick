// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Base} from "./Base.t.sol";
import {IMorpho, MarketParams} from "./ShareCollateral.t.sol";
import {StockVault} from "../src/StockVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {UptickShareOracle, IUptickVault, IVaultFactory} from "../src/UptickShareOracle.sol";

/// @dev The one-click Earn and borrow flow against the real Morpho Blue singleton on a fork of Robinhood Chain. The vault refuses to
/// move shares minted in the current block.number (StockVault._update), and on this Orbit chain block.number inside a contract is the
/// parent chain's block (about 12 s), so the app sends the deposit and the supplyCollateral as two batches a parent block apart.
/// vm.roll(+1) is that parent block. Morpho moves the shares with transferFrom and wraps a reverting token in its own string, so the
/// vault's SharesLocked is seen as "transferFrom reverted" through Morpho and as SharesLocked on a direct transfer.
contract SharesLockedFlowTest is Base {
    using Math for uint256;

    IMorpho constant MORPHO = IMorpho(0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010);
    address constant IRM = 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1;
    uint256 constant LLTV = 0.625e18;

    VaultFactory factory;
    UptickShareOracle oracle;
    MarketParams mp;
    bytes32 id;
    address lender = makeAddr("lender");
    address factoryOwner = makeAddr("factoryOwner");

    function setUp() public override {
        super.setUp();
        bytes memory code = vm.getCode("StockVault.sol:StockVault");
        factory = new VaultFactory(
            factoryOwner,
            keccak256(code),
            bytes32(0),
            address(0),
            VaultFactory.Defaults({
                usdg: USDG,
                positionManager: NPM,
                router: ROUTER,
                vaultOwner: owner,
                keeper: keeper,
                treasury: treasury,
                params: _defaultParams()
            })
        );
        vm.prank(factoryOwner);
        vault = StockVault(factory.createVault(code, NVDA, POOL, FEED, 0));
        _instant();
        _deposit(alice, 200e18); // a seeded vault, so the share price is not the first-depositor price
        oracle = new UptickShareOracle(IVaultFactory(address(factory)), IUptickVault(address(vault)));
        mp = MarketParams(USDG, address(vault), address(oracle), IRM, LLTV);
        id = keccak256(abi.encode(mp));
        MORPHO.createMarket(mp);
        deal(USDG, lender, 1_000_000e6);
        vm.startPrank(lender);
        IERC20(USDG).approve(address(MORPHO), type(uint256).max);
        MORPHO.supply(mp, 1_000_000e6, 0, lender, "");
        vm.stopPrank();
    }

    function _position(address who) internal view returns (uint256 borrowShares, uint256 collateral) {
        (, uint128 bs, uint128 col) = MORPHO.position(id, who);
        return (bs, col);
    }

    /// @dev Phase 1 of the app: approve the stock, deposit. Returns the shares minted.
    function _phase1(address who, uint256 amount) internal returns (uint256 minted) {
        _settle();
        _fund(who, amount);
        vm.prank(who);
        minted = vault.deposit(amount, who);
    }

    /// @dev Phase 2 of the app: approve the shares, supplyCollateral, borrow.
    function _phase2(address who, uint256 collateral, uint256 borrowAssets) internal {
        vm.startPrank(who);
        IERC20(address(vault)).approve(address(MORPHO), collateral);
        MORPHO.supplyCollateral(mp, collateral, who, "");
        MORPHO.borrow(mp, borrowAssets, 0, who, who);
        vm.stopPrank();
    }

    function test_oneBatchDepositThenSupplyCollateralRevertsInTheDepositBlock() public {
        uint256 minted = _phase1(bob, 10e18);
        uint256 collateral = minted * 9950 / 10_000;
        assertEq(vault.balanceOf(bob), minted, "the shares are minted");

        // the vault's own refusal, seen directly
        vm.prank(bob);
        vm.expectRevert(StockVault.SharesLocked.selector);
        vault.transfer(alice, collateral);

        // and through Morpho, which wraps a reverting token transfer in its own string
        vm.startPrank(bob);
        IERC20(address(vault)).approve(address(MORPHO), collateral);
        vm.expectRevert(bytes("transferFrom reverted"));
        MORPHO.supplyCollateral(mp, collateral, bob, "");
        vm.stopPrank();
        (, uint256 posted) = _position(bob);
        assertEq(posted, 0, "nothing was posted");
    }

    function test_twoPhasesWorkOnceTheParentBlockHasAdvanced() public {
        uint256 minted = _phase1(bob, 10e18);
        uint256 collateral = minted * 9950 / 10_000;
        vm.roll(vm.getBlockNumber() + 1); // the wait step: the parent chain's next block, about 12 seconds
        uint256 limit = collateral.mulDiv(oracle.price(), 1e36).mulDiv(LLTV, 1e18);
        uint256 borrowAssets = limit / 2;
        assertGt(borrowAssets, 100e6, "a real loan");
        uint256 usdg0 = IERC20(USDG).balanceOf(bob);
        _phase2(bob, collateral, borrowAssets);
        (uint256 bs, uint256 posted) = _position(bob);
        assertEq(posted, collateral, "the shares are collateral");
        assertGt(bs, 0, "there is debt");
        assertEq(IERC20(USDG).balanceOf(bob) - usdg0, borrowAssets, "the USDG reached the wallet");
        assertEq(vault.balanceOf(bob), minted - collateral, "the 50 bp margin stays in the wallet");
    }

    /// @dev "Make it safer" takes shares out of Morpho and exits them in kind in one batch. The lock only covers shares minted in the
    /// current block, and the shares leaving Morpho arrive by transfer, so the batch is not affected, including when the same account
    /// has just minted more shares in that block.
    function test_makeSaferBatchIsNotAffectedByTheLock() public {
        uint256 minted = _phase1(bob, 10e18);
        uint256 collateral = minted * 9950 / 10_000;
        vm.roll(vm.getBlockNumber() + 1);
        _phase2(bob, collateral, collateral.mulDiv(oracle.price(), 1e36).mulDiv(LLTV, 1e18) / 10);
        vm.roll(vm.getBlockNumber() + 1);

        uint256 round = collateral / 20; // well inside the health floor
        vm.startPrank(bob);
        MORPHO.withdrawCollateral(mp, round, bob, bob);
        (uint256 outStock, uint256 outUsdg) = vault.redeemInKind(round, bob, bob);
        vm.stopPrank();
        assertGt(outStock + outUsdg, 0, "the exit paid out");
        (, uint256 left) = _position(bob);
        assertEq(left, collateral - round);

        // the same account mints in this very block, then runs a second round
        uint256 fresh = _phase1(bob, 1e18);
        assertGt(fresh, 0);
        vm.startPrank(bob);
        MORPHO.withdrawCollateral(mp, round, bob, bob);
        vault.redeemInKind(round, bob, bob);
        vm.stopPrank();
        (, left) = _position(bob);
        assertEq(left, collateral - 2 * round, "the second round went through in the minting block");
    }
}
