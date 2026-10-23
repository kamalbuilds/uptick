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

/// @dev What the oracle reads from the contract that deploys it: the Uptick VaultFactory and the vault to price.
/// `UptickShareOracleFactory` is the one implementation, and the oracle records its deployer as `oracleFactory`.
interface IOracleDeployer {
    function deployParams() external view returns (IVaultFactory factory, IUptickVault vault);
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
/// which pins its creation code. The constructor takes no argument: it asks its deployer (`msg.sender`, a
/// `UptickShareOracleFactory`) for the VaultFactory and the vault, requires `factory.isVault(vault)`, and stores all
/// three as immutables (`factory()`, `vault()`, `oracleFactory()`). An account cannot deploy it; a look-alike deployer
/// contract can, but its oracle is not in the real oracle factory's `isOracle` registry and `oracleFactory()` names the
/// look-alike, so a lender checks `UptickShareOracleFactory(<published>).isOracle(oracle)`.
contract UptickShareOracle is IOracle {
    using Math for uint256;

    /// @notice The oldest Chainlink print the oracle accepts, in seconds (97 hours).
    uint256 public constant MAX_FEED_AGE = 349_200;
    uint256 private constant Q96 = 1 << 96;
    uint8 private constant FEED_INVALID = 1; // Status.FeedInvalid in StockVault and StockVaultV4

    /// @notice The Uptick VaultFactory whose `isVault` approved `vault`.
    IVaultFactory public immutable factory;
    IUptickVault public immutable vault;
    /// @notice The contract that deployed this oracle, which asked its own immutable VaultFactory about `vault`.
    address public immutable oracleFactory;
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

    constructor() {
        (IVaultFactory factory_, IUptickVault vault_) = IOracleDeployer(msg.sender).deployParams();
        if (!factory_.isVault(address(vault_))) revert NotRegisteredVault();
        factory = factory_;
        oracleFactory = msg.sender;
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
        (uint8 status, uint256 px, uint256 updatedAt, uint160 sqrtOracle, uint160 sqrtTwap,) = vault.health();
        if (status == FEED_INVALID) revert FeedInvalid();
        if (block.timestamp - updatedAt > MAX_FEED_AGE) revert FeedTooOld(updatedAt);
        return valueInUsdg(px, sqrtOracle, sqrtTwap).mulDiv(1e36, vault.totalSupply() + virtualShares);
    }

    /// @notice The vault's holdings in USDG raw units at the Chainlink answer `px` (feed decimals), the position at
    /// `sqrtOracle`, less the treasury's cut of the uncollected fees and of the fees the vault recorded as pending
    /// (see `_pendingCutUsdg`; `sqrtTwap` is the vault's TWAP from `health()`), capped by `totalAssets()` at the same price.
    function valueInUsdg(uint256 px, uint160 sqrtOracle, uint160 sqrtTwap) public view returns (uint256) {
        IUptickVault.PositionInfo memory p = vault.positionInfo();
        uint256 posStock;
        uint256 posUsdg;
        if (p.liquidity != 0) {
            (uint256 a0, uint256 a1) = vaultMath.amounts(sqrtOracle, p.tickLower, p.tickUpper, p.liquidity);
            (posStock, posUsdg) = stockIsToken0 ? (a0, a1) : (a1, a0);
        }
        uint256 owed = vault.totalStockOwed();
        uint256 idle = stock.balanceOf(address(vault));
        idle = idle > owed ? idle - owed : 0;
        uint256 idleUsdg = usdg.balanceOf(address(vault));
        uint256 usdgPerStock = px * usdgScale;
        uint256 value = (idle + posStock + p.uncollectedStock).mulDiv(usdgPerStock, stockScale) + idleUsdg + posUsdg
            + p.uncollectedUsdg;
        (, uint16 perfFeeBps,,,,,,) = vault.params();
        uint256 feeValue = p.uncollectedStock.mulDiv(usdgPerStock, stockScale) + p.uncollectedUsdg;
        uint256 cut = feeValue.mulDiv(perfFeeBps, 1e4, Math.Rounding.Ceil);
        uint256 ta = vault.totalAssets();
        cut += _pendingCutUsdg(p, idle, idleUsdg, px, sqrtTwap, perfFeeBps, ta);
        value = value > cut ? value - cut : 0;

        return Math.min(value, ta.mulDiv(usdgPerStock, stockScale));
    }

    /// @notice The treasury's cut of the fees a closed-gate `redeemInKind` moved into the vault's idle balances and
    /// recorded as pending (v4; always zero on v3), in USDG raw units at the current Chainlink answer.
    function pendingCutUsdg() external view returns (uint256) {
        (, uint256 px,,, uint160 sqrtTwap,) = vault.health();
        IUptickVault.PositionInfo memory p = vault.positionInfo();
        uint256 owed = vault.totalStockOwed();
        uint256 idle = stock.balanceOf(address(vault));
        (, uint16 perfFeeBps,,,,,,) = vault.params();
        return _pendingCutUsdg(
            p, idle > owed ? idle - owed : 0, usdg.balanceOf(address(vault)), px, sqrtTwap, perfFeeBps, vault.totalAssets()
        );
    }

    /// @dev The vault keeps the pending fees private, but its net valuation `ta` is `gross - cut(uncollected + pending)`
    /// with every term at `nav = min(Chainlink, TWAP)`, and everything but the pending cut is readable: the idle
    /// balances, the position's legs at the vault's TWAP and the uncollected fees all come from `positionInfo()`. So
    /// the pending cut is `gross - cut(uncollected) - ta`, rebuilt here with the vault's own formulas and rounding (it
    /// is zero on v3, and within a wei or two of zero on v4 when nothing is pending), saturating at zero. The cut is
    /// returned in stock units at `nav`; multiplying by `px >= nav` values it at the Chainlink price. The vault does not
    /// say whether the pending fees sit in the stock leg or the USDG leg, so the result is the upper bound of the cut
    /// at `px` (all stock), at most `px / nav - 1` above it (the vault's deviation gate keeps that under 1%) and always
    /// toward the lender. Spot never enters.
    function _pendingCutUsdg(
        IUptickVault.PositionInfo memory p,
        uint256 idle,
        uint256 idleUsdg,
        uint256 px,
        uint160 sqrtTwap,
        uint16 perfFeeBps,
        uint256 ta
    ) private view returns (uint256) {
        uint256 navScale = Math.min(px, _sqrtToUsd(sqrtTwap)) * usdgScale;
        uint256 gross = idle + p.stockAmount + p.uncollectedStock
            + (idleUsdg + p.usdgAmount + p.uncollectedUsdg).mulDiv(stockScale, navScale);
        uint256 uncollectedCut = (p.uncollectedStock + p.uncollectedUsdg.mulDiv(stockScale, navScale)) * perfFeeBps / 1e4;
        uint256 pending = gross > uncollectedCut + ta ? gross - uncollectedCut - ta : 0;
        return pending.mulDiv(px * usdgScale, stockScale);
    }

    /// @dev USD per Stock Token (feed decimals) of a sqrt price, the vault's own `_sqrtToUsd`.
    function _sqrtToUsd(uint160 sqrtP) private view returns (uint256) {
        uint256 price96 = Math.mulDiv(sqrtP, sqrtP, Q96);
        return stockIsToken0
            ? Math.mulDiv(price96, stockScale, Q96) / usdgScale
            : Math.mulDiv(stockScale, Q96, price96) / usdgScale;
    }
}
