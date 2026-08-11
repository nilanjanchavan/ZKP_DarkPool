import "dotenv/config";
import { ethers } from "ethers";
import { DEFAULT_NETWORK, getNetwork, ZERO_ADDRESS } from "./config/networks";

const CHAIN_ID = Number(process.env.CHAIN_ID || DEFAULT_NETWORK.chainId);
const network = getNetwork(CHAIN_ID);
if (!network) {
  throw new Error(`Unsupported CHAIN_ID ${CHAIN_ID}. Add it to config/networks.ts first.`);
}

const RPC_URL = network.RPC_URL;
const POOL_ADDRESS = network.POOL_ADDRESS;
const PERFORM_GAS_LIMIT = 3_000_000n;
const TICK_INTERVAL_MS = Number(process.env.MATCH_INTERVAL_MS || 60_000);
const MATCH_TOLERANCE_BPS = 100n; // 1%, mirrors the pool's MATCH_TOLERANCE constant

/**
 * Registered supported assets for the active network: token address ->
 * { symbol, Chainlink feed } (built from config/networks.ts).
 */
const TOKENS: Record<string, { symbol: string; feed: string }> = {};
for (const token of network.SUPPORTED_TOKENS) {
  TOKENS[token.tokenAddress.toLowerCase()] = { symbol: token.symbol, feed: token.chainlinkOracleAddress };
}

const POOL_ABI = [
  "function performUpkeep(bytes calldata performData) external",
  "function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData)",
  "function getTokenPrice(address token) external view returns (uint256)",
  "function orders(uint256) external view returns (uint256 id, address trader, address tokenIn, address tokenOut, uint256 amountIn, bool active)",
  "function ordersCount() external view returns (uint256)",
  "function automationRegistry() external view returns (address)",
];

const AGGREGATOR_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

interface Order {
  id: number;
  trader: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
}

const KNOWN_ERRORS: Record<string, string> = {};
for (const sig of [
  "OnlyAutomationRegistry()",
  "InvalidPrice()",
  "InvalidProof()",
  "ZeroAmount()",
  "SameToken()",
  "IncorrectEthValue()",
  "UnsupportedToken()",
  "EnforcedPause()",
]) {
  KNOWN_ERRORS[ethers.id(sig).slice(0, 10)] = sig;
}

function decodeRevertData(revertData: string): string {
  if (!revertData || revertData === "0x") return "(no revert data)";
  const sig = revertData.slice(0, 10);
  if (KNOWN_ERRORS[sig]) return KNOWN_ERRORS[sig];
  try {
    const parsed = new ethers.Interface(["error Error(string)"]).parseError(revertData);
    if (parsed) return `Error(${String(parsed.args[0])})`;
  } catch {
    /* fall through */
  }
  return `unknown selector ${sig}`;
}

function hexify(value: Uint8Array | string): string {
  return typeof value === "string" ? value : ethers.hexlify(value);
}

function stamp(): string {
  return new Date().toISOString();
}

/** Reads all registered orders from the pool (state view calls only). */
async function fetchActiveOrders(pool: ethers.Contract): Promise<Order[]> {
  const count = Number(await pool.ordersCount());
  const orders: Order[] = [];
  for (let i = 0; i < count; i++) {
    const o = await pool.orders(i);
    if (!o.active) continue;
    orders.push({
      id: Number(o.id),
      trader: String(o.trader).toLowerCase(),
      tokenIn: String(o.tokenIn).toLowerCase(),
      tokenOut: String(o.tokenOut).toLowerCase(),
      amountIn: o.amountIn,
    });
  }
  return orders;
}

/** Reads live USD prices (18-decimal) for every registered token from its feed. */
async function readPrices(provider: ethers.JsonRpcProvider): Promise<Record<string, bigint>> {
  const prices: Record<string, bigint> = {};
  for (const [token, { feed }] of Object.entries(TOKENS)) {
    const agg = new ethers.Contract(feed, AGGREGATOR_ABI, provider);
    const [, answer] = await agg.latestRoundData();
    if (answer <= 0n) throw new Error(`Non-positive answer from feed ${feed}`);
    prices[token.toLowerCase()] = BigInt(answer) * 10n ** 10n;
  }
  return prices;
}

/**
 * Pair discovery + valuation. Finds the first complementary pair
 * (A.tokenIn == B.tokenOut && A.tokenOut == B.tokenIn) whose USD values agree
 * within MATCH_TOLERANCE_BPS. Returns their order ids (a < b) or null.
 */
function findMatchablePair(orders: Order[], prices: Record<string, bigint>): { a: number; b: number } | null {
  for (let i = 0; i < orders.length; i++) {
    for (let j = i + 1; j < orders.length; j++) {
      const orderA = orders[i];
      const orderB = orders[j];
      if (orderA.trader === orderB.trader) continue;
      if (orderA.tokenIn === orderA.tokenOut) continue;
      if (orderA.tokenIn !== orderB.tokenOut) continue;
      if (orderA.tokenOut !== orderB.tokenIn) continue;

      const priceA = prices[orderA.tokenIn];
      const priceB = prices[orderB.tokenIn];
      if (priceA === undefined || priceB === undefined) continue;

      const valueA = (orderA.amountIn * priceA) / 10n ** 18n;
      const valueB = (orderB.amountIn * priceB) / 10n ** 18n;
      const diff = valueA > valueB ? valueA - valueB : valueB - valueA;
      const avg = (valueA + valueB) / 2n;
      const tolerance = avg * (MATCH_TOLERANCE_BPS * 10n ** 16n);
      if (diff * 10n ** 18n <= tolerance) return { a: orderA.id, b: orderB.id };
    }
  }
  return null;
}

async function executePair(
  pool: ethers.Contract,
  provider: ethers.JsonRpcProvider,
  caller: string,
  pair: { a: number; b: number }
): Promise<void> {
  // Dynamic encoding: the two complementary order ids are the performData.
  const performData = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [pair.a, pair.b]);

  console.log(`[${stamp()}] matchable pair: order ${pair.a} <-> order ${pair.b} (performData ${performData})`);

  const tx = await pool.performUpkeep(performData, { gasLimit: PERFORM_GAS_LIMIT });
  console.log(`[${stamp()}] performUpkeep broadcast: ${tx.hash}`);

  const receipt = await provider.waitForTransaction(tx.hash, 1, 120_000);
  if (!receipt) throw new Error("Transaction not mined within timeout");

  if (receipt.status === 1) {
    console.log(
      `[${stamp()}] performUpkeep SUCCESS: https://sepolia.etherscan.io/tx/${tx.hash} (block ${receipt.blockNumber})`
    );
  } else {
    const replay = await provider
      .call({ to: POOL_ADDRESS, from: caller, data: tx.data ?? "0x" })
      .catch((e: any) => e?.data ?? "0x");
    console.error(`[${stamp()}] performUpkeep REVERTED: ${decodeRevertData(replay)} (${tx.hash})`);
  }
}

/**
 * One matching cycle: reads orders + live prices, finds a value-balanced
 * complementary pair, and broadcasts performUpkeep with the encoded pair.
 * Never throws: errors are logged so the loop keeps ticking.
 */
async function tick(pool: ethers.Contract, provider: ethers.JsonRpcProvider, caller: string): Promise<void> {
  let orders: Order[];
  try {
    orders = await fetchActiveOrders(pool);
  } catch (err: any) {
    console.warn(`[${stamp()}] order fetch failed: ${err?.message ?? err}`);
    return;
  }

  let prices: Record<string, bigint>;
  try {
    prices = await readPrices(provider);
  } catch (err: any) {
    console.warn(`[${stamp()}] price read failed: ${err?.message ?? err}`);
    return;
  }

  const eth = prices[ZERO_ADDRESS.toLowerCase()];
  console.log(`[${stamp()}] ETH/USD ${eth ? ethers.formatUnits(eth, 18) : "n/a"} · ${orders.length} open orders`);

  const pair = findMatchablePair(orders, prices);
  if (!pair) {
    console.log(`[${stamp()}] no value-balanced complementary pair found`);
    return;
  }

  try {
    await executePair(pool, provider, caller, pair);
  } catch (err: any) {
    console.error(`[${stamp()}] tick failed: ${err?.message ?? err}`);
  }
}

async function main() {
  const rawKey = process.env.CRE_ETH_PRIVATE_KEY;
  if (!rawKey) throw new Error("CRE_ETH_PRIVATE_KEY is not set (add it to your cloud env vars)");
  const key = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
  if (!ethers.isHexString(key, 32)) {
    throw new Error("CRE_ETH_PRIVATE_KEY is not a valid 32-byte private key");
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(key, provider);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, wallet);

  console.log(`[${stamp()}] matcher starting · network ${network!.name} (chainId ${CHAIN_ID}) · pool ${POOL_ADDRESS} · wallet ${wallet.address}`);
  console.log(`[${stamp()}] balance ${ethers.formatEther(await provider.getBalance(wallet.address))} ETH`);
  console.log(`[${stamp()}] interval ${TICK_INTERVAL_MS / 1000}s`);

  const registry = await pool.automationRegistry();
  console.log(`[${stamp()}] automationRegistry ${registry}`);
  if (registry.toLowerCase() !== wallet.address.toLowerCase()) {
    console.warn(
      "[startup] WARNING: signer is NOT the pool automationRegistry — performUpkeep will revert with OnlyAutomationRegistry(). " +
        "Set CRE_ETH_PRIVATE_KEY to the wallet the pool was deployed with."
    );
  }

  let running = false;
  const cycle = async () => {
    if (running) return;
    running = true;
    try {
      await tick(pool, provider, wallet.address);
    } catch (err: any) {
      console.error(`[${stamp()}] cycle failed: ${err?.message ?? err}`);
    } finally {
      running = false;
    }
  };

  await cycle();
  setInterval(cycle, TICK_INTERVAL_MS);

  const shutdown = () => {
    console.log(`[${stamp()}] shutdown signal received, exiting`);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error("FAILED TO START:", error?.message ?? error);
  process.exit(1);
});
