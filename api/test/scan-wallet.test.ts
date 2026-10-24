import { describe, expect, test } from "bun:test";
import { createPublicClient, http, parseAbi, parseUnits, toHex } from "viem";
import { handleMcp, scanPayload, scanVaults, type Env } from "../src/mcp";
import { READ_LAG, RHC_RPCS, scanWallet } from "../src/shared/scan.ts";
import { E18, HEAD, mockChain, px } from "../../web/lib/scan-mock.ts";

const OWNER = "0x28C66690Ae101a4f07546b07a2Ac8Eb439b6C245";
const VAULTS = scanVaults();
const by = (id: string) => VAULTS.find((v) => v.id === id)!;
const env: Env = { NETWORK: "robinhood-chain" } as Env;

type ToolResult = { content: Array<{ type: string; text: string }>; structuredContent: Record<string, any>; isError?: boolean };

async function scan(args: Record<string, unknown>, deps: Parameters<typeof handleMcp>[2], e: Env = env): Promise<ToolResult> {
  const res = await handleMcp(
    new Request("https://uptick-evidence.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "scan_wallet", arguments: args } }),
    }),
    e,
    deps,
  );
  return ((await res.json()) as { result: ToolResult }).result;
}

/** Every feed answers $200 unless a price is given for it. */
const prices = (by_: Record<string, number> = {}) => Object.fromEntries(VAULTS.map((v) => [v.feed.toLowerCase(), px(by_[v.id] ?? 200)]));

describe("scan_wallet against a mock chain that decodes the RPC", () => {
  test("reads every balance and feed in one eth_call at head less the lag and returns holdings, totals and the closed vault's reason", async () => {
    const nvda = by("nvda"), aapl = by("aapl"), tsla = by("tsla");
    const chain = mockChain(VAULTS, { [nvda.token.toLowerCase()]: 10n * E18, [aapl.token.toLowerCase()]: 3n * E18, [tsla.token.toLowerCase()]: E18 / 2n }, prices({ aapl: 250, tsla: 400 }));
    const r = await scan({ address: OWNER.toLowerCase() }, { scanClient: chain.client });
    expect(r.isError).toBeUndefined();

    // the RPC the tool sent: the owner is the argument of every balanceOf, every tracked token and feed is read once, in one call at one block
    expect(chain.rpc).toEqual(["eth_blockNumber", "eth_call"]);
    expect(chain.ethCalls[0].at).toBe(toHex(HEAD - READ_LAG));
    const inner = chain.ethCalls[0].inner;
    expect(inner.length).toBe(17 + 34);
    expect(inner.slice(0, 17).map((c) => c.to)).toEqual(VAULTS.map((v) => v.token.toLowerCase()));
    for (const c of inner.slice(0, 17)) expect((c.args[0] as string).toLowerCase()).toBe(OWNER.toLowerCase());
    expect(inner.slice(17).filter((_, i) => i % 2 === 0).map((c) => c.to)).toEqual(VAULTS.map((v) => v.feed.toLowerCase()));

    const p = r.structuredContent;
    expect(p.owner).toBe(OWNER);
    expect(p.chain_id).toBe(4663);
    expect(p.block).toBe(Number(HEAD - READ_LAG));
    expect(p.tracked).toBe(17);
    expect(p.holdings.map((h: any) => h.ticker)).toEqual(["NVDA", "AAPL", "TSLA"]);

    const h = (t: string) => p.holdings.find((x: any) => x.ticker === t);
    expect(h("NVDA").holding_usd).toBe(2000);
    expect(h("NVDA").gate_state).toBe("reduced");
    expect(h("NVDA").can_deposit).toBe(true);
    expect(h("NVDA").put_to_work_usd).toBe(2000);
    expect(h("NVDA").kept_per_year_usd).toBe(Math.round(((2000 * (10_000 - nvda.entryFeeBps)) / 10_000) * nvda.gate.worstHalfApr) / 100);
    expect(h("NVDA").borrow.status).toBe("opens_with_market");
    expect(h("TSLA").gate_state).toBe("closed");
    expect(h("TSLA").can_deposit).toBe(false);
    expect(h("TSLA").put_to_work_usd).toBeNull();
    expect(h("TSLA").borrow.status).toBe("none");

    expect(p.totals.idle_usd).toBe(2000 + 750 + 200);
    expect(p.totals.put_to_work.tokens).toBe(2);
    expect(p.totals.put_to_work.usd).toBe(2750);
    expect(p.totals.refused.tokens).toBe(1);
    expect(p.totals.refused.reasons[0].ticker).toBe("TSLA");
    expect(p.totals.refused.reasons[0].reason).toBe(tsla.gate.reason);
    expect(p.kept_basis).toContain("not a forecast");
    // the text content is the same payload
    expect(JSON.parse(r.content[0].text)).toEqual(p);
  });

  test("an empty wallet answers with no holdings and zero totals", async () => {
    const chain = mockChain(VAULTS, {}, prices());
    const r = await scan({ address: "0x0000000000000000000000000000000000000000" }, { scanClient: chain.client });
    expect(r.structuredContent.holdings).toEqual([]);
    expect(r.structuredContent.tracked).toBe(17);
    expect(r.structuredContent.totals.idle_usd).toBe(0);
    expect(r.structuredContent.totals.put_to_work.tokens).toBe(0);
  });

  test("a held token with no usable price is listed unpriced and left out of the totals", async () => {
    const nvda = by("nvda");
    const chain = mockChain(VAULTS, { [nvda.token.toLowerCase()]: E18 }, { ...prices(), [nvda.feed.toLowerCase()]: 0n });
    const r = await scan({ address: OWNER }, { scanClient: chain.client });
    expect(r.structuredContent.holdings[0].holding_usd).toBeNull();
    expect(r.structuredContent.holdings[0].price_usd).toBeNull();
    expect(r.structuredContent.totals.unpriced).toEqual(["NVDA"]);
    expect(r.structuredContent.totals.idle_usd).toBe(0);
  });

  test("a configured market shows borrow room at its limit, and a total only when every working token has one", async () => {
    const nvda = by("nvda"), aapl = by("aapl");
    const chain = mockChain(VAULTS, { [nvda.token.toLowerCase()]: 10n * E18, [aapl.token.toLowerCase()]: 10n * E18 }, prices());
    const lltv = { nvda: 625_000_000_000_000_000n, aapl: 860_000_000_000_000_000n };
    const both = scanPayload(env, await scanWallet(chain.client, OWNER, VAULTS, lltv)) as any;
    const n = both.holdings.find((x: any) => x.ticker === "NVDA");
    expect(n.borrow).toEqual({ status: "room", max_usd: Math.round(((2000 * (10_000 - nvda.entryFeeBps)) / 10_000) * 0.625 * 100) / 100, lltv_pct: 62.5 });
    expect(both.totals.put_to_work.borrow_room_usd).toBe(
      Math.round((((2000 * (10_000 - nvda.entryFeeBps)) / 10_000) * 0.625 + ((2000 * (10_000 - aapl.entryFeeBps)) / 10_000) * 0.86) * 100) / 100,
    );
    const one = scanPayload(env, await scanWallet(chain.client, OWNER, VAULTS, { nvda: lltv.nvda })) as any;
    expect(one.totals.put_to_work.borrow_room_usd).toBeNull();
  });

  test("a malformed address, a name, or no address is refused before any RPC is sent", async () => {
    const chain = mockChain(VAULTS, {}, prices());
    for (const address of ["0x1234", "vitalik.eth", "", OWNER.slice(0, 10) + OWNER.slice(10).toUpperCase(), undefined, 42]) {
      const r = await scan({ address }, { scanClient: chain.client });
      expect(r.isError).toBe(true);
      expect(r.structuredContent.error).toContain("valid 0x wallet address");
    }
    expect(chain.rpc).toEqual([]);
  });

  test("an RPC failure is a tool error naming the read, not an empty wallet", async () => {
    const chain = mockChain(VAULTS, {}, prices(), { rpcError: "upstream 429" });
    const r = await scan({ address: OWNER }, { scanClient: chain.client });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toContain("could not read Robinhood Chain");
    expect(r.structuredContent.holdings).toBeUndefined();
  });
});

describe("scan_wallet reads the room a live vault has left", () => {
  const AAPL = "0x127eCb0e814EF0cC296910DFd5E946050d85534f";
  const live: Env = { NETWORK: "robinhood-chain", VAULTS: JSON.stringify({ aapl: AAPL }) } as Env;

  test("a vault named in VAULTS is asked for maxDeposit(owner) in the same call, and takes the lesser of the holding and that room", async () => {
    const liveVaults = scanVaults(live);
    const aapl = liveVaults.find((v) => v.id === "aapl")!;
    expect(aapl.vault).toBe(AAPL);
    const nvda = liveVaults.find((v) => v.id === "nvda")!;
    expect(nvda.vault).toBeUndefined();
    const chain = mockChain(liveVaults, { [aapl.token.toLowerCase()]: 100n * E18, [nvda.token.toLowerCase()]: 10n * E18 }, Object.fromEntries(liveVaults.map((v) => [v.feed.toLowerCase(), px(200)])), { rooms: { [AAPL.toLowerCase()]: 5n * E18 } });
    const r = await scan({ address: OWNER }, { scanClient: chain.client }, live);
    expect(r.isError).toBeUndefined();
    expect(chain.rpc).toEqual(["eth_blockNumber", "eth_call"]);
    const inner = chain.ethCalls[0].inner;
    expect(inner.length).toBe(17 + 34 + 1);
    expect([inner[51].fn, inner[51].to]).toEqual(["maxDeposit", AAPL.toLowerCase()]);
    expect((inner[51].args[0] as string).toLowerCase()).toBe(OWNER.toLowerCase());

    const h = (t: string) => r.structuredContent.holdings.find((x: any) => x.ticker === t);
    expect(h("AAPL").vault).toBe(AAPL);
    expect(h("AAPL").room_usd).toBe(1000);
    expect(h("AAPL").holding_usd).toBe(20_000);
    expect(h("AAPL").put_to_work_usd).toBe(1000);
    expect(h("NVDA").vault).toBeNull();
    expect(h("NVDA").room_usd).toBeNull();
    expect(h("NVDA").put_to_work_usd).toBe(2000);
    const w = r.structuredContent.totals.put_to_work;
    expect(w.live).toEqual({ usd: 1000, tickers: ["AAPL"] });
    expect(w.launching).toEqual({ usd: 2000, tickers: ["NVDA"] });
    expect(w.usd).toBe(3000);
  });

  test("a paused vault reports no room, cannot be deposited into, and is named in full_tickers", async () => {
    const liveVaults = scanVaults(live);
    const aapl = liveVaults.find((v) => v.id === "aapl")!;
    const chain = mockChain(liveVaults, { [aapl.token.toLowerCase()]: 100n * E18 }, Object.fromEntries(liveVaults.map((v) => [v.feed.toLowerCase(), px(200)])), { rooms: { [AAPL.toLowerCase()]: 0n } });
    const p = (await scan({ address: OWNER }, { scanClient: chain.client }, live)).structuredContent;
    expect(p.holdings[0].room_usd).toBe(0);
    expect(p.holdings[0].put_to_work_usd).toBe(0);
    expect(p.holdings[0].can_deposit).toBe(false);
    expect(p.totals.put_to_work.full_tickers).toEqual(["AAPL"]);
    expect(p.totals.put_to_work.live.usd).toBe(0);
  });

  test("a malformed VAULTS entry leaves the vault launching and sends no maxDeposit", async () => {
    const bad: Env = { NETWORK: "robinhood-chain", VAULTS: JSON.stringify({ aapl: "0x1234" }) } as Env;
    const liveVaults = scanVaults(bad);
    expect(liveVaults.every((v) => v.vault === undefined)).toBe(true);
  });
});

// A real wallet on the real chain: the top non-contract holder of the NVDA Stock Token on Blockscout,
// https://robinhoodchain.blockscout.com/api/v2/tokens/0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC/holders, read 2026-10-23.
describe("scan_wallet live on Robinhood Chain 4663", () => {
  test("a known holder: balances match an independent balanceOf at the same block, prices come from Chainlink, totals add up", async () => {
    const r = await scan({ address: OWNER }, {});
    expect(r.isError).toBeUndefined();
    const p = r.structuredContent;
    expect(p.holdings.length).toBeGreaterThan(0);
    expect(p.block).toBeGreaterThan(90_000_000);
    expect(p.totals.idle_usd).toBeGreaterThan(0);
    const priced = p.holdings.filter((h: any) => h.holding_usd !== null);
    expect(priced.length).toBe(p.holdings.length);
    expect(Math.abs(priced.reduce((a: number, h: any) => a + h.holding_usd, 0) - p.totals.idle_usd)).toBeLessThan(0.05);
    expect(p.totals.put_to_work.tokens + p.totals.refused.tokens).toBe(p.holdings.length);

    // independent read: a different endpoint, a plain balanceOf per token, pinned to the block the tool reported
    const independent = createPublicClient({ transport: http(RHC_RPCS[1]) });
    const abi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
    for (const h of p.holdings as Array<{ id: string; token: `0x${string}`; balance: string }>) {
      const raw = await independent.readContract({ address: h.token, abi, functionName: "balanceOf", args: [OWNER], blockNumber: BigInt(p.block) });
      expect(parseUnits(h.balance, 18)).toBe(raw);
    }
    // and every tracked token this wallet does not hold is absent
    const held = new Set(p.holdings.map((h: any) => h.id));
    for (const v of VAULTS.filter((x) => !held.has(x.id))) {
      const raw = await independent.readContract({ address: v.token, abi, functionName: "balanceOf", args: [OWNER], blockNumber: BigInt(p.block) });
      expect(raw).toBe(0n);
    }
  }, 60_000);

  test("the zero address holds none of the 17 Stock Tokens", async () => {
    const r = await scan({ address: "0x0000000000000000000000000000000000000000" }, {});
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent.holdings).toEqual([]);
    expect(r.structuredContent.tracked).toBe(17);
    expect(r.structuredContent.block).toBeGreaterThan(90_000_000);
  }, 60_000);
});
