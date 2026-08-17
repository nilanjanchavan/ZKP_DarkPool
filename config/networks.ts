/**
 * Central multi-network configuration for the ZKDarkPool stack.
 *
 * Every supported chain defines the pool deployment, an RPC endpoint, an
 * explorer, and the tokens tradable on it — each with its Chainlink price-feed
 * oracle. The frontend, off-chain matcher (run-matcher.ts) and the deployment
 * script all read from here so a network can be added in one place.
 */

export interface NetworkToken {
  symbol: string;
  tokenAddress: string;
  decimals: number;
  chainlinkOracleAddress: string;
}

export interface NetworkConfig {
  chainId: number;
  name: string;
  POOL_ADDRESS: string;
  RPC_URL: string;
  EXPLORER_URL: string;
  /** Pool deployment block; used to bound event-log queries (set after deploy). */
  POOL_FROM_BLOCK: number;
  SUPPORTED_TOKENS: NetworkToken[];
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const NETWORKS: Record<number, NetworkConfig> = {
  // Ethereum Mainnet
  1: {
    chainId: 1,
    name: "Ethereum Mainnet",
    POOL_ADDRESS: "0x0000000000000000000000000000000000000000", // TODO: deploy, then set
    RPC_URL: "https://eth.llamarpc.com",
    EXPLORER_URL: "https://etherscan.io",
    POOL_FROM_BLOCK: 0, // TODO: set to the deployment block after deploy
    SUPPORTED_TOKENS: [
      {
        symbol: "ETH",
        tokenAddress: ZERO_ADDRESS,
        decimals: 18,
        chainlinkOracleAddress: "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419", // ETH/USD
      },
      {
        symbol: "LINK",
        tokenAddress: "0x514910771af9ca656af840dff83e8264ecf986ca",
        decimals: 18,
        chainlinkOracleAddress: "0x2c1d072e956affc0d435cb7ac38ef18d24d9127c", // LINK/USD
      },
      {
        symbol: "USDC",
        tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        decimals: 6,
        chainlinkOracleAddress: "0x8fffffd4afb6115b954bd326cbe7b4ba576818f6", // USDC/USD
      },
    ],
  },

  // Arbitrum One
  42161: {
    chainId: 42161,
    name: "Arbitrum One",
    POOL_ADDRESS: "0x0000000000000000000000000000000000000000", // TODO: deploy, then set
    RPC_URL: "https://arb1.arbitrum.io/rpc",
    EXPLORER_URL: "https://arbiscan.io",
    POOL_FROM_BLOCK: 0, // TODO: set to the deployment block after deploy
    SUPPORTED_TOKENS: [
      {
        symbol: "ETH",
        tokenAddress: ZERO_ADDRESS,
        decimals: 18,
        chainlinkOracleAddress: "0x639fe6ab55c921f74e7fac1ee960c0b6293ba612", // ETH/USD
      },
      {
        symbol: "LINK",
        tokenAddress: "0xf97f4df75117a78c1a5a0dbb814ab92458339f9d",
        decimals: 18,
        chainlinkOracleAddress: "0x86e53cf1b870786351da77a57575e0cb0d4c21b3", // LINK/USD
      },
      {
        symbol: "ARB",
        tokenAddress: "0x912ce59144191c1204e64559fe8253a0e49e6548",
        decimals: 18,
        chainlinkOracleAddress: "0xb2a824043730fe05f3da2efafa1cbbe83fa548d6", // ARB/USD
      },
    ],
  },

  // Sepolia Testnet
  11155111: {
    chainId: 11155111,
    name: "Sepolia Testnet",
    POOL_ADDRESS: "0xBBbF96F31CFaa790F9Bb11D7729df61eDbc40092", // demo deploy (unguarded performUpkeep), 2026-08-17
    RPC_URL: "https://ethereum-sepolia-rpc.publicnode.com",
    EXPLORER_URL: "https://sepolia.etherscan.io",
    POOL_FROM_BLOCK: 11508216,
    SUPPORTED_TOKENS: [
      {
        symbol: "ETH",
        tokenAddress: ZERO_ADDRESS,
        decimals: 18,
        chainlinkOracleAddress: "0x694aa1769357215de4fac081bf1f309adc325306", // ETH/USD
      },
      {
        symbol: "LINK",
        tokenAddress: "0x779877a7b0d9e8603169ddbd7836e478b4624789",
        decimals: 18,
        chainlinkOracleAddress: "0xc59e3633baac79493d908e63626716e204a45edf", // LINK/USD
      },
    ],
  },
};

/** Returns the network config for a chain id (string or number), or undefined. */
export function getNetwork(chainId: number | string): NetworkConfig | undefined {
  return NETWORKS[Number(chainId)];
}

export const DEFAULT_NETWORK: NetworkConfig = NETWORKS[11155111];

export function isNativeToken(token: NetworkToken): boolean {
  return token.tokenAddress === ZERO_ADDRESS;
}
