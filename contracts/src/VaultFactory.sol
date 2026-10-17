// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {StockVault} from "./StockVault.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3.sol";

/// @title VaultFactory
/// @notice Deploys one StockVault per (Stock Token, pool, Chainlink feed) and keeps the registry the app and the
/// keeper read. The factory pins the keccak256 of StockVault's creation code, so the only contract it can ever
/// register is the audited build.
/// @dev StockVault's runtime is 24,132 bytes and its creation code 28,511, so a factory cannot embed it. The owner
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

    Defaults private _defaults;
    Entry[] private _entries;

    /// @notice stock => pool => vault. Zero when none exists.
    mapping(address => mapping(address => address)) public vaultOf;
    mapping(address => address[]) private _vaultsOfStock;
    mapping(address => bool) public isVault;

    event VaultCreated(
        address indexed stock, address indexed pool, address indexed vault, address feed, uint24 feeTier, uint256 index
    );
    event DefaultsSet(address vaultOwner, address keeper, address treasury);

    error WrongCreationCode();
    error VaultExists(address vault);
    error DeployFailed();
    error ZeroAddress();
    error OutOfRange();

    constructor(address factoryOwner, bytes32 vaultCodeHash_, Defaults memory d) Ownable(factoryOwner) {
        _setDefaults(d);
        vaultCodeHash = vaultCodeHash_;
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

    // ------------------------------------------------------------- registry

    function defaults() external view returns (Defaults memory) {
        return _defaults;
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
