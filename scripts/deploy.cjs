require("ts-node/register");
const hre = require("hardhat");
const { getNetwork, ZERO_ADDRESS } = require("../config/networks");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Detect the target network from the provider the deployer is connected to.
  const providerNetwork = await hre.ethers.provider.getNetwork();
  const chainId = Number(providerNetwork.chainId);
  const network = getNetwork(chainId);
  if (!network) {
    throw new Error(
      `Unsupported network chainId ${chainId}. Add it to config/networks.ts before deploying.`
    );
  }
  console.log(`Target network : ${network.name} (chainId ${chainId})`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance (ETH):", hre.ethers.formatEther(balance));

  // Registry that run-matcher.ts triggers from: the wallet derived from
  // CRE_ETH_PRIVATE_KEY (fallback: the hardhat deployer).
  let triggerAddress = deployer.address;
  if (process.env.CRE_ETH_PRIVATE_KEY) {
    const key = process.env.CRE_ETH_PRIVATE_KEY.startsWith("0x")
      ? process.env.CRE_ETH_PRIVATE_KEY
      : `0x${process.env.CRE_ETH_PRIVATE_KEY}`;
    triggerAddress = new hre.ethers.Wallet(key).address;
  }
  console.log("automationRegistry (signer):", triggerAddress);

  // Pull Chainlink feeds + token addresses for this network from networks.ts.
  const ethToken = network.SUPPORTED_TOKENS.find((t) => t.tokenAddress === ZERO_ADDRESS);
  const linkToken = network.SUPPORTED_TOKENS.find((t) => t.symbol === "LINK");
  const ethUsdFeed = ethToken?.chainlinkOracleAddress ?? hre.ethers.ZeroAddress;
  const linkUsdFeed = linkToken?.chainlinkOracleAddress ?? hre.ethers.ZeroAddress;
  const linkTokenAddress = linkToken?.tokenAddress ?? hre.ethers.ZeroAddress;
  console.log("ethUsdFeed  :", ethUsdFeed);
  console.log("linkUsdFeed :", linkUsdFeed);
  console.log("linkToken   :", linkTokenAddress);

  console.log("\n[1/2] Deploying ZK verifier…");
  const MockZKVerifier = await hre.ethers.getContractFactory("MockZKVerifier");
  const verifier = await MockZKVerifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log(`  MockZKVerifier -> ${verifierAddress}`);

  // Constructor order matters: (ethUsdFeed, linkUsdFeed, linkToken, zkVerifier, automationRegistry).
  console.log("\n[2/2] Deploying ZKDarkPool…");
  const ZKDarkPool = await hre.ethers.getContractFactory("ZKDarkPool");
  const darkPool = await ZKDarkPool.deploy(
    ethUsdFeed,
    linkUsdFeed,
    linkTokenAddress,
    verifierAddress,
    triggerAddress
  );
  await darkPool.waitForDeployment();
  const darkPoolAddress = await darkPool.getAddress();

  console.log("\n========================================");
  console.log(`ZKDarkPool deployed to: ${darkPoolAddress}`);
  console.log(`chainId            : ${chainId} (${network.name})`);
  console.log(`ethUsdFeed         : ${ethUsdFeed}`);
  console.log(`linkUsdFeed        : ${linkUsdFeed}`);
  console.log(`linkToken          : ${linkTokenAddress}`);
  console.log(`zkVerifier         : ${verifierAddress}`);
  console.log(`automationRegistry : ${triggerAddress}`);
  console.log("Update POOL_ADDRESS for this network in config/networks.ts with the address above.");
  console.log("========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
