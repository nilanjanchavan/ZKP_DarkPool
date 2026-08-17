const { expect } = require("chai");
const { ethers } = require("hardhat");

const { ETH, ORDER, nullifierFor, defaultFixtures } = require("../helpers/setup.cjs");
const { makeProof } = require("../helpers/proofs.cjs");

/**
 * Real-verifier fixture: deploys the snarkjs-generated Groth16Verifier and the
 * SnarkVerifierAdapter bridging it to the pool's IZKVerifier interface, plus
 * the usual price feeds / LINK token. Everything else matches
 * helpers/setup.cjs::defaultFixtures.
 */
async function realFixtures() {
  const [owner, trader, automation, trader2] = await ethers.getSigners();

  const Groth16Verifier = await ethers.getContractFactory("Groth16Verifier");
  const verifier = await Groth16Verifier.deploy();

  const SnarkVerifierAdapter = await ethers.getContractFactory("SnarkVerifierAdapter");
  const adapter = await SnarkVerifierAdapter.deploy(await verifier.getAddress());

  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const ethFeed = await MockPriceFeed.deploy();
  const linkFeed = await MockPriceFeed.deploy();
  await linkFeed.setAnswer(ethers.parseUnits("15", 8));

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const linkToken = await MockERC20.deploy("Chainlink", "LINK");

  const ZKDarkPool = await ethers.getContractFactory("ZKDarkPool");
  const pool = await ZKDarkPool.deploy(
    await ethFeed.getAddress(),
    await linkFeed.getAddress(),
    await linkToken.getAddress(),
    await adapter.getAddress(),
    automation.getAddress()
  );

  const linkAddress = await linkToken.getAddress();
  const signers = await ethers.getSigners();
  for (const signer of signers) {
    await linkToken.mint(signer.address, ethers.parseEther("10000"));
  }

  return { owner, trader, trader2, automation, pool, verifier, adapter, ethFeed, linkFeed, linkToken, linkAddress };
}

/** Generates a fresh valid (proof, publicSignals) for `sender` selling ETH → LINK. */
function orderProof(fixtures, signer, amount = ORDER.amount, overrides = {}) {
  return makeProof({
    amountIn: overrides.amountIn ?? amount,
    tokenIn: overrides.tokenIn ?? ETH,
    tokenOut: overrides.tokenOut ?? fixtures.linkAddress,
    sender: overrides.sender ?? signer.address,
  });
}

describe("Unit — Real Groth16 proof (snarkjs ↔ Verifier.sol)", function () {
  let f;
  beforeEach(async function () {
    f = await realFixtures();
  });

  it("accepts an order with a freshly generated valid proof (nullifier from Poseidon secret)", async function () {
    const { proofBytes, publicSignals } = await orderProof(f, f.trader);
    const nullifier = publicSignals[0];

    await expect(
      f.pool
        .connect(f.trader)
        .submitOrder(proofBytes, nullifier, ETH, f.linkAddress, ORDER.amount, { value: ORDER.amount })
    )
      .to.emit(f.pool, "OrderSubmitted")
      .withArgs(0n, f.trader.address, nullifier, ETH, f.linkAddress, ORDER.amount);

    expect(await f.pool.nullifiersUsed(nullifier)).to.equal(true);
    const order = await f.pool.orders(0);
    expect(order.active).to.equal(true);
  });

  it("reverts with InvalidProof when the nullifier public input is tampered", async function () {
    // Valid proof computed for a secret/nullifier...
    const { proofBytes, publicSignals } = await orderProof(f, f.trader);
    // ...but the nullifier we broadcast is wrong (i.e. tampered publicInputs).
    const tamperedNullifier = (BigInt(publicSignals[0]) + 1n).toString();

    await expect(
      f.pool
        .connect(f.trader)
        .submitOrder(proofBytes, tamperedNullifier, ETH, f.linkAddress, ORDER.amount, { value: ORDER.amount })
    ).to.be.revertedWithCustomError(f.pool, "InvalidProof");
  });

  it("reverts with InvalidProof when the amount public input is tampered", async function () {
    const { proofBytes, publicSignals } = await orderProof(f, f.trader, ORDER.amount, {
      amountIn: ORDER.amount + 1n,
    });

    await expect(
      f.pool
        .connect(f.trader)
        .submitOrder(proofBytes, publicSignals[0], ETH, f.linkAddress, ORDER.amount, { value: ORDER.amount })
    ).to.be.revertedWithCustomError(f.pool, "InvalidProof");
  });

  it("rejects a proof bound to another msg.sender (sender is a committed public input)", async function () {
    // trader   proves knowledge of the secret for themselves...
    const traderProof = await orderProof(f, f.trader);
    // ...then trader2 tries to broadcast that same proof from their address.
    await expect(
      f.pool
        .connect(f.trader2)
        .submitOrder(traderProof.proofBytes, traderProof.publicSignals[0], ETH, f.linkAddress, ORDER.amount, {
          value: ORDER.amount,
        })
    ).to.be.revertedWithCustomError(f.pool, "InvalidProof");
  });

  it("does not create an order when the proof is invalid", async function () {
    const { proofBytes, publicSignals } = await orderProof(f, f.trader);
    const bad = (BigInt(publicSignals[0]) - 1n).toString();

    await expect(
      f.pool
        .connect(f.trader)
        .submitOrder(proofBytes, bad, ETH, f.linkAddress, ORDER.amount, { value: ORDER.amount })
    ).to.be.revertedWithCustomError(f.pool, "InvalidProof");

    expect(await f.pool.ordersCount()).to.equal(0);
  });

  it("reverts when the same nullifier is reused (double-spend), with a real proof", async function () {
    const { proofBytes, publicSignals } = await orderProof(f, f.trader);
    const nullifier = publicSignals[0];

    await expect(
      f.pool
        .connect(f.trader)
        .submitOrder(proofBytes, nullifier, ETH, f.linkAddress, ORDER.amount, { value: ORDER.amount })
    ).to.emit(f.pool, "OrderSubmitted");

    await expect(
      f.pool
        .connect(f.trader)
        .submitOrder(proofBytes, nullifier, ETH, f.linkAddress, ORDER.amount, { value: ORDER.amount })
    ).to.be.revertedWith("Nullifier already used");
  });
});

describe("Regression — MockZKVerifier still passes with the 5-input contract shape", function () {
  let f;
  beforeEach(async function () {
    f = await defaultFixtures();
  });

  it("accepts mock proofs and stays compatible with the non-ZK test suite", async function () {
    const nullifier = nullifierFor("mock-regression");
    await expect(
      f.pool
        .connect(f.trader)
        .submitOrder("0x01", nullifier, ETH, f.linkAddress, ORDER.amount, { value: ORDER.amount })
    ).to.emit(f.pool, "OrderSubmitted");
    expect(await f.pool.nullifiersUsed(nullifier)).to.equal(true);
  });
});