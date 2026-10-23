// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {IOracle} from "../../src/interfaces/IOracle.sol";
import {VaultMath} from "../../src/VaultMath.sol";
import {IUptickVault} from "../../src/UptickShareOracle.sol";

/// @notice The oracle UptickShareOracle is built not to be: it marks a vault share to the pool's spot price. The position's legs
/// are read at `sqrtSpot` and the Stock Token is valued at that same spot, with no Chainlink input, no fee deduction and no
/// totalAssets cap. Anyone who swaps in the pool moves its figure. scripts/e2e-fork.sh deploys it as the negative control
/// of the spot-push step: the check that holds for the real oracle fails for this one.
contract SpotShareOracle is IOracle {
    IUptickVault public immutable vault;
    VaultMath private immutable vaultMath;
    IERC20 private immutable stock;
    IERC20 private immutable usdg;
    bool private immutable stockIsToken0;
    uint256 private immutable virtualShares;

    constructor(IUptickVault vault_) {
        vault = vault_;
        vaultMath = VaultMath(vault_.vaultMath());
        stock = IERC20(vault_.stock());
        usdg = IERC20(vault_.usdg());
        stockIsToken0 = vault_.stockIsToken0();
        virtualShares = 10 ** (vault_.decimals() - IERC20Metadata(vault_.stock()).decimals());
    }

    function price() external view returns (uint256) {
        (,,,,, uint160 sqrtSpot) = vault.health();
        IUptickVault.PositionInfo memory p = vault.positionInfo();
        uint256 posStock;
        uint256 posUsdg;
        if (p.liquidity != 0) {
            (uint256 a0, uint256 a1) = vaultMath.amounts(sqrtSpot, p.tickLower, p.tickUpper, p.liquidity);
            (posStock, posUsdg) = stockIsToken0 ? (a0, a1) : (a1, a0);
        }
        uint256 owed = vault.totalStockOwed();
        uint256 idle = stock.balanceOf(address(vault));
        uint256 stockTotal = (idle > owed ? idle - owed : 0) + posStock + p.uncollectedStock;
        uint256 usdgTotal = usdg.balanceOf(address(vault)) + posUsdg + p.uncollectedUsdg;
        uint256 stockValue = stockIsToken0
            ? Math.mulDiv(Math.mulDiv(stockTotal, sqrtSpot, 1 << 96), sqrtSpot, 1 << 96)
            : Math.mulDiv(Math.mulDiv(stockTotal, 1 << 96, sqrtSpot), 1 << 96, sqrtSpot);
        return Math.mulDiv(stockValue + usdgTotal, 1e36, vault.totalSupply() + virtualShares);
    }
}
