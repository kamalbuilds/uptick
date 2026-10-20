import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const routerAbi = parseAbi([
  "function depositUsdg(address vault, uint256 usdgIn, uint256 minShares, address receiver) returns (uint256 shares)",
]);

export const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function previewWithdraw(uint256 assets) view returns (uint256)",
  "function health() view returns (uint8 status, uint256 price, uint256 updatedAt, uint160 sqrtOracle, uint160 sqrtTwap, uint160 sqrtSpot)",
  "function maxWithdraw(address owner) view returns (uint256)",
  "function maxDeposit(address receiver) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function redeemInKind(uint256 shares, address receiver, address owner) returns (uint256 stockOut, uint256 usdgOut)",
  "function totalStockOwed() view returns (uint256)",
  "function stock() view returns (address)",
  "function usdg() view returns (address)",
  "function positionInfo() view returns ((uint256 tokenId, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 stockAmount, uint256 usdgAmount, uint256 uncollectedStock, uint256 uncollectedUsdg, bool inRange) info)",
]);
