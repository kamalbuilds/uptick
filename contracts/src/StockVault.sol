// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";

import {
    IAggregatorV3,
    IUniswapV3Factory,
    IUniswapV3Pool,
    INonfungiblePositionManager,
    ISwapRouter02
} from "./interfaces/IUniswapV3.sol";

/// @title StockVault
/// @notice ERC-4626 vault over one Stock Token. Deposits are managed as a single Uniswap v3 position on the
/// Stock Token / USDG pool, recentred once a day at +-rangeBps around the Chainlink price. Shares are a pro-rata
/// claim on idle balances plus both legs of the position. Valuation uses Chainlink for price and the pool TWAP for
/// the position's composition, and every value-in or value-out path reverts when feed, TWAP and spot disagree.
contract StockVault is ERC4626, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ------------------------------------------------------------------ types

    enum Status {
        Ok,
        FeedInvalid, // reverted, non-positive answer, zero or future timestamp, or answeredInRound < roundId
        FeedStale, // older than maxStaleness
        TwapUnavailable, // pool.observe reverted (history shorter than twapWindow)
        TwapDeviates, // TWAP price differs from Chainlink by more than maxDeviationBps
        SpotDeviates // spot price differs from Chainlink by more than maxDeviationBps
    }

    struct Params {
        uint16 rangeBps; // half-width of the position around the Chainlink price
        uint16 perfFeeBps; // share of collected trading fees minted to the treasury
        uint16 maxDeviationBps; // max |TWAP vs Chainlink| and |spot vs Chainlink|
        uint16 slippageBps; // min swap output vs Chainlink value
        uint16 exitBufferBps; // haircut that previewRedeem/previewWithdraw price in for the exit swap
        uint32 maxStaleness; // seconds since the feed's updatedAt
        uint32 twapWindow; // seconds, at least 600
        uint32 minRebalanceInterval; // seconds between keeper rebalances
    }

    struct Config {
        address stock;
        address usdg;
        address pool;
        address positionManager;
        address router;
        address feed;
        address owner;
        address keeper;
        address treasury;
        uint256 depositCap; // in Stock Token units, 0 means uncapped
    }

    struct Snapshot {
        uint256 price; // Chainlink answer, feed decimals
        uint256 updatedAt;
        uint160 sqrtOracle; // Chainlink price as pool sqrt price
        uint160 sqrtTwap; // TWAP sqrt price, falls back to spot when unavailable
        uint160 sqrtSpot;
    }

    struct Valuation {
        uint256 idleStock;
        uint256 idleUsdg;
        uint256 posStock; // principal at the TWAP price
        uint256 posUsdg;
        uint256 feeStock; // uncollected fees
        uint256 feeUsdg;
        uint256 gross; // in Stock Token units
        uint256 net; // gross minus the treasury's cut of uncollected fees
    }

    struct PositionInfo {
        uint256 tokenId;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 stockAmount; // principal, at the TWAP price
        uint256 usdgAmount;
        uint256 uncollectedStock;
        uint256 uncollectedUsdg;
        bool inRange; // spot tick inside [tickLower, tickUpper)
    }

    // -------------------------------------------------------------- constants

    uint256 public constant PERMISSIONLESS_DELAY = 26 hours;
    uint256 private constant Q96 = 1 << 96;
    uint256 private constant Q128 = 1 << 128;
    uint128 private constant UNIT_LIQUIDITY = 1e24;

    // -------------------------------------------------------------- immutables

    IERC20 public immutable stock;
    IERC20 public immutable usdg;
    IUniswapV3Pool public immutable pool;
    INonfungiblePositionManager public immutable positionManager;
    ISwapRouter02 public immutable router;
    IAggregatorV3 public immutable feed;
    bool public immutable stockIsToken0;
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;
    uint256 private immutable stockScale; // 10^(stock decimals + feed decimals)
    uint256 private immutable usdgScale; // 10^usdg decimals

    // ----------------------------------------------------------------- storage

    Params public params;
    address public keeper;
    address public treasury;
    bool public instantDeploy;
    uint256 public depositCap;

    uint256 public tokenId; // 0 when no position is open
    int24 public tickLower;
    int24 public tickUpper;
    uint256 public lastRebalance;

    uint256 public lifetimeFeesStock;
    uint256 public lifetimeFeesUsdg;

    /// @notice Stock Token owed to redeemInKind receivers whose transfer reverted (pause or blocklist).
    mapping(address => uint256) public stockOwed;
    uint256 public totalStockOwed;

    // ------------------------------------------------------------------ events

    event Deposited(address indexed caller, address indexed receiver, uint256 assets, uint256 shares, bool deployed);
    event Withdrawn(
        address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares
    );
    event RedeemedInKind(
        address indexed caller,
        address indexed receiver,
        address indexed owner,
        uint256 shares,
        uint256 stockOut,
        uint256 usdgOut,
        uint256 stockCredited
    );
    event Rebalanced(int24 tickLower, int24 tickUpper, uint256 fees0, uint256 fees1);
    event FeesCollected(uint256 fees0, uint256 fees1, uint256 feeValueInStock, uint256 treasuryShares);
    event StockClaimed(address indexed account, address indexed to, uint256 amount);
    event ParamsUpdated(Params params);
    event KeeperUpdated(address keeper);
    event TreasuryUpdated(address treasury);
    event InstantDeployUpdated(bool enabled);
    event DepositCapUpdated(uint256 cap);

    // ------------------------------------------------------------------ errors

    error OracleUnhealthy(Status status);
    error NotKeeper();
    error TooSoon();
    error BadConfig();
    error BadParams();
    error ExitBelowMinimum(uint256 got, uint256 wanted);
    error SwapBelowMinimum(uint256 got, uint256 wanted);
    error ZeroAmount();
    error ExceedsMax();
    error NothingOwed();

    // ------------------------------------------------------------- construction

    constructor(Config memory c, Params memory p, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        ERC4626(IERC20(c.stock))
        Ownable(c.owner)
    {
        if (c.treasury == address(0) || c.stock == c.usdg) revert BadConfig();
        IUniswapV3Pool pool_ = IUniswapV3Pool(c.pool);
        bool s0 = pool_.token0() == c.stock;
        if (!(s0 && pool_.token1() == c.usdg) && !(pool_.token1() == c.stock && pool_.token0() == c.usdg)) {
            revert BadConfig();
        }
        INonfungiblePositionManager npm = INonfungiblePositionManager(c.positionManager);
        // the position manager only mints into the pool the factory resolves for (token0, token1, fee)
        if (IUniswapV3Factory(npm.factory()).getPool(c.stock, c.usdg, pool_.fee()) != c.pool) revert BadConfig();

        stock = IERC20(c.stock);
        usdg = IERC20(c.usdg);
        pool = pool_;
        positionManager = npm;
        router = ISwapRouter02(c.router);
        feed = IAggregatorV3(c.feed);
        stockIsToken0 = s0;
        poolFee = pool_.fee();
        tickSpacing = pool_.tickSpacing();

        uint8 dStock = ERC20(c.stock).decimals();
        uint8 dUsdg = ERC20(c.usdg).decimals();
        uint8 dFeed = IAggregatorV3(c.feed).decimals();
        if (uint256(dStock) + dFeed < dUsdg) revert BadConfig();
        stockScale = 10 ** (uint256(dStock) + dFeed);
        usdgScale = 10 ** uint256(dUsdg);

        _checkParams(p);
        params = p;
        keeper = c.keeper;
        treasury = c.treasury;
        depositCap = c.depositCap;
        lastRebalance = block.timestamp;
    }

    // ------------------------------------------------------------- owner admin

    function setParams(Params calldata p) external onlyOwner {
        _checkParams(p);
        params = p;
        emit ParamsUpdated(p);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperUpdated(keeper_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert BadConfig();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setInstantDeploy(bool enabled) external onlyOwner {
        instantDeploy = enabled;
        emit InstantDeployUpdated(enabled);
    }

    function setDepositCap(uint256 cap) external onlyOwner {
        depositCap = cap;
        emit DepositCapUpdated(cap);
    }

    /// @notice Stops deposits and mints. Withdrawals, redeemInKind and rebalance stay open.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _checkParams(Params memory p) private pure {
        if (
            p.rangeBps < 50 || p.rangeBps > 2000 || p.perfFeeBps > 2000 || p.maxDeviationBps < 10
                || p.maxDeviationBps > 500 || p.slippageBps < 1 || p.slippageBps > 500 || p.exitBufferBps > 200
                || p.maxStaleness < 1 hours || p.maxStaleness > 7 days || p.twapWindow < 600 || p.twapWindow > 1 days
                || p.minRebalanceInterval < 1 hours || p.minRebalanceInterval > 24 hours
        ) revert BadParams();
    }

    // -------------------------------------------------------------------- views

    /// @notice Net asset value in Stock Token units: idle balances, both position legs at the TWAP price and
    /// uncollected fees, with the treasury's performance cut on those fees already deducted.
    function totalAssets() public view override returns (uint256) {
        (Status st, Snapshot memory s) = _read();
        if (st == Status.FeedInvalid) revert OracleUnhealthy(st);
        return _valuation(s).net;
    }

    function totalValueInUSDG() external view returns (uint256) {
        (Status st, Snapshot memory s) = _read();
        if (st == Status.FeedInvalid) revert OracleUnhealthy(st);
        return _stockToUsdg(_valuation(s).net, s.price);
    }

    /// @notice Stock Token units redeemable per whole share (10^decimals() share units).
    function pricePerShare() external view returns (uint256) {
        return convertToAssets(10 ** decimals());
    }

    function feesEarnedLifetime() external view returns (uint256 stockFees, uint256 usdgFees, uint256 valueInUSDG) {
        (Status st, Snapshot memory s) = _read();
        if (st == Status.FeedInvalid) revert OracleUnhealthy(st);
        stockFees = lifetimeFeesStock;
        usdgFees = lifetimeFeesUsdg;
        valueInUSDG = usdgFees + _stockToUsdg(stockFees, s.price);
    }

    function positionInfo() external view returns (PositionInfo memory info) {
        (Status st, Snapshot memory s) = _read();
        if (st == Status.FeedInvalid) revert OracleUnhealthy(st);
        info.tokenId = tokenId;
        if (tokenId == 0) return info;
        info.tickLower = tickLower;
        info.tickUpper = tickUpper;
        info.liquidity = _liquidity();
        (uint256 a0, uint256 a1) = _amounts(s.sqrtTwap, tickLower, tickUpper, info.liquidity);
        (info.stockAmount, info.usdgAmount) = _orient(a0, a1);
        (uint256 f0, uint256 f1) = _uncollectedFees();
        (info.uncollectedStock, info.uncollectedUsdg) = _orient(f0, f1);
        (, int24 tick,,,,,) = pool.slot0();
        info.inRange = tick >= tickLower && tick < tickUpper;
    }

    /// @notice Current range as ticks and as USD per Stock Token (feed decimals, ordered low to high).
    function currentRange() external view returns (int24 lower, int24 upper, uint256 priceLow, uint256 priceHigh) {
        lower = tickLower;
        upper = tickUpper;
        if (tokenId == 0) return (0, 0, 0, 0);
        uint256 a = _sqrtToUsd(TickMath.getSqrtPriceAtTick(lower));
        uint256 b = _sqrtToUsd(TickMath.getSqrtPriceAtTick(upper));
        (priceLow, priceHigh) = a < b ? (a, b) : (b, a);
    }

    /// @notice Oracle gate as the guarded paths see it. Never reverts for a bad feed.
    function health()
        external
        view
        returns (Status status, uint256 price, uint256 updatedAt, uint160 sqrtOracle, uint160 sqrtTwap, uint160 sqrtSpot)
    {
        Snapshot memory s;
        (status, s) = _read();
        return (status, s.price, s.updatedAt, s.sqrtOracle, s.sqrtTwap, s.sqrtSpot);
    }

    // ---------------------------------------------------------- ERC-4626 limits

    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) return 0;
        uint256 cap = depositCap;
        if (cap == 0) return type(uint256).max;
        uint256 ta = totalAssets();
        return cap > ta ? cap - ta : 0;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 assets = maxDeposit(receiver);
        return assets == type(uint256).max ? type(uint256).max : _convertToShares(assets, Math.Rounding.Floor);
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        return previewRedeem(balanceOf(owner_));
    }

    /// @dev A floor on what redeem delivers: fair value less the exit buffer. redeem pays the actual proceeds.
    function previewRedeem(uint256 shares) public view override returns (uint256) {
        return _convertToAssets(shares, Math.Rounding.Floor).mulDiv(1e4 - params.exitBufferBps, 1e4);
    }

    /// @dev Shares burned to receive exactly `assets`: fair shares for assets grossed up by the exit buffer.
    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        uint256 gross = assets.mulDiv(1e4, 1e4 - params.exitBufferBps, Math.Rounding.Ceil);
        return _convertToShares(gross, Math.Rounding.Ceil);
    }

    // ----------------------------------------------------------------- deposits

    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        Snapshot memory s = _requireHealthy();
        shares = super.deposit(assets, receiver);
        bool deployed = instantDeploy;
        if (deployed) _deploy(s);
        emit Deposited(msg.sender, receiver, assets, shares, deployed);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        Snapshot memory s = _requireHealthy();
        assets = super.mint(shares, receiver);
        bool deployed = instantDeploy;
        if (deployed) _deploy(s);
        emit Deposited(msg.sender, receiver, assets, shares, deployed);
    }

    // -------------------------------------------------------------- withdrawals

    /// @notice Burns previewWithdraw(assets) shares and sends exactly `assets` of the Stock Token. Reverts when
    /// the exit swap costs more than the exit buffer; use redeem or redeemInKind then.
    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        Snapshot memory s = _requireHealthy();
        _harvest(s);
        if (assets > maxWithdraw(owner_)) revert ExceedsMax();
        shares = previewWithdraw(assets);
        _exit(msg.sender, receiver, owner_, shares, assets, true, s);
    }

    /// @notice Burns `shares` and sends the actual proceeds of the Stock Token, at least previewRedeem(shares).
    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        Snapshot memory s = _requireHealthy();
        _harvest(s);
        if (shares > balanceOf(owner_)) revert ExceedsMax();
        assets = _exit(msg.sender, receiver, owner_, shares, previewRedeem(shares), false, s);
    }

    /// @notice Pro-rata exit in both legs. No oracle gate, no swap, not pausable. If the Stock Token transfer to
    /// `receiver` reverts (issuer pause or blocklist) the Stock Token leg is credited to `receiver` and claimed
    /// later with claimStockOwed.
    function redeemInKind(uint256 shares, address receiver, address owner_)
        external
        nonReentrant
        returns (uint256 stockOut, uint256 usdgOut)
    {
        if (shares == 0) revert ZeroAmount();
        if (shares > balanceOf(owner_)) revert ExceedsMax();
        try this.health() returns (Status st, uint256, uint256, uint160, uint160, uint160) {
            if (st == Status.Ok) {
                (, Snapshot memory s) = _read();
                _harvest(s);
            }
        } catch {}

        if (msg.sender != owner_) _spendAllowance(owner_, msg.sender, shares);
        uint256 supply = totalSupply();
        _burn(owner_, shares);
        (stockOut, usdgOut) = _release(shares, supply);

        if (usdgOut > 0) usdg.safeTransfer(receiver, usdgOut);
        uint256 credited;
        if (stockOut > 0) {
            try stock.transfer(receiver, stockOut) returns (bool ok) {
                if (!ok) credited = stockOut;
            } catch {
                credited = stockOut;
            }
            if (credited > 0) {
                stockOwed[receiver] += credited;
                totalStockOwed += credited;
            }
        }
        emit RedeemedInKind(msg.sender, receiver, owner_, shares, stockOut, usdgOut, credited);
    }

    /// @notice Sends the caller's credited Stock Token (from a failed redeemInKind transfer) to `to`.
    function claimStockOwed(address to) external nonReentrant {
        uint256 amount = stockOwed[msg.sender];
        if (amount == 0) revert NothingOwed();
        stockOwed[msg.sender] = 0;
        totalStockOwed -= amount;
        stock.safeTransfer(to, amount);
        emit StockClaimed(msg.sender, to, amount);
    }

    // ---------------------------------------------------------------- rebalance

    /// @notice Collects fees, closes the position and reopens it at +-rangeBps around the Chainlink price.
    /// Callable by the keeper every minRebalanceInterval, and by anyone once PERMISSIONLESS_DELAY has passed
    /// since the last rebalance. The oracle gate applies to every caller.
    function rebalance() external nonReentrant {
        if (msg.sender == keeper) {
            if (block.timestamp < lastRebalance + params.minRebalanceInterval) revert TooSoon();
        } else if (block.timestamp < lastRebalance + PERMISSIONLESS_DELAY) {
            revert NotKeeper();
        }
        Snapshot memory s = _requireHealthy();
        (uint256 f0, uint256 f1) = _harvest(s);
        _closePosition();
        _openPosition(s);
        lastRebalance = block.timestamp;
        emit Rebalanced(tickLower, tickUpper, f0, f1);
    }

    // ----------------------------------------------------------------- internals

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function _exit(
        address caller,
        address receiver,
        address owner_,
        uint256 shares,
        uint256 minAssets,
        bool exact,
        Snapshot memory s
    ) internal returns (uint256 delivered) {
        if (shares == 0) revert ZeroAmount();
        if (caller != owner_) _spendAllowance(owner_, caller, shares);
        uint256 supply = totalSupply();
        _burn(owner_, shares);
        (uint256 outStock, uint256 outUsdg) = _release(shares, supply);

        if (outUsdg > 0) {
            uint256 minOut = _minOut(_usdgToStock(outUsdg, s.price));
            if (minOut > 0) outStock += _swap(usdg, stock, outUsdg, minOut);
        }
        if (outStock < minAssets) revert ExitBelowMinimum(outStock, minAssets);
        delivered = exact ? minAssets : outStock;
        stock.safeTransfer(receiver, delivered);
        emit Withdraw(caller, receiver, owner_, delivered, shares);
        emit Withdrawn(caller, receiver, owner_, delivered, shares);
    }

    /// @dev Takes shares/supply of idle balances and of the position's liquidity into this contract and returns
    /// the amounts. Uncollected fees are not touched: callers harvest first when the oracle allows it.
    function _release(uint256 shares, uint256 supply) internal returns (uint256 outStock, uint256 outUsdg) {
        outStock = _idleStock().mulDiv(shares, supply);
        outUsdg = usdg.balanceOf(address(this)).mulDiv(shares, supply);
        if (tokenId == 0) return (outStock, outUsdg);
        uint128 liq = _liquidity();
        uint128 part = shares == supply ? liq : uint128(uint256(liq).mulDiv(shares, supply));
        if (part == 0) return (outStock, outUsdg);
        (uint256 d0, uint256 d1) = positionManager.decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams(tokenId, part, 0, 0, block.timestamp)
        );
        positionManager.collect(
            INonfungiblePositionManager.CollectParams(tokenId, address(this), uint128(d0), uint128(d1))
        );
        (uint256 s0, uint256 s1) = _orient(d0, d1);
        outStock += s0;
        outUsdg += s1;
    }

    /// @dev Collects trading fees only (principal is always collected the moment it is decreased) and mints the
    /// treasury its cut as shares. The mint prices shares against assets net of that cut, so the share price is
    /// unchanged by the mint.
    function _harvest(Snapshot memory s) internal returns (uint256 f0, uint256 f1) {
        if (tokenId == 0) return (0, 0);
        (f0, f1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams(tokenId, address(this), type(uint128).max, type(uint128).max)
        );
        if (f0 == 0 && f1 == 0) return (0, 0);
        (uint256 fStock, uint256 fUsdg) = _orient(f0, f1);
        lifetimeFeesStock += fStock;
        lifetimeFeesUsdg += fUsdg;
        uint256 feeValue = fStock + _usdgToStock(fUsdg, s.price);
        uint256 cut = feeValue.mulDiv(params.perfFeeBps, 1e4);
        uint256 minted;
        if (cut > 0) {
            uint256 gross = _valuation(s).gross;
            if (gross > cut) {
                minted = cut.mulDiv(totalSupply() + 10 ** _decimalsOffset(), gross - cut + 1);
                if (minted > 0) _mint(treasury, minted);
            }
        }
        emit FeesCollected(f0, f1, feeValue, minted);
    }

    function _closePosition() internal {
        uint256 id = tokenId;
        if (id == 0) return;
        uint128 liq = _liquidity();
        if (liq > 0) {
            positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams(id, liq, 0, 0, block.timestamp)
            );
        }
        positionManager.collect(
            INonfungiblePositionManager.CollectParams(id, address(this), type(uint128).max, type(uint128).max)
        );
        positionManager.burn(id);
        tokenId = 0;
    }

    function _openPosition(Snapshot memory s) internal {
        (int24 tl, int24 tu) = _targetTicks(s.price);
        _deployInto(tl, tu, s);
    }

    function _deploy(Snapshot memory s) internal {
        if (tokenId == 0) _openPosition(s);
        else _deployInto(tickLower, tickUpper, s);
    }

    /// @dev Swaps the idle inventory to the ratio the range needs at the current spot price, then mints a new
    /// position (tokenId == 0) or adds to the open one. Any remainder stays idle and counts in totalAssets.
    function _deployInto(int24 tl, int24 tu, Snapshot memory s) internal {
        (uint256 a0, uint256 a1) = _idle01();
        (uint256 idleStock, uint256 idleUsdg) = _orient(a0, a1);
        if (idleUsdg + _stockToUsdg(idleStock, s.price) < usdgScale) return;

        (bool zeroForOne, uint256 amountIn) = _swapNeeded(tl, tu, s.sqrtSpot, a0, a1);
        if (amountIn > 0) {
            bool stockIn = zeroForOne == stockIsToken0;
            if (stockIn) {
                _swap(stock, usdg, amountIn, _minOut(_stockToUsdg(amountIn, s.price)));
            } else {
                _swap(usdg, stock, amountIn, _minOut(_usdgToStock(amountIn, s.price)));
            }
            (a0, a1) = _idle01();
        }

        address t0 = stockIsToken0 ? address(stock) : address(usdg);
        address t1 = stockIsToken0 ? address(usdg) : address(stock);
        IERC20(t0).forceApprove(address(positionManager), a0);
        IERC20(t1).forceApprove(address(positionManager), a1);
        if (tokenId == 0) {
            (uint256 id,,,) = positionManager.mint(
                INonfungiblePositionManager.MintParams(
                    t0, t1, poolFee, tl, tu, a0, a1, 0, 0, address(this), block.timestamp
                )
            );
            tokenId = id;
            tickLower = tl;
            tickUpper = tu;
        } else {
            positionManager.increaseLiquidity(
                INonfungiblePositionManager.IncreaseLiquidityParams(tokenId, a0, a1, 0, 0, block.timestamp)
            );
        }
        IERC20(t0).forceApprove(address(positionManager), 0);
        IERC20(t1).forceApprove(address(positionManager), 0);
    }

    /// @dev Solves for the swap that leaves idle balances in the ratio of one unit of liquidity over [tl, tu] at
    /// the spot price, net of the pool fee. Price impact is ignored; the remainder stays idle.
    function _swapNeeded(int24 tl, int24 tu, uint160 sqrtP, uint256 a0, uint256 a1)
        internal
        view
        returns (bool zeroForOne, uint256 amountIn)
    {
        (uint256 u0, uint256 u1) = _amounts(sqrtP, tl, tu, UNIT_LIQUIDITY);
        uint256 price96 = Math.mulDiv(sqrtP, sqrtP, Q96); // token1 per token0, Q96
        uint256 netPrice96 = price96.mulDiv(1e6 - poolFee, 1e6);
        uint256 lhs = a0 * u1;
        uint256 rhs = a1 * u0;
        if (lhs > rhs) {
            zeroForOne = true;
            amountIn = (lhs - rhs) / (u1 + Math.mulDiv(u0, netPrice96, Q96));
        } else if (rhs > lhs) {
            amountIn = (rhs - lhs) / (u0 + Math.mulDiv(u1, Q96, netPrice96));
        }
    }

    function _swap(IERC20 tokenIn, IERC20 tokenOut, uint256 amountIn, uint256 minOut) internal returns (uint256 out) {
        uint256 before = tokenOut.balanceOf(address(this));
        tokenIn.forceApprove(address(router), amountIn);
        router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(
                address(tokenIn), address(tokenOut), poolFee, address(this), amountIn, minOut, 0
            )
        );
        out = tokenOut.balanceOf(address(this)) - before;
        if (out < minOut) revert SwapBelowMinimum(out, minOut);
    }

    /// @dev Lowest acceptable swap output: the Chainlink value of the input less slippageBps.
    function _minOut(uint256 oracleValueOut) internal view returns (uint256) {
        return oracleValueOut.mulDiv(1e4 - params.slippageBps, 1e4);
    }

    // ---------------------------------------------------------------- oracle

    function _requireHealthy() internal view returns (Snapshot memory s) {
        Status st;
        (st, s) = _read();
        if (st != Status.Ok) revert OracleUnhealthy(st);
    }

    /// @dev Reads Chainlink, the TWAP and spot. The first failing check wins; everything that could be read is
    /// still returned so views can degrade. Only an unusable feed leaves the snapshot empty.
    function _read() internal view returns (Status st, Snapshot memory s) {
        try feed.latestRoundData() returns (uint80 id, int256 answer, uint256, uint256 updatedAt, uint80 answeredIn) {
            if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp || answeredIn < id) {
                return (Status.FeedInvalid, s);
            }
            s.price = uint256(answer);
            s.updatedAt = updatedAt;
        } catch {
            return (Status.FeedInvalid, s);
        }
        Params memory p = params;
        s.sqrtOracle = _sqrtFromUsd(s.price);
        (uint160 spot,,,,,,) = pool.slot0();
        s.sqrtSpot = spot;
        (bool twapOk, int24 twapTick) = _twapTick(p.twapWindow);
        s.sqrtTwap = twapOk ? TickMath.getSqrtPriceAtTick(twapTick) : spot;

        if (block.timestamp - s.updatedAt > p.maxStaleness) st = Status.FeedStale;
        else if (!twapOk) st = Status.TwapUnavailable;
        else if (_deviates(s.sqrtTwap, s.sqrtOracle, p.maxDeviationBps)) st = Status.TwapDeviates;
        else if (_deviates(s.sqrtSpot, s.sqrtOracle, p.maxDeviationBps)) st = Status.SpotDeviates;
    }

    function _twapTick(uint32 window) internal view returns (bool ok, int24 tick) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = window;
        try pool.observe(ago) returns (int56[] memory cum, uint160[] memory) {
            int56 delta = cum[1] - cum[0];
            int56 w = int56(uint56(window));
            int56 t = delta / w;
            if (delta < 0 && delta % w != 0) t--;
            if (t < TickMath.MIN_TICK || t > TickMath.MAX_TICK) return (false, 0);
            return (true, int24(t));
        } catch {
            return (false, 0);
        }
    }

    /// @dev True when the two sqrt prices imply prices more than `bps` apart.
    function _deviates(uint160 a, uint160 b, uint256 bps) internal pure returns (bool) {
        (uint256 hi, uint256 lo) = a > b ? (uint256(a), uint256(b)) : (uint256(b), uint256(a));
        uint256 hiP = Math.mulDiv(hi, hi, Q96);
        uint256 loP = Math.mulDiv(lo, lo, Q96);
        return hiP * 1e4 > loP * (1e4 + bps);
    }

    // ------------------------------------------------------------ valuation

    function _valuation(Snapshot memory s) internal view returns (Valuation memory v) {
        v.idleStock = _idleStock();
        v.idleUsdg = usdg.balanceOf(address(this));
        if (tokenId != 0) {
            (uint256 a0, uint256 a1) = _amounts(s.sqrtTwap, tickLower, tickUpper, _liquidity());
            (v.posStock, v.posUsdg) = _orient(a0, a1);
            (uint256 f0, uint256 f1) = _uncollectedFees();
            (v.feeStock, v.feeUsdg) = _orient(f0, f1);
        }
        uint256 usdgTotal = v.idleUsdg + v.posUsdg + v.feeUsdg;
        v.gross = v.idleStock + v.posStock + v.feeStock + _usdgToStock(usdgTotal, s.price);
        uint256 feeValue = v.feeStock + _usdgToStock(v.feeUsdg, s.price);
        v.net = v.gross - feeValue.mulDiv(params.perfFeeBps, 1e4);
    }

    function _amounts(uint160 sqrtP, int24 tl, int24 tu, uint128 liq) internal pure returns (uint256 a0, uint256 a1) {
        uint160 sa = TickMath.getSqrtPriceAtTick(tl);
        uint160 sb = TickMath.getSqrtPriceAtTick(tu);
        if (sqrtP <= sa) {
            a0 = SqrtPriceMath.getAmount0Delta(sa, sb, liq, false);
        } else if (sqrtP < sb) {
            a0 = SqrtPriceMath.getAmount0Delta(sqrtP, sb, liq, false);
            a1 = SqrtPriceMath.getAmount1Delta(sa, sqrtP, liq, false);
        } else {
            a1 = SqrtPriceMath.getAmount1Delta(sa, sb, liq, false);
        }
    }

    /// @dev Fees the position has earned but not collected: tokensOwed plus growth since its last update,
    /// computed the way the pool does (wrapping subtraction on fee growth).
    function _uncollectedFees() internal view returns (uint256 f0, uint256 f1) {
        if (tokenId == 0) return (0, 0);
        uint128 liq;
        uint256 last0;
        uint256 last1;
        {
            uint128 owed0;
            uint128 owed1;
            (,,,,,,, liq, last0, last1, owed0, owed1) = positionManager.positions(tokenId);
            f0 = owed0;
            f1 = owed1;
        }
        if (liq == 0) return (f0, f1);
        (uint256 in0, uint256 in1) = _feeGrowthInside();
        unchecked {
            f0 += Math.mulDiv(in0 - last0, liq, Q128);
            f1 += Math.mulDiv(in1 - last1, liq, Q128);
        }
    }

    function _feeGrowthInside() internal view returns (uint256 in0, uint256 in1) {
        (, int24 tick,,,,,) = pool.slot0();
        uint256 g0 = pool.feeGrowthGlobal0X128();
        uint256 g1 = pool.feeGrowthGlobal1X128();
        (,, uint256 lo0, uint256 lo1,,,,) = pool.ticks(tickLower);
        (,, uint256 hi0, uint256 hi1,,,,) = pool.ticks(tickUpper);
        unchecked {
            uint256 below0 = tick >= tickLower ? lo0 : g0 - lo0;
            uint256 below1 = tick >= tickLower ? lo1 : g1 - lo1;
            uint256 above0 = tick < tickUpper ? hi0 : g0 - hi0;
            uint256 above1 = tick < tickUpper ? hi1 : g1 - hi1;
            in0 = g0 - below0 - above0;
            in1 = g1 - below1 - above1;
        }
    }

    function _liquidity() internal view returns (uint128 liq) {
        (,,,,,,, liq,,,,) = positionManager.positions(tokenId);
    }

    // ------------------------------------------------------------ conversions

    function _idleStock() internal view returns (uint256) {
        uint256 bal = stock.balanceOf(address(this));
        return bal > totalStockOwed ? bal - totalStockOwed : 0;
    }

    function _idle01() internal view returns (uint256 a0, uint256 a1) {
        return stockIsToken0 ? (_idleStock(), usdg.balanceOf(address(this))) : (usdg.balanceOf(address(this)), _idleStock());
    }

    function _orient(uint256 a0, uint256 a1) internal view returns (uint256 stockAmt, uint256 usdgAmt) {
        return stockIsToken0 ? (a0, a1) : (a1, a0);
    }

    /// @dev USDG is valued at 1 USD.
    function _usdgToStock(uint256 usdgAmt, uint256 price) internal view returns (uint256) {
        return usdgAmt.mulDiv(stockScale, price * usdgScale);
    }

    function _stockToUsdg(uint256 stockAmt, uint256 price) internal view returns (uint256) {
        return stockAmt.mulDiv(price * usdgScale, stockScale);
    }

    /// @dev USD per whole Stock Token (feed decimals) to the pool's sqrt price.
    function _sqrtFromUsd(uint256 price) internal view returns (uint160) {
        uint256 price96 = stockIsToken0
            ? Math.mulDiv(price * usdgScale, Q96, stockScale) // token1 (usdg) per token0 (stock)
            : Math.mulDiv(stockScale, Q96, price * usdgScale); // token1 (stock) per token0 (usdg)
        return uint160(Math.sqrt(price96 * Q96));
    }

    function _sqrtToUsd(uint160 sqrtP) internal view returns (uint256) {
        uint256 price96 = Math.mulDiv(sqrtP, sqrtP, Q96);
        return stockIsToken0 ? Math.mulDiv(price96, stockScale, Q96) / usdgScale : Math.mulDiv(stockScale, Q96, price96) / usdgScale;
    }

    /// @dev Range of +-rangeBps around the Chainlink price, outward-snapped to the tick spacing.
    function _targetTicks(uint256 price) internal view returns (int24 tl, int24 tu) {
        uint256 bps = params.rangeBps;
        int24 tA = TickMath.getTickAtSqrtPrice(_sqrtFromUsd(price.mulDiv(1e4 - bps, 1e4)));
        int24 tB = TickMath.getTickAtSqrtPrice(_sqrtFromUsd(price.mulDiv(1e4 + bps, 1e4)));
        (int24 lo, int24 hi) = tA < tB ? (tA, tB) : (tB, tA);
        int24 spacing = tickSpacing;
        tl = _floorTick(lo, spacing);
        tu = _floorTick(hi, spacing);
        if (tu < hi) tu += spacing;
        int24 minT = TickMath.minUsableTick(spacing);
        int24 maxT = TickMath.maxUsableTick(spacing);
        if (tl < minT) tl = minT;
        if (tu > maxT) tu = maxT;
        if (tu <= tl) revert BadConfig();
    }

    function _floorTick(int24 t, int24 spacing) private pure returns (int24 r) {
        int24 m = t % spacing;
        r = t - m;
        if (m < 0) r -= spacing;
    }
}
