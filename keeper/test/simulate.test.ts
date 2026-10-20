import { expect, test } from "bun:test";
import { createPublicClient, custom, RpcRequestError, toFunctionSelector, type Address } from "viem";
import { simulateRebalance } from "../src/simulate.ts";

const VAULT: Address = "0x000000000000000000000000000000000000dEaD";
const KEEPER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

// A node that answers eth_call the way geth/anvil do for a reverting contract: JSON-RPC error code 3 carrying the revert data.
const node = (data: `0x${string}` | null) =>
  createPublicClient({
    transport: custom({
      async request({ method }) {
        if (method === "eth_chainId") return "0x1237";
        if (method !== "eth_call") throw new Error(`unexpected ${method}`);
        if (data === null) return "0x";
        throw new RpcRequestError({ body: { method }, url: "test://node", error: { code: 3, message: "execution reverted", data } });
      },
    }),
  });

test("SpotOffTwap in the eth_call simulation is returned by name, not thrown", async () => {
  const r = await simulateRebalance(node(toFunctionSelector("SpotOffTwap()")), VAULT, KEEPER);
  expect(r).toEqual({ ok: false, error: "SpotOffTwap()" });
});

test("TwapOffOracle in the eth_call simulation is returned by name, not thrown", async () => {
  const r = await simulateRebalance(node(toFunctionSelector("TwapOffOracle()")), VAULT, KEEPER);
  expect(r).toEqual({ ok: false, error: "TwapOffOracle()" });
});

test("OracleUnhealthy keeps its argument", async () => {
  const data = (toFunctionSelector("OracleUnhealthy(uint8)") + "2".padStart(64, "0")) as `0x${string}`;
  const r = await simulateRebalance(node(data), VAULT, KEEPER);
  expect(r).toEqual({ ok: false, error: "OracleUnhealthy(2)" });
});

test("a clean simulation returns the request to send", async () => {
  const r = await simulateRebalance(node(null), VAULT, KEEPER);
  expect(r.ok).toBe(true);
});
