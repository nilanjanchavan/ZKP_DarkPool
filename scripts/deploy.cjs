require("ts-node/register");
const hre = require("hardhat");
const { getNetwork, ZERO_ADDRESS } = require("../config/networks");

/**
 * ZKDarkPool deployment + wiring script.
 *
 * Two modes:
 *  1) Fresh deploy (default)       — deploys a new MockZKVerifier and a new
 *                                     ZKDarkPool wired to it.
 *  2) Wire existing pool           — set POOL_ADDRESS=<existing pool>. Skips
 *                                     the pool deploy and just re-points the
 *                                     pool's zkVerifier to a MockZKVerifier,
 *                                     then reads it back to confirm.
 *
 * The demo/testnet verifier is MockZKVerifier: it accepts any proof as long as
 * publicInputs.length == 4, so zero-length proofs ("0x") pass on-chain without
 * errors. Override with VERIFIER_ADDRESS=<addr> to wire a different verifier
 * (e.g. a real SnarkVerifierAdapter) instead of deploying a fresh mock.
 */
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

  console.log("\n[1/2a] Verifier (MockZKVerifier)…");
  const MockZKVerifier = await hre.ethers.getContractFactory("MockZKVerifier");
  let verifierAddress = process.env.VERIFIER_ADDRESS;
  if (verifierAddress) {
    console.log(`  VERIFIER_ADDRESS override -> ${verifierAddress}`);
  } else {
    const verifier = await MockZKVerifier.deploy();
    await verifier.waitForDeployment();
    verifierAddress = await verifier.getAddress();
    console.log(`  MockZKVerifier deployed -> ${verifierAddress}`);
  }

  const poolAddress = process.env.POOL_ADDRESS;

  if (poolAddress) {
    // ---- Mode 2: wire an existing pool's zkVerifier ----
    console.log("\n[2/2] Wiring existing pool…");
    const pool = await hre.ethers.getContractAt("ZKDarkPool", poolAddress, deployer);
    console.log(`  pool          : ${poolAddress}`);
    const before = await pool.zkVerifier();
    console.log(`  zkVerifier before: ${before}`);
    if (before.toLowerCase() !== verifierAddress.toLowerCase()) {
      const tx = await pool.setVerifier(verifierAddress);
      await tx.wait();
      console.log("  setVerifier tx:", tx.hash);
    } else {
      console.log("  already wired; skipping tx");
    }
    const after = await pool.zkVerifier();
    console.log(`  zkVerifier after : ${after}`);
    if (after.toLowerCase() !== verifierAddress.toLowerCase()) {
      throw new Error(`READ-BACK MISMATCH: expected ${verifierAddress}, got ${after}`);
    }
    console.log("  VERIFIED: pool.zkVerifier === verifier");

    console.log("\n========================================");
    console.log(`ZKDarkPool wired to: ${poolAddress}`);
    console.log(`chainId    : ${chainId} (${network.name})`);
    console.log(`zkVerifier : ${verifierAddress} (MockZKVerifier — accepts 0x proofs for demo)`);
    console.log("========================================\n");
    return;
  }

  // ---- Mode 1: fresh pool deployment ----
  // Pull Chainlink feeds + token addresses for this network from networks.ts.
  const ethToken = network.SUPPORTED_TOKENS.find((t) => t.tokenAddress === ZERO_ADDRESS);
  const linkToken = network.SUPPORTED_TOKENS.find((t) => t.symbol === "LINK");
  const ethUsdFeed = ethToken?.chainlinkOracleAddress ?? hre.ethers.ZeroAddress;
  const linkUsdFeed = linkToken?.chainlinkOracleAddress ?? hre.ethers.ZeroAddress;
  const linkTokenAddress = linkToken?.tokenAddress ?? hre.ethers.ZeroAddress;
  console.log("\nethUsdFeed  :", ethUsdFeed);
  console.log("linkUsdFeed :", linkUsdFeed);
  console.log("linkToken   :", linkTokenAddress);

  console.log("\n[2/2b] Deploying ZKDarkPool…");
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