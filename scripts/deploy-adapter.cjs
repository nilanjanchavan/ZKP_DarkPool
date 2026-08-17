const hre = require("hardhat");

// The tenant's simulation-broadcast forwarder on Sepolia. Verified empirically:
// `cre workflow simulate --broadcast` delivered a report via this
// MockKeystoneForwarder (tx `to` = 0x15fC6...). A DEPLOYED workflow on Sepolia
// would instead use the production KeystoneForwarder 0xF8344CF... (needs its
// own adapter; the pool only has one automationRegistry slot).
const FORWARDER =
  process.env.FORWARDER_ADDRESS || "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";

// Required: the ZKDarkPool to service. The adapter's `pool` is immutable, so a
// fresh pool deployment MUST be paired with a fresh adapter.
const POOL = process.env.POOL_ADDRESS;
if (!POOL) {
  throw new Error("POOL_ADDRESS env var required (the ZKDarkPool this adapter services)");
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("deployer:", deployer.address);
  console.log("balance :", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");

  console.log("\n[1/3] Deploying DarkPoolAutomationAdapter…");
  const factory = await hre.ethers.getContractFactory("DarkPoolAutomationAdapter");
  const adapter = await factory.deploy(FORWARDER, POOL);
  await adapter.waitForDeployment();
  const adapterAddress = await adapter.getAddress();
  console.log("adapter :", adapterAddress);
  console.log("  forwarder:", await adapter.forwarder());
  console.log("  pool    :", await adapter.pool());

  console.log("\n[2/3] Rewiring pool.automationRegistry → adapter…");
  const pool = await hre.ethers.getContractAt("ZKDarkPool", POOL, deployer);
  const before = await pool.automationRegistry();
  console.log("  automationRegistry before:", before);
  if (before.toLowerCase() !== adapterAddress.toLowerCase()) {
    const tx = await pool.setAutomationRegistry(adapterAddress);
    await tx.wait();
    console.log("  setAutomationRegistry tx:", tx.hash);
  } else {
    console.log("  already wired; skipping tx");
  }

  console.log("\n[3/3] Read-back…");
  const after = await pool.automationRegistry();
  console.log("  automationRegistry after :", after);
  if (after.toLowerCase() !== adapterAddress.toLowerCase()) {
    throw new Error(`READ-BACK MISMATCH: expected ${adapterAddress}, got ${after}`);
  }
  console.log("  VERIFIED: pool.automationRegistry === adapter");

  const SUPPORTS_IRECEIVER = "0x805f2132";
  const supports = await adapter.supportsInterface(SUPPORTS_IRECEIVER);
  console.log("  supportsInterface(type(IReceiver).interfaceId):", supports);

  console.log("\nADAPTER_ADDRESS=" + adapterAddress);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});