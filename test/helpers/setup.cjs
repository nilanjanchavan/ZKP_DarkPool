const { ethers } = require("hardhat");

const PROOF = "0x01";
const ETH = ethers.ZeroAddress; // tokenIn/tokenOut key for native ETH

const ORDER = {
  amount: ethers.parseEther("2"), // 2 ETH (or 2 LINK) sold
};

// Value-balanced defaults used by matching tests. With the helper's default
// feeds (ETH/USD = 3000, LINK/USD = 15): 2 ETH == 400 LINK == $6,000.
const PAIR = {
  ethAmount: ethers.parseEther("2"),
  linkAmount: ethers.parseEther("400"),
};

/** Unique nullifier per call to avoid cross-test collisions. */
function nullifierFor(label) {
  return ethers.keccak256(ethers.toUtf8Bytes(`${label}-${Date.now()}-${Math.random()}`));
}

/**
 * Deploys a fresh ZKDarkPool with MockZKVerifier, two MockPriceFeeds
 * (ETH/USD = 3000, LINK/USD = 15) and a mintable MockERC20 LINK token.
 * @param {object} [opts]
 * @param {boolean} [opts.withAdapter] Also deploy the CRE bridge and rewire the
 *   pool's automationRegistry to it (used by integration/edge tests).
 */
async function defaultFixtures({ withAdapter = false } = {}) {
  const [owner, trader, automation, forwarder] = await ethers.getSigners();

  const MockZKVerifier = await ethers.getContractFactory("MockZKVerifier");
  const mockVerifier = await MockZKVerifier.deploy();

  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const ethFeed = await MockPriceFeed.deploy(); // default answer 3000.00000000
  const linkFeed = await MockPriceFeed.deploy();
  await linkFeed.setAnswer(ethers.parseUnits("15", 8)); // 15.00000000 USD

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const linkToken = await MockERC20.deploy("Chainlink", "LINK");

  const ZKDarkPool = await ethers.getContractFactory("ZKDarkPool");
  const pool = await ZKDarkPool.deploy(
    await ethFeed.getAddress(),
    await linkFeed.getAddress(),
    await linkToken.getAddress(),
    await mockVerifier.getAddress(),
    automation.getAddress()
  );

  // Fund every hardhat account with LINK so any signer can act as a
  // counterparty (approvals happen per-order in submitLinkOrder or inline).
  const signers = await ethers.getSigners();
  const linkAddress = await linkToken.getAddress();
  for (const signer of signers) {
    await linkToken.mint(signer.address, ethers.parseEther("10000"));
  }

  let adapter;
  if (withAdapter) {
    const DarkPoolAutomationAdapter = await ethers.getContractFactory("DarkPoolAutomationAdapter");
    adapter = await DarkPoolAutomationAdapter.deploy(forwarder.getAddress(), await pool.getAddress());
    await pool.connect(owner).setAutomationRegistry(await adapter.getAddress());
  }

  return {
    owner,
    trader,
    automation,
    forwarder,
    pool,
    mockVerifier,
    ethFeed,
    linkFeed,
    linkToken,
    linkAddress,
    adapter,
  };
}

/**
 * Submits an order selling native ETH for `tokenOut`. Sends `value` so the
 * pool's msg.value == amountIn deposit passes.
 */
async function submitEthOrder(pool, trader, tokenOut, amount) {
  return pool.connect(trader).submitOrder(PROOF, nullifierFor("eth"), ETH, tokenOut, amount, {
    value: amount,
  });
}

/**
 * Submits an order selling ERC-20 LINK for `tokenOut` (trader is pre-funded;
 * approves the pool to its full balance first).
 */
async function submitLinkOrder(pool, trader, tokenOut, amount, linkToken) {
  const linkAddress = await linkToken.getAddress();
  await linkToken.connect(trader).approve(await pool.getAddress(), ethers.MaxUint256);
  return pool.connect(trader).submitOrder(PROOF, nullifierFor("link"), linkAddress, tokenOut, amount);
}

/**
 * Encodes performUpkeep(bytes) call data exactly as the CRE workflow does with
 * viem's encodeFunctionData — the report payload carried by onReport().
 */
function encodePerformUpkeep(performData) {
  const iface = new ethers.Interface(["function performUpkeep(bytes calldata performData) external"]);
  return iface.encodeFunctionData("performUpkeep", [performData]);
}

/** ABI-encodes a complementary (orderA, orderB) pair the way checkUpkeep does. */
function encodePair(orderAId, orderBId) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [orderAId, orderBId]);
}

module.exports = {
  PROOF,
  ETH,
  ORDER,
  PAIR,
  nullifierFor,
  defaultFixtures,
  submitEthOrder,
  submitLinkOrder,
  encodePerformUpkeep,
  encodePair,
};
