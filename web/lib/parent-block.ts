import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";
import { MULTICALL3 } from "./scan.ts";

/** What the vault's share lock compares. StockVault._update refuses to move shares minted in the current `block.number`, and on Robinhood Chain (an Arbitrum Orbit chain)
 *  `block.number` inside a contract is the PARENT chain's block number, about 12 s apart, not the L2 block that `eth_blockNumber` returns. Multicall3.getBlockNumber() returns
 *  `block.number` from inside a contract, so it is the number the lock sees. Checked on the public RPC: Multicall3 has code at the canonical address, `eth_blockNumber` was
 *  96,115,822 while getBlockNumber() answered 26,256,841 and moved by one 13 s later. */
const multicall = parseAbi(["function getBlockNumber() view returns (uint256 blockNumber)"]);
const DATA: Hex = encodeFunctionData({ abi: multicall, functionName: "getBlockNumber" });

export type ParentBlockReader = { call(args: { to: `0x${string}`; data: Hex; blockNumber?: bigint }): Promise<{ data?: Hex }> };

/** The parent-chain block number a contract sees: at L2 block `at` when given, else at the latest block. */
export async function parentBlockNumber(client: ParentBlockReader, at?: bigint): Promise<bigint> {
  const res = await client.call({ to: MULTICALL3, data: DATA, ...(at === undefined ? {} : { blockNumber: at }) });
  if (!res.data) throw new Error("Multicall3 getBlockNumber returned no data");
  return decodeFunctionResult({ abi: multicall, functionName: "getBlockNumber", data: res.data });
}

export class ParentBlockTimeout extends Error {
  constructor(seconds: number) {
    super(`The chain did not reach its next block within ${seconds} seconds. Your deposit is confirmed and the shares are in your wallet. Try again in a moment.`);
    this.name = "ParentBlockTimeout";
  }
}

export type WaitOptions = { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number };

/** The parent block a deposit mined in: read at the deposit receipt's L2 block. A node that no longer keeps that state answers with an error; the latest parent block is then a
 *  safe stand-in, since it is never below the deposit's, and the wait that follows is only as long as one more block. */
export async function depositParentBlock(client: ParentBlockReader, depositL2Block: bigint | undefined): Promise<bigint> {
  if (depositL2Block !== undefined) {
    try {
      return await parentBlockNumber(client, depositL2Block);
    } catch {
      /* state at that block is gone or the node is lagging: fall through to latest */
    }
  }
  return parentBlockNumber(client);
}

/** Resolves once the latest parent block is above `after`, polling every `pollMs` (default 2 s), and returns it. Rejects with ParentBlockTimeout after `timeoutMs`
 *  (default 2 minutes, ten parent blocks). A failed read counts as "not yet", so a flaky RPC delays the wait and never ends it early. */
export async function waitForParentBlockAfter(client: ParentBlockReader, after: bigint, opts: WaitOptions = {}): Promise<bigint> {
  const { timeoutMs = 120_000, pollMs = 2_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = opts;
  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      const head = await parentBlockNumber(client);
      if (head > after) return head;
    } catch {
      /* retry until the deadline */
    }
    if (now() >= deadline) throw new ParentBlockTimeout(Math.round(timeoutMs / 1000));
    await sleep(pollMs);
  }
}
