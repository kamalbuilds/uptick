// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UptickShareOracle, IUptickVault, IVaultFactory, IOracleDeployer} from "./UptickShareOracle.sol";

/// @title UptickShareOracleFactory
/// @notice The only way to deploy an `UptickShareOracle`, and the registry a lender checks before supplying to a market
/// whose oracle claims to price an Uptick vault share.
///
/// The production `VaultFactory` is fixed at construction (`factory()`). `createOracle(vault)` requires
/// `factory.isVault(vault)`, then deploys the vault's oracle with CREATE2 salted by the vault, so there is exactly one
/// oracle per vault and its address is known before it exists (`oracleAddress`). Nobody chooses a parameter: whoever
/// calls `createOracle` for a vault gets the same oracle at the same address, and a second call returns it unchanged,
/// so deploying an oracle before the vault's owner does, or front-running the owner's deploy, changes nothing.
///
/// Verifying a market: `oracleFactory.isOracle(oracle)` (the oracle factory address is published with the
/// VaultFactory) and `UptickShareOracle(oracle).factory() == the real VaultFactory`. A contract that imitates this
/// factory can deploy an oracle against any registry it likes, but that oracle is not in this contract's `isOracle`.
/// No owner, no setters, no funds.
contract UptickShareOracleFactory is IOracleDeployer {
    /// @notice The production VaultFactory every oracle this factory deploys is checked against.
    IVaultFactory public immutable factory;

    /// @notice True for every oracle this contract deployed, false for anything else.
    mapping(address oracle => bool) public isOracle;
    /// @notice The oracle of a vault, or zero when none was deployed yet.
    mapping(address vault => address) public oracleOf;

    /// @dev The vault whose oracle is being constructed; read back by the oracle's constructor through `deployParams`.
    address private _deploying;

    event OracleCreated(address indexed vault, address indexed oracle);

    error NotRegisteredVault();

    constructor(IVaultFactory factory_) {
        factory = factory_;
    }

    /// @notice Deploys the oracle of `vault` and records it, or returns the one already deployed.
    function createOracle(IUptickVault vault) external returns (address oracle) {
        if (!factory.isVault(address(vault))) revert NotRegisteredVault();
        oracle = oracleOf[address(vault)];
        if (oracle != address(0)) return oracle;
        _deploying = address(vault);
        oracle = address(new UptickShareOracle{salt: _salt(address(vault))}());
        _deploying = address(0);
        isOracle[oracle] = true;
        oracleOf[address(vault)] = oracle;
        emit OracleCreated(address(vault), oracle);
    }

    /// @notice The address `createOracle(vault)` deploys to, whether or not it exists yet.
    function oracleAddress(address vault) external view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(vault), keccak256(type(UptickShareOracle).creationCode)));
        return address(uint160(uint256(h)));
    }

    /// @inheritdoc IOracleDeployer
    function deployParams() external view returns (IVaultFactory, IUptickVault) {
        return (factory, IUptickVault(_deploying));
    }

    function _salt(address vault) private pure returns (bytes32) {
        return bytes32(uint256(uint160(vault)));
    }
}
