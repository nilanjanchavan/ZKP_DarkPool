// Frontend contract ABIs + re-exports from the shared multi-network config
// (config/networks.ts). Network-specific values (pool, RPC, tokens, oracles)
// live in that shared module.

import { getAddress } from "ethers";
import { DEFAULT_NETWORK, NETWORKS, ZERO_ADDRESS, getNetwork, isNativeToken } from "../../config/networks";

export { DEFAULT_NETWORK, NETWORKS, ZERO_ADDRESS, getNetwork, isNativeToken };

// Normalizes any address to its canonical EIP-55 checksummed form, which Ethers
// v6 always accepts (a lowercased input can never fail checksum validation).
// Returns null when the value is missing or not a valid 40-hex address, so
// callers can fail gracefully instead of letting `new ethers.Contract(...)`
// throw INVALID_ARGUMENT.
export function safeAddress(value) {
  if (!value) return null;
  const s = String(value).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(s)) return null;
  try {
    return getAddress(s);
  } catch {
    return null;
  }
}

export const NATIVE_ADDRESS = ZERO_ADDRESS;

export const ZK_POOL_ABI = [
  "function getLatestPrice() external view returns (uint256)",
  "function getTokenPrice(address token) external view returns (uint256)",
  "function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData)",
  "function performUpkeep(bytes calldata performData) external",
  "function submitOrder(bytes proof, uint256 nullifier, address tokenIn, address tokenOut, uint256 amountIn) payable returns (uint256)",
  "function orders(uint256) external view returns (uint256 id, address trader, address tokenIn, address tokenOut, uint256 amountIn, bool active)",
  "function ordersCount() external view returns (uint256)",
  "function automationRegistry() external view returns (address)",
  "function priceFeeds(address) external view returns (address)",
  "event OrderSubmitted(uint256 indexed orderId, address indexed trader, uint256 nullifier, address tokenIn, address tokenOut, uint256 amountIn)",
  "event OrderExecuted(uint256 indexed orderId, address indexed trader, uint256 amountIn, uint256 fillPriceUSD)",
  "event OrderMatched(uint256 indexed orderAId, uint256 indexed orderBId, uint256 priceA, uint256 priceB)",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];
