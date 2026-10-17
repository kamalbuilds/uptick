import { defineChain, type Address } from "viem";

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

export interface Ticker {
  id: string; // lowercase ticker, used in URLs and env names
  symbol: string;
  stock: Address;
  pool: Address;
  feeTier: number;
  feed: Address; // Chainlink AggregatorV3 proxy
  stockIsToken0: boolean; // v3 orders by address; verified against pool.token0() at startup
  vault?: Address;
  deployBlock?: bigint;
}

const base: Omit<Ticker, "vault" | "deployBlock">[] = [
  { id: "nvda", symbol: "NVDA", stock: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", pool: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3", feeTier: 500, feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", stockIsToken0: false },
  { id: "tsla", symbol: "TSLA", stock: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", pool: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3", feeTier: 3000, feed: "0x4A1166a659A55625345e9515b32adECea5547C38", stockIsToken0: true },
  { id: "spcx", symbol: "SPCX", stock: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", pool: "0xc61284332117c3FB23A2A56cceFFD07F7aF60029", feeTier: 500, feed: "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb", stockIsToken0: true },
];

export function loadTickers(env: Record<string, string | undefined> = process.env): Ticker[] {
  return base.map((t) => {
    const S = t.symbol;
    const vault = env[`VAULT_ADDRESS_${S}`]?.trim() as Address | undefined;
    if (vault && !/^0x[0-9a-fA-F]{40}$/.test(vault)) throw new Error(`VAULT_ADDRESS_${S} is not an address`);
    const db = env[`VAULT_DEPLOY_BLOCK_${S}`]?.trim();
    if (vault && !db) throw new Error(`VAULT_DEPLOY_BLOCK_${S} is required when VAULT_ADDRESS_${S} is set (bounded getLogs start)`);
    return { ...t, vault: vault || undefined, deployBlock: db ? BigInt(db) : undefined };
  });
}

export const MAX_DEV_BPS = Number(process.env.MAX_DEV_BPS || 200); // pool vs Chainlink, 2%
export const CL_MAX_AGE_S = Number(process.env.CL_MAX_AGE_S || 86400 + 600); // feed heartbeat 86400 s plus grace
export const OOR_MINUTES = 30; // spike engine oor_minutes
export const MIN_GAP_H = 2; // spike engine oor_min_gap_h
export const LOG_PAGE_BLOCKS = 200_000n;
export const LOG_MAX_PAGES = 60;
