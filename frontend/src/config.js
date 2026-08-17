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

// Merges the JSON written by scripts/deploy.cjs (chainId 31337, Hardhat
// localhost) onto the 31337 skeleton NetworkConfig. JSON values win at every
// level — top-level fields AND the nested SUPPORTED_TOKENS entries — so a
// deployed pool/mock feeds/mock LINK take effect without baking addresses into
// config/networks.ts. Tokens missing from the JSON keep their skeleton row but
// degrade to ZERO_ADDRESS, surfaced via console.warn (a zero oracle is exactly
// what produces "could not decode result data (value=0x)" against a non-feed).
export function buildLocalNetworkFromJson(data, baseNetwork) {
  const baseTokens = baseNetwork?.SUPPORTED_TOKENS ?? [];
  const jsonTokens = Array.isArray(data.tokens) ? data.tokens : [];

  let tokens = jsonTokens.map((t) => ({
    symbol: t.symbol,
    tokenAddress: safeAddress(t.address) ?? ZERO_ADDRESS,
    decimals: Number(t.decimals ?? 18),
    chainlinkOracleAddress: safeAddress(t.oracle) ?? ZERO_ADDRESS,
  }));
  if (tokens.length === 0) {
    // Nothing usable in the JSON — keep the skeleton rows so the network is at
    // least structurally valid, and say why.
    tokens = baseTokens;
    console.warn("[local] local-addresses.json has no tokens — keeping skeleton rows.");
  }
  for (const t of tokens) {
    if (t.chainlinkOracleAddress === ZERO_ADDRESS) {
      console.warn(
        `[local] token "${t.symbol}" resolved with ZERO oracle address; ` +
          "latestRoundData() will be called on the zero address. Run scripts/deploy.cjs to write real mock feed addresses."
      );
    }
  }

  return {
    chainId: Number(data.chainId ?? baseNetwork?.chainId ?? 31337),
    name: data.name ?? baseNetwork?.name ?? "Hardhat Local",
    POOL_ADDRESS: safeAddress(data.poolAddress) ?? baseNetwork?.POOL_ADDRESS ?? ZERO_ADDRESS,
    RPC_URL: data.rpcUrl ?? baseNetwork?.RPC_URL ?? "http://127.0.0.1:8545",
    EXPLORER_URL: data.explorerUrl ?? baseNetwork?.EXPLORER_URL ?? "http://127.0.0.1:8545",
    POOL_FROM_BLOCK: Number(data.poolFromBlock ?? baseNetwork?.POOL_FROM_BLOCK ?? 0),
    SUPPORTED_TOKENS: tokens,
  };
}

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
