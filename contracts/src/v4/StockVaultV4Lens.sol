// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";

import {IAggregatorV3} from "../interfaces/IUniswapV3.sol";
import {StockVaultV4} from "./StockVaultV4.sol";

/// @title StockVaultV4Lens
/// @notice Read-only app helpers for any StockVaultV4: the USDG value of the vault and the USD prices of its range.
/// They sit outside the vault because the vault's runtime has no room for them and they touch no state or money:
/// each reads the vault's public views and does arithmetic on them.
contract StockVaultV4Lens {
    using Math for uint256;

    error FeedInvalid();

    /// @notice `totalAssets` in USDG at the Chainlink price. Reverts only when the feed is unusable.
    function totalValueInUSDG(StockVaultV4 v) external view returns (uint256) {
        (StockVaultV4.Status st, uint256 price,,,,) = v.health();
        if (st == StockVaultV4.Status.FeedInvalid) revert FeedInvalid();
        (uint256 stockScale, uint256 usdgScale) = _scales(v);
        return v.totalAssets().mulDiv(price * usdgScale, stockScale);
    }

    /// @notice The vault's range as ticks and as USD per Stock Token (feed decimals, ordered low to high); zeros when
    /// no position range is set.
    function currentRange(StockVaultV4 v)
        external
        view
        returns (int24 lower, int24 upper, uint256 priceLow, uint256 priceHigh)
    {
        if (!v.positionOpen()) return (0, 0, 0, 0);
        lower = v.tickLower();
        upper = v.tickUpper();
        (uint256 stockScale, uint256 usdgScale) = _scales(v);
        bool s0 = v.stockIsToken0();
        uint256 a = _usd(TickMath.getSqrtPriceAtTick(lower), stockScale, usdgScale, s0);
        uint256 b = _usd(TickMath.getSqrtPriceAtTick(upper), stockScale, usdgScale, s0);
        (priceLow, priceHigh) = a < b ? (a, b) : (b, a);
    }

    function _scales(StockVaultV4 v) private view returns (uint256 stockScale, uint256 usdgScale) {
        stockScale = 10 ** (uint256(IERC20Metadata(address(v.stock())).decimals()) + IAggregatorV3(address(v.feed())).decimals());
        usdgScale = 10 ** uint256(IERC20Metadata(address(v.usdg())).decimals());
    }

    function _usd(uint160 sqrtP, uint256 stockScale, uint256 usdgScale, bool stockIsToken0) private pure returns (uint256) {
        uint256 price96 = FullMath.mulDiv(sqrtP, sqrtP, 1 << 96);
        return stockIsToken0
            ? FullMath.mulDiv(price96, stockScale, 1 << 96) / usdgScale
            : FullMath.mulDiv(stockScale, 1 << 96, price96) / usdgScale;
    }
}
