import { createPublicClient, custom, decodeFunctionData, encodeFunctionResult, getAddress, toHex, type Abi, type PublicClient } from "viem";
import { erc20Abi, vaultAbi } from "../src/shared/abis.ts";
import { MORPHO_BLUE, irmAbi, marketId, morphoAbi, oracleAbi, type MarketEntry, type MarketParams } from "../src/shared/morpho.ts";

export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
export const VAULT = getAddress("0x00000000000000000000000000000000000a11c3");
export const BORROWER = getAddress("0x00000000000000000000000000000000000b0b01");
export const ORACLE = getAddress("0xB1E9aE2B51875b5A0Af7290189Bdd77F9758eE3A");
export const IRM = getAddress("0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1");
export const LLTV = 625_000_000_000_000_000n;
export const ENTRY: MarketEntry = { oracle: ORACLE, irm: IRM, lltv: LLTV };
export const MARKET: MarketParams = { loanToken: USDG, collateralToken: VAULT, oracle: ORACLE, irm: IRM, lltv: LLTV };
export const MARKET_ID = marketId(MARKET);

/** What the fake node holds. Mutate it between calls to move the position or the price. */
export type Chain = {
  now: bigint;
  market: { totalSupplyAssets: bigint; totalSupplyShares: bigint; totalBorrowAssets: bigint; totalBorrowShares: bigint; lastUpdate: bigint; fee: bigint } | null;
  rate: bigint;
  price: bigint;
  positions: Record<string, { supplyShares: bigint; borrowShares: bigint; collateral: bigint }>;
  usdg: Record<string, bigint>;
  allowance: Record<string, bigint>;
  /** What redeemInKind(all collateral) returns; null makes the vault call revert. */
  inKind: { stock: bigint; usdg: bigint } | null;
  /** Count of JSON-RPC requests, to check that a run batches its reads. */
  requests: number;
};

export const NOW = 1_800_000_000n;
export function freshChain(): Chain {
  return {
    now: NOW,
    market: {
      totalSupplyAssets: 1_000_000n * 10n ** 6n, totalSupplyShares: 1_000_000n * 10n ** 12n,
      totalBorrowAssets: 400_000n * 10n ** 6n, totalBorrowShares: 400_000n * 10n ** 12n, lastUpdate: NOW - 3n * 86_400n, fee: 0n,
    },
    rate: 2_536_783_358n,
    price: 200n * 10n ** 18n, // a $200 share
    positions: { [BORROWER.toLowerCase()]: { supplyShares: 0n, borrowShares: 9_000n * 10n ** 12n, collateral: 100n * 10n ** 24n } },
    usdg: {},
    allowance: {},
    inKind: { stock: 50n * 10n ** 18n / 1n, usdg: 10_000n * 10n ** 6n },
    requests: 0,
  };
}

const abis: Abi[] = [morphoAbi, oracleAbi, irmAbi, erc20Abi, vaultAbi];

function answer(chain: Chain, to: string, data: `0x${string}`): `0x${string}` {
  for (const abi of abis) {
    let call: { functionName: string; args?: readonly unknown[] };
    try {
      call = decodeFunctionData({ abi, data });
    } catch {
      continue;
    }
    const out = (value: unknown) => encodeFunctionResult({ abi, functionName: call.functionName, result: value } as never);
    const arg = (i: number) => call.args![i];
    switch (call.functionName) {
      case "market": {
        if (arg(0) !== MARKET_ID || !chain.market) return out([0n, 0n, 0n, 0n, 0n, 0n]);
        const m = chain.market;
        return out([m.totalSupplyAssets, m.totalSupplyShares, m.totalBorrowAssets, m.totalBorrowShares, m.lastUpdate, m.fee]);
      }
      case "position": {
        const p = chain.positions[String(arg(1)).toLowerCase()] ?? { supplyShares: 0n, borrowShares: 0n, collateral: 0n };
        return out([p.supplyShares, p.borrowShares, p.collateral]);
      }
      case "price":
        return out(chain.price);
      case "borrowRateView":
        return out(chain.rate);
      case "balanceOf":
        return out(chain.usdg[String(arg(0)).toLowerCase()] ?? 0n);
      case "allowance":
        return out(chain.allowance[String(arg(0)).toLowerCase()] ?? 0n);
      case "redeemInKind":
        if (!chain.inKind) throw Object.assign(new Error("execution reverted"), { code: 3, data: "0x" });
        return out([chain.inKind.stock, chain.inKind.usdg]);
      default:
        throw new Error(`fake chain: unhandled ${call.functionName} on ${to}`);
    }
  }
  throw new Error(`fake chain: unknown selector ${data.slice(0, 10)} on ${to}`);
}

/** A viem client over an in-memory JSON-RPC node that answers the reads the Worker makes with the state in `chain`. */
export function fakeClient(chain: Chain): PublicClient {
  const request = async ({ method, params }: { method: string; params?: unknown }) => {
    chain.requests++;
    const p = (params ?? []) as unknown[];
    switch (method) {
      case "eth_chainId":
        return toHex(4663);
      case "eth_getBlockByNumber":
        return {
          number: "0x5b8f000", hash: `0x${"11".repeat(32)}`, parentHash: `0x${"22".repeat(32)}`, timestamp: toHex(chain.now), gasLimit: "0x1", gasUsed: "0x0",
          miner: `0x${"00".repeat(20)}`, nonce: "0x0000000000000000", difficulty: "0x0", totalDifficulty: "0x0", size: "0x1", extraData: "0x", logsBloom: `0x${"00".repeat(256)}`,
          transactions: [], uncles: [], sha3Uncles: `0x${"33".repeat(32)}`, stateRoot: `0x${"44".repeat(32)}`, receiptsRoot: `0x${"55".repeat(32)}`, transactionsRoot: `0x${"66".repeat(32)}`,
        };
      case "eth_call": {
        const tx = p[0] as { to: string; data: `0x${string}` };
        return answer(chain, tx.to, tx.data);
      }
      default:
        throw new Error(`fake chain: unhandled method ${method}`);
    }
  };
  return createPublicClient({ transport: custom({ request }, { retryCount: 0 }) });
}

export { MORPHO_BLUE };
