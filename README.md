# ZK Dark Pool 🌑

A multi-asset, zero-knowledge trading terminal for the Ethereum ecosystem. 

ZK Dark Pool allows users to place Maker and Taker orders for native assets (ETH) and ERC-20 tokens (LINK) without exposing their trade execution to front-running. The protocol utilizes an off-chain matching engine and Chainlink Data Feeds to settle cross-asset trades securely on-chain.

Live link - https://zkp-dark-pool.vercel.app/

## ✨ Key Features

* **Cross-Asset Swaps:** Seamlessly trade Native ETH and ERC-20 tokens (LINK).
* **Zero-Knowledge Execution:** Orders are submitted and held securely until matched, protecting users from MEV and front-running.
* **Fair Market Pricing:** Integrates live Chainlink Oracle Data Feeds (ETH/USD, LINK/USD) to ensure orders only settle within a strict 1% value tolerance.
* **Automated Settlement:** An off-chain matching engine polls for value-balanced complementary pairs and executes `performUpkeep` automatically.
* **Flat 2D Interface:** A custom, strictly flat two-dimensional React UI designed for professional trading environments.

## 🛠️ Tech Stack

* **Frontend:** React, Vite, Ethers.js v6
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
🚀 Getting Started
To run this project locally, you will need two separate terminal windows—one for the React frontend and one for the off-chain matching engine.

Prerequisites
Node.js (v18+)

MetaMask wallet connected to Sepolia Testnet

Testnet ETH and LINK (available via Chainlink Faucets)

1. Start the Frontend
Navigate to the frontend directory, install dependencies, and start the Vite development server:

Bash
cd frontend
npm install
npm run dev
The trading terminal will be live at http://localhost:5173.

2. Start the Matching Engine
Open a new terminal window in the root directory, install dependencies, and run the matcher script to listen for and execute trades on Sepolia:

Bash
npm install
npx hardhat run run-matcher.ts --network sepolia
📜 Usage Workflow
Maker Order (Account 1): Connect to the frontend and submit an order to sell ETH for LINK.

Taker Order (Account 2): Switch accounts, approve LINK, and submit a complementary order to sell LINK for ETH based on the live conversion rate.

Settlement: The run-matcher.ts engine will detect the complementary pair, verify the Chainlink prices, and broadcast the settlement transaction. The dashboard will instantly update from "Listed" to "Settled".

👤 Acknowledgements
Developed by Nilanjan.
