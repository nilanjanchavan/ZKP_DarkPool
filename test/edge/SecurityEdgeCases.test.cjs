const { expect } = require("chai");
const { ethers } = require("hardhat");

const {
  ETH,
  PAIR,
  nullifierFor,
  defaultFixtures,
  encodePerformUpkeep,
} = require("../helpers/setup.cjs");

describe("Edge — Double-spend prevention", function () {
  let fixtures;

  beforeEach(async function () {
    fixtures = await defaultFixtures();
  });

  it("blocks reusing a nullifier at submission time", async function () {
    const { pool, trader, linkAddress } = fixtures;
    const nullifier = nullifierFor("ds-submit");

    await pool.connect(trader).submitOrder("0x01", nullifier, ETH, linkAddress, PAIR.ethAmount, {
      value: PAIR.ethAmount,
    });

    await expect(
      pool.connect(trader).submitOrder("0x01", nullifier, ETH, linkAddress, PAIR.ethAmount, {
        value: PAIR.ethAmount,
      })
    ).to.be.revertedWith("Nullifier already used");
  });

  it("blocks reusing a nullifier from a different account", async function () {
    const { pool, trader, linkAddress } = fixtures;
    const attacker = (await ethers.getSigners())[4];
    const nullifier = nullifierFor("ds-cross-account");

    await pool.connect(trader).submitOrder("0x01", nullifier, ETH, linkAddress, PAIR.ethAmount, {
      value: PAIR.ethAmount,
    });

    await expect(
      pool.connect(attacker).submitOrder("0x01", nullifier, ETH, linkAddress, PAIR.ethAmount, {
        value: PAIR.ethAmount,
      })
    ).to.be.revertedWith("Nullifier already used");
  });

  it("blocks reusing a nullifier after the order has executed", async function () {
    const { pool, trader, automation, linkAddress, linkToken } = fixtures;
    const nullifier = nullifierFor("ds-after-exec");

    await pool.connect(trader).submitOrder("0x01", nullifier, ETH, linkAddress, PAIR.ethAmount, {
      value: PAIR.ethAmount,
    });
    const trader2 = (await ethers.getSigners())[4];
    await linkToken.connect(trader2).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(trader2).submitOrder("0x01", nullifierFor("ds-after-exec-b"), linkAddress, ETH, PAIR.linkAmount);

    const { performData } = await pool.connect(automation).checkUpkeep("0x");
    await pool.connect(automation).performUpkeep(performData);
    expect((await pool.orders(0)).active).to.equal(false);

    await expect(
      pool.connect(trader).submitOrder("0x01", nullifier, ETH, linkAddress, PAIR.ethAmount, {
        value: PAIR.ethAmount,
      })
    ).to.be.revertedWith("Nullifier already used");
  });
});

describe("Edge — Invalid proof rejection", function () {
  let fixtures;

  beforeEach(async function () {
    fixtures = await defaultFixtures();
  });

  it("does not spend the nullifier for a failed proof", async function () {
    const { pool, trader, mockVerifier, linkAddress } = fixtures;
    const nullifier = nullifierFor("ip-save");
    await mockVerifier.setShouldVerify(false);

    await expect(
      pool.connect(trader).submitOrder("0x01", nullifier, ETH, linkAddress, PAIR.ethAmount, {
        value: PAIR.ethAmount,
      })
    ).to.be.revertedWithCustomError(pool, "InvalidProof");

    expect(await pool.nullifiersUsed(nullifier)).to.equal(false);
  });

  it("does not mutate the order book for a failed proof", async function () {
    const { pool, trader, mockVerifier, linkAddress } = fixtures;
    const sizeBefore = await pool.ordersCount();
    await mockVerifier.setShouldVerify(false);

    await expect(
      pool.connect(trader).submitOrder("0x01", nullifierFor("ip-noop"), ETH, linkAddress, PAIR.ethAmount, {
        value: PAIR.ethAmount,
      })
    ).to.be.revertedWithCustomError(pool, "InvalidProof");

    expect(await pool.ordersCount()).to.equal(sizeBefore);
  });
});

describe("Edge — Paused pool lockdown", function () {
  let fixtures;

  beforeEach(async function () {
    fixtures = await defaultFixtures();
  });

  it("halts order placement while paused", async function () {
    const { pool, trader, linkAddress } = fixtures;
    await pool.pause();

    await expect(
      pool.connect(trader).submitOrder("0x01", nullifierFor("pause-place"), ETH, linkAddress, PAIR.ethAmount, {
        value: PAIR.ethAmount,
      })
    ).to.be.revertedWithCustomError(pool, "EnforcedPause");
  });

  it("reports no upkeep while paused", async function () {
    const { pool, trader, linkAddress } = fixtures;
    await pool.connect(trader).submitOrder("0x01", nullifierFor("pause-check"), ETH, linkAddress, PAIR.ethAmount, {
      value: PAIR.ethAmount,
    });
    await pool.pause();

    const { upkeepNeeded } = await pool.connect(trader).checkUpkeep("0x");
    expect(upkeepNeeded).to.equal(false);
  });

  it("blocks performUpkeep while paused even for the registry", async function () {
    const { pool, trader, automation, linkAddress, linkToken } = fixtures;
    await pool.connect(trader).submitOrder("0x01", nullifierFor("pause-perform-a"), ETH, linkAddress, PAIR.ethAmount, {
      value: PAIR.ethAmount,
    });
    const trader2 = (await ethers.getSigners())[4];
    await linkToken.connect(trader2).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(trader2).submitOrder("0x01", nullifierFor("pause-perform-b"), linkAddress, ETH, PAIR.linkAmount);
    await pool.pause();

    const { performData } = await pool.connect(automation).checkUpkeep("0x");
    await expect(pool.connect(automation).performUpkeep(performData)).to.be.revertedWithCustomError(
      pool,
      "EnforcedPause"
    );
  });

  it("restores execution after unpausing", async function () {
    const { pool, trader, automation, linkAddress, linkToken } = fixtures;
    await pool.connect(trader).submitOrder("0x01", nullifierFor("pause-unpause-a"), ETH, linkAddress, PAIR.ethAmount, {
      value: PAIR.ethAmount,
    });
    const trader2 = (await ethers.getSigners())[4];
    await linkToken.connect(trader2).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(trader2).submitOrder("0x01", nullifierFor("pause-unpause-b"), linkAddress, ETH, PAIR.linkAmount);
    await pool.pause();
    await pool.unpause();

    const { performData } = await pool.connect(automation).checkUpkeep("0x");
    await expect(pool.connect(automation).performUpkeep(performData)).to.emit(pool, "OrderMatched");
  });
});

describe("Edge — Adapter authorization", function () {
  let fixtures;

  beforeEach(async function () {
    fixtures = await defaultFixtures({ withAdapter: true });
  });

  it("only accepts reports from the configured forwarder", async function () {
    const { adapter, trader, forwarder } = fixtures;

    await expect(adapter.connect(trader).onReport("0x", "0x")).to.be.revertedWithCustomError(
      adapter,
      "OnlyForwarder"
    );

    // A valid performData pointing at nonexistent orders is a pool no-op.
    const noopPerformData = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [999, 1000]);
    await expect(adapter.connect(forwarder).onReport("0x", encodePerformUpkeep(noopPerformData))).to.not.be
      .reverted;
  });

  it("lets the demo matcher perform upkeep directly after rewiring to the adapter", async function () {
    const { pool, automation, linkAddress, linkToken } = fixtures;

    await pool.connect(automation).submitOrder("0x01", nullifierFor("adapter-guard-a"), ETH, linkAddress, PAIR.ethAmount, {
      value: PAIR.ethAmount,
    });
    const trader2 = (await ethers.getSigners())[4];
    await linkToken.connect(trader2).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(trader2).submitOrder("0x01", nullifierFor("adapter-guard-b"), linkAddress, ETH, PAIR.linkAmount);

    // performUpkeep is no longer gated by automationRegistry: after the adapter
    // took the registry slot, the former registry signer is a plain wallet, yet
    // it can still trigger a match directly — the local matcher demo path.
    const { performData } = await pool.connect(automation).checkUpkeep("0x");
    await expect(pool.connect(automation).performUpkeep(performData)).to.emit(pool, "OrderMatched");
  });
});
