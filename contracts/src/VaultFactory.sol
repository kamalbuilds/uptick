// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

import {StockVault} from "./StockVault.sol";
import {StockVaultV4} from "./v4/StockVaultV4.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3.sol";

interface IFeedDescription {
    function description() external view returns (string memory);
}

/// @title VaultFactory
/// @notice Deploys one StockVault per (Stock Token, pool, Chainlink feed), or one StockVaultV4 per (Stock Token,
/// Uniswap v4 pool, Chainlink feed), and keeps the registry the app and the keeper read. The factory pins the keccak256
/// of each creation code, so the only contracts it can ever register are the audited builds. `isVault` covers both
/// types: it is the one registry UptickRouter checks.
/// @dev StockVault's runtime is 24,504 bytes and its creation code 36,068, so a factory cannot embed it. The owner
/// passes the creation code with each call; the factory checks it against `vaultCodeHash`, appends the constructor
/// arguments itself and deploys with CREATE2. Pin the hash with
/// `forge inspect StockVault bytecode | cast keccak`.
contract VaultFactory is Ownable2Step {
    /// @notice Everything a new vault is configured with except its Stock Token, pool, feed and cap.
    struct Defaults {
        address usdg;
        address positionManager;
        address router;
        address vaultOwner; // multisig that owns every vault
        address keeper;
        address treasury;
        StockVault.Params params;
    }

    struct Entry {
        address stock;
        address pool;
        address feed;
        address vault;
        uint24 feeTier;
    }

    bytes32 public immutable vaultCodeHash;
    /// @notice The pinned creation-code hash of StockVaultV4; zero means this factory creates v3 vaults only.
    bytes32 public immutable vaultV4CodeHash;
    /// @notice The Uniswap v4 PoolManager every StockVaultV4 this factory creates trades and holds liquidity in.
    address public immutable poolManager;

    struct EntryV4 {
        address stock;
        bytes32 poolId;
        address feed;
        address vault;
        uint24 feeTier;
    }

    EntryV4[] private _entriesV4;
    /// @notice stock => v4 poolId => vault. Zero when none exists.
    mapping(address => mapping(bytes32 => address)) public vaultOfV4;
    /// @notice Hooks a v4 pool may carry. The vault refuses any hook whose address permissions can take value or block
    /// an exit; this list is the owner's review of the rest. The zero address (no hook) needs no entry.
    mapping(address => bool) public allowedHook;

    Defaults private _defaults;
    Entry[] private _entries;

    /// @notice stock => pool => vault. Zero when none exists.
    mapping(address => mapping(address => address)) public vaultOf;
    mapping(address => address[]) private _vaultsOfStock;
    mapping(address => bool) public isVault;

    event VaultCreated(
        address indexed stock, address indexed pool, address indexed vault, address feed, uint24 feeTier, uint256 index
    );
    event VaultCreatedV4(
        address indexed stock, bytes32 indexed poolId, address indexed vault, address feed, uint24 feeTier, uint256 index
    );
    event HookAllowed(address indexed hook, bool allowed);
    event DefaultsSet(address vaultOwner, address keeper, address treasury);

    error WrongCreationCode();
    error VaultExists(address vault);
    error DeployFailed();
    error ZeroAddress();
    error OutOfRange();
    error BadFeed(address feed);
    error V4Disabled();
    error HookNotAllowed(address hook);

    constructor(
        address factoryOwner,
        bytes32 vaultCodeHash_,
        bytes32 vaultV4CodeHash_,
        address poolManager_,
        Defaults memory d
    ) Ownable(factoryOwner) {
        if (vaultV4CodeHash_ != bytes32(0) && poolManager_ == address(0)) revert ZeroAddress();
        _setDefaults(d);
        vaultCodeHash = vaultCodeHash_;
        vaultV4CodeHash = vaultV4CodeHash_;
        poolManager = poolManager_;
    }

    /// @notice Allows or revokes a hook for vaults created from now on. Existing vaults are untouched.
    function setHookAllowed(address hook, bool allowed) external onlyOwner {
        allowedHook[hook] = allowed;
        emit HookAllowed(hook, allowed);
    }

    // ---------------------------------------------------------------- admin

    /// @notice Applies to vaults created from now on. Existing vaults are untouched.
    function setDefaults(Defaults calldata d) external onlyOwner {
        _setDefaults(d);
    }

    function _setDefaults(Defaults memory d) private {
        if (
            d.usdg == address(0) || d.positionManager == address(0) || d.router == address(0)
                || d.vaultOwner == address(0) || d.treasury == address(0)
        ) revert ZeroAddress();
        _defaults = d;
        emit DefaultsSet(d.vaultOwner, d.keeper, d.treasury);
    }

    /// @notice Deploys the vault for `stock` on `pool` priced by `feed`. StockVault's constructor validates the
    /// pool against the Stock Token, USDG and the position manager's own factory, and the params against its bounds.
    /// @param creationCode StockVault's creation code (without constructor arguments); must hash to `vaultCodeHash`.
    /// @param depositCap in Stock Token units, 0 means uncapped.
    function createVault(bytes calldata creationCode, address stock, address pool, address feed, uint256 depositCap)
        external
        onlyOwner
        returns (address vault)
    {
        if (keccak256(creationCode) != vaultCodeHash) revert WrongCreationCode();
        address existing = vaultOf[stock][pool];
        if (existing != address(0)) revert VaultExists(existing);

        Defaults memory d = _defaults;
        string memory sym = IERC20Metadata(stock).symbol();
        _requireFeedFor(feed, sym);
        bytes memory initcode = bytes.concat(
            creationCode,
            abi.encode(
                StockVault.Config({
                    stock: stock,
                    usdg: d.usdg,
                    pool: pool,
                    positionManager: d.positionManager,
                    router: d.router,
                    feed: feed,
                    owner: d.vaultOwner,
                    keeper: d.keeper,
                    treasury: d.treasury,
                    depositCap: depositCap
                }),
                d.params,
                string.concat("Stock Vault ", sym),
                string.concat("sv", sym)
            )
        );
        bytes32 salt = keccak256(abi.encode(stock, pool, feed));
        assembly ("memory-safe") {
            vault := create2(0, add(initcode, 0x20), mload(initcode), salt)
            if iszero(vault) {
                // bubble StockVault's own revert (BadConfig, BadParams, ...)
                let size := returndatasize()
                if size {
                    let ptr := mload(0x40)
                    returndatacopy(ptr, 0, size)
                    revert(ptr, size)
                }
            }
        }
        if (vault == address(0)) revert DeployFailed();

        uint24 fee = IUniswapV3Pool(pool).fee();
        vaultOf[stock][pool] = vault;
        isVault[vault] = true;
        _vaultsOfStock[stock].push(vault);
        _entries.push(Entry(stock, pool, feed, vault, fee));
        emit VaultCreated(stock, pool, vault, feed, fee, _entries.length - 1);
    }

    /// @notice Deploys the StockVaultV4 for `stock` on the Uniswap v4 pool (stock, USDG, `fee`, `tickSpacing`, `hooks`)
    /// priced by `feed`. StockVaultV4's constructor validates the pool key (static fee, hook permissions, pool
    /// initialised) and the params against its bounds; the factory adds the hook allow-list and the feed check.
    /// @param creationCode StockVaultV4's creation code (without constructor arguments); must hash to `vaultV4CodeHash`.
    /// @param depositCap in Stock Token units, 0 means uncapped.
    function createVaultV4(
        bytes calldata creationCode,
        address stock,
        uint24 fee,
        int24 tickSpacing,
        address hooks,
        address feed,
        uint256 depositCap
    ) external onlyOwner returns (address vault) {
        if (vaultV4CodeHash == bytes32(0)) revert V4Disabled();
        if (keccak256(creationCode) != vaultV4CodeHash) revert WrongCreationCode();
        if (hooks != address(0) && !allowedHook[hooks]) revert HookNotAllowed(hooks);

        Defaults memory d = _defaults;
        bytes32 poolId = _poolId(stock, d.usdg, fee, tickSpacing, hooks);
        address existing = vaultOfV4[stock][poolId];
        if (existing != address(0)) revert VaultExists(existing);
        string memory sym = IERC20Metadata(stock).symbol();
        _requireFeedFor(feed, sym);
        bytes memory initcode = bytes.concat(
            creationCode,
            abi.encode(
                StockVaultV4.Config({
                    stock: stock,
                    usdg: d.usdg,
                    poolManager: poolManager,
                    hooks: hooks,
                    feed: feed,
                    owner: d.vaultOwner,
                    keeper: d.keeper,
                    treasury: d.treasury,
                    depositCap: depositCap,
                    fee: fee,
                    tickSpacing: tickSpacing
                }),
                StockVaultV4.Params({
                    rangeBps: d.params.rangeBps,
                    perfFeeBps: d.params.perfFeeBps,
                    maxDeviationBps: d.params.maxDeviationBps,
                    slippageBps: d.params.slippageBps,
                    exitBufferBps: d.params.exitBufferBps,
                    maxStaleness: d.params.maxStaleness,
                    twapWindow: d.params.twapWindow,
                    minRebalanceInterval: d.params.minRebalanceInterval
                }),
                string.concat("Stock Vault ", sym),
                string.concat("sv", sym)
            )
        );
        bytes32 salt = keccak256(abi.encode(stock, poolId, feed));
        assembly ("memory-safe") {
            vault := create2(0, add(initcode, 0x20), mload(initcode), salt)
            if iszero(vault) {
                let size := returndatasize()
                if size {
                    let ptr := mload(0x40)
                    returndatacopy(ptr, 0, size)
                    revert(ptr, size)
                }
            }
        }
        if (vault == address(0)) revert DeployFailed();
        // the vault derived the same pool id the factory registers it under
        if (StockVaultV4(vault).poolId() != poolId) revert DeployFailed();

        vaultOfV4[stock][poolId] = vault;
        isVault[vault] = true;
        _vaultsOfStock[stock].push(vault);
        _entriesV4.push(EntryV4(stock, poolId, feed, vault, fee));
        emit VaultCreatedV4(stock, poolId, vault, feed, fee, _entriesV4.length - 1);
    }

    function _poolId(address stock, address usdg, uint24 fee, int24 tickSpacing, address hooks)
        private
        pure
        returns (bytes32)
    {
        bool s0 = stock < usdg;
        PoolKey memory k = PoolKey(
            Currency.wrap(s0 ? stock : usdg), Currency.wrap(s0 ? usdg : stock), fee, tickSpacing, IHooks(hooks)
        );
        return keccak256(abi.encode(k));
    }

    /// @dev The feed's description must end with "<symbol> / USD" ("Robinhood NVDA / USD", "RHNVDA / USD" on the
    /// deployed Chainlink proxies), so a feed of another ticker, or one with no description, cannot be wired in.
    function _requireFeedFor(address feed, string memory sym) private view {
        if (feed.code.length == 0) revert BadFeed(feed);
        bytes memory tail = bytes(string.concat(sym, " / USD"));
        try IFeedDescription(feed).description() returns (string memory d) {
            bytes memory b = bytes(d);
            if (b.length >= tail.length) {
                uint256 off = b.length - tail.length;
                uint256 i;
                while (i < tail.length && b[off + i] == tail[i]) ++i;
                if (i == tail.length) return;
            }
        } catch {}
        revert BadFeed(feed);
    }

    // ------------------------------------------------------------- registry

    function defaults() external view returns (Defaults memory) {
        return _defaults;
    }

    function vaultCountV4() external view returns (uint256) {
        return _entriesV4.length;
    }

    function entryAtV4(uint256 index) external view returns (EntryV4 memory) {
        if (index >= _entriesV4.length) revert OutOfRange();
        return _entriesV4[index];
    }

    /// @notice Registry page of the v4 vaults: `limit` entries from `offset`, fewer at the end.
    function entriesV4(uint256 offset, uint256 limit) external view returns (EntryV4[] memory page) {
        uint256 n = _entriesV4.length;
        if (offset >= n) return page;
        uint256 end = limit > n - offset ? n : offset + limit;
        page = new EntryV4[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            page[i - offset] = _entriesV4[i];
        }
    }

    function vaultCount() external view returns (uint256) {
        return _entries.length;
    }

    function entryAt(uint256 index) external view returns (Entry memory) {
        if (index >= _entries.length) revert OutOfRange();
        return _entries[index];
    }

    /// @notice Registry page: `limit` entries from `offset`, fewer at the end.
    function entries(uint256 offset, uint256 limit) external view returns (Entry[] memory page) {
        uint256 n = _entries.length;
        if (offset >= n) return page;
        uint256 end = limit > n - offset ? n : offset + limit;
        page = new Entry[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            page[i - offset] = _entries[i];
        }
    }

    /// @notice Every vault on one Stock Token, one per pool.
    function vaultsOfStock(address stock) external view returns (address[] memory) {
        return _vaultsOfStock[stock];
    }
}
