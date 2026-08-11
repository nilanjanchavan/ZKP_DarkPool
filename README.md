# ZK Dark Pool 🌑

![Ethereum](https://img.shields.io/badge/Network-Sepolia_Testnet-blue?style=flat-square&logo=ethereum)
![Solidity](https://img.shields.io/badge/Smart_Contracts-Solidity-363636?style=flat-square&logo=solidity)
![React](https://img.shields.io/badge/Frontend-React_%2B_Vite-61DAFB?style=flat-square&logo=react)
![Chainlink](https://img.shields.io/badge/Oracles-Chainlink-2A5ADA?style=flat-square&logo=chainlink)

A multi-asset, zero-knowledge trading terminal for the Ethereum ecosystem. 

ZK Dark Pool allows users to place Maker and Taker orders for native assets (ETH) and ERC-20 tokens (LINK) without exposing their trade intent to the public mempool. By utilizing an off-chain matching engine and Chainlink Data Feeds, the protocol guarantees fair-market execution while completely protecting users from Maximum Extractable Value (MEV) bots, slippage, and front-running.

**Live Application:** [https://zkp-dark-pool.vercel.app/](https://zkp-dark-pool.vercel.app/)

---

## ✨ Key Features

* **Cross-Asset Swaps:** Seamlessly and securely trade between Native ETH and ERC-20 tokens (LINK).
* **Zero-Knowledge Execution:** Orders are submitted and held securely in the pool until matched, preventing malicious actors from front-running your trades.
* **Fair Market Pricing:** Integrates live, decentralized Chainlink Oracle Data Feeds (ETH/USD, LINK/USD) to ensure orders only settle within a strict 1% real-world value tolerance.
* **Automated Settlement:** A robust off-chain matching engine constantly polls for value-balanced complementary pairs and executes `performUpkeep` automatically when a match is found.
* **Flat 2D Interface:** A custom, strictly flat two-dimensional React UI designed specifically for a distraction-free, professional trading environment.

## 🛠️ Tech Stack

* **Frontend:** React, Vite, Ethers.js v6, CSS3
* **Smart Contracts:** Solidity, Hardhat
* **Infrastructure:** Chainlink Data Feeds, Chainlink Automation (Keepers)
* **Network:** Ethereum Sepolia Testnet

## 📂 Project Structure

```text
├── frontend/             # React & Vite application
│   ├── src/
│   │   ├── components/   # TradingTerminal, OrderDashboard, etc.
│   │   ├── config/       # networks.ts (Addresses & Oracles)
│   │   └── prices.ts     # Shared Chainlink price fetching logic
├── contracts/            # Solidity smart contracts
├── scripts/              # Hardhat deployment scripts (deploy.cjs)
└── run-matcher.ts        # Off-chain order matching engine
```

## 🚀 Getting Started

To run this project locally, you will need two separate terminal windows—one for the React frontend and one for the off-chain matching engine.

### Prerequisites

* [Node.js](https://nodejs.org/) (v18+)
* A Web3 wallet (e.g., MetaMask) connected to the **Sepolia Testnet**
* Testnet ETH and LINK (Available for free via [Chainlink Faucets](https://faucets.chain.link/))

### 1. Start the Frontend

Navigate to the frontend directory, install the required dependencies, and start the Vite development server:

```bash
cd frontend
npm install
npm run dev
```

The trading terminal will be live at `http://localhost:5173`.

### 2. Start the Matching Engine

Open a new terminal window in the root directory, install the backend dependencies, and run the matcher script to listen for and execute trades on Sepolia:

```bash
npm install
npx hardhat run run-matcher.ts --network sepolia
```

## 📜 Usage Workflow

1. **Maker Order (Account 1):** Connect to the frontend and submit an order to sell ETH for LINK. The UI will automatically calculate the expected return based on live Chainlink prices.
2. **Taker Order (Account 2):** Switch to a second account, approve LINK spending, and submit a complementary order to sell LINK for ETH.
3. **Settlement:** The `run-matcher.ts` engine will detect the complementary pair, mathematically verify the Chainlink price ratios, and broadcast the settlement transaction. The dashboard will instantly update your trades from "Listed" to "Settled".
