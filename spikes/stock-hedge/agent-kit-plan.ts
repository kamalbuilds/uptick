/** Calls plan_weekend_hedge through the Worker's own MCP handler against the live Lighter RH API and the live chain, and prints the structured result.
 *  Usage: bun spikes/stock-hedge/agent-kit-plan.ts <wallet> <vault> [leverage] */
import { handleMcp, type Env } from "../../api/src/mcp";

const [address, vault, leverage] = process.argv.slice(2);
if (!address || !vault) throw new Error("usage: agent-kit-plan.ts <wallet> <vault> [leverage]");
const args: Record<string, unknown> = { address, vault };
if (leverage) args.leverage = Number(leverage);
const res = await handleMcp(
  new Request("https://uptick-evidence.test/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "plan_weekend_hedge", arguments: args } }),
  }),
  { NETWORK: "robinhood-chain" } as Env,
);
const out = ((await res.json()) as { result: { structuredContent: unknown; isError?: boolean } }).result;
if (out.isError) throw new Error(JSON.stringify(out.structuredContent));
console.log(JSON.stringify(out.structuredContent, null, 2));
