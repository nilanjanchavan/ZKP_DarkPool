# ZK Dark Pool 🌑

[![Network: Sepolia](https://img.shields.io/badge/Network-Sepolia_Testnet-blue?style=flat-square&logo=ethereum)](https://sepolia.etherscan.io/address/0x14b9f710DBcB52123B34722b29aE6aBFE156Db87)
[![Solidity](https://img.shields.io/badge/Smart_Contracts-Solidity_0.8.20-363636?style=flat-square&logo=solidity)](contracts/ZKDarkPool.sol)
[![Hardhat](https://img.shields.io/badge/Tests-55_Passing-brightgreen?style=flat-square&logo=javascript)](test/unit/)
[![React](https://img.shields.io/badge/Frontend-React_%2B_Vite-61DAFB?style=flat-square&logo=react)](frontend/)
[![Chainlink](https://img.shields.io/badge/Oracles-Chainlink_Data_Feeds-2A5ADA?style=flat-square&logo=chainlink)](https://data.chain.link/)
[![Security](https://img.shields.io/badge/Security-SafeERC20_%7C_ReentrancyGuard-red?style=flat-square)](contracts/ZKDarkPool.sol)

A privacy-preserving, multi-asset dark pool protocol and professional trading terminal built on Ethereum. 

ZK Dark Pool enables traders to submit confidential Maker and Taker orders for native assets (ETH) and ERC-20 tokens (e.g. LINK, USDC) without exposing trade intent, limit prices, or order sizes to public mempools. By combining cryptographic zero-knowledge proof verification, off-chain matching algorithms, and decentralized Chainlink Price Oracles, the protocol eliminates Maximum Extractable Value (MEV) exploits, sandwich attacks, and front-running while enforcing fair market value settlement.

🌐 **Live Application:** [https://zkp-dark-pool.vercel.app/](https://zkp-dark-pool.vercel.app/)

---

## 📍 Deployed Contracts (Sepolia Testnet)

| Contract | Address | Explorer |
| :--- | :--- | :--- |
| **ZKDarkPool** | `0x14b9f710DBcB52123B34722b29aE6aBFE156Db87` | [View on Etherscan](https://sepolia.etherscan.io/address/0x14b9f710DBcB52123B34722b29aE6aBFE156Db87) |
| **MockZKVerifier** | `0x80BB05C920a16400154B0cAf5017D809fC823746` | [View on Etherscan](https://sepolia.etherscan.io/address/0x80BB05C920a16400154B0cAf5017D809fC823746) |
| **Creation Block** | `12187305` | [Block #12187305](https://sepolia.etherscan.io/block/12187305) |

---

## 🏛️ System Architecture

```text
  ┌────────────────────────────────────────────────────────┐
  │                    React + Vite UI                     │
  │     (Trading Terminal, Live Feeds, Order Dashboard)    │
  └───────────────┬────────────────────────▲───────────────┘
                  │ 1. Submit Order        │
                  │    (Proof + Deposit)   │ 4. Live Updates &
                  ▼                        │    1-Click Settlement
  ┌────────────────────────────────────────┴───────────────┐
  │              ZKDarkPool Smart Contract                 │
  │   - Nullifier double-spend registry                    │
  │   - Groth16 / Mock ZK Proof Verifier                   │
  │   - SafeERC20 asset escrow                             │
  │   - On-chain cancelOrder() with instant refund         │
  └───────────────▲────────────────────────▲───────────────┘
                  │                        │
         2. Price Validation        3. Settlement (Dual-Mode)
                  │                        │
  ┌───────────────┴───────────────┐ ┌──────┴───────────────┐
  │   Chainlink Decentralized     │ │ Matching Engine:     │
  │         Data Feeds            │ │  a) In-Browser UI    │
  │   (ETH/USD, LINK/USD, etc.)   │ │  b) Chainlink Keeper │
  │   Strict 1% Value Tolerance   │ │  c) run-matcher.ts   │
  └───────────────────────────────┘ └──────────────────────┘
```

---

## ✨ Key Features & Technical Highlights

* **Mempool Privacy & Anti-MEV**: Order details (size, limit parameters) are safeguarded with ZK nullifier commitments. Front-running bots and searchers cannot intercept or front-run user orders in the public mempool.
* **On-Chain Order Cancellation with Instant Escrow Refund**: Traders can cancel active orders at any time. The contract verifies trader authorization, marks the order inactive, and safely returns 100% of deposited ETH or ERC-20 tokens via `SafeERC20` with reentrancy protection.
* **Fair Market Settlement (1% Deviation Bound)**: Trade pairs are only matchable when their USD valuation (sourced directly from decentralized Chainlink oracles) agrees within a strict 1% tolerance (`MATCH_TOLERANCE = 1e16`), preventing slippage manipulation.
* **Multi-Decimal Token Normalization**: Built-in support for non-standard ERC-20 decimal scales (e.g. 6-decimal USDC vs 18-decimal ETH), properly normalizing cross-asset token values before evaluating fair market tolerance.
* **Dual-Mode Settlement**:
  1. **In-Browser 1-Click Settlement**: Dashboard automatically checks `checkUpkeep` in real time and presents an intuitive "Match & Settle Orders" button for instant execution.
  2. **Automated Decentralized Keepers / Bot**: Fully compatible with Chainlink Automation and `run-matcher.ts` for headless automated settlements.
* **Adaptive Chunked Event Querying**: Solves Ethereum RPC limits (such as error `-32701: exceed maximum block range: 50000`) through dynamic recursive block-range chunking and fill-price caching.
* **Gas-Optimized Custom Errors & Reentrancy Guards**: Uses Solidity 0.8.20 custom errors (`InvalidProof`, `OrderNotActive`, `NotOrderTrader`) for lower deployment and execution gas costs.

---

## 🛠️ Tech Stack

* **Smart Contracts:** Solidity 0.8.20, Hardhat, OpenZeppelin (`SafeERC20`, `ReentrancyGuard`, `Pausable`, `Ownable`)
* **Zero-Knowledge Proofs:** Groth16 SnarkVerifier architecture & MockZKVerifier
* **Oracles & Infrastructure:** Chainlink Data Feeds (AggregatorV3Interface), Chainlink Automation (AutomationCompatible)
* **Frontend:** React 18, Vite, Ethers.js v6, TypeScript
* **Testing:** Hardhat, Mocha, Chai (55 automated edge, integration, and unit tests passing)

---

## 📂 Project Structure

```text
├── contracts/
│   ├── ZKDarkPool.sol           # Core Dark Pool contract with cancellation & SafeERC20
│   ├── interfaces/              # IZKVerifier, AggregatorV3Interface
│   └── mocks/                   # MockZKVerifier, MockContracts (Price Feeds, Tokens)
├── test/
│   ├── unit/                    # 55 unit and edge-case tests
│   └── integration/             # Pair matching and price feed integration tests
├── config/
│   └── networks.ts              # Multi-chain network configurations & RPC endpoints
├── frontend/
│   ├── src/
│   │   ├── TradingTerminal.tsx  # Order placement with ZK commitment generator
│   │   ├── OrderDashboard.tsx   # Active/Settled orders, cancellation, 1-click settle
│   │   ├── LivePriceFeed.tsx    # Live Chainlink oracle pricing
│   │   └── prices.ts            # Chainlink oracle scaling logic
│   └── vite.config.ts           # Production build configuration
├── scripts/
│   └── deploy.cjs               # Deployment and verifier wiring script
└── run-matcher.ts               # Autonomous off-chain matching engine
```

---

## 🚀 Quickstart & Local Development

### Prerequisites

* [Node.js](https://nodejs.org/) (v18+)
* [Git](https://git-scm.com/)
* Web3 Wallet (e.g. MetaMask) connected to **Sepolia Testnet**

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/nilanjanchavan/ZKP_DarkPool.git
cd ZKP_DarkPool
npm install
cd frontend && npm install && cd ..
```

### 2. Run Smart Contract Test Suite

Execute the 55 comprehensive unit and integration tests:

```bash
npx hardhat test
```

### 3. Start Local Frontend

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 4. Deploy to Sepolia (Optional)

Configure your `.env` with a funded Sepolia account:

```env
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
PRIVATE_KEY=0x...
```

Deploy contracts and automatically wire the verifier:

```bash
npx hardhat run scripts/deploy.cjs --network sepolia
```

---

## 🧪 Testing Coverage

The test suite covers:
* **ZK Proof Verification**: Valid proof execution, invalid proof rejection, double-spend prevention.
* **Nullifier Tracking**: On-chain tracking preventing reused nullifiers across transactions.
* **Order Placement & Escrow**: Deposits for native ETH and ERC-20s, allowance checks, zero-amount reverts.
* **Order Cancellation**: Full refunds of ETH and ERC-20s, unauthorized cancellation protection, inactive order checks.
* **Multi-Decimal Matching**: Precision-loss-free valuation matching across varying token decimals (e.g. 18-dec ETH vs 6-dec USDC).
* **Price Oracles**: Price scaling from 8-decimal Chainlink feeds to 18-decimal internal representations.
* **Automation Upkeep**: Complementary pair discovery and state execution.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
