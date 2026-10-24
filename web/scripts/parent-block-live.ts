// Reads the parent-chain block number through web/lib/parent-block.ts against the public Robinhood Chain RPC and waits for it to advance, the wait the app runs between its two batches.
// Usage: node --experimental-strip-types scripts/parent-block-live.ts
import { createPublicClient, http } from "viem";
import { depositParentBlock, parentBlockNumber, waitForParentBlockAfter } from "../lib/parent-block.ts";

const client = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
const l2 = await client.getBlockNumber();
const parent = await parentBlockNumber(client);
console.log(`eth_blockNumber (L2) ${l2}, Multicall3.getBlockNumber (parent) ${parent}`);
if (parent >= l2 || parent <= 0n) throw new Error("the parent block number must be a smaller, positive number than the L2 block");

const at = await depositParentBlock(client, l2 - 5n);
console.log(`parent block at L2 block ${l2 - 5n}: ${at}`);
if (at > parent) throw new Error("a past block cannot have a higher parent block than now");

const t0 = Date.now();
const next = await waitForParentBlockAfter(client, parent);
const secs = (Date.now() - t0) / 1000;
console.log(`parent block advanced ${parent} -> ${next} after ${secs.toFixed(1)} s`);
if (next <= parent) throw new Error("the wait returned without an advance");
