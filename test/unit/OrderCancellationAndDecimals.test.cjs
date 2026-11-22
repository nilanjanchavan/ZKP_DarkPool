const { expect } = require("chai");
const { ethers } = require("hardhat");
const { PROOF, ETH, nullifierFor, defaultFixtures, submitEthOrder } = require("../helpers/setup.cjs");

describe("Unit — Order Cancellation & Multi-Decimal Matching", function () {
  let fixtures;

  beforeEach(async function () {
    fixtures = await defaultFixtures();
  });

  describe("Order Cancellation", function () {
    it("allows the trader to cancel an active native ETH order and receive a full refund", async function () {
      const { pool, trader, linkAddress } = fixtures;
      const amount = ethers.parseEther("1.5");

      await submitEthOrder(pool, trader, linkAddress, amount);
      const orderBefore = await pool.orders(0);
      expect(orderBefore.active).to.equal(true);

      const balBefore = await ethers.provider.getBalance(trader.address);
      const tx = await pool.connect(trader).cancelOrder(0);
      const receipt = await tx.wait();
      const gasSpent = receipt.gasUsed * receipt.gasPrice;

      const balAfter = await ethers.provider.getBalance(trader.address);
      expect(balAfter).to.equal(balBefore + amount - gasSpent);

      const orderAfter = await pool.orders(0);
      expect(orderAfter.active).to.equal(false);
    });

    it("allows the trader to cancel an active ERC-20 order and receive tokens back", async function () {
      const { pool, trader, linkToken, linkAddress } = fixtures;
      const amount = ethers.parseEther("50");

      await linkToken.connect(trader).approve(await pool.getAddress(), amount);
      await pool.connect(trader).submitOrder(PROOF, nullifierFor("link-cancel"), linkAddress, ETH, amount);

      const balBefore = await linkToken.balanceOf(trader.address);
      await pool.connect(trader).cancelOrder(0);
      const balAfter = await linkToken.balanceOf(trader.address);

      expect(balAfter).to.equal(balBefore + amount);
      const order = await pool.orders(0);
      expect(order.active).to.equal(false);
    });

    it("reverts when a non-trader attempts to cancel someone else's order", async function () {
      const { pool, trader, linkAddress, owner } = fixtures;
      await submitEthOrder(pool, trader, linkAddress, ethers.parseEther("1"));

      await expect(pool.connect(owner).cancelOrder(0)).to.be.revertedWithCustomError(pool, "NotOrderTrader");
    });

    it("reverts when attempting to cancel an already inactive or cancelled order", async function () {
      const { pool, trader, linkAddress } = fixtures;
      await submitEthOrder(pool, trader, linkAddress, ethers.parseEther("1"));

      await pool.connect(trader).cancelOrder(0);
      await expect(pool.connect(trader).cancelOrder(0)).to.be.revertedWithCustomError(pool, "OrderNotActive");
    });

    it("reverts when orderId is out of bounds", async function () {
      const { pool, trader } = fixtures;
      await expect(pool.connect(trader).cancelOrder(999)).to.be.revertedWithCustomError(pool, "OrderNotActive");
    });
  });

  describe("Multi-Decimal Matching (e.g. 6-decimal USDC vs 18-decimal ETH)", function () {
    it("successfully matches an 18-decimal ETH order with a 6-decimal USDC order", async function () {
      const { pool, owner } = fixtures;
      const [, traderA, traderB] = await ethers.getSigners();

      // Deploy Mock 6-decimal USDC and Mock Price Feed ($1.00 USD)
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const usdc = await MockERC20.deploy("USD Coin", "USDC");
      await usdc.setDecimals(6);
      const usdcAddress = await usdc.getAddress();

      const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
      const usdcFeed = await MockPriceFeed.deploy();
      await usdcFeed.setAnswer(ethers.parseUnits("1", 8)); // $1.00 USD
      await pool.connect(owner).setPriceFeed(usdcAddress, await usdcFeed.getAddress());

      // ETH price is $3000 USD (from defaultFixtures).
      // Trader A sells 1 ETH ($3000) for USDC.
      // Trader B sells 3000 USDC ($3000) for ETH.
      const ethAmount = ethers.parseEther("1");
      const usdcAmount = ethers.parseUnits("3000", 6); // 3000 * 10^6

      await usdc.mint(traderB.address, usdcAmount);
      await usdc.connect(traderB).approve(await pool.getAddress(), usdcAmount);

      // Submit Order 0 (Trader A: 1 ETH -> USDC)
      await pool.connect(traderA).submitOrder(PROOF, nullifierFor("eth-usdc"), ETH, usdcAddress, ethAmount, {
        value: ethAmount,
      });

      // Submit Order 1 (Trader B: 3000 USDC -> ETH)
      await pool.connect(traderB).submitOrder(PROOF, nullifierFor("usdc-eth"), usdcAddress, ETH, usdcAmount);

      // Check upkeep finds the pair
      const [upkeepNeeded, performData] = await pool.checkUpkeep("0x");
      expect(upkeepNeeded).to.equal(true);

      // Perform upkeep
      const traderABalBefore = await usdc.balanceOf(traderA.address);
      const traderBBalBefore = await ethers.provider.getBalance(traderB.address);

      await pool.performUpkeep(performData);

      // Verify trades settled
      const traderABalAfter = await usdc.balanceOf(traderA.address);
      const traderBBalAfter = await ethers.provider.getBalance(traderB.address);

      expect(traderABalAfter).to.equal(traderABalBefore + usdcAmount);
      expect(traderBBalAfter).to.equal(traderBBalBefore + ethAmount);

      const order0 = await pool.orders(0);
      const order1 = await pool.orders(1);
      expect(order0.active).to.equal(false);
      expect(order1.active).to.equal(false);
    });
  });
});

