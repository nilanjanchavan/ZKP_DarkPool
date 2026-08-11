const { expect } = require("chai");
const { ethers } = require("hardhat");

const { PROOF, ETH, ORDER, nullifierFor, defaultFixtures, submitEthOrder } = require("../helpers/setup.cjs");

describe("Unit — Order placement", function () {
  let fixtures;

  beforeEach(async function () {
    fixtures = await defaultFixtures();
  });

  it("persists every order field from submitOrder", async function () {
    const { pool, trader, linkAddress } = fixtures;
    const nullifier = nullifierFor("order-fields");

    await pool.connect(trader).submitOrder(PROOF, nullifier, ETH, linkAddress, ORDER.amount, { value: ORDER.amount });

    const order = await pool.orders(0);
    expect(order.id).to.equal(0n);
    expect(order.trader).to.equal(trader.address);
    expect(order.tokenIn).to.equal(ETH);
    expect(order.tokenOut).to.equal(linkAddress);
    expect(order.amountIn).to.equal(ORDER.amount);
    expect(order.active).to.equal(true);
  });

  it("assigns sequential order ids", async function () {
    const { pool, trader, linkAddress } = fixtures;

    await submitEthOrder(pool, trader, linkAddress, ORDER.amount);
    await submitEthOrder(pool, trader, linkAddress, ORDER.amount);

    expect(await pool.ordersCount()).to.equal(2);
    expect((await pool.orders(0)).id).to.equal(0n);
    expect((await pool.orders(1)).id).to.equal(1n);
  });

  it("deposits native ETH into the pool when tokenIn is the zero address", async function () {
    const { pool, trader, linkAddress } = fixtures;
    const before = await ethers.provider.getBalance(await pool.getAddress());

    await submitEthOrder(pool, trader, linkAddress, ORDER.amount);

    expect(await ethers.provider.getBalance(await pool.getAddress())).to.equal(before + ORDER.amount);
  });

  it("deposits ERC-20 tokens when tokenIn is an ERC-20", async function () {
    const { pool, trader, linkToken, linkAddress } = fixtures;
    const amount = ethers.parseEther("100");
    const traderBefore = await linkToken.balanceOf(trader.address);
    const poolBefore = await linkToken.balanceOf(await pool.getAddress());

    const tx = await linkToken
      .connect(trader)
      .approve(await pool.getAddress(), ethers.MaxUint256)
      .then(() =>
        pool.connect(trader).submitOrder(PROOF, nullifierFor("erc20-deposit"), linkAddress, ETH, amount)
      );
    await tx.wait();

    expect(await linkToken.balanceOf(await pool.getAddress())).to.equal(poolBefore + amount);
    expect(await linkToken.balanceOf(trader.address)).to.equal(traderBefore - amount);
  });

  it("reverts when the amount is zero", async function () {
    const { pool, trader, linkAddress } = fixtures;

    await expect(
      pool.connect(trader).submitOrder(PROOF, nullifierFor("order-zero-amount"), ETH, linkAddress, 0, { value: 0 })
    ).to.be.revertedWithCustomError(pool, "ZeroAmount");
  });

  it("reverts when tokenIn and tokenOut are the same", async function () {
    const { pool, trader } = fixtures;

    await expect(
      pool
        .connect(trader)
        .submitOrder(PROOF, nullifierFor("order-same-token"), ETH, ETH, ORDER.amount, { value: ORDER.amount })
    ).to.be.revertedWithCustomError(pool, "SameToken");
  });

  it("reverts a native order whose msg.value does not match the amount", async function () {
    const { pool, trader, linkAddress } = fixtures;

    await expect(
      pool
        .connect(trader)
        .submitOrder(PROOF, nullifierFor("order-wrong-value"), ETH, linkAddress, ORDER.amount, {
          value: ORDER.amount / 2n,
        })
    ).to.be.revertedWithCustomError(pool, "IncorrectEthValue");
  });

  it("reverts an ERC-20 order without a sufficient allowance", async function () {
    const { pool, trader, linkToken, linkAddress } = fixtures;

    // Approve far less than the amount so transferFrom reverts with a plain error.
    await linkToken.connect(trader).approve(await pool.getAddress(), 1);

    await expect(
      pool.connect(trader).submitOrder(PROOF, nullifierFor("order-no-allowance"), linkAddress, ETH, ORDER.amount)
    ).to.be.reverted;
  });

  it("reverts when the pool is paused", async function () {
    const { pool, trader, linkAddress } = fixtures;
    await pool.pause();

    await expect(
      pool
        .connect(trader)
        .submitOrder(PROOF, nullifierFor("order-paused"), ETH, linkAddress, ORDER.amount, { value: ORDER.amount })
    ).to.be.revertedWithCustomError(pool, "EnforcedPause");
  });

  describe("Owner controls", function () {
    it("emits events when updating the verifier and automation registry", async function () {
      const { owner, pool } = fixtures;
      const replacement = await (await ethers.getContractFactory("MockZKVerifier")).deploy();

      await expect(pool.setVerifier(await replacement.getAddress()))
        .to.emit(pool, "VerifierUpdated")
        .withArgs(await replacement.getAddress());

      await expect(pool.setAutomationRegistry(owner.address))
        .to.emit(pool, "AutomationRegistryUpdated")
        .withArgs(owner.address);
    });

    it("lets the owner (re)configure price feeds", async function () {
      const { owner, pool, ethFeed, linkAddress } = fixtures;
      const other = await (await ethers.getContractFactory("MockPriceFeed")).deploy();

      await expect(pool.setPriceFeed(linkAddress, await other.getAddress()))
        .to.emit(pool, "PriceFeedUpdated")
        .withArgs(linkAddress, await other.getAddress());

      expect(await pool.priceFeeds(linkAddress)).to.equal(await other.getAddress());
    });

    it("rejects non-owner updates", async function () {
      const { pool, trader, mockVerifier } = fixtures;

      await expect(pool.connect(trader).setVerifier(mockVerifier.target)).to.be.revertedWithCustomError(
        pool,
        "OwnableUnauthorizedAccount"
      );
    });
  });
});
