const { expect } = require("chai");
const { ethers } = require("hardhat");

const { ETH, PAIR, nullifierFor, defaultFixtures, encodePair } = require("../helpers/setup.cjs");

describe("Integration — Pair matching via performUpkeep", function () {
  let fixtures;

  beforeEach(async function () {
    fixtures = await defaultFixtures();
  });

  /** Submits the value-balanced pair: order 0 = ETH->LINK, order 1 = LINK->ETH. */
  async function submitBalancedPair(pool, linkToken, linkAddress) {
    const [, trader, , trader2] = await ethers.getSigners();
    await pool
      .connect(trader)
      .submitOrder("0x01", nullifierFor("pair-a"), ETH, linkAddress, PAIR.ethAmount, {
        value: PAIR.ethAmount,
      });
    await linkToken.connect(trader2).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(trader2).submitOrder("0x01", nullifierFor("pair-b"), linkAddress, ETH, PAIR.linkAmount);
    return { trader, trader2 };
  }

  it("lets any wallet (e.g. the local matcher) perform upkeep directly", async function () {
    const { pool, linkToken, linkAddress } = fixtures;
    await submitBalancedPair(pool, linkToken, linkAddress);
    const matcher = (await ethers.getSigners())[5]; // not the configured registry

    const { performData } = await pool.connect(matcher).checkUpkeep("0x");
    await expect(pool.connect(matcher).performUpkeep(performData)).to.emit(pool, "OrderMatched");
    expect((await pool.orders(0)).active).to.equal(false);
    expect((await pool.orders(1)).active).to.equal(false);
  });

  it("executes both sides of a complementary pair and transfers assets", async function () {
    const { pool, automation, linkToken, linkAddress } = fixtures;
    const { trader, trader2 } = await submitBalancedPair(pool, linkToken, linkAddress);

    const linkTraderBefore = await linkToken.balanceOf(trader.address);
    const ethTrader2Before = await ethers.provider.getBalance(trader2.address);
    const poolEthBefore = await ethers.provider.getBalance(await pool.getAddress());
    const poolLinkBefore = await linkToken.balanceOf(await pool.getAddress());

    const { performData } = await pool.connect(automation).checkUpkeep("0x");
    const receipt = await (await pool.connect(automation).performUpkeep(performData)).wait();

    // Order A (ETH->LINK): trader receives 400 LINK. Order B (LINK->ETH): trader2 receives 2 ETH.
    expect(await linkToken.balanceOf(trader.address)).to.equal(linkTraderBefore + PAIR.linkAmount);
    expect(await ethers.provider.getBalance(trader2.address)).to.equal(ethTrader2Before + PAIR.ethAmount);
    expect(await ethers.provider.getBalance(await pool.getAddress())).to.equal(poolEthBefore - PAIR.ethAmount);
    expect(await linkToken.balanceOf(await pool.getAddress())).to.equal(poolLinkBefore - PAIR.linkAmount);

    // Order state + events.
    expect((await pool.orders(0)).active).to.equal(false);
    expect((await pool.orders(1)).active).to.equal(false);

    const iface = new ethers.Interface([
      "event OrderExecuted(uint256 indexed orderId, address indexed trader, uint256 amountIn, uint256 fillPriceUSD)",
    ]);
    const poolAddress = await pool.getAddress();
    const executed = receipt.logs
      .filter((log) => log.address === poolAddress)
      .flatMap((log) => {
        try {
          return [iface.parseLog(log).args];
        } catch {
          return [];
        }
      });
    const ethPrice = ethers.parseUnits("3000", 18);
    const linkPrice = ethers.parseUnits("15", 18);
    expect(executed[0][0]).to.equal(0n);
    expect(executed[0][1]).to.equal(trader.address);
    expect(executed[0][3]).to.equal(ethPrice); // fill price of ETH at execution
    expect(executed[1][0]).to.equal(1n);
    expect(executed[1][3]).to.equal(linkPrice);
  });

  it("emits OrderMatched for the pair", async function () {
    const { pool, automation, linkToken, linkAddress } = fixtures;
    await submitBalancedPair(pool, linkToken, linkAddress);

    const { performData } = await pool.connect(automation).checkUpkeep("0x");
    await expect(pool.connect(automation).performUpkeep(performData))
      .to.emit(pool, "OrderMatched")
      .withArgs(0n, 1n, ethers.parseUnits("3000", 18), ethers.parseUnits("15", 18));
  });

  it("drains multiple balanced pairs across repeated triggers", async function () {
    const { pool, automation, linkToken, linkAddress } = fixtures;
    const signers = await ethers.getSigners();

    // Pair 1: orders 0,1 ; Pair 2: orders 2,3 (different traders so no self-match).
    const submitEth = (signer, nonce) =>
      pool
        .connect(signer)
        .submitOrder("0x01", nullifierFor(`drain-eth-${nonce}`), ETH, linkAddress, PAIR.ethAmount, {
          value: PAIR.ethAmount,
        });
    const poolAddress = await pool.getAddress();
    const submitLink = async (signer, nonce) => {
      await linkToken.connect(signer).approve(poolAddress, ethers.MaxUint256);
      return pool
        .connect(signer)
        .submitOrder("0x01", nullifierFor(`drain-link-${nonce}`), linkAddress, ETH, PAIR.linkAmount);
    };

    await submitEth(signers[1], 0);
    await submitLink(signers[2], 0);
    await submitEth(signers[3], 1);
    await submitLink(signers[4], 1);

    let executed = 0;
    while ((await pool.connect(automation).checkUpkeep("0x")).upkeepNeeded) {
      const { performData } = await pool.connect(automation).checkUpkeep("0x");
      await pool.connect(automation).performUpkeep(performData);
      executed += 1;
    }

    expect(executed).to.equal(2);
    for (const id of [0, 1, 2, 3]) expect((await pool.orders(id)).active).to.equal(false);
  });

  it("does not match when the USD values differ beyond the tolerance", async function () {
    const { pool, automation, linkToken, linkAddress } = fixtures;
    const [, trader, , trader2] = await ethers.getSigners();

    // 2 ETH ($6,000) vs 300 LINK ($4,500) — 25% gap, way past the 1% tolerance.
    await pool
      .connect(trader)
      .submitOrder("0x01", nullifierFor("off-value-a"), ETH, linkAddress, PAIR.ethAmount, { value: PAIR.ethAmount });
    await linkToken.connect(trader2).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool
      .connect(trader2)
      .submitOrder("0x01", nullifierFor("off-value-b"), linkAddress, ETH, ethers.parseEther("300"));

    const res = await pool.connect(automation).checkUpkeep("0x");
    expect(res.upkeepNeeded).to.equal(false);

    await pool.connect(automation).performUpkeep(encodePair(0, 1));
    expect((await pool.orders(0)).active).to.equal(true);
    expect((await pool.orders(1)).active).to.equal(true);
  });

  it("does not match non-complementary or same-trader orders", async function () {
    const { pool, automation, linkToken, linkAddress } = fixtures;
    const [owner] = await ethers.getSigners();

    // Same trader: self-match is disallowed.
    await pool
      .connect(owner)
      .submitOrder("0x01", nullifierFor("same-trader-a"), ETH, linkAddress, PAIR.ethAmount, {
        value: PAIR.ethAmount,
      });
    await linkToken.connect(owner).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(owner).submitOrder("0x01", nullifierFor("same-trader-b"), linkAddress, ETH, PAIR.linkAmount);

    const res = await pool.connect(automation).checkUpkeep("0x");
    expect(res.upkeepNeeded).to.equal(false);
  });

  it("treats an out-of-range pair as a no-op", async function () {
    const { pool, automation } = fixtures;

    await expect(pool.connect(automation).performUpkeep(encodePair(99, 100))).to.not.emit(pool, "OrderMatched");
  });
});
