// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAggregatorV3, ISwapRouter02} from "./interfaces/IUniswapV3.sol";

/// @notice The slice of StockVault the router needs. Status mirrors StockVault.Status so the health gate reads the
/// same value the vault gates its own deposit paths on.
interface IStockVault {
    enum Status {
        Ok,
        FeedInvalid,
        FeedStale,
        TwapUnavailable,
        TwapDeviates,
        SpotDeviates,
        CorporateAction
    }

    function usdg() external view returns (address);
    function stock() external view returns (address);
    function router() external view returns (address);
    function poolFee() external view returns (uint24);
    function feed() external view returns (address);

    function health()
        external
        view
        returns (
            Status status,
            uint256 price,
            uint256 updatedAt,
            uint160 sqrtOracle,
            uint160 sqrtTwap,
            uint160 sqrtSpot
        );

    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function redeemInKind(uint256 shares, address receiver, address owner)
        external
        returns (uint256 stockOut, uint256 usdgOut);
}

/// @notice The slice of VaultFactory the router needs: the registry of vaults the factory deployed.
interface IVaultRegistry {
    function isVault(address vault) external view returns (bool);
}

/// @title UptickRouter
/// @notice USDG on-ramp for StockVault. Swaps USDG into the vault's Stock Token through the same Uniswap v3 router
/// and pool fee the vault uses, then deposits to `receiver`. The swap floor is the Chainlink-implied stock amount
/// from `health().price` less `slippageBps`, so a deposit reverts when the pool sits far below the oracle. It only
/// serves vaults the VaultFactory registered, and measures what each swap delivers as a balance delta. The router
/// holds no balances and leaves no allowances behind after any call.
contract UptickRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 private constant BPS = 1e4;

    /// @notice Maximum adverse move between the Chainlink price and the swap, in basis points.
    uint256 public immutable slippageBps;

    /// @notice The VaultFactory whose `isVault` registry decides which vaults the router will call.
    IVaultRegistry public immutable registry;

    error Unhealthy(IStockVault.Status status);
    error ZeroAmount();
    error InsufficientShares(uint256 shares, uint256 minShares);
    error MinStockOut(uint256 stockOut, uint256 minStock);
    error MinUsdgOut(uint256 usdgOut, uint256 minUsdg);
    error BadConfig();
    error NotRegisteredVault(address vault);

    constructor(uint256 slippageBps_, IVaultRegistry registry_) {
        if (slippageBps_ > BPS || address(registry_) == address(0)) revert BadConfig();
        slippageBps = slippageBps_;
        registry = registry_;
    }

    /// @dev The vault argument is attacker-supplied: its `stock()`, `usdg()`, `router()` and `feed()` decide which
    /// tokens the router approves and moves. Only a vault the factory deployed (and so only the pinned StockVault
    /// build) is trusted.
    modifier onlyRegistered(IStockVault vault) {
        if (!registry.isVault(address(vault))) revert NotRegisteredVault(address(vault));
        _;
    }

    /// @notice Pulls `usdgIn` from the caller, swaps it to the Stock Token and deposits to `receiver`.
    /// @dev Reverts Unhealthy when the vault oracle gate is not Ok. The min-out is the Chainlink value of `usdgIn`
    /// in stock less `slippageBps`.
    function depositUsdg(IStockVault vault, uint256 usdgIn, uint256 minShares, address receiver)
        external
        nonReentrant
        onlyRegistered(vault)
        returns (uint256 shares)
    {
        if (usdgIn == 0) revert ZeroAmount();

        (IStockVault.Status status, uint256 price,,,,) = vault.health();
        if (status != IStockVault.Status.Ok) revert Unhealthy(status);

        IERC20 usdg = IERC20(vault.usdg());
        IERC20 stock = IERC20(vault.stock());
        ISwapRouter02 swapRouter = ISwapRouter02(vault.router());
        address vaultAddr = address(vault);

        uint256 impliedStock = _usdgToStock(stock, usdg, vault.feed(), usdgIn, price);
        uint256 minStock = impliedStock.mulDiv(BPS - slippageBps, BPS);

        usdg.safeTransferFrom(msg.sender, address(this), usdgIn);

        uint256 stockBefore = stock.balanceOf(address(this));
        usdg.forceApprove(address(swapRouter), usdgIn);
        swapRouter.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(
                address(usdg), address(stock), vault.poolFee(), address(this), usdgIn, minStock, 0
            )
        );
        usdg.forceApprove(address(swapRouter), 0);

        uint256 stockReceived = stock.balanceOf(address(this)) - stockBefore;
        if (stockReceived < minStock) revert MinStockOut(stockReceived, minStock);

        stock.forceApprove(vaultAddr, stockReceived);
        shares = vault.deposit(stockReceived, receiver);
        stock.forceApprove(vaultAddr, 0);

        if (shares < minShares) revert InsufficientShares(shares, minShares);
    }

    /// @notice Pulls `shares` from the caller, exits the vault in kind to this router, checks both legs against the
    /// caller's minimums and forwards them to `receiver`.
    function redeemInKindMin(IStockVault vault, uint256 shares, uint256 minStock, uint256 minUsdg, address receiver)
        external
        nonReentrant
        onlyRegistered(vault)
        returns (uint256 stockOut, uint256 usdgOut)
    {
        if (shares == 0) revert ZeroAmount();

        IERC20 stock = IERC20(vault.stock());
        IERC20 usdg = IERC20(vault.usdg());
        address vaultAddr = address(vault);

        IERC20(vaultAddr).safeTransferFrom(msg.sender, address(this), shares);

        (stockOut, usdgOut) = vault.redeemInKind(shares, address(this), address(this));

        if (stockOut < minStock) revert MinStockOut(stockOut, minStock);
        if (usdgOut < minUsdg) revert MinUsdgOut(usdgOut, minUsdg);

        if (stockOut > 0) stock.safeTransfer(receiver, stockOut);
        if (usdgOut > 0) usdg.safeTransfer(receiver, usdgOut);
    }

    /// @dev Stock Token units the Chainlink price implies for `usdgIn`, matching StockVault._usdgToStock exactly:
    /// usdgIn * 10^(stockDecimals + feedDecimals) / (price * 10^usdgDecimals).
    function _usdgToStock(IERC20 stock, IERC20 usdg, address feed, uint256 usdgIn, uint256 price)
        internal
        view
        returns (uint256)
    {
        uint8 stockDecimals = IERC20Metadata(address(stock)).decimals();
        uint8 usdgDecimals = IERC20Metadata(address(usdg)).decimals();
        uint8 feedDecimals = IAggregatorV3(feed).decimals();
        uint256 stockScale = 10 ** (uint256(stockDecimals) + feedDecimals);
        uint256 usdgScale = 10 ** uint256(usdgDecimals);
        return usdgIn.mulDiv(stockScale, price * usdgScale);
    }
}
