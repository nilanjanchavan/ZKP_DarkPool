require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
require("ts-node/register");
const { NETWORKS } = require("./config/networks");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    mainnet: {
      chainId: 1,
      url: process.env.MAINNET_RPC_URL || NETWORKS[1].RPC_URL,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    arbitrum: {
      chainId: 42161,
      url: process.env.ARBITRUM_RPC_URL || NETWORKS[42161].RPC_URL,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    sepolia: {
      chainId: 11155111,
      url: process.env.SEPOLIA_RPC_URL || NETWORKS[11155111].RPC_URL,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};
