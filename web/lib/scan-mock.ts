import assert from "node:assert/strict";
import { createPublicClient, custom, decodeFunctionData, encodeAbiParameters, encodeFunctionResult, multicall3Abi, parseAbi, toHex, type Address, type Hex } from "viem";
import { MULTICALL3, type ScanVault } from "./scan.ts";

/** A mock chain for the wallet scan's tests, shared by web/lib/scan.test.ts and api/test/scan-wallet.test.ts. It answers the RPC the scan sends by
 *  decoding it: eth_blockNumber, and Multicall3.aggregate3 with each inner balanceOf, latestRoundData and decimals decoded against the tracked
 *  tokens and feeds. A call to an address that is not tracked fails the test. */

export const HEAD = 95_900_000n;
export const E18 = 10n ** 18n;
/** An 8-decimal Chainlink answer for a USD price. */
export const px = (usd: number): bigint => BigInt(Math.round(usd * 1e8));

const abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

export type Seen = { to: string; fn: string; args: readonly unknown[] };

/** `balances` is token address (lowercase) -> base units; `prices` is feed address (lowercase) -> 8-decimal answer, and an absent feed makes its calls fail. */
export function mockChain(vaults: readonly ScanVault[], balances: Record<string, bigint>, prices: Record<string, bigint>, opts: { failBalanceOf?: string; rpcError?: string } = {}) {
  const ethCalls: Array<{ to: string; at: unknown; inner: Seen[] }> = [];
  const rpc: string[] = [];
  const tokenAt = new Map(vaults.map((v) => [v.token.toLowerCase(), v]));
  const feedAt = new Map(vaults.map((v) => [v.feed.toLowerCase(), v]));
  const client = createPublicClient({
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        rpc.push(method);
        if (opts.rpcError) throw new Error(opts.rpcError);
        if (method === "eth_blockNumber") return toHex(HEAD);
        if (method !== "eth_call") throw new Error(`unexpected RPC method ${method}`);
        const [{ to, data }, at] = params as [{ to: string; data: Hex }, unknown];
        assert.equal(to.toLowerCase(), MULTICALL3.toLowerCase(), "every eth_call goes to Multicall3");
        const outer = decodeFunctionData({ abi: multicall3Abi, data });
        assert.equal(outer.functionName, "aggregate3");
        const calls = (outer.args as [readonly { target: Address; allowFailure: boolean; callData: Hex }[]])[0];
        const inner: Seen[] = [];
        const out = calls.map((c) => {
          const target = c.target.toLowerCase();
          const call = decodeFunctionData({ abi, data: c.callData });
          inner.push({ to: target, fn: call.functionName, args: call.args ?? [] });
          if (call.functionName === "balanceOf") {
            const v = tokenAt.get(target);
            assert.ok(v, `balanceOf sent to an untracked address ${target}`);
            if (opts.failBalanceOf === v.symbol) return { success: false, returnData: "0x" as Hex };
            return { success: true, returnData: encodeFunctionResult({ abi, functionName: "balanceOf", result: balances[v.token.toLowerCase()] ?? 0n }) };
          }
          const v = feedAt.get(target);
          assert.ok(v, `feed call sent to an untracked address ${target}`);
          const answer = prices[v.feed.toLowerCase()];
          if (answer === undefined) return { success: false, returnData: "0x" as Hex };
          return call.functionName === "decimals"
            ? { success: true, returnData: encodeFunctionResult({ abi, functionName: "decimals", result: 8 }) }
            : { success: true, returnData: encodeFunctionResult({ abi, functionName: "latestRoundData", result: [1n, answer, 0n, 1_790_000_000n, 1n] }) };
        });
        ethCalls.push({ to, at, inner });
        return encodeAbiParameters([{ type: "tuple[]", components: [{ type: "bool", name: "success" }, { type: "bytes", name: "returnData" }] }], [out]);
      },
    }),
  });
  return { client, ethCalls, rpc };
}
