// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Write-once registry of declared maximum takes. A hook registers itself from its own
/// constructor, so msg.sender is the hook address and cannot be spoofed by a third party.
/// The cap is a declaration, not an attestation: anyone reading it must also check the hook's
/// bytecode inherits CappedTakeHook (see FINDINGS.md, caveat on registry trust).
contract CapRegistry {
    struct Entry {
        uint16 maxTakeBps;
        uint48 registeredAt;
    }

    mapping(address hook => Entry) private _entries;

    event Registered(address indexed hook, uint16 maxTakeBps);

    error AlreadyRegistered(address hook);
    error CapAboveFullSwap(uint16 maxTakeBps);

    function register(uint16 maxTakeBps) external {
        if (_entries[msg.sender].registeredAt != 0) revert AlreadyRegistered(msg.sender);
        if (maxTakeBps > 10_000) revert CapAboveFullSwap(maxTakeBps);
        _entries[msg.sender] = Entry(maxTakeBps, uint48(block.timestamp));
        emit Registered(msg.sender, maxTakeBps);
    }

    function capOf(address hook) external view returns (uint16 maxTakeBps, bool registered) {
        Entry memory e = _entries[hook];
        return (e.maxTakeBps, e.registeredAt != 0);
    }
}
