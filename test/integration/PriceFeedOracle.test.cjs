const { expect } = require("chai");
const { ethers } = require("hardhat");

const { nullifierFor, defaultFixtures } = require("../helpers/setup.cjs");

describe("Integration — Price feed interactions", function () {
  let fixtures;

  beforeEach(async function () {
    fixtures = await defaultFixtures();
  });

  describe("Oracle scaling", function () {
    it("scales the 8-decimal ETH/USD answer to 18 decimals", async function () {
      const { pool, ethFeed } = fixtures;
      await ethFeed.setAnswer(ethers.parseUnits("3000", 8));

      expect(await pool.getLatestPrice()).to.equal(ethers.parseUnits("3000", 18));
    });

    it("returns per-token prices via getTokenPrice", async function () {
      const { pool, ethFeed, linkFeed, linkAddress } = fixtures;
      await ethFeed.setAnswer(ethers.parseUnits("3000", 8));
      await linkFeed.setAnswer(ethers.parseUnits("15.5", 8));

      expect(await pool.getTokenPrice(ethers.ZeroAddress)).to.equal(ethers.parseUnits("3000", 18));
      expect(await pool.getTokenPrice(linkAddress)).to.equal(ethers.parseUnits("15.5", 18));
    });

    it("reverts when the oracle answer is not positive", async function () {
      const { pool, ethFeed } = fixtures;
      await ethFeed.setAnswer(-1);

      await expect(pool.getLatestPrice()).to.be.revertedWithCustomError(pool, "InvalidPrice");
    });

    it("reverts for a token without a registered price feed", async function () {
      const { pool } = fixtures;

      await expect(pool.getTokenPrice("0x1111111111111111111111111111111111111111")).to.be.revertedWithCustomError(
        pool,
        "UnsupportedToken"
      );
    });

    it("initializes priceFeeds for ETH and LINK at construction", async function () {
      const { pool, ethFeed, linkFeed, linkAddress } = fixtures;

      expect(await pool.priceFeeds(ethers.ZeroAddress)).to.equal(await ethFeed.getAddress());
      expect(await pool.priceFeeds(linkAddress)).to.equal(await linkFeed.getAddress());
    });
  });

  describe("Pair discovery via checkUpkeep", function () {
    it("does not report upkeep when no complementary pair exists", async function () {
      const { pool, trader, automation, linkAddress } = fixtures;

      // Only one side of the pair exists.
      await pool
        .connect(trader)
        .submitOrder("0x01", nullifierFor("feed-solo"), ethers.ZeroAddress, linkAddress, ethers.parseEther("2"), {
          value: ethers.parseEther("2"),
        });

      const res = await pool.connect(automation).checkUpkeep("0x");
      expect(res.upkeepNeeded).to.equal(false);
      expect(res.performData).to.equal("0x");
    });

    it("returns the lowest-index complementary pair", async function () {
      const { pool, trader, automation, linkAddress, linkToken } = fixtures;
      const trader2 = (await ethers.getSigners())[3];

      // A: 2 ETH -> LINK; B: 400 LINK -> ETH (both ≈ $6,000 with feeds 3000/15).
      await pool
        .connect(trader)
        .submitOrder("0x01", nullifierFor("feed-a"), ethers.ZeroAddress, linkAddress, ethers.parseEther("2"), {
          value: ethers.parseEther("2"),
        });
      await linkToken.connect(trader2).approve(await pool.getAddress(), ethers.MaxUint256);
      await pool
        .connect(trader2)
        .submitOrder("0x01", nullifierFor("feed-b"), linkAddress, ethers.ZeroAddress, ethers.parseEther("400"));

      const res = await pool.connect(automation).checkUpkeep("0x");
      expect(res.upkeepNeeded).to.equal(true);
      expect(res.performData).to.equal(
        ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 1])
      );
    });

    it("reports upkeep for a specific pair when checkData is supplied", async function () {
      const { pool, trader, automation, linkAddress, linkToken } = fixtures;
      const trader2 = (await ethers.getSigners())[3];

      await pool
        .connect(trader)
        .submitOrder("0x01", nullifierFor("feed-target-0"), ethers.ZeroAddress, linkAddress, ethers.parseEther("2"), {
          value: ethers.parseEther("2"),
        });
      await linkToken.connect(trader2).approve(await pool.getAddress(), ethers.MaxUint256);
      await pool
        .connect(trader2)
        .submitOrder("0x01", nullifierFor("feed-target-1"), linkAddress, ethers.ZeroAddress, ethers.parseEther("400"));

      const checkData = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 1]);
      const targeted = await pool.connect(automation).checkUpkeep(checkData);
      expect(targeted.upkeepNeeded).to.equal(true);
      expect(targeted.performData).to.equal(checkData);
    });
  });
});
