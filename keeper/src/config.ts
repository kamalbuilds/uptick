import { defineChain, type Address, type Hex } from "viem";

export const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const USDG_DECIMALS = 6;
export const STOCK_DECIMALS = 18;

interface TickerBase {
  id: string; // lowercase ticker, used in URLs and env names
  symbol: string;
  name: string;
  stock: Address;
  feeTier: number; // pool fee in pips (v3 fee tier, or the v4 pool key's fee)
  feed: Address; // Chainlink AggregatorV3 proxy
  stockIsToken0: boolean; // both venues order by address; verified against the pool (v3) or the vault (v4) at startup
  rangeBps: number; // half-width of the vault's band in bps (data/params.json range_bps, 500 where the token has no entry)
  capUsd: number; // vault size in USD: the deposit cap the vault is created with (data/universe.json cap_usd; for a v4 vault, its pool's cap_usd in data/replay.json chosen_v4)
  vault?: Address;
  deployBlock?: bigint;
}

/** A StockVault on the replay's chosen Uniswap v3 pool. */
export interface TickerV3 extends TickerBase { venue: "v3"; pool: Address; poolId?: undefined }
/** A StockVaultV4 on the replay's chosen Uniswap v4 pool (PoolManager singleton, identified by its pool id). It has no pool address. */
export interface TickerV4 extends TickerBase { venue: "v4"; poolId: Hex; pool?: undefined }
export type Ticker = TickerV3 | TickerV4;

export const MAX_DEV_BPS = Number(process.env.MAX_DEV_BPS || 200); // pool vs Chainlink, 2%
export const CL_MAX_AGE_S = Number(process.env.CL_MAX_AGE_S || 86400 + 600); // feed heartbeat 86400 s plus grace
export const OOR_MINUTES = 30; // spike engine oor_minutes
export const MIN_GAP_H = 2; // spike engine oor_min_gap_h
export const LOG_PAGE_BLOCKS = 200_000n;
export const LOG_MAX_PAGES = 60;
