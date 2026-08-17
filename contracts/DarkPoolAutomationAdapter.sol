// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IReceiver - receives keystone reports
/// @notice Mirrors the chainlink-evm IReceiver exactly:
///         github.com/smartcontractkit/chainlink-evm/blob/main/contracts/cre/src/v1/interfaces/IReceiver.sol
/// @dev The KeystoneForwarder checks this interface via ERC165 before delivery
///      (`ERC165Checker.supportsInterface(receiver, type(IReceiver).interfaceId)`),
///      so implementations MUST return true for type(IReceiver).interfaceId. An
///      adapter that only claims IERC165 is rejected as `invalidReceiver` and
///      reports are never delivered (verified live on Sepolia).
interface IReceiver is IERC165 {
  /// @notice Handles incoming keystone reports.
  /// @param metadata Report's metadata.
  /// @param report Workflow report.
  function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title Minimal ZKDarkPool surface used by the adapter.
interface IZKDarkPool {
  function performUpkeep(bytes calldata performData) external;
}

/**
 * @title DarkPoolAutomationAdapter
 * @notice IReceiver-compatible bridge between a CRE workflow and the ZKDarkPool.
 * @dev A CRE workflow writes a signed report via evmClient.writeReport(); the
 *      report is delivered by the chain's KeystoneForwarder to this contract's
 *      onReport() (the forwarder performs the DON signature verification and
 *      only calls this function, so msg.sender == forwarder is a trusted check).
 *
 *      The report payload is the full ABI-encoded performUpkeep(bytes) call
 *      data produced by the workflow with viem's encodeFunctionData() in
 *      workflows/darkpool-matcher/main.ts. We decode the performData argument
 *      and relay it to the pool, then emit the forwarded performData.
 *
 *      Set the pool's automationRegistry to this contract so the
 *      onlyAutomationRegistry guard in performUpkeep passes:
 *          pool.setAutomationRegistry(address(this))
 */
contract DarkPoolAutomationAdapter is IReceiver {
    address public immutable forwarder;
    address public immutable pool;

    event PerformUpkeepForwarded(address pool, bytes performData);

    error OnlyForwarder();
    error ZeroAddress();

    constructor(address _forwarderAddress, address _pool) {
        if (_forwarderAddress == address(0) || _pool == address(0)) revert ZeroAddress();
        forwarder = _forwarderAddress;
        pool = _pool;
    }

    function onReport(bytes calldata /* metadata */, bytes calldata report) external override {
        // Security-critical: only the real forwarder may deliver reports. The
        // KeystoneForwarder (production) and MockKeystoneForwarder (broadcast)
        // both call this function after validating the DON signature.
        if (msg.sender != forwarder) revert OnlyForwarder();

        // report is performUpkeep(bytes) call data; the arg lives after the
        // 4-byte selector as a single ABI-encoded `bytes`.
        bytes memory performData = abi.decode(report[4:], (bytes));

        IZKDarkPool(pool).performUpkeep(performData);

        emit PerformUpkeepForwarded(pool, performData);
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}