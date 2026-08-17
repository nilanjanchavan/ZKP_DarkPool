// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Re-exports Chainlink's MockV3Aggregator so that Hardhat compiles it as part
// of the project's source graph. Without this import there is no artifact for
// `@chainlink/contracts/src/v0.8/shared/mocks/MockV3Aggregator.sol`, so
// getContractFactory("...MockV3Aggregator") fails on any chain that needs a
// local price feed (chainId 31337 Hardhat localhost).
import "@chainlink/contracts/src/v0.8/shared/mocks/MockV3Aggregator.sol";