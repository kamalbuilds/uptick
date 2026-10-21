// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

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

/// @notice What a StockVaultV4 adds to the slice above: the Uniswap v4 pool it trades in, from which the router
/// rebuilds the pool key, and the swap fee (LP fee plus the PoolManager's protocol fee) its Chainlink floor allows for.
interface IStockVaultV4 {
    function poolManager() external view returns (address);
    function swapFee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function hooks() external view returns (address);
    function stockIsToken0() external view returns (bool);
}

/// @notice The slice of VaultFactory the router needs: the registry of vaults the factory deployed.
interface IVaultRegistry {
    function isVault(address vault) external view returns (bool);
}

/// @title UptickRouter
/// @notice USDG on-ramp for StockVault. Swaps USDG into the vault's Stock Token through the same Uniswap v3 router
/// and pool fee the vault uses, then deposits to `receiver`. The swap floor is the Chainlink-implied stock amount
/// from `health().price` less the pool fee and `slippageBps`, so a deposit reverts when the pool sits far below the oracle. It only
/// serves vaults the VaultFactory registered, and measures what each swap delivers as a balance delta. The router
/// holds no balances and leaves no allowances behind after any call.
contract UptickRouter is ReentrancyGuard, IUnlockCallback {
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
    error NotPoolManager();

    /// @dev The PoolManager the router is inside an `unlock` call to; zero otherwise.
    address private _unlocking;

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
    /// in stock less the pool fee and `slippageBps`.
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
        uint256 minStock = impliedStock.mulDiv(1e6 - vault.poolFee(), 1e6).mulDiv(BPS - slippageBps, BPS);

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

    /// @notice `depositUsdg` for a StockVaultV4: the same registry check, health gate and Chainlink swap floor, with
    /// the swap made in the vault's own Uniswap v4 pool through the PoolManager. The floor allows for the pool's swap
    /// fee as the vault reads it (LP fee plus protocol fee), so a v4 pool and a v3 pool of the same tier are held to
    /// the same price. Input the pool did not consume (a partial fill) goes back to the caller.
    function depositUsdgV4(IStockVault vault, uint256 usdgIn, uint256 minShares, address receiver)
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
        address vaultAddr = address(vault);

        uint256 impliedStock = _usdgToStock(stock, usdg, vault.feed(), usdgIn, price);
        uint256 minStock = impliedStock.mulDiv(1e6 - IStockVaultV4(vaultAddr).swapFee(), 1e6).mulDiv(BPS - slippageBps, BPS);

        uint256 usdgBefore = usdg.balanceOf(address(this));
        uint256 stockBefore = stock.balanceOf(address(this));
        usdg.safeTransferFrom(msg.sender, address(this), usdgIn);
        _swapV4(IStockVaultV4(vaultAddr), vault.poolFee(), usdg, stock, usdgIn);

        uint256 stockReceived = stock.balanceOf(address(this)) - stockBefore;
        if (stockReceived < minStock) revert MinStockOut(stockReceived, minStock);
        uint256 unspent = usdg.balanceOf(address(this)) - usdgBefore;
        if (unspent > 0) usdg.safeTransfer(msg.sender, unspent);

        stock.forceApprove(vaultAddr, stockReceived);
        shares = vault.deposit(stockReceived, receiver);
        stock.forceApprove(vaultAddr, 0);

        if (shares < minShares) revert InsufficientShares(shares, minShares);
    }

    function _swapV4(IStockVaultV4 v4, uint24 poolFee, IERC20 usdg, IERC20 stock, uint256 usdgIn) private {
        bool s0 = v4.stockIsToken0();
        PoolKey memory k = PoolKey(
            Currency.wrap(s0 ? address(stock) : address(usdg)),
            Currency.wrap(s0 ? address(usdg) : address(stock)),
            poolFee,
            v4.tickSpacing(),
            IHooks(v4.hooks())
        );
        address pm = v4.poolManager();
        _unlocking = pm;
        IPoolManager(pm).unlock(abi.encode(k, !s0, usdgIn)); // the input is USDG: currency0 when the stock is currency1
        _unlocking = address(0);
    }

    /// @notice The PoolManager's `unlock` callback: swaps exact-in and settles both currencies. Only the PoolManager
    /// `depositUsdgV4` is currently unlocking can call it; the router holds no balances outside that call.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (_unlocking == address(0) || msg.sender != _unlocking) revert NotPoolManager();
        (PoolKey memory k, bool zeroForOne, uint256 amountIn) = abi.decode(data, (PoolKey, bool, uint256));
        IPoolManager pm = IPoolManager(msg.sender);
        BalanceDelta d = pm.swap(
            k,
            IPoolManager.SwapParams(
                zeroForOne, -int256(amountIn), zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            ""
        );
        _settle(pm, k.currency0, d.amount0());
        _settle(pm, k.currency1, d.amount1());
        return "";
    }

    function _settle(IPoolManager pm, Currency c, int128 amount) private {
        if (amount < 0) {
            pm.sync(c);
            IERC20(Currency.unwrap(c)).safeTransfer(address(pm), uint128(-amount));
            pm.settle();
        } else if (amount > 0) {
            pm.take(c, address(this), uint128(amount));
        }
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
