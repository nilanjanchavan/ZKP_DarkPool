require("ts-node/register");
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { getNetwork, ZERO_ADDRESS } = require("../config/networks");

const LOCAL_CHAIN_ID = 31337;

/** Scales a USD price into a Chainlink feed's fixed-point format (8 decimals). */
function feedAnswer(usdPrice) {
  return hre.ethers.parseUnits(usdPrice, 8);
}

async function deployRealVerifier() {
  // The real verifier is the snarkjs-generated contract (contracts/Verifier.sol
  // -> Groth16Verifier), NOT MockZKVerifier. The pool talks to verifiers via
  // IZKVerifier.verifyProof(bytes, uint256[]), so wire the SnarkVerifierAdapter
  // between them; the pool's zkVerifier address must be the adapter.
  console.log("  Deploying Groth16Verifier (snarkjs-generated, contracts/Verifier.sol)…");
  const Groth16Verifier = await hre.ethers.getContractFactory("Groth16Verifier");
  const verifier = await Groth16Verifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();

  console.log("  Deploying SnarkVerifierAdapter (IKZVerifier bridge)…");
  const SnarkVerifierAdapter = await hre.ethers.getContractFactory("SnarkVerifierAdapter");
  const adapter = await SnarkVerifierAdapter.deploy(verifierAddress);
  await adapter.waitForDeployment();
  const adapterAddress = await adapter.getAddress();

  return { verifierAddress, adapterAddress };
}

/** Deploys everything a fresh local chain needs (no reliance on networks.ts). */
async function deployLocalDependencies(deployer) {
  // Chainlink ships MockV3Aggregator in @chainlink/contracts (already a
  // dependency): MockV3Aggregator(uint8 decimals, int256 initialAnswer).
  const MockV3Aggregator = await hre.ethers.getContractFactory(
    "@chainlink/contracts/src/v0.8/shared/mocks/MockV3Aggregator.sol:MockV3Aggregator"
  );

  // 8 decimals mirrors real Chainlink feeds; the pool scales *1e10 to 18.
  const ETH_USD = 3000;
  const LINK_USD = 15;

  console.log(`  Deploying mock ETH/USD feed ($${ETH_USD}, 8 decimals = ${feedAnswer("3000")})…`);
  const ethFeed = await MockV3Aggregator.deploy(8, feedAnswer(String(ETH_USD)));
  await ethFeed.waitForDeployment();
  const ethFeedAddress = await ethFeed.getAddress();

  console.log(`  Deploying mock LINK/USD feed ($${LINK_USD}, 8 decimals = ${feedAnswer("15")})…`);
  const linkFeed = await MockV3Aggregator.deploy(8, feedAnswer(String(LINK_USD)));
  await linkFeed.waitForDeployment();
  const linkFeedAddress = await linkFeed.getAddress();

  // Mintable ERC-20 standing in for LINK (the project's own MockERC20).
  console.log("  Deploying mock LINK ERC-20 (MockERC20)…");
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const linkToken = await MockERC20.deploy("Chainlink", "LINK");
  await linkToken.waitForDeployment();
  const linkTokenAddress = await linkToken.getAddress();

  // Fund two wallets so Maker and Taker can both trade: deployer (Account #0)
  // and hardhat's default Account #1.
  const [, secondAccount] = await hre.ethers.getSigners();
  const SUPPLY = hre.ethers.parseEther("10000"); // 10,000 LINK
  for (const [label, account] of [["deployer (#0)", deployer], ["account #1", secondAccount]]) {
    await (await linkToken.mint(account.address, SUPPLY)).wait();
    console.log(`  Minted ${hre.ethers.formatEther(SUPPLY)} LINK -> ${label} (${account.address})`);
  }

  return { ethFeedAddress, linkFeedAddress, linkTokenAddress, prices: { ETH_USD, LINK_USD } };
}

/** Writes fresh local deployment addresses for the frontend (dev mode). */
function writeLocalAddressesFile(local) {
  const file = path.join(__dirname, "..", "frontend", "public", "local-addresses.json");
  fs.writeFileSync(file, JSON.stringify(local, null, 2) + "\n");
  return file;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const providerNetwork = await hre.ethers.provider.getNetwork();
  const chainId = Number(providerNetwork.chainId);
  const network = getNetwork(chainId);
  const isLocal = chainId === LOCAL_CHAIN_ID;
  if (!network) {
    throw new Error(
      `Unsupported network chainId ${chainId}. Add it to config/networks.ts before deploying.`
    );
  }
  console.log(`Target network : ${network.name} (chainId ${chainId})${isLocal ? " [LOCAL]" : ""}`);
  console.log(`Balance (ETH)  : ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))}`);

  let triggerAddress = deployer.address;
  if (process.env.CRE_ETH_PRIVATE_KEY) {
    const key = process.env.CRE_ETH_PRIVATE_KEY.startsWith("0x")
      ? process.env.CRE_ETH_PRIVATE_KEY
      : `0x${process.env.CRE_ETH_PRIVATE_KEY}`;
    triggerAddress = new hre.ethers.Wallet(key).address;
  }
  console.log("automationRegistry (signer):", triggerAddress);

  // On local, the automationRegistry EOA is a key from .env, NOT one of
  // hardhat's pre-funded accounts, so it starts with 0 ETH and can never pay
  // the gas for performUpkeep -> matched orders would never settle. Fund it.
  if (isLocal && triggerAddress !== deployer.address) {
    const REGISTRY_GAS_FUND = hre.ethers.parseEther("1000");
    await (await deployer.sendTransaction({
      to: triggerAddress,
      value: REGISTRY_GAS_FUND,
    })).wait();
    console.log(`  Funded automationRegistry ${triggerAddress} with ${hre.ethers.formatEther(REGISTRY_GAS_FUND)} ETH (for performUpkeep gas)`);
  }

  // ---- resolve feeds/tokens ----
  let ethUsdFeed, linkUsdFeed, linkTokenAddress, localMocks;
  if (isLocal) {
    console.log("\n[local] Deploying mock dependencies (feeds + LINK)…");
    localMocks = await deployLocalDependencies(deployer);
    ethUsdFeed = localMocks.ethFeedAddress;
    linkUsdFeed = localMocks.linkFeedAddress;
    linkTokenAddress = localMocks.linkTokenAddress;
  } else {
    const ethToken = network.SUPPORTED_TOKENS.find((t) => t.tokenAddress === ZERO_ADDRESS);
    const linkToken = network.SUPPORTED_TOKENS.find((t) => t.symbol === "LINK");
    ethUsdFeed = ethToken?.chainlinkOracleAddress ?? hre.ethers.ZeroAddress;
    linkUsdFeed = linkToken?.chainlinkOracleAddress ?? hre.ethers.ZeroAddress;
    linkTokenAddress = linkToken?.tokenAddress ?? hre.ethers.ZeroAddress;
  }
  console.log("ethUsdFeed  :", ethUsdFeed);
  console.log("linkUsdFeed :", linkUsdFeed);
  console.log("linkToken   :", linkTokenAddress);

  // ---- verifier (same real verifier + adapter on every chain) ----
  console.log("\n[1/3] Deploying ZK verifier + adapter…");
  const { verifierAddress, adapterAddress } = await deployRealVerifier();
  console.log(`  Groth16Verifier     -> ${verifierAddress}`);
  console.log(`  SnarkVerifierAdapter-> ${adapterAddress}`);

  // ---- pool ----
  // Constructor order: (ethUsdFeed, linkUsdFeed, linkToken, zkVerifier, automationRegistry).
  console.log("\n[2/3] Deploying ZKDarkPool…");
  const ZKDarkPool = await hre.ethers.getContractFactory("ZKDarkPool");
  const darkPool = await ZKDarkPool.deploy(
    ethUsdFeed,
    linkUsdFeed,
    linkTokenAddress,
    adapterAddress, // zkVerifier must be the adapter (IKZVerifier ABI)
    triggerAddress
  );
  await darkPool.waitForDeployment();
  const darkPoolAddress = await darkPool.getAddress();
  const poolDeployReceipt = await darkPool.deploymentTransaction().wait();
  const poolFromBlock = poolDeployReceipt.blockNumber;

  // ---- local-addresses.json for the frontend ----
  const tokens = isLocal
    ? // Hold real values on local: the mock feeds/token ARE the oracle/token.
      [
        { symbol: "ETH", address: ZERO_ADDRESS, decimals: 18, oracle: ethUsdFeed },
        { symbol: "LINK", address: linkTokenAddress, decimals: 18, oracle: linkUsdFeed },
      ]
    : network.SUPPORTED_TOKENS.map((t) => ({
        symbol: t.symbol,
        address: t.tokenAddress === ZERO_ADDRESS ? ZERO_ADDRESS : t.tokenAddress,
        decimals: t.decimals,
        oracle: t.chainlinkOracleAddress,
      }));
  const local = {
    chainId,
    name: network.name,
    rpcUrl: network.RPC_URL,
    explorerUrl: network.EXPLORER_URL,
    poolAddress: darkPoolAddress,
    poolFromBlock,
    verifierAddress,
    adapterAddress,
    automationRegistry: triggerAddress,
    ethUsdFeed,
    linkUsdFeed,
    linkToken: linkTokenAddress,
    prices: isLocal ? localMocks.prices : undefined,
    tokens,
  };
  if (isLocal) {
    const file = writeLocalAddressesFile(local);
    console.log(`\n[3/3] Wrote ${file}`);
  }

  // ---- local: verify the deployed feeds actually answer ----
  if (isLocal) {
    const feedFQN = "@chainlink/contracts/src/v0.8/shared/mocks/MockV3Aggregator.sol:MockV3Aggregator";
    const ethFeedC = await hre.ethers.getContractAt(feedFQN, ethUsdFeed);
    const ethData = await ethFeedC.latestRoundData();
    console.log(
      `\nETH/USD latestRoundData() -> roundId=${ethData[0]} ` +
        `answer=${hre.ethers.formatUnits(ethData[1], 8)} ` +
        `(expected ${localMocks.prices.ETH_USD})`
    );
    const linkFeedC = await hre.ethers.getContractAt(feedFQN, linkUsdFeed);
    const linkData = await linkFeedC.latestRoundData();
    console.log(
      `LINK/USD latestRoundData() -> roundId=${linkData[0]} ` +
        `answer=${hre.ethers.formatUnits(linkData[1], 8)} ` +
        `(expected ${localMocks.prices.LINK_USD})`
    );
    const poolPrice = await darkPool.getLatestPrice();
    console.log(
      `pool.getLatestPrice()    -> ${hre.ethers.formatUnits(poolPrice, 18)} ` +
        "USD (ETH/USD scaled 8 -> 18 decimals)"
    );
  }

  console.log("\n========================================");
  console.log(`chainId            : ${chainId} (${network.name})`);
  console.log(`ZKDarkPool deployed to: ${darkPoolAddress}`);
  console.log(`  Groth16Verifier      : ${verifierAddress}`);
  console.log(`  SnarkVerifierAdapter : ${adapterAddress}`);
  console.log(`  ethUsdFeed           : ${ethUsdFeed}`);
  console.log(`  linkUsdFeed          : ${linkUsdFeed}`);
  console.log(`  linkToken            : ${linkTokenAddress}`);
  console.log(`  automationRegistry   : ${triggerAddress}`);
  console.log("----------------------------------------");
  console.log("Copy-paste for the frontend (MetaMask RPC: http://127.0.0.1:8545):");
  console.log(`  POOL_ADDRESS   = ${darkPoolAddress}`);
  console.log(`  ETH_USD_FEED   = ${ethUsdFeed}`);
  console.log(`  LINK_USD_FEED  = ${linkUsdFeed}`);
  console.log(`  LINK_TOKEN     = ${linkTokenAddress}`);
  if (isLocal) {
    console.log("  (also written to frontend/public/local-addresses.json — the UI");
    console.log("   reads this automatically in dev mode, no manual copy needed)");
  }
  console.log("========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });