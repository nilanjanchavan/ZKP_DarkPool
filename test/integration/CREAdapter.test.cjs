const { expect } = require("chai");
const { ethers } = require("hardhat");

const {
  ETH,
  PAIR,
  nullifierFor,
  defaultFixtures,
  encodePerformUpkeep,
} = require("../helpers/setup.cjs");

describe("Integration — CRE adapter (onReport bridge)", function () {
  let fixtures;

  beforeEach(async function () {
    fixtures = await defaultFixtures({ withAdapter: true });
  });

  it("rejects reports not delivered by the KeystoneForwarder", async function () {
    const { adapter, trader } = fixtures;

    await expect(adapter.connect(trader).onReport("0x", "0x")).to.be.revertedWithCustomError(
      adapter,
      "OnlyForwarder"
    );
  });

  it("executes a balanced ETH<->LINK pair via a forwarder report", async function () {
    const { pool, adapter, trader, forwarder, linkToken, linkAddress } = fixtures;
    const trader2 = (await ethers.getSigners())[4];

    await pool
      .connect(trader)
      .submitOrder("0x01", nullifierFor("adapter-eth"), ETH, linkAddress, PAIR.ethAmount, {
        value: PAIR.ethAmount,
      });
    await linkToken.connect(trader2).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool
      .connect(trader2)
      .submitOrder("0x01", nullifierFor("adapter-link"), linkAddress, ETH, PAIR.linkAmount);

    const traderLinkBefore = await linkToken.balanceOf(trader.address);
    const trader2Before = await ethers.provider.getBalance(trader2.address);
    const { performData } = await pool.connect(forwarder).checkUpkeep("0x");
    const report = encodePerformUpkeep(performData);

    await expect(adapter.connect(forwarder).onReport("0x", report))
      .to.emit(adapter, "PerformUpkeepForwarded")
      .withArgs(await pool.getAddress(), performData);

    expect((await pool.orders(0)).active).to.equal(false);
    expect((await pool.orders(1)).active).to.equal(false);

    // Both traders got paid out: trader receives LINK, trader2 receives ETH.
    expect(await linkToken.balanceOf(trader.address)).to.equal(traderLinkBefore + PAIR.linkAmount);
    expect(await ethers.provider.getBalance(trader2.address)).to.equal(trader2Before + PAIR.ethAmount);
  });

  it("bubbles a pool revert through the adapter", async function () {
    const { adapter, forwarder } = fixtures;

    // performUpkeep abi-decodes performData as (uint256,uint256); garbage bytes
    // revert in the pool and the adapter must not swallow the error.
    const badReport = encodePerformUpkeep("0xabcd");

    await expect(adapter.connect(forwarder).onReport("0x", badReport)).to.be.reverted;
  });
});
