import { parseAbi } from "viem";

export const AggregatorV3InterfaceAbi = parseAbi([
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)",
]);

export const ZKDarkPoolAbi = parseAbi([
  "function getLatestPrice() public view returns (uint256)",
  "function getTokenPrice(address token) public view returns (uint256)",
  "function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData)",
  "function performUpkeep(bytes calldata performData) external",
  "function orders(uint256) external view returns (uint256 id, address trader, address tokenIn, address tokenOut, uint256 amountIn, bool active)",
  "function ordersCount() external view returns (uint256)",
  "event OrderSubmitted(uint256 indexed orderId, address indexed trader, uint256 nullifier, address tokenIn, address tokenOut, uint256 amountIn)",
  "event OrderExecuted(uint256 indexed orderId, address indexed trader, uint256 amountIn, uint256 fillPriceUSD)",
  "event OrderMatched(uint256 indexed orderAId, uint256 indexed orderBId, uint256 priceA, uint256 priceB)",
]);