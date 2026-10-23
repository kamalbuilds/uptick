import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeFunctionResult, parseAbi, type Hex } from "viem";
import { ParentBlockTimeout, depositParentBlock, parentBlockNumber, waitForParentBlockAfter, type ParentBlockReader } from "./parent-block.ts";
import { MULTICALL3 } from "./scan.ts";

const abi = parseAbi(["function getBlockNumber() view returns (uint256 blockNumber)"]);
const answer = (n: bigint): { data: Hex } => ({ data: encodeFunctionResult({ abi, functionName: "getBlockNumber", result: n }) });

/** A node whose Multicall3 answers `head()` at the latest block and `history[l2]` at an L2 block, and records what it was asked. */
function node(head: () => bigint, history: Record<string, bigint> = {}) {
  const asked: { to: string; fn: string; at?: bigint }[] = [];
  const client: ParentBlockReader = {
    async call({ to, data, blockNumber }) {
      asked.push({ to, fn: decodeFunctionData({ abi, data }).functionName, at: blockNumber });
      if (blockNumber === undefined) return answer(head());
      const v = history[blockNumber.toString()];
      if (v === undefined) throw new Error("historical state is not available");
      return answer(v);
    },
  };
  return { client, asked };
}

const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
};

test("the parent block is read from Multicall3.getBlockNumber, not eth_blockNumber", async () => {
  const { client, asked } = node(() => 26_256_841n);
  assert.equal(await parentBlockNumber(client), 26_256_841n);
  assert.deepEqual(asked, [{ to: MULTICALL3, fn: "getBlockNumber", at: undefined }]);
});

test("the deposit's parent block is read at the receipt's L2 block, and falls back to the latest when that state is gone", async () => {
  const a = node(() => 26_256_900n, { "96115800": 26_256_841n });
  assert.equal(await depositParentBlock(a.client, 96_115_800n), 26_256_841n);
  const b = node(() => 26_256_900n);
  assert.equal(await depositParentBlock(b.client, 96_115_800n), 26_256_900n, "never below the deposit's block");
  assert.equal(await depositParentBlock(b.client, undefined), 26_256_900n);
});

test("the wait ends only when the parent block is strictly above the deposit's", async () => {
  const c = clock();
  let reads = 0;
  const { client } = node(() => (++reads < 4 ? 100n : 101n)); // 100 for three polls, then 101
  const head = await waitForParentBlockAfter(client, 100n, { pollMs: 2_000, ...c });
  assert.equal(head, 101n);
  assert.equal(reads, 4, "kept polling while the block was equal to the deposit's");
  assert.equal(c.now(), 6_000, "slept between the polls, not after the last");
});

test("a block already past the deposit's returns at once", async () => {
  const c = clock();
  const { client } = node(() => 205n);
  assert.equal(await waitForParentBlockAfter(client, 204n, c), 205n);
  assert.equal(c.now(), 0);
});

test("a parent block that never advances times out with a clear error", async () => {
  const c = clock();
  const { client } = node(() => 100n);
  await assert.rejects(waitForParentBlockAfter(client, 100n, { timeoutMs: 20_000, pollMs: 2_000, ...c }), (e: unknown) => {
    assert.ok(e instanceof ParentBlockTimeout);
    assert.match((e as Error).message, /did not reach its next block within 20 seconds.*deposit is confirmed/);
    return true;
  });
  assert.ok(c.now() >= 20_000);
});

test("a failing RPC delays the wait and never ends it", async () => {
  const c = clock();
  let reads = 0;
  const client: ParentBlockReader = {
    async call() {
      reads++;
      if (reads < 3) throw new Error("429");
      return answer(reads < 5 ? 100n : 101n);
    },
  };
  assert.equal(await waitForParentBlockAfter(client, 100n, c), 101n);
  assert.equal(reads, 5);
  const dead: ParentBlockReader = { async call() { throw new Error("down"); } };
  await assert.rejects(waitForParentBlockAfter(dead, 100n, { timeoutMs: 6_000, ...clock() }), ParentBlockTimeout);
});
