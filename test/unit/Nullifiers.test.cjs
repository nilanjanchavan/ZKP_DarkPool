const { expect } = require("chai");
const { ethers } = require("hardhat");

const { ETH, ORDER, nullifierFor, defaultFixtures } = require("../helpers/setup.cjs");

describe("Unit — Nullifier tracking", function () {
  let fixtures;

  beforeEach(async function () {
    fixtures = await defaultFixtures();
  });

  it("records the nullifier in the on-chain registry", async function () {
    const { pool, trader, linkAddress } = fixtures;
    const nullifier = nullifierFor("nul-record");

    await pool.connect(trader).submitOrder("0x01", nullifier, ETH, linkAddress, ORDER.amount, { value: ORDER.amount });

    expect(await pool.nullifiersUsed(nullifier)).to.equal(true);
  });

  it("reverts when the same nullifier is submitted twice (double-spend)", async function () {
    const { pool, trader, linkAddress } = fixtures;
    const nullifier = nullifierFor("nul-reuse");

    await pool.connect(trader).submitOrder("0x01", nullifier, ETH, linkAddress, ORDER.amount, { value: ORDER.amount });

    await expect(
      pool.connect(trader).submitOrder("0x01", nullifier, ETH, linkAddress, ORDER.amount, { value: ORDER.amount })
    ).to.be.revertedWith("Nullifier already used");
  });

  it("allocates separate slots for distinct nullifiers from the same trader", async function () {
    const { pool, trader, linkAddress } = fixtures;
    const first = nullifierFor("nul-a");
    const second = nullifierFor("nul-b");

    await pool.connect(trader).submitOrder("0x01", first, ETH, linkAddress, ORDER.amount, { value: ORDER.amount });
    await pool.connect(trader).submitOrder("0x01", second, ETH, linkAddress, ORDER.amount, { value: ORDER.amount });

    expect(await pool.ordersCount()).to.equal(2);
    expect(await pool.nullifiersUsed(first)).to.equal(true);
    expect(await pool.nullifiersUsed(second)).to.equal(true);
  });

  it("keeps the nullifier spent even after the order is executed", async function () {
    const { pool, trader, automation, linkAddress, linkToken } = fixtures;
    const nullifier = nullifierFor("nul-after-exec");

    // value-balanced pair: 2 ETH (~$6,000) vs 400 LINK (~$6,000)
    await pool.connect(trader).submitOrder("0x01", nullifier, ETH, linkAddress, ORDER.amount, { value: ORDER.amount });
    const trader2 = (await ethers.getSigners())[3];
    await linkToken.connect(trader2).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool
      .connect(trader2)
      .submitOrder("0x01", nullifierFor("nul-other"), linkAddress, ETH, ethers.parseEther("400"));

    const { performData } = await pool.connect(automation).checkUpkeep("0x");
    await pool.connect(automation).performUpkeep(performData);

    expect((await pool.orders(0)).active).to.equal(false);
    expect(await pool.nullifiersUsed(nullifier)).to.equal(true);
  });
});
