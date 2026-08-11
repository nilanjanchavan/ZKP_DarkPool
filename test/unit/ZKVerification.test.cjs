const { expect } = require("chai");

const { PROOF, ETH, ORDER, nullifierFor, defaultFixtures } = require("../helpers/setup.cjs");

describe("Unit — ZK proof verification", function () {
  let fixtures;

  beforeEach(async function () {
    fixtures = await defaultFixtures();
  });

  it("accepts an order when the Groth16 proof is valid", async function () {
    const { pool, trader, linkAddress } = fixtures;
    const nullifier = nullifierFor("zk-valid");

    await expect(
      pool.connect(trader).submitOrder(PROOF, nullifier, ETH, linkAddress, ORDER.amount, { value: ORDER.amount })
    )
      .to.emit(pool, "OrderSubmitted")
      .withArgs(0n, trader.address, nullifier, ETH, linkAddress, ORDER.amount);

    const order = await pool.orders(0);
    expect(order.active).to.equal(true);
    expect(order.trader).to.equal(trader.address);
    expect(order.tokenIn).to.equal(ETH);
    expect(order.tokenOut).to.equal(linkAddress);
    expect(order.amountIn).to.equal(ORDER.amount);
  });

  it("rejects an invalid proof", async function () {
    const { pool, trader, mockVerifier, linkAddress } = fixtures;
    await mockVerifier.setShouldVerify(false);

    await expect(
      pool
        .connect(trader)
        .submitOrder(PROOF, nullifierFor("zk-invalid"), ETH, linkAddress, ORDER.amount, { value: ORDER.amount })
    ).to.be.revertedWithCustomError(pool, "InvalidProof");
  });

  it("does not create an order when the proof is invalid", async function () {
    const { pool, trader, mockVerifier, linkAddress } = fixtures;
    await mockVerifier.setShouldVerify(false);

    await expect(
      pool
        .connect(trader)
        .submitOrder(PROOF, nullifierFor("zk-noop"), ETH, linkAddress, ORDER.amount, { value: ORDER.amount })
    ).to.be.revertedWithCustomError(pool, "InvalidProof");

    expect(await pool.ordersCount()).to.equal(0);
  });

  it("does not spend the nullifier when the proof is invalid", async function () {
    const { pool, trader, mockVerifier, linkAddress } = fixtures;
    const nullifier = nullifierFor("zk-nullifier-save");
    await mockVerifier.setShouldVerify(false);

    await expect(
      pool
        .connect(trader)
        .submitOrder(PROOF, nullifier, ETH, linkAddress, ORDER.amount, { value: ORDER.amount })
    ).to.be.revertedWithCustomError(pool, "InvalidProof");

    expect(await pool.nullifiersUsed(nullifier)).to.equal(false);
  });
});
