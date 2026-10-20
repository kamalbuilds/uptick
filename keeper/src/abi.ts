import { parseAbi } from "viem";

export const vaultAbi = parseAbi([
  "function rebalance()",
  "function health() view returns (uint8 status, uint256 price, uint256 updatedAt, uint160 sqrtOracle, uint160 sqrtTwap, uint160 sqrtSpot)",
  "function positionInfo() view returns (bytes)",
  "function totalValueInUSDG() view returns (uint256)",
  "function feesEarnedLifetime() view returns (uint256)",
  "function currentRange() view returns (int24, int24)",
  "function pricePerShare() view returns (uint256)",
  "event Rebalanced(int24 tickLower, int24 tickUpper, uint256 fees0, uint256 fees1)",
  "event FeesCollected(uint256 fees0, uint256 fees1, uint256 feeValueInStock, uint256 treasuryShares)",
  "error SpotOffTwap()",
  "error TwapOffOracle()",
  "error OracleUnhealthy(uint8 status)",
  "error TooSoon()",
  "error NotKeeper()",
  "error SwapBelowMinimum(uint256 got, uint256 wanted)",
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
