import { parseAbi } from "viem";

export const vaultAbi = parseAbi([
  "function rebalance()",
  "function positionInfo() view returns (bytes)",
  "function totalValueInUSDG() view returns (uint256)",
  "function feesEarnedLifetime() view returns (uint256)",
  "function currentRange() view returns (int24, int24)",
  "function pricePerShare() view returns (uint256)",
  "event Rebalanced(int24 tickLower, int24 tickUpper, uint256 fees0, uint256 fees1)",
  "event FeesCollected(uint256 amount0, uint256 amount1)",
  "event Deposited(address indexed user, uint256 amount, uint256 shares)",
  "event Withdrawn(address indexed user, uint256 amount, uint256 shares)",
]);

export const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function liquidity() view returns (uint128)",
]);

export const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);
