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

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {ProtocolFeeLibrary} from "v4-core/libraries/ProtocolFeeLibrary.sol";

import {IAggregatorV3} from "../interfaces/IUniswapV3.sol";
import {VaultMath} from "../VaultMath.sol";
import {VaultMathV4} from "./VaultMathV4.sol";
import {TickOracleV4} from "./TickOracleV4.sol";

/// @notice The slice of the ERC-8056 Stock Token the vault reads (same two reads as StockVault).
interface IStockToken8056 {
    function oraclePaused() external view returns (bool);
    function effectiveAt() external view returns (uint256);
}

/// @title StockVaultV4
/// @notice ERC-4626 vault over one Stock Token whose liquidity sits in one Uniswap v4 position on a Stock Token /
/// USDG pool, recentred once a day at +-rangeBps around the Chainlink price. The same shares, guards and exits as
/// StockVault; only the venue differs. The vault holds the position itself and talks to the PoolManager directly
/// through `unlock` (no position NFT, no Permit2): one `unlockCallback` runs a swap or a liquidity change and
/// settles both currencies before it returns. v4 pays a position's accrued fees to the caller on every liquidity
/// change, so the vault collects them first (performance fee minted) whenever it can read the oracle. v4 has no
/// built-in oracle: the TWAP comes from `TickOracleV4`, an observation ring this vault feeds through `poke()`.
/// Accepted pools: a static LP fee of at most 2% and either no hook or a hook whose address permissions carry no
/// return-delta flag (it cannot take value) and no remove-liquidity callback (it cannot block `redeemInKind`).
contract StockVaultV4 is ERC4626, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;
    using StateLibrary for IPoolManager;

    // ------------------------------------------------------------------ types

    enum Status {
        Ok,
        FeedInvalid,
        FeedStale,
        TwapUnavailable, // the observation ring is not a continuous record over twapWindow
        TwapDeviates,
        SpotDeviates,
        CorporateAction
    }

    struct Params {
        uint16 rangeBps;
        uint16 perfFeeBps;
        uint16 maxDeviationBps;
        uint16 slippageBps;
        uint16 exitBufferBps;
        uint32 maxStaleness;
        uint32 twapWindow;
        uint32 minRebalanceInterval;
    }

    struct Config {
        address stock;
        address usdg;
        address poolManager;
        address hooks;
        address feed;
        address owner;
        address keeper;
        address treasury;
        uint256 depositCap;
        uint24 fee; // static LP fee of the pool key, in pips
        int24 tickSpacing; // of the pool key
    }

    struct Snapshot {
        uint256 price;
        uint256 updatedAt;
        uint160 sqrtOracle;
        uint160 sqrtTwap;
        uint160 sqrtSpot;
    }

    struct Valuation {
        uint256 idleStock;
        uint256 idleUsdg;
        uint256 posStock;
        uint256 posUsdg;
        uint256 feeStock;
        uint256 feeUsdg;
        uint256 gross;
        uint256 net;
    }

    struct PositionInfo {
        bool open;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 stockAmount;
        uint256 usdgAmount;
        uint256 uncollectedStock;
        uint256 uncollectedUsdg;
        bool inRange;
    }

    /// @dev One PoolManager call, ABI-encoded into `unlock` and decoded in `unlockCallback`.
    struct Act {
        bool swap;
        bool zeroForOne;
        int24 tl;
        int24 tu;
        int256 amount; // swap: negative exact input; modify: liquidity delta
    }

    // -------------------------------------------------------------- constants

    uint256 public constant PERMISSIONLESS_DELAY = 26 hours;
    uint256 public constant CHANGE_DELAY = 24 hours;
    uint256 public constant CORP_ACTION_LEAD = 1 hours;
    uint256 public constant CORP_ACTION_LAG = 1 hours;
    uint256 public constant CHANGE_GRACE = 7 days;
    uint16 public constant MAX_SPOT_TWAP_BPS = 50;
    uint16 private constant MAX_TWAP_ORACLE_BPS = 500;
    uint16 private constant MIN_TWAP_ORACLE_BPS = 10;
    uint32 private constant MAX_TWAP_WINDOW = 1800;
    uint24 private constant MAX_ENTRY_FEE = 20_000;
    uint24 public constant DEFAULT_ENTRY_FEE = 3500;
    /// @dev Hook address permission bits a vault pool may not carry: BEFORE/AFTER_REMOVE_LIQUIDITY (a hook that can
    /// revert a removal could block `redeemInKind`), the four *_RETURNS_DELTA flags (a hook that can take value
    /// outright), and BEFORE/AFTER_SWAP and BEFORE/AFTER_ADD_LIQUIDITY (a hook that runs inside the vault's own swap or
    /// add can call the PoolManager from its callback and sandwich the vault up to its swap floor). Only initialize
    /// and donate hooks pass.
    uint160 private constant FORBIDDEN_HOOK_BITS =
        (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2) | (1 << 1) | 1;
    uint256 private constant Q96 = 1 << 96;

    // -------------------------------------------------------------- immutables

    IERC20 public immutable stock;
    IERC20 public immutable usdg;
    IPoolManager public immutable poolManager;
    IAggregatorV3 public immutable feed;
    VaultMath public immutable vaultMath;
    VaultMathV4 public immutable vaultMathV4;
    TickOracleV4 public immutable oracle;
    IHooks public immutable hooks;
    bytes32 public immutable poolId;
    bool public immutable stockIsToken0;
    uint24 public immutable poolFee; // the pool key's LP fee; the swap fee adds the PoolManager's protocol fee (swapFee())
    int24 public immutable tickSpacing;
    uint256 private immutable stockScale;
    uint256 private immutable usdgScale;

    // ----------------------------------------------------------------- storage

    Params public params;
    address public keeper;
    address public treasury;
    bool public instantDeploy;
    uint256 public depositCap;
    uint16 public maxSpotTwapBps = 10;
    uint16 public maxTwapOracleBps = 30;
    uint24 public entryFee;

    mapping(bytes32 => uint256) public changeEta;

    struct Lock {
        uint128 amount;
        uint128 blk;
    }
    mapping(address => Lock) private _locks;

    bool public positionOpen; // a position range is set (its liquidity may be 0 after a full in-kind exit)
    int24 public tickLower;
    int24 public tickUpper;
    uint256 public lastRebalance;

    uint128 private lifetimeFeesStock;
    uint128 private lifetimeFeesUsdg;
    /// @dev Fees the PoolManager paid into the vault on a liquidity change that was not preceded by a harvest (a
    /// `redeemInKind` while the oracle gate is not Ok). They sit in the idle balances, the treasury's cut of them is
    /// deducted from NAV and held back from every exit, and the next `_harvest` mints it. token0/token1 amounts.
    uint128 private pendingFee0;
    uint128 private pendingFee1;

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
    error DynamicFeePool();
    error ForbiddenHook();
    error PoolNotInitialised();
    error NotPoolManager();
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
        if (c.treasury == address(0) || c.stock == c.usdg || c.poolManager.code.length == 0) revert BadConfig();
        if (c.fee & 0x800000 != 0) revert DynamicFeePool();
        if (c.fee > MAX_ENTRY_FEE) revert BadConfig();
        if (uint160(c.hooks) & FORBIDDEN_HOOK_BITS != 0) revert ForbiddenHook();

        bool s0 = c.stock < c.usdg;
        PoolKey memory k = PoolKey(
            Currency.wrap(s0 ? c.stock : c.usdg),
            Currency.wrap(s0 ? c.usdg : c.stock),
            c.fee,
            c.tickSpacing,
            IHooks(c.hooks)
        );
        bytes32 id = PoolId.unwrap(k.toId());
        IPoolManager pm = IPoolManager(c.poolManager);
        (uint160 sqrtP,, uint24 protocolFee, uint24 lpFee) = pm.getSlot0(PoolId.wrap(id));
        if (sqrtP == 0) revert PoolNotInitialised();

        stock = IERC20(c.stock);
        usdg = IERC20(c.usdg);
        poolManager = pm;
        feed = IAggregatorV3(c.feed);
        vaultMath = new VaultMath();
        vaultMathV4 = new VaultMathV4();
        oracle = new TickOracleV4(pm, id);
        hooks = IHooks(c.hooks);
        poolId = id;
        stockIsToken0 = s0;
        poolFee = c.fee;
        tickSpacing = c.tickSpacing;

        uint8 dStock = ERC20(c.stock).decimals();
        uint8 dUsdg = ERC20(c.usdg).decimals();
        uint8 dFeed = IAggregatorV3(c.feed).decimals();
        if (uint256(dStock) + dFeed < dUsdg) revert BadConfig();
        stockScale = 10 ** (uint256(dStock) + dFeed);
        usdgScale = 10 ** uint256(dUsdg);

        _checkParams(p);
        params = p;
        entryFee = uint24(Math.max(_swapFeeOf(protocolFee, lpFee), DEFAULT_ENTRY_FEE));
        keeper = c.keeper;
        treasury = c.treasury;
        depositCap = c.depositCap;
        lastRebalance = block.timestamp;
    }

    // ------------------------------------------------------------- owner admin

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
        _checkParams(p);
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

    /// @param pips fee on deposit and mint in pool-fee pips, at least the pool's swap fee (LP fee plus protocol fee).
    function setEntryFee(uint24 pips) external onlyQueued {
        _within(pips, swapFee(), MAX_ENTRY_FEE);
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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function renounceOwnership() public view override onlyOwner {
        revert BadConfig();
    }

    function _checkParams(Params memory p) private pure {
        _within(p.rangeBps, 50, 2000);
        _within(p.perfFeeBps, 0, 2000);
        _within(p.maxDeviationBps, 10, 500);
        _within(p.slippageBps, 1, 500);
        _within(p.exitBufferBps, 0, 200);
        _within(p.maxStaleness, 1 hours, 7 days);
        _within(p.twapWindow, 600, MAX_TWAP_WINDOW);
        _within(p.minRebalanceInterval, 1 hours, 24 hours);
    }

    function _within(uint256 v, uint256 lo, uint256 hi) private pure {
        if (v < lo || v > hi) revert BadParams();
    }

    // -------------------------------------------------------------------- views

    function totalAssets() public view override returns (uint256) {
        Snapshot memory s = _readLenient();
        return _valuation(s).net;
    }

    function pricePerShare() external view returns (uint256) {
        return convertToAssets(10 ** decimals());
    }

    function feesEarnedLifetime() external view returns (uint256 stockFees, uint256 usdgFees, uint256 valueInUSDG) {
        Snapshot memory s = _readLenient();
        stockFees = lifetimeFeesStock;
        usdgFees = lifetimeFeesUsdg;
        valueInUSDG = usdgFees + _stockToUsdg(stockFees, s.price);
    }

    /// @dev The pool this vault trades and holds liquidity in, as the PoolManager keys it. The router rebuilds the
    /// same key from `poolManager`, `stockIsToken0`, `stock`, `usdg`, `poolFee`, `tickSpacing` and `hooks`.
    function _key() internal view returns (PoolKey memory k) {
        bool s0 = stockIsToken0;
        k.currency0 = Currency.wrap(s0 ? address(stock) : address(usdg));
        k.currency1 = Currency.wrap(s0 ? address(usdg) : address(stock));
        k.fee = poolFee;
        k.tickSpacing = tickSpacing;
        k.hooks = hooks;
    }

    /// @notice What a swap in this pool costs the vault in pips: the LP fee combined with the PoolManager's protocol
    /// fee for the pool, the larger of the two directions. Read live because the protocol fee controller can change it.
    function swapFee() public view returns (uint24) {
        (,, uint24 pf, uint24 lp) = _slot0();
        return _swapFeeOf(pf, lp);
    }

    function positionInfo() external view returns (PositionInfo memory info) {
        Snapshot memory s = _readLenient();
        info.open = positionOpen;
        if (!info.open) return info;
        info.tickLower = tickLower;
        info.tickUpper = tickUpper;
        uint256 a0;
        uint256 a1;
        uint256 f0;
        uint256 f1;
        (info.liquidity, a0, a1, f0, f1, info.inRange) =
            vaultMathV4.info(poolManager, poolId, address(this), tickLower, tickUpper, s.sqrtTwap);
        (info.stockAmount, info.usdgAmount) = _orient(a0, a1);
        (info.uncollectedStock, info.uncollectedUsdg) = _orient(f0, f1);
    }

    function health()
        external
        view
        returns (Status status, uint256 price, uint256 updatedAt, uint160 sqrtOracle, uint160 sqrtTwap, uint160 sqrtSpot)
    {
        Snapshot memory s;
        (status, s) = _read();
        return (status, s.price, s.updatedAt, s.sqrtOracle, s.sqrtTwap, s.sqrtSpot);
    }

    // ---------------------------------------------------------- observations

    /// @notice Writes one observation into the TWAP ring when the Chainlink answer is usable and the previous
    /// observation is at least `MIN_GAP` old. Anyone may call it; the keeper calls it every minute. Returns whether
    /// an observation was written. See TickOracleV4 for the bounds on what is written.
    function poke() external returns (bool) {
        (Status st, Snapshot memory s) = _read();
        if (st == Status.FeedInvalid || block.timestamp - s.updatedAt > params.maxStaleness) return false;
        return oracle.record(s.sqrtOracle, params.maxDeviationBps);
    }

    // ---------------------------------------------------------- ERC-4626 limits

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

    function previewRedeem(uint256 shares) public view override returns (uint256) {
        return _convertToAssets(shares, Math.Rounding.Floor) * (1e4 - params.exitBufferBps) / 1e4 * (1e6 - swapFee()) / 1e6;
    }

    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        uint256 gross = Math.ceilDiv(Math.ceilDiv(assets * 1e6, 1e6 - swapFee()) * 1e4, 1e4 - params.exitBufferBps);
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

    /// @notice Pro-rata exit in both legs. No oracle gate, no swap, not pausable. v4 pays the whole position's
    /// accrued fees to the vault when liquidity is removed. When the oracle gate is not Ok the vault cannot price a
    /// performance-fee mint, so the redeemer's slice excludes those fees (they stay with the holders who remain) and
    /// they are recorded as pending: the treasury's cut of them is deducted from NAV, held back from every later exit
    /// and minted at the next harvest. StockVault reaches the same result by leaving the fees owed in the position.
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

    function claimStockOwed(address to) external nonReentrant {
        uint256 amount = stockOwed[msg.sender];
        if (amount == 0) revert NothingOwed();
        stockOwed[msg.sender] = 0;
        totalStockOwed -= amount;
        stock.safeTransfer(to, amount);
        emit StockClaimed(msg.sender, to, amount);
    }

    // ---------------------------------------------------------------- rebalance

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

    // ----------------------------------------------------------- PoolManager

    /// @notice The PoolManager's `unlock` callback. Only the PoolManager can call it, and it calls back only the
    /// contract that called `unlock`, which is this vault inside one of its own entry points.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        Act memory a = abi.decode(data, (Act));
        PoolKey memory k = _key();
        BalanceDelta d;
        BalanceDelta f;
        if (a.swap) {
            d = poolManager.swap(
                k,
                IPoolManager.SwapParams(
                    a.zeroForOne, a.amount, a.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                ),
                ""
            );
        } else {
            (d, f) = poolManager.modifyLiquidity(k, IPoolManager.ModifyLiquidityParams(a.tl, a.tu, a.amount, 0), "");
        }
        _settle(k.currency0, d.amount0());
        _settle(k.currency1, d.amount1());
        return abi.encode(d, f);
    }

    /// @dev A negative delta is owed to the PoolManager: sync, transfer, settle. A positive one is taken.
    function _settle(Currency c, int128 amount) private {
        if (amount < 0) {
            poolManager.sync(c);
            IERC20(Currency.unwrap(c)).safeTransfer(address(poolManager), uint128(-amount));
            poolManager.settle();
        } else if (amount > 0) {
            poolManager.take(c, address(this), uint128(amount));
        }
    }

    function _unlock(Act memory a) private returns (int128 d0, int128 d1, int128 f0, int128 f1) {
        (BalanceDelta d, BalanceDelta f) = abi.decode(poolManager.unlock(abi.encode(a)), (BalanceDelta, BalanceDelta));
        return (d.amount0(), d.amount1(), f.amount0(), f.amount1());
    }

    /// @dev Adds (positive) or removes (negative) liquidity on the vault's range, or collects fees (zero). Returns
    /// the vault's balance delta (negative: paid in) and the fees accrued inside it (already part of the delta).
    function _modify(int256 liquidityDelta) private returns (int128 d0, int128 d1, int128 f0, int128 f1) {
        return _unlock(Act(false, false, tickLower, tickUpper, liquidityDelta));
    }

    // ----------------------------------------------------------------- internals

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

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

        uint256 forfeited;
        if (_isDust(outUsdg)) forfeited = _usdgToStock(outUsdg, s.price);
        else outStock += _swap(usdg, stock, outUsdg, _minOut(_usdgToStock(outUsdg, s.price)));
        if (outStock + (exact ? 0 : forfeited) < minAssets) revert ExitBelowMinimum(outStock, minAssets);
        delivered = exact ? minAssets : outStock;
        burned = shares;
        if (outStock > delivered) {
            uint256 surplus = outStock - delivered;
            uint256 refund = surplus.mulDiv(supply - shares + 10 ** _decimalsOffset(), _valuation(s).net - delivered - surplus + 1);
            burned -= refund;
            _mint(owner_, refund);
        }
        if (caller != owner_) _spendAllowance(owner_, caller, burned);
        stock.safeTransfer(receiver, delivered);
        emit Withdraw(caller, receiver, owner_, delivered, burned);
    }

    /// @dev Takes shares/supply of idle balances and of the position's liquidity into this contract and returns the
    /// amounts. The fees the PoolManager pays on the liquidity change land in the vault and are not part of them.
    function _release(uint256 shares, uint256 supply) internal returns (uint256 outStock, uint256 outUsdg) {
        // the treasury's cut of the pending fees is not the holders' to take
        (uint256 rs, uint256 ru) = _orient(
            uint256(pendingFee0) * params.perfFeeBps / 1e4, uint256(pendingFee1) * params.perfFeeBps / 1e4
        );
        outStock = (_idleStock() - rs).mulDiv(shares, supply);
        outUsdg = (usdg.balanceOf(address(this)) - ru).mulDiv(shares, supply);
        if (!positionOpen) return (outStock, outUsdg);
        (uint128 liq,,) = _pos();
        uint128 part = shares == supply ? liq : uint128(uint256(liq).mulDiv(shares, supply));
        if (part == 0) return (outStock, outUsdg);
        (int128 d0, int128 d1, int128 f0, int128 f1) = _modify(-int256(uint256(part)));
        (uint256 s0, uint256 s1) = _orient(uint256(uint128(d0 - f0)), uint256(uint128(d1 - f1)));
        outStock += s0;
        outUsdg += s1;
        pendingFee0 += uint128(f0);
        pendingFee1 += uint128(f1);
    }

    /// @dev Collects the trading fees (a zero-liquidity change) and mints the treasury its cut as shares, priced
    /// against assets net of the cut so the share price is unchanged by the mint.
    function _harvest(Snapshot memory s) internal returns (uint256 f0, uint256 f1) {
        (uint128 liq,,) = _pos();
        if (liq > 0) {
            (int128 d0, int128 d1,,) = _modify(0);
            f0 = uint256(uint128(d0));
            f1 = uint256(uint128(d1));
        }
        // fees an earlier closed-gate exit swept into the vault are harvested with these
        f0 += pendingFee0;
        f1 += pendingFee1;
        if (f0 == 0 && f1 == 0) return (0, 0);
        pendingFee0 = 0;
        pendingFee1 = 0;
        (uint256 fStock, uint256 fUsdg) = _orient(f0, f1);
        lifetimeFeesStock += uint128(fStock);
        lifetimeFeesUsdg += uint128(fUsdg);
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
        if (!positionOpen) return;
        (uint128 liq,,) = _pos();
        positionOpen = false;
        if (liq > 0) _modify(-int256(uint256(liq)));
    }

    function _openPosition(Snapshot memory s) internal {
        (int24 tl, int24 tu) =
            vaultMath.targetTicks(s.price, params.rangeBps, stockScale, usdgScale, stockIsToken0, tickSpacing);
        _deployInto(tl, tu, s);
    }

    /// @dev Adding to an open position pays its accrued fees into the vault, so they are harvested (treasury cut
    /// minted) first.
    function _deploy(Snapshot memory s) internal {
        if (!positionOpen) {
            _openPosition(s);
        } else {
            _harvest(s);
            _deployInto(tickLower, tickUpper, s);
        }
    }

    function _deployInto(int24 tl, int24 tu, Snapshot memory s) internal {
        if (!_balanceInventory(tl, tu, s)) return;
        (uint256 a0, uint256 a1) = _idle01();
        (uint160 spotNow,,,) = _slot0();
        // The liquidity is fitted here, from the spot price the add will see, so there is no quote-to-mint window
        // for a minimum to guard (the position manager in StockVault quotes at its own price): the add either
        // takes at most the idle balances or the settle transfer reverts.
        uint128 liq = vaultMathV4.fit(spotNow, tl, tu, a0, a1);
        if (liq == 0) return;
        if (!positionOpen) {
            positionOpen = true;
            tickLower = tl;
            tickUpper = tu;
        }
        _modify(int256(uint256(liq)));
    }

    function _balanceInventory(int24 tl, int24 tu, Snapshot memory s) internal returns (bool) {
        (uint256 a0, uint256 a1) = _idle01();
        (uint256 idleStock, uint256 idleUsdg) = _orient(a0, a1);
        if (idleUsdg + _stockToUsdg(idleStock, s.price) < usdgScale) return false;

        uint256 twapPrice = _sqrtToUsd(s.sqrtTwap);
        (bool zeroForOne, uint256 amountIn) = vaultMath.swapNeeded(s.sqrtSpot, tl, tu, a0, a1, swapFee());
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
        _unlock(Act(true, (address(tokenIn) == address(stock)) == stockIsToken0, 0, 0, -int256(amountIn)));
        out = tokenOut.balanceOf(address(this)) - before;
        if (out < minOut) revert SwapBelowMinimum(out, minOut);
    }

    function _isDust(uint256 usdgAmount) internal view returns (bool) {
        return usdgAmount < usdgScale / 100;
    }

    function _minOut(uint256 oracleValueOut) internal view returns (uint256) {
        return oracleValueOut * (1e6 - swapFee()) / 1e6 * (1e4 - params.slippageBps) / 1e4;
    }

    // ---------------------------------------------------------------- oracle

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

    function _nearTwap(Snapshot memory s) internal view returns (bool) {
        return !_deviates(s.sqrtSpot, s.sqrtTwap, maxSpotTwapBps);
    }

    function _requireTight() internal view returns (Snapshot memory s) {
        s = _requireHealthy();
        if (!_nearTwap(s)) revert SpotOffTwap();
    }

    function _requireDepositable() internal view returns (Snapshot memory s) {
        s = _requireHealthy();
        bool spotBelow = stockIsToken0 ? s.sqrtSpot < s.sqrtTwap : s.sqrtSpot > s.sqrtTwap;
        if (spotBelow && !_nearTwap(s)) revert SpotOffTwap();
    }

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
        (uint160 spot,,,) = _slot0();
        s.sqrtSpot = spot;
        bool twapOk;
        (twapOk, s.sqrtTwap) = oracle.twapSqrt(p.twapWindow);
        if (!twapOk) s.sqrtTwap = spot;

        if (_corporateActionWindow(p.twapWindow)) st = Status.CorporateAction;
        else if (block.timestamp - s.updatedAt > p.maxStaleness) st = Status.FeedStale;
        else if (!twapOk) st = Status.TwapUnavailable;
        else if (_deviates(s.sqrtTwap, s.sqrtOracle, p.maxDeviationBps)) st = Status.TwapDeviates;
        else if (_deviates(s.sqrtSpot, s.sqrtOracle, p.maxDeviationBps)) st = Status.SpotDeviates;
    }

    function _corporateActionWindow(uint32 twapWindow) private view returns (bool) {
        IStockToken8056 t = IStockToken8056(address(stock));
        try t.oraclePaused() returns (bool paused_) {
            if (paused_) return true;
        } catch {}
        try t.effectiveAt() returns (uint256 at) {
            uint256 now_ = block.timestamp;
            return at != 0 && (now_ < at ? at - now_ <= CORP_ACTION_LEAD : now_ - at <= CORP_ACTION_LAG + twapWindow);
        } catch {}
        return false;
    }

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
        if (positionOpen) {
            (uint128 liq, uint256 f0, uint256 f1) = _pos();
            (uint256 a0, uint256 a1) = vaultMath.amounts(s.sqrtTwap, tickLower, tickUpper, liq);
            (v.posStock, v.posUsdg) = _orient(a0, a1);
            (v.feeStock, v.feeUsdg) = _orient(f0, f1);
        }
        uint256 usdgTotal = v.idleUsdg + v.posUsdg + v.feeUsdg;
        v.gross = v.idleStock + v.posStock + v.feeStock + _usdgToStock(usdgTotal, px);
        // pending fees are already idle (in gross); only the treasury's cut of them is deducted
        (uint256 pStock, uint256 pUsdg) = _orient(pendingFee0, pendingFee1);
        uint256 feeValue = v.feeStock + pStock + _usdgToStock(v.feeUsdg + pUsdg, px);
        v.net = v.gross - feeValue * params.perfFeeBps / 1e4;
    }

    function _navPrice(Snapshot memory s) private view returns (uint256) {
        return Math.min(s.price, _sqrtToUsd(s.sqrtTwap));
    }

    function _depositNav() private view returns (uint256) {
        Snapshot memory s = _readLenient();
        return _valuationAt(s, Math.min(_navPrice(s), _sqrtToUsd(s.sqrtSpot))).net;
    }

    function previewDeposit(uint256 assets) public view override returns (uint256) {
        return (assets * (1e6 - entryFee) / 1e6).mulDiv(
            totalSupply() + 10 ** _decimalsOffset(), _depositNav() + 1, Math.Rounding.Floor
        );
    }

    function previewMint(uint256 shares) public view override returns (uint256) {
        return shares.mulDiv(_depositNav() + 1, totalSupply() + 10 ** _decimalsOffset(), Math.Rounding.Ceil).mulDiv(
            1e6, 1e6 - entryFee, Math.Rounding.Ceil
        );
    }

    /// @dev The position's liquidity and uncollected fees; zeros when no range is set.
    function _pos() internal view returns (uint128 liq, uint256 f0, uint256 f1) {
        if (!positionOpen) return (0, 0, 0);
        return vaultMathV4.position(poolManager, poolId, address(this), tickLower, tickUpper);
    }

    function _slot0() internal view returns (uint160 sqrtP, int24 tick, uint24 protocolFee, uint24 lpFee) {
        return poolManager.getSlot0(PoolId.wrap(poolId));
    }

    function _swapFeeOf(uint24 protocolFee, uint24 lpFee) private pure returns (uint24) {
        uint16 a = ProtocolFeeLibrary.getZeroForOneFee(protocolFee);
        uint16 b = ProtocolFeeLibrary.getOneForZeroFee(protocolFee);
        return ProtocolFeeLibrary.calculateSwapFee(a > b ? a : b, lpFee);
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
