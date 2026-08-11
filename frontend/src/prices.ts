import { Contract, JsonRpcProvider } from "ethers";
import { safeAddress, ZERO_ADDRESS } from "./config";
import type { NetworkConfig, NetworkToken } from "../../config/networks";

// Chainlink AggregatorV3Interface — the live answer is read straight from each
// token's data feed so prices don't depend on the (possibly stale) pool
// contract's getTokenPrice().
export const AGGREGATOR_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)",
];

// Sepolia price-feed fallbacks, used when a token has no oracle configured in
// config/networks.ts. Lowercase so Ethers v6 never rejects them.
export const SEPOLIA_ORACLE_FALLBACK: Record<string, string> = {
  ETH: "0x694aa1769357215de4fac081bf1f309adc325306", // ETH / USD
  LINK: "0xc59e3633baac79493d908e63626716e204a45edf", // LINK / USD
};

export function oracleFor(token: NetworkToken, network: NetworkConfig): string {
  const configured = token.chainlinkOracleAddress;
  if (configured && configured !== ZERO_ADDRESS) return configured;
  if (network.chainId === 11155111) return SEPOLIA_ORACLE_FALLBACK[token.symbol] ?? ZERO_ADDRESS;
  return ZERO_ADDRESS;
}

// Reads latestRoundData() for a token and normalizes the answer to 18 decimals
// (the pool's getTokenPrice convention). Throws with the exact reason on any
// failure so the UI can surface it instead of hanging on "Loading prices…".
export async function fetchTokenPrice(
  provider: JsonRpcProvider,
  token: NetworkToken,
  network: NetworkConfig
): Promise<bigint> {
  const feedAddress = safeAddress(oracleFor(token, network));
  if (!feedAddress) {
    throw new Error(`No Chainlink oracle configured for ${token.symbol}`);
  }
  const feed = new Contract(feedAddress, AGGREGATOR_ABI, provider);
  const [roundData, decimals] = await Promise.all([feed.latestRoundData(), feed.decimals()]);
  const answer = roundData.answer;
  const decimalsNum = Number(decimals);
  if (answer <= 0n) throw new Error(`Non-positive ${token.symbol}/USD answer: ${answer}`);
  if (decimalsNum <= 0 || decimalsNum > 18) throw new Error(`Unexpected ${token.symbol}/USD feed decimals: ${decimalsNum}`);
  return answer * 10n ** BigInt(18 - decimalsNum);
}
