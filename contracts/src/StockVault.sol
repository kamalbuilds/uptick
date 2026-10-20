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

import {
    IAggregatorV3,
    IUniswapV3Factory,
    IUniswapV3Pool,
    INonfungiblePositionManager,
    ISwapRouter02
} from "./interfaces/IUniswapV3.sol";
import {VaultMath} from "./VaultMath.sol";

/// @notice The slice of the ERC-8056 Stock Token the vault reads. Both functions exist on the deployed tokens
/// (checked with eth_call against NVDA: oraclePaused() returns bool, effectiveAt() returns the unix time of the
/// latest multiplier change as uint256). A token without them reads as no corporate action.
interface IStockTokenCorpActions {
    function oraclePaused() external view returns (bool);
    function effectiveAt() external view returns (uint256);
}

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
        SpotDeviates, // spot price differs from Chainlink by more than maxDeviationBps
        CorporateAction // Stock Token oracle paused, or inside the window around a multiplier change (ERC-8056)
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
    /// @notice Owner changes to risk parameters, the keeper and instantDeploy wait this long after being queued.
    uint256 public constant CHANGE_DELAY = 24 hours;
    /// @notice Price-checked paths close from this long before a Stock Token multiplier change takes effect...
    uint256 public constant CORP_ACTION_LEAD = 1 hours;
    /// @notice ...until this long plus `twapWindow` after it (the pool TWAP needs that long to reprice).
    uint256 public constant CORP_ACTION_LAG = 1 hours;
    /// @notice A queued change that has not run this long after its eta is void and can be queued again.
    uint256 public constant CHANGE_GRACE = 7 days;
    uint16 public constant MAX_SPOT_TWAP_BPS = 50;
    /// @notice Widest TWAP-to-Chainlink gap a rebalance may be bounded to, and the narrowest.
    uint16 private constant MAX_TWAP_ORACLE_BPS = 500;
    uint16 private constant MIN_TWAP_ORACLE_BPS = 10;
    /// @notice Longest TWAP window. The pool must also hold more observations than the window has seconds: a pool
    /// serves at most `cardinality - 1` seconds of history under one write per second, so a window equal to the
    /// cardinality could be pushed out of the ring and close the oracle gate.
    uint32 private constant MAX_TWAP_WINDOW = 1800;
    /// @notice Highest entry fee, in pool-fee pips (20,000 = 2%).
    uint24 private constant MAX_ENTRY_FEE = 20_000;
    /// @notice Entry fee a vault starts with when its pool's own fee tier is lower: 35 bp. A deposit made at a price
    /// the feed has not printed yet, taken out in kind the next block, gains D*V/(V+D) * (m*u - fee) for an off-chain
    /// move m with u the USDG share of the vault (about one half), so it is unprofitable while fee >= m*u. Across
    /// the 1,769 round-to-round changes of the NVDA, AAPL, GOOGL, SPY and QQQ feeds (54 to 120 days each, public RPC,
    /// `getRoundData`) 97.2% are at most 70 bp (median 52 bp: the feeds print when the price has moved about half a
    /// percent), so 35 bp covers 97.2% of them.
    uint24 public constant DEFAULT_ENTRY_FEE = 3500;
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
    /// @notice The stateless maths contract this vault deployed for itself.
    VaultMath public immutable vaultMath;
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
    /// @notice Largest allowed gap between pool spot and the pool TWAP on deposit, mint and rebalance.
    uint16 public maxSpotTwapBps = 10;
    /// @notice Largest gap between the pool TWAP and Chainlink a rebalance accepts. Tighter than the
    /// maxDeviationBps gate every guarded path shares: it is what stops a TWAP walked away from the feed (inside
    /// the band at every step) from being traded against. What a walk inside the bound can still take is the
    /// bound times the one swap the rebalance makes, so the bound is the narrowest the feeds' own lag allows: the
    /// 10-minute TWAPs of twelve vaulted pools sat within 30 bp of the feed in 76% to 91% of NYSE-hours samples
    /// (2 minutes apart, 96 h to 20 Oct 2026) and within 60 bp in 96% to 100%; the feeds print only after a move of
    /// about half a percent, so a tighter bound would refuse most of the day. 30 bp, retried by the keeper.
    uint16 public maxTwapOracleBps = 30;
    /// @notice Fee on deposit and mint, in pool-fee pips, retained in the vault for the holders who stay. Never
    /// below the pool's own fee tier; the default is the larger of the tier and DEFAULT_ENTRY_FEE.
    uint24 public entryFee;

    /// @notice Queued owner change => earliest execution time. Zero when none is queued.
    mapping(bytes32 => uint256) public changeEta;

    struct Lock {
        uint128 amount; // shares minted to the account in `blk`
        uint128 blk;
    }
    mapping(address => Lock) private _locks;

    uint256 public tokenId; // 0 when no position is open
    int24 public tickLower;
    int24 public tickUpper;
    uint256 public lastRebalance;

    uint256 private lifetimeFeesStock;
    uint256 private lifetimeFeesUsdg;

    /// @notice Stock Token owed to redeemInKind receivers whose transfer reverted (pause or blocklist).
    mapping(address => uint256) public stockOwed;
    uint256 public totalStockOwed;

    // ------------------------------------------------------------------ events

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
    event SpotTwapBandUpdated(uint16 bps);
    event TwapOracleBandUpdated(uint16 bps);
    event EntryFeeUpdated(uint24 pips);
    event ChangeQueued(bytes32 indexed id, uint256 eta, bytes data);
    event ChangeExecuted(bytes32 indexed id);
    event ChangeCancelled(bytes32 indexed id);

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
    error SpotOffTwap();
    error TwapOffOracle();
    error SharesLocked();
    error ChangeNotAllowed();
    error ChangeQueuedAlready();
    error ChangeNotQueued();
    error ChangeTooEarly(uint256 eta);
    error ChangeExpired(uint256 expiredAt);

    // ------------------------------------------------------------- construction

    constructor(Config memory c, Params memory p, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        ERC4626(IERC20(c.stock))
        Ownable(c.owner)
    {
        if (c.treasury == address(0) || c.router == address(0) || c.stock == c.usdg) revert BadConfig();
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
        vaultMath = new VaultMath();
        stockIsToken0 = s0;
        poolFee = pool_.fee();
        tickSpacing = pool_.tickSpacing();

        uint8 dStock = ERC20(c.stock).decimals();
        uint8 dUsdg = ERC20(c.usdg).decimals();
        uint8 dFeed = IAggregatorV3(c.feed).decimals();
        if (uint256(dStock) + dFeed < dUsdg) revert BadConfig();
        stockScale = 10 ** (uint256(dStock) + dFeed);
        usdgScale = 10 ** uint256(dUsdg);

        _checkParams(p, pool_);
        params = p;
        entryFee = uint24(Math.max(pool_.fee(), DEFAULT_ENTRY_FEE));
        keeper = c.keeper;
        treasury = c.treasury;
        depositCap = c.depositCap;
        lastRebalance = block.timestamp;
    }

    // ------------------------------------------------------------- owner admin

    // Timelocked setters. The owner queues the ABI-encoded call, waits CHANGE_DELAY, then executes it; holders see
    // ChangeQueued with the full calldata and have the delay to exit (redeemInKind is never gated). The four
    // setters accept only a call from this contract, so the queue is the only way to reach them.
    // setTreasury, setDepositCap, pause and unpause stay immediate: setDepositCap and pause can only shrink what
    // the vault accepts, unpause and a cap raise only re-open deposits into a vault whose exit path is unchanged,
    // and setTreasury redirects the performance-fee shares without touching any holder's claim.

    modifier onlyQueued() {
        if (msg.sender != address(this)) revert ChangeNotQueued();
        _;
    }

    function queueChange(bytes calldata data) external onlyOwner returns (bytes32 id) {
        bytes4 sel = bytes4(data);
        if (
            sel != this.setParams.selector && sel != this.setKeeper.selector && sel != this.setInstantDeploy.selector
                && sel != this.setSpotTwapBand.selector && sel != this.setTwapOracleBand.selector
                && sel != this.setEntryFee.selector
        ) revert ChangeNotAllowed();
        id = keccak256(data);
        uint256 queued = changeEta[id];
        if (queued != 0 && block.timestamp <= queued + CHANGE_GRACE) revert ChangeQueuedAlready();
        uint256 eta = block.timestamp + CHANGE_DELAY;
        changeEta[id] = eta;
        emit ChangeQueued(id, eta, data);
    }

    function executeChange(bytes calldata data) external onlyOwner {
        bytes32 id = keccak256(data);
        uint256 eta = changeEta[id];
        if (eta == 0) revert ChangeNotQueued();
        if (block.timestamp < eta) revert ChangeTooEarly(eta);
        if (block.timestamp > eta + CHANGE_GRACE) revert ChangeExpired(eta + CHANGE_GRACE);
        delete changeEta[id];
        (bool ok, bytes memory ret) = address(this).call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        emit ChangeExecuted(id);
    }

    function cancelChange(bytes32 id) external onlyOwner {
        if (changeEta[id] == 0) revert ChangeNotQueued();
        delete changeEta[id];
        emit ChangeCancelled(id);
    }

    function setParams(Params calldata p) external onlyQueued {
        _checkParams(p, pool);
        params = p;
        emit ParamsUpdated(p);
    }

    function setKeeper(address keeper_) external onlyQueued {
        keeper = keeper_;
        emit KeeperUpdated(keeper_);
    }

    function setSpotTwapBand(uint16 bps) external onlyQueued {
        _within(bps, 1, MAX_SPOT_TWAP_BPS);
        maxSpotTwapBps = bps;
        emit SpotTwapBandUpdated(bps);
    }

    function setTwapOracleBand(uint16 bps) external onlyQueued {
        _within(bps, MIN_TWAP_ORACLE_BPS, MAX_TWAP_ORACLE_BPS);
        maxTwapOracleBps = bps;
        emit TwapOracleBandUpdated(bps);
    }

    /// @param pips fee on deposit and mint in pool-fee pips (500 = 0.05%), at least the pool's fee tier.
    function setEntryFee(uint24 pips) external onlyQueued {
        _within(pips, poolFee, MAX_ENTRY_FEE);
        entryFee = pips;
        emit EntryFeeUpdated(pips);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert BadConfig();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setInstantDeploy(bool enabled) external onlyQueued {
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

    /// @dev Renouncing would freeze every parameter and the keeper and treasury for good.
    function renounceOwnership() public view override onlyOwner {
        revert BadConfig();
    }

    function _checkParams(Params memory p, IUniswapV3Pool pool_) private view {
        _within(p.rangeBps, 50, 2000);
        _within(p.perfFeeBps, 0, 2000);
        _within(p.maxDeviationBps, 10, 500);
        _within(p.slippageBps, 1, 500);
        _within(p.exitBufferBps, 0, 200);
        _within(p.maxStaleness, 1 hours, 7 days);
        _within(p.twapWindow, 600, MAX_TWAP_WINDOW);
        (,,, uint16 cardinality,,,) = pool_.slot0();
        if (p.twapWindow >= cardinality) revert BadParams();
        _within(p.minRebalanceInterval, 1 hours, 24 hours);
    }

    function _within(uint256 v, uint256 lo, uint256 hi) private pure {
        if (v < lo || v > hi) revert BadParams();
    }

    // -------------------------------------------------------------------- views

    /// @notice Net asset value in Stock Token units: idle balances, both position legs at the TWAP price and
    /// uncollected fees, with the treasury's performance cut on those fees already deducted.
    function totalAssets() public view override returns (uint256) {
        Snapshot memory s = _readLenient();
        return _valuation(s).net;
    }

    function totalValueInUSDG() external view returns (uint256) {
        Snapshot memory s = _readLenient();
        return _stockToUsdg(_valuation(s).net, s.price);
    }

    /// @notice Stock Token units redeemable per whole share (10^decimals() share units).
    function pricePerShare() external view returns (uint256) {
        return convertToAssets(10 ** decimals());
    }

    function feesEarnedLifetime() external view returns (uint256 stockFees, uint256 usdgFees, uint256 valueInUSDG) {
        Snapshot memory s = _readLenient();
        stockFees = lifetimeFeesStock;
        usdgFees = lifetimeFeesUsdg;
        valueInUSDG = usdgFees + _stockToUsdg(stockFees, s.price);
    }

    function positionInfo() external view returns (PositionInfo memory info) {
        Snapshot memory s = _readLenient();
        info.tokenId = tokenId;
        if (tokenId == 0) return info;
        info.tickLower = tickLower;
        info.tickUpper = tickUpper;
        info.liquidity = _liquidity();
        (uint256 a0, uint256 a1) = vaultMath.amounts(s.sqrtTwap, tickLower, tickUpper, info.liquidity);
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
        uint256 a = _sqrtToUsd(vaultMath.sqrtAtTick(lower));
        uint256 b = _sqrtToUsd(vaultMath.sqrtAtTick(upper));
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

    /// @dev Room under the cap measured on the deposit-side valuation (_depositNav), the largest of the three views,
    /// so the assets in plus the assets already in never exceed the cap.
    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) return 0;
        uint256 cap = depositCap;
        if (cap == 0) return type(uint256).max;
        uint256 ta = _depositNav();
        return cap > ta ? cap - ta : 0;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 assets = maxDeposit(receiver);
        return assets == type(uint256).max ? type(uint256).max : previewDeposit(assets);
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        return previewRedeem(balanceOf(owner_));
    }

    /// @dev A floor on what redeem delivers: fair value less the exit buffer less the pool fee. The exit swap pays the
    /// pool fee on the USDG leg, up to the whole value, so the floor allows for it in full: on a 1% pool the fee alone
    /// is more than the buffer. redeem pays the actual proceeds.
    function previewRedeem(uint256 shares) public view override returns (uint256) {
        return _convertToAssets(shares, Math.Rounding.Floor) * (1e4 - params.exitBufferBps) / 1e4 * (1e6 - poolFee) / 1e6;
    }

    /// @dev Shares burned to receive exactly `assets`: fair shares for assets grossed up by the exit buffer and the
    /// pool fee.
    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        uint256 gross = Math.ceilDiv(Math.ceilDiv(assets * 1e4, 1e4 - params.exitBufferBps) * 1e6, 1e6 - poolFee);
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
        Snapshot memory s = _requireDepositable();
        shares = super.deposit(assets, receiver);
        if (instantDeploy) _deploy(s);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        Snapshot memory s = _requireDepositable();
        assets = super.mint(shares, receiver);
        if (instantDeploy) _deploy(s);
    }

    // -------------------------------------------------------------- withdrawals

    /// @notice Sends exactly `assets` of the Stock Token and burns the shares the exit actually cost: at most
    /// previewWithdraw(assets), less whatever part of the exit buffer the swap did not spend. Reverts when the exit
    /// swap costs more than the exit buffer; use redeem or redeemInKind then. The shares minted back are minted in this
    /// block, so they are locked in it (_update): a whole-balance redeem in the same block reverts SharesLocked.
    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        Snapshot memory s = _requireHealthy();
        _harvest(s);
        if (assets > maxWithdraw(owner_)) revert ExceedsMax();
        (, shares) = _exit(msg.sender, receiver, owner_, previewWithdraw(assets), assets, true, s);
    }

    /// @notice Burns `shares` and sends the actual proceeds of their pro-rata slice in the Stock Token: at least
    /// previewRedeem(shares), and everything the exit swap returned above that. The slice is taken pro-rata, so
    /// the holders who stay keep their NAV per share whatever the swap returns.
    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        Snapshot memory s = _requireHealthy();
        _harvest(s);
        if (shares > balanceOf(owner_)) revert ExceedsMax();
        (assets,) = _exit(msg.sender, receiver, owner_, shares, previewRedeem(shares), false, s);
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
        Snapshot memory s = _requireTight();
        if (_deviates(s.sqrtTwap, s.sqrtOracle, maxTwapOracleBps)) revert TwapOffOracle();
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

    /// @dev Shares minted in a block cannot leave the account in that block, by burn (redeem, withdraw,
    /// redeemInKind) or by transfer. A deposit-rebalance-exit sequence therefore spans two blocks: the depositor
    /// carries the price risk in between and cannot atomically hand the vault the cost of deploying their deposit.
    /// Only the shares minted this block are locked, so sending dust to someone cannot trap their other shares.
    /// ponytail: a whole-balance exit in the block a griefer dusted the account reverts; partial exits and the next block work.
    function _update(address from, address to, uint256 value) internal override {
        address who = from == address(0) ? to : from;
        Lock memory l = _locks[who];
        bool fresh = l.blk == block.number;
        if (from == address(0)) {
            _locks[who] = Lock(uint128((fresh ? l.amount : 0) + value), uint128(block.number));
        } else if (fresh && balanceOf(from) < value + l.amount) {
            revert SharesLocked();
        }
        super._update(from, to, value);
    }

    /// @dev Burns `shares`, releases their pro-rata slice and swaps its USDG leg. `exact` (withdraw) sends
    /// `minAssets` and mints back to the owner the shares the unspent part of the exit buffer is worth; otherwise
    /// (redeem) sends all the proceeds. Returns the Stock Token sent and the shares burned.
    function _exit(
        address caller,
        address receiver,
        address owner_,
        uint256 shares,
        uint256 minAssets,
        bool exact,
        Snapshot memory s
    ) internal returns (uint256 delivered, uint256 burned) {
        if (shares == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        _burn(owner_, shares);
        (uint256 outStock, uint256 outUsdg) = _release(shares, supply);

        uint256 forfeited; // Stock Token value of a USDG leg too small to swap; it stays in the vault
        if (_isDust(outUsdg)) forfeited = _usdgToStock(outUsdg, s.price);
        else outStock += _swap(usdg, stock, outUsdg, _minOut(_usdgToStock(outUsdg, s.price)));
        if (outStock + (exact ? 0 : forfeited) < minAssets) revert ExitBelowMinimum(outStock, minAssets);
        delivered = exact ? minAssets : outStock;
        burned = shares;
        if (outStock > delivered) {
            // The unspent buffer stays idle in the vault. Mint the owner back the shares it is worth, priced like
            // the harvest mint: against the assets of those who stay (net of the surplus), rounding down.
            uint256 surplus = outStock - delivered;
            uint256 refund = surplus.mulDiv(supply - shares + 10 ** _decimalsOffset(), _valuation(s).net - delivered - surplus + 1);
            burned -= refund;
            _mint(owner_, refund);
        }
        if (caller != owner_) _spendAllowance(owner_, caller, burned);
        stock.safeTransfer(receiver, delivered);
        emit Withdraw(caller, receiver, owner_, delivered, burned);
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
        uint256 feeValue = fStock + _usdgToStock(fUsdg, _navPrice(s));
        uint256 cut = feeValue * params.perfFeeBps / 1e4;
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
        tokenId = 0;
        if (liq > 0) {
            positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams(id, liq, 0, 0, block.timestamp)
            );
        }
        positionManager.collect(
            INonfungiblePositionManager.CollectParams(id, address(this), type(uint128).max, type(uint128).max)
        );
        positionManager.burn(id);
    }

    function _openPosition(Snapshot memory s) internal {
        (int24 tl, int24 tu) =
            vaultMath.targetTicks(s.price, params.rangeBps, stockScale, usdgScale, stockIsToken0, tickSpacing);
        _deployInto(tl, tu, s);
    }

    function _deploy(Snapshot memory s) internal {
        if (tokenId == 0) _openPosition(s);
        else _deployInto(tickLower, tickUpper, s);
    }

    /// @dev Swaps the idle inventory to the ratio the range needs at the current spot price, then mints a new
    /// position (tokenId == 0) or adds to the open one. Any remainder stays idle and counts in totalAssets.
    function _deployInto(int24 tl, int24 tu, Snapshot memory s) internal {
        if (!_balanceInventory(tl, tu, s)) return;
        (uint256 a0, uint256 a1) = _idle01();
        address t0 = stockIsToken0 ? address(stock) : address(usdg);
        address t1 = stockIsToken0 ? address(usdg) : address(stock);
        IERC20(t0).forceApprove(address(positionManager), a0);
        IERC20(t1).forceApprove(address(positionManager), a1);
        // The position must take at least (1 - slippageBps) of what the idle pair buys at the spot the mint sees
        // after the balancing swap; the swap itself was floored at the TWAP value and spot was held within
        // maxSpotTwapBps of the TWAP on entry.
        (uint160 spotNow,,,,,,) = pool.slot0();
        (uint256 m0, uint256 m1) = vaultMath.mintMins(spotNow, tl, tu, a0, a1, params.slippageBps);
        if (tokenId == 0) {
            (uint256 id,,,) = positionManager.mint(
                INonfungiblePositionManager.MintParams(
                    t0, t1, poolFee, tl, tu, a0, a1, m0, m1, address(this), block.timestamp
                )
            );
            tokenId = id;
            tickLower = tl;
            tickUpper = tu;
        } else {
            positionManager.increaseLiquidity(
                INonfungiblePositionManager.IncreaseLiquidityParams(tokenId, a0, a1, m0, m1, block.timestamp)
            );
        }
        IERC20(t0).forceApprove(address(positionManager), 0);
        IERC20(t1).forceApprove(address(positionManager), 0);
    }

    /// @dev Swaps idle inventory toward the ratio the range needs. False when there is less than 1 USD to deploy.
    function _balanceInventory(int24 tl, int24 tu, Snapshot memory s) internal returns (bool) {
        (uint256 a0, uint256 a1) = _idle01();
        (uint256 idleStock, uint256 idleUsdg) = _orient(a0, a1);
        if (idleUsdg + _stockToUsdg(idleStock, s.price) < usdgScale) return false;

        // The floor is the higher of the TWAP value and the Chainlink value of the input, less the pool fee and
        // slippageBps: a swap fills only when the pool pays at least that much against both references. The TWAP
        // is the market 10 minutes deep and Chainlink can lag it by hours, so each alone can be the stale one;
        // a pool dragged below the feed (or the feed run ahead of the pool) fails the other and reverts.
        // Selling Stock Token the higher price is the demanding one, buying it the lower.
        uint256 twapPrice = _sqrtToUsd(s.sqrtTwap);
        (bool zeroForOne, uint256 amountIn) = vaultMath.swapNeeded(s.sqrtSpot, tl, tu, a0, a1, poolFee);
        if (zeroForOne == stockIsToken0) {
            uint256 usdgValue = _stockToUsdg(amountIn, Math.max(twapPrice, s.price));
            if (!_isDust(usdgValue)) _swap(stock, usdg, amountIn, _minOut(usdgValue));
        } else if (!_isDust(amountIn)) {
            _swap(usdg, stock, amountIn, _minOut(_usdgToStock(amountIn, Math.min(twapPrice, s.price))));
        }
        return true;
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

    /// @dev Below one US cent a swap is not worth its gas, and the pool rounds its fee up to whole units, so a swap
    /// of a few raw units can return nothing and revert the whole call. Dust stays in the vault.
    function _isDust(uint256 usdgAmount) internal view returns (bool) {
        return usdgAmount < usdgScale / 100;
    }

    /// @dev Lowest acceptable swap output: the reference value of the input less the pool fee (every swap pays it,
    /// whatever the depth) less slippageBps for price impact and drift. Deploy swaps pass the more demanding of the
    /// TWAP and Chainlink values, exit swaps the Chainlink value.
    function _minOut(uint256 oracleValueOut) internal view returns (uint256) {
        return oracleValueOut * (1e6 - poolFee) / 1e6 * (1e4 - params.slippageBps) / 1e4;
    }

    // ---------------------------------------------------------------- oracle

    /// @dev For views: any readable feed answer is used even when the gate is not Ok; only an unusable feed reverts.
    function _readLenient() internal view returns (Snapshot memory s) {
        Status st;
        (st, s) = _read();
        if (st == Status.FeedInvalid) revert OracleUnhealthy(st);
    }

    function _requireHealthy() internal view returns (Snapshot memory s) {
        Status st;
        (st, s) = _read();
        if (st != Status.Ok) revert OracleUnhealthy(st);
    }

    /// @dev True while pool spot is within maxSpotTwapBps of the 10-minute TWAP. The Chainlink gate allows
    /// maxDeviationBps between spot and the feed; this band is much tighter, and a single-block push cannot move
    /// the TWAP. Rebalance holds it on both sides; deposit and mint only below the TWAP (_requireDepositable). So
    /// shares are never minted against a pool pushed under its average, and whatever an attacker pushes spot down
    /// by, the vault trades at no more than that many bp off the average.
    function _nearTwap(Snapshot memory s) internal view returns (bool) {
        return !_deviates(s.sqrtSpot, s.sqrtTwap, maxSpotTwapBps);
    }

    function _requireTight() internal view returns (Snapshot memory s) {
        s = _requireHealthy();
        if (!_nearTwap(s)) revert SpotOffTwap();
    }

    /// @dev Deposit and mint. Shares are priced at the lowest of Chainlink, the TWAP and spot (_depositNav), so a
    /// spot above the TWAP cannot make them cheaper and is let through: UptickRouter.depositUsdg buys in this pool
    /// and lifts spot past the band with its own swap. Only a spot below the TWAP, the push that could overcharge
    /// the depositor or underprice the vault's USDG leg, is held to the band. Rebalance keeps it two-sided.
    function _requireDepositable() internal view returns (Snapshot memory s) {
        s = _requireHealthy();
        bool spotBelow = stockIsToken0 ? s.sqrtSpot < s.sqrtTwap : s.sqrtSpot > s.sqrtTwap;
        if (spotBelow && !_nearTwap(s)) revert SpotOffTwap();
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
        s.sqrtOracle = vaultMath.sqrtFromUsd(s.price, stockScale, usdgScale, stockIsToken0);
        (uint160 spot,,,,,,) = pool.slot0();
        s.sqrtSpot = spot;
        (bool twapOk, uint160 twap) = vaultMath.twapSqrt(pool, p.twapWindow);
        s.sqrtTwap = twapOk ? twap : spot;

        if (_corporateActionWindow(p.twapWindow)) st = Status.CorporateAction;
        else if (block.timestamp - s.updatedAt > p.maxStaleness) st = Status.FeedStale;
        else if (!twapOk) st = Status.TwapUnavailable;
        else if (_deviates(s.sqrtTwap, s.sqrtOracle, p.maxDeviationBps)) st = Status.TwapDeviates;
        else if (_deviates(s.sqrtSpot, s.sqrtOracle, p.maxDeviationBps)) st = Status.SpotDeviates;
    }

    /// @dev True while the Stock Token's oracle is paused, or from CORP_ACTION_LEAD before until CORP_ACTION_LAG plus
    /// `twapWindow` after the time its multiplier last or next changes (ERC-8056 effectiveAt()). Inside that window
    /// the feed, the pool and the token can disagree by less than maxDeviationBps and still be wrong by a whole
    /// step, so every price-checked path closes; redeemInKind does not read the gate. Every multiplier step
    /// closes the paths for CORP_ACTION_LEAD + CORP_ACTION_LAG + twapWindow (2 h 10 min at the default window),
    /// ordinary dividend accruals included; this is deliberate and the window is not narrowed.
    function _corporateActionWindow(uint32 twapWindow) private view returns (bool) {
        IStockTokenCorpActions t = IStockTokenCorpActions(address(stock));
        try t.oraclePaused() returns (bool paused_) {
            if (paused_) return true;
        } catch {}
        try t.effectiveAt() returns (uint256 at) {
            uint256 now_ = block.timestamp;
            return at != 0 && (now_ < at ? at - now_ <= CORP_ACTION_LEAD : now_ - at <= CORP_ACTION_LAG + twapWindow);
        } catch {}
        return false;
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
        return _valuationAt(s, _navPrice(s));
    }

    function _valuationAt(Snapshot memory s, uint256 px) internal view returns (Valuation memory v) {
        v.idleStock = _idleStock();
        v.idleUsdg = usdg.balanceOf(address(this));
        if (tokenId != 0) {
            (uint256 a0, uint256 a1) = vaultMath.amounts(s.sqrtTwap, tickLower, tickUpper, _liquidity());
            (v.posStock, v.posUsdg) = _orient(a0, a1);
            (uint256 f0, uint256 f1) = _uncollectedFees();
            (v.feeStock, v.feeUsdg) = _orient(f0, f1);
        }
        uint256 usdgTotal = v.idleUsdg + v.posUsdg + v.feeUsdg;
        v.gross = v.idleStock + v.posStock + v.feeStock + _usdgToStock(usdgTotal, px);
        uint256 feeValue = v.feeStock + _usdgToStock(v.feeUsdg, px);
        v.net = v.gross - feeValue * params.perfFeeBps / 1e4;
    }

    /// @dev USD price at which the USDG leg is valued in totalAssets: the lower of Chainlink and the pool TWAP.
    /// The TWAP, not spot, so the vault's own swaps and a same-block push cannot move the reported share price.
    /// Value in is priced one step more conservatively, see _depositNav. Value out needs no price at all for the
    /// holders who stay: redeemInKind hands out a pro-rata slice of the actual balances, and redeem/withdraw hand
    /// out that slice's swap proceeds. totalAssets feeds previewRedeem/previewWithdraw, the exiter's guarantee:
    /// after a fall it quotes less than the swap returns and the surplus is paid out; after a rise it quotes
    /// slightly more and the exit reverts with ExitBelowMinimum, never underpaying those who stay, and
    /// redeemInKind is the way out.
    function _navPrice(Snapshot memory s) private view returns (uint256) {
        return Math.min(s.price, _sqrtToUsd(s.sqrtTwap));
    }

    /// @dev Assets the vault is worth for pricing new shares: the USDG leg at the lowest of Chainlink, the TWAP and
    /// spot. A lower price converts the USDG leg into more Stock Token, so this is the largest of the three views
    /// and a deposit gets the fewest shares. New shares are never cheaper than the cheapest view of the vault's
    /// value, so a market that has fallen ahead of both the feed (deviation trigger, off-hours) and the 10-minute
    /// TWAP cannot be sold into the vault at the stale price, and deposit -> redeemInKind is value-neutral. Pushing
    /// spot down in one block to overcharge another depositor is bounded by the Chainlink gate (maxDeviationBps) and
    /// costs the pusher the pool fee both ways; depositors that care floor their shares with previewDeposit
    /// (UptickRouter.depositUsdg takes minShares).
    function _depositNav() private view returns (uint256) {
        Snapshot memory s = _readLenient();
        return _valuationAt(s, Math.min(_navPrice(s), _sqrtToUsd(s.sqrtSpot))).net;
    }

    /// @dev Shares for `assets` less the entry fee. The fee stays in the vault and is not minted against, so it
    /// accrues to the holders who stay. Exact: deposit mints this, rounding down.
    function previewDeposit(uint256 assets) public view override returns (uint256) {
        return (assets * (1e6 - entryFee) / 1e6).mulDiv(
            totalSupply() + 10 ** _decimalsOffset(), _depositNav() + 1, Math.Rounding.Floor
        );
    }

    /// @dev Assets that buy `shares`, grossed up by the entry fee. Exact: mint takes this, rounding up.
    function previewMint(uint256 shares) public view override returns (uint256) {
        return shares.mulDiv(_depositNav() + 1, totalSupply() + 10 ** _decimalsOffset(), Math.Rounding.Ceil).mulDiv(
            1e6, 1e6 - entryFee, Math.Rounding.Ceil
        );
    }

    function _uncollectedFees() internal view returns (uint256 f0, uint256 f1) {
        if (tokenId == 0) return (0, 0);
        return vaultMath.uncollectedFees(pool, positionManager, tokenId);
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

    function _sqrtToUsd(uint160 sqrtP) internal view returns (uint256) {
        uint256 price96 = Math.mulDiv(sqrtP, sqrtP, Q96);
        return stockIsToken0 ? Math.mulDiv(price96, stockScale, Q96) / usdgScale : Math.mulDiv(stockScale, Q96, price96) / usdgScale;
    }
}
