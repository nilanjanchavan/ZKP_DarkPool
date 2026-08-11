// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title DarkPoolAutomationAdapter
 * @notice IReceiver-compatible bridge between a CRE workflow and the ZKDarkPool.
 * @dev A CRE workflow writes a signed report via evmClient.writeReport(); the
 *      report is delivered by the chain's KeystoneForwarder to this contract's
 *      onReport() (the forwarder performs the DON signature verification).
 *
 *      The report payload is the full ABI-encoded performUpkeep(bytes) call
 *      data produced by the workflow with viem's encodeFunctionData(). We relay
 *      it to the pool with a low-level call, then emit the forwarded performData.
 *
 *      Set the pool's automationRegistry to this contract so the
 *      onlyAutomationRegistry guard in performUpkeep passes:
 *          pool.setAutomationRegistry(address(this))
 */
contract DarkPoolAutomationAdapter is IERC165 {
    address public immutable forwarder;
    address public immutable pool;

    event PerformUpkeepForwarded(address indexed pool, bytes performData);

    error OnlyForwarder();
    error ZeroAddress();
    error PerformUpkeepFailed();

    constructor(address _forwarderAddress, address _pool) {
        if (_forwarderAddress == address(0) || _pool == address(0)) revert ZeroAddress();
        forwarder = _forwarderAddress;
        pool = _pool;
    }

    function onReport(bytes calldata, bytes calldata report) external {
        if (msg.sender != forwarder) revert OnlyForwarder();

        (bool ok, bytes memory returndata) = pool.call(report);
        if (!ok) {
            if (returndata.length > 0) {
                assembly {
                    revert(add(returndata, 0x20), mload(returndata))
                }
            }
            revert PerformUpkeepFailed();
        }

        // report is performUpkeep(bytes) call data; the arg lives after the 4-byte selector.
        bytes memory performData = abi.decode(report[4:], (bytes));
        emit PerformUpkeepForwarded(pool, performData);
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC165).interfaceId;
    }
}