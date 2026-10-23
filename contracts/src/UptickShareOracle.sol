// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {IOracle} from "./interfaces/IOracle.sol";
import {IAggregatorV3} from "./interfaces/IUniswapV3.sol";
import {VaultMath} from "./VaultMath.sol";

/// @dev The reads shared by StockVault and StockVaultV4 (same names, same word layout). `health()` and `positionInfo()`
/// return the same static tuples in both; only the type of positionInfo's first word differs (v3 `tokenId`, v4 `open`),
/// and both decode as a uint256.
interface IUptickVault {
    struct PositionInfo {
        uint256 head;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 stockAmount; // at the vault's TWAP; not used here
        uint256 usdgAmount; // at the vault's TWAP; not used here
        uint256 uncollectedStock;
        uint256 uncollectedUsdg;
        bool inRange;
    }

    function health()
        external
        view
        returns (uint8 status, uint256 price, uint256 updatedAt, uint160 sqrtOracle, uint160 sqrtTwap, uint160 sqrtSpot);
    function positionInfo() external view returns (PositionInfo memory);
    function params()
        external
        view
        returns (
            uint16 rangeBps,
            uint16 perfFeeBps,
            uint16 maxDeviationBps,
            uint16 slippageBps,
            uint16 exitBufferBps,
            uint32 maxStaleness,
            uint32 twapWindow,
            uint32 minRebalanceInterval
        );
    function totalAssets() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function totalStockOwed() external view returns (uint256);
    function decimals() external view returns (uint8);
    function stock() external view returns (address);
    function usdg() external view returns (address);
    function feed() external view returns (address);
    function stockIsToken0() external view returns (bool);
    function vaultMath() external view returns (address);
}

interface IVaultFactory {
    function isVault(address vault) external view returns (bool);
}

/// @title UptickShareOracle
/// @notice A Morpho Blue oracle that prices one share of an Uptick vault (StockVault v3 or StockVaultV4) in USDG, so
/// the share can be a market's collateral token and USDG its loan token.
///
/// What a share is worth. The vault's holdings are idle Stock Token, idle USDG, a concentrated-liquidity position and
/// the fees that position has earned. The oracle values them at the Chainlink price only: the Stock Token at the feed
/// answer, USDG at 1, and the position's two legs at the amounts its liquidity holds when the pool sits at the
/// Chainlink price (`VaultMath.amounts` at the vault's own `sqrtOracle`). Pool spot is never read, so a swap that
/// moves the pool moves nothing here: the liquidity and range are fixed by the vault, the legs are recomputed at the
/// reference price. That is the standard fair-price valuation of a constant-product position, and it is a lower bound
/// of what the same basket is worth at Chainlink, because an AMM position's value is concave in price (the basket the
/// pool actually holds at a displaced spot, revalued at the reference price, is worth at least as much). The treasury's
/// performance cut of the uncollected fees is deducted, as the vault does. The figure is then capped by the vault's own
/// `totalAssets()` valued at the same Chainlink price, which prices the USDG leg at the lower of Chainlink and TWAP
/// (and, in v4, also deducts the cut of fees recorded as pending), so the oracle never reports more than the vault does.
/// The result is divided by the share supply plus the vault's virtual-share offset, which is exactly how the vault's
/// own `convertToAssets` divides, so a donation to an empty vault cannot make the price jump.
///
/// Scale. Morpho wants loan-token raw units per collateral raw unit times 1e36. Shares have 24 decimals (stock 18 plus
/// an offset of 6) and USDG 6, so one whole share is 1e24 raw units and a $200 share is 200e6 raw USDG:
/// `price = 200e6 * 1e36 / 1e24 = 2e20`. The ratio is taken in raw units on both sides, so no decimals constant appears.
///
/// Feed stale or corporate action. The vault closes its priced paths in those states, but Morpho must keep a price to
/// liquidate with, and `redeemInKind` is always open, so a liquidator who seizes shares can always exit them. The oracle
/// therefore keeps answering with the last Chainlink print through a weekend or a corporate-action window, as the
/// market oracles already live on Robinhood Chain for the NVDA/USDG pair do (they apply no corporate-action gate and
/// revert only past 349,200 s on the Stock Token feed, which the oracle at `0xED29D310...` encodes as its base-feed
/// age bound). It reverts past the same bound: the longest silence measured on the equity feeds is 80.8 h (Labor Day
/// weekend), so 97 h clears every market holiday and a feed older than that is dead. It also reverts when the feed
/// answer itself is unusable (`FeedInvalid`: reverted, non-positive, future-dated or `answeredInRound < roundId`).
///
/// No owner, no setters, no upgrade path. One oracle per vault; the vault must be one the Uptick factory deployed,
/// which pins its creation code.
contract UptickShareOracle is IOracle {
    using Math for uint256;

    /// @notice The oldest Chainlink print the oracle accepts, in seconds (97 hours).
    uint256 public constant MAX_FEED_AGE = 349_200;
    uint8 private constant FEED_INVALID = 1; // Status.FeedInvalid in StockVault and StockVaultV4

    IUptickVault public immutable vault;
    IERC20 public immutable stock;
    IERC20 public immutable usdg;
    bool public immutable stockIsToken0;
    VaultMath public immutable vaultMath;
    /// @dev `10 ** (share decimals - stock decimals)`: the vault's virtual shares, the offset it adds to the supply.
    uint256 private immutable virtualShares;
    /// @dev Stock Token wei per feed unit and USDG raw unit: `10 ** (stock decimals + feed decimals)`, and `10 ** usdg decimals`.
    uint256 private immutable stockScale;
    uint256 private immutable usdgScale;

    error NotRegisteredVault();
    error FeedInvalid();
    error FeedTooOld(uint256 updatedAt);

    constructor(IVaultFactory factory, IUptickVault vault_) {
        if (!factory.isVault(address(vault_))) revert NotRegisteredVault();
        vault = vault_;
        IERC20Metadata stock_ = IERC20Metadata(vault_.stock());
        IERC20Metadata usdg_ = IERC20Metadata(vault_.usdg());
        stock = stock_;
        usdg = usdg_;
        stockIsToken0 = vault_.stockIsToken0();
        vaultMath = VaultMath(vault_.vaultMath());
        virtualShares = 10 ** (vault_.decimals() - stock_.decimals());
        stockScale = 10 ** (uint256(stock_.decimals()) + IAggregatorV3(vault_.feed()).decimals());
        usdgScale = 10 ** uint256(usdg_.decimals());
    }

    /// @inheritdoc IOracle
    function price() external view returns (uint256) {
        (uint8 status, uint256 px, uint256 updatedAt, uint160 sqrtOracle,,) = vault.health();
        if (status == FEED_INVALID) revert FeedInvalid();
        if (block.timestamp - updatedAt > MAX_FEED_AGE) revert FeedTooOld(updatedAt);
        return valueInUsdg(px, sqrtOracle).mulDiv(1e36, vault.totalSupply() + virtualShares);
    }

    /// @notice The vault's holdings in USDG raw units at the Chainlink answer `px` (feed decimals), the position at
    /// `sqrtOracle`, less the treasury's cut of the uncollected fees, capped by `totalAssets()` at the same price.
    function valueInUsdg(uint256 px, uint160 sqrtOracle) public view returns (uint256) {
        IUptickVault.PositionInfo memory p = vault.positionInfo();
        uint256 posStock;
        uint256 posUsdg;
        if (p.liquidity != 0) {
            (uint256 a0, uint256 a1) = vaultMath.amounts(sqrtOracle, p.tickLower, p.tickUpper, p.liquidity);
            (posStock, posUsdg) = stockIsToken0 ? (a0, a1) : (a1, a0);
        }
        uint256 owed = vault.totalStockOwed();
        uint256 idle = stock.balanceOf(address(vault));
        uint256 stockTotal = (idle > owed ? idle - owed : 0) + posStock + p.uncollectedStock;
        uint256 usdgTotal = usdg.balanceOf(address(vault)) + posUsdg + p.uncollectedUsdg;

        uint256 usdgPerStock = px * usdgScale;
        uint256 value = stockTotal.mulDiv(usdgPerStock, stockScale) + usdgTotal;
        (, uint16 perfFeeBps,,,,,,) = vault.params();
        uint256 feeValue = p.uncollectedStock.mulDiv(usdgPerStock, stockScale) + p.uncollectedUsdg;
        uint256 cut = feeValue.mulDiv(perfFeeBps, 1e4, Math.Rounding.Ceil);
        value = value > cut ? value - cut : 0;

        return Math.min(value, vault.totalAssets().mulDiv(usdgPerStock, stockScale));
    }
}
