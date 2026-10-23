import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, custom, decodeFunctionData, encodeAbiParameters, encodeFunctionResult, getAddress, multicall3Abi, parseAbi, toHex, type Hex, type PublicClient } from "viem";
import { handleMcp, scanVaults, type Env } from "../src/mcp";
import { READ_LAG } from "../src/shared/scan.ts";
import { E18, HEAD, mockChain, px } from "../../web/lib/scan-mock.ts";
import { BORROWER, ENTRY, VAULT, freshChain, fakeClient, type Chain } from "./fake-chain";

/** Lighter RH answers recorded from api.rh.lighter.xyz (each file carries its URL and fetch time in _source). The fundings file ends at 2026-10-23T23:26:57Z, so that is the clock. */
const fx = (f: string) => JSON.parse(readFileSync(resolve(import.meta.dir, "../../web/lib/__fixtures__", f), "utf8")) as Record<string, any>;
const details = fx("lighter-orderbookdetails.json");
const assets = fx("lighter-assetdetails.json");
const book = fx("lighter-orderbookorders-nvda.json");
const fundings = fx("lighter-fundings-nvda.json");
const NOW = 1792798017 * 1000;

const OWNER = "0x28C66690Ae101a4f07546b07a2Ac8Eb439b6C245";
const VAULTS = scanVaults();
const by = (id: string) => VAULTS.find((v) => v.id === id)!;
const env: Env = { NETWORK: "robinhood-chain" } as Env;
const NVDA_MULT = 1_000_775_159_164_630_595n;

type ToolResult = { structuredContent: Record<string, any>; isError?: boolean };
const reply = (body: unknown, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

/** Serves the recorded Lighter responses by path, and counts what was asked. */
function lighter(overrides: Partial<Record<string, () => Response>> = {}) {
  const asked: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    asked.push(`${u.pathname}${u.search}`);
    const o = overrides[u.pathname];
    if (o) return o();
    switch (u.pathname) {
      case "/api/v1/orderBookDetails":
        return reply(details);
      case "/api/v1/assetDetails":
        return reply(assets);
      case "/api/v1/orderBookOrders":
        return u.searchParams.get("market_id") === "15" ? reply(book) : reply({ code: 404, message: "no recorded book for this market" }, 404);
      case "/api/v1/fundings":
        return u.searchParams.get("market_id") === "15" ? reply(fundings) : reply({ code: 404, message: "no recorded fundings for this market" }, 404);
      default:
        return reply({ code: 404 }, 404);
    }
  }) as typeof fetch;
  return { f, asked };
}

const UI = parseAbi(["function uiMultiplier() view returns (uint256)"]);
const UI_SELECTOR = "0xa60bf13d";

/** Wraps a mock node so a Multicall3 batch made only of uiMultiplier() calls is answered per token (undefined makes the call revert); every other request goes to the mock. */
function withMultipliers(base: PublicClient, byToken: Record<string, bigint | undefined>, seen: Array<{ token: string; at: unknown }> = [], head?: bigint): PublicClient {
  return createPublicClient({
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        if (method === "eth_blockNumber" && head !== undefined) return toHex(head);
        if (method === "eth_call") {
          const [{ data }, at] = params as [{ to: string; data: Hex }, unknown];
          try {
            const outer = decodeFunctionData({ abi: multicall3Abi, data });
            const calls = (outer.args as [readonly { target: string; callData: Hex }[]])[0];
            if (outer.functionName === "aggregate3" && calls.length > 0 && calls.every((c) => c.callData.startsWith(UI_SELECTOR))) {
              const out = calls.map((c) => {
                seen.push({ token: c.target.toLowerCase(), at });
                const m = byToken[c.target.toLowerCase()];
                return m === undefined ? { success: false, returnData: "0x" as Hex } : { success: true, returnData: encodeFunctionResult({ abi: UI, functionName: "uiMultiplier", result: m }) };
              });
              return encodeAbiParameters([{ type: "tuple[]", components: [{ type: "bool", name: "success" }, { type: "bytes", name: "returnData" }] }], [out]);
            }
          } catch {
            /* not a multicall: the mock answers it */
          }
        }
        return base.request({ method, params } as never);
      },
    }),
  });
}

const prices = () => Object.fromEntries(VAULTS.map((v) => [v.feed.toLowerCase(), px(200)]));
const tokenKey = (id: string) => by(id).token.toLowerCase();

async function plan(args: Record<string, unknown>, deps: Parameters<typeof handleMcp>[2]): Promise<ToolResult> {
  const res = await handleMcp(
    new Request("https://uptick-evidence.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "plan_weekend_hedge", arguments: args } }),
    }),
    env,
    { now: () => NOW, ...deps },
  );
  return ((await res.json()) as { result: ToolResult }).result;
}

/** A wallet that holds `held` (token id -> balance), with the node answering uiMultiplier per token. */
function holder(held: Record<string, bigint>, mult: Record<string, bigint | undefined> = { [tokenKey("nvda")]: NVDA_MULT }) {
  const seen: Array<{ token: string; at: unknown }> = [];
  const chain = mockChain(VAULTS, Object.fromEntries(Object.entries(held).map(([id, n]) => [tokenKey(id), n])), prices());
  return { client: withMultipliers(chain.client, mult, seen), chain, seen };
}

const mid = (b: typeof book) => (Math.max(...b.bids.map((l: any) => Number(l.price))) + Math.min(...b.asks.map((l: any) => Number(l.price)))) / 2;

describe("plan_weekend_hedge for a wallet that holds NVDA", () => {
  test("sizes the short from the balance and the multiplier and prices it from the recorded Lighter answers", async () => {
    const { client, seen } = holder({ nvda: 10n * E18 });
    const l = lighter();
    const r = await plan({ address: OWNER }, { scanClient: client as never, lighterFetch: l.f });
    expect(r.isError).toBeUndefined();
    const p = r.structuredContent;

    // the share count is balance x ERC-8056 multiplier, floored to the market's size decimals, worked out here from the fixture and not by the planner
    const sizeDecimals = details.order_book_details.find((m: any) => m.symbol === "NVDA").size_decimals as number;
    const units = (10n * NVDA_MULT * 10n ** BigInt(sizeDecimals)) / E18;
    const expectedShares = `${units / 10n ** BigInt(sizeDecimals)}.${(units % 10n ** BigInt(sizeDecimals)).toString().padStart(sizeDecimals, "0")}`;
    expect(Number(expectedShares)).toBeGreaterThan(10);
    expect(p.shares).toBe(expectedShares);
    expect(p).toMatchObject({ symbol: "NVDA", side: "short", sizedFrom: "wallet_balance", hedgeable: true, address: getAddress(OWNER), leverage: 5, marginBorrowed: false, marginCostBp: 0 });
    expect(p.notionalUsd).toBeCloseTo(Number(expectedShares) * mid(book), 1);

    // every cost field is a finite number with its sign convention
    for (const k of ["notionalUsd", "marginUsdg", "slippageBp", "fundingBp", "fundingUsd", "feeBp", "netBp", "netUsd"]) expect(Number.isFinite(p[k])).toBe(true);
    expect(p.slippageBp).toBeGreaterThan(0);
    expect(p.fundingDirection).toBe(p.fundingBp >= 0 ? "earns" : "pays");
    expect(p.fundingWeekendRows).toBeGreaterThanOrEqual(24);
    expect(p.netBp).toBeCloseTo(p.fundingBp - p.slippageBp - p.feeBp - p.marginCostBp, 1);
    expect(p.marginUsdg).toBeCloseTo(p.notionalUsd / 5, 0);

    // Lighter's own margin terms for NVDA, as recorded
    expect(p).toMatchObject({ marginEligible: true, userCapTokens: 60, loanToValue: 0.5 });

    // the weekend: Friday's US close and the Monday unwind 30 minutes before the open (EDT, so 13:00Z)
    expect(p.window.close).toBe("2026-10-23T20:00:00.000Z");
    expect(p.window.unwind).toBe("2026-10-26T13:00:00.000Z");
    expect(p.handoffUrl).toBe("https://robinhoodchain.lighter.xyz/trade/NVDA");

    // returns no calldata, and every Lighter figure names its URL and arrival time
    expect(p.transactions).toBeUndefined();
    const urls = (p.sources as Array<{ url: string; fetchedAt: string }>).map((s) => s.url);
    expect(urls.filter((u) => u.startsWith("https://api.rh.lighter.xyz/api/v1/")).length).toBe(4);
    expect(urls.some((u) => u.includes("uiMultiplier()"))).toBe(true);
    for (const s of p.sources) expect(Number.isNaN(Date.parse(s.fetchedAt))).toBe(false);

    // the uiMultiplier read went to the NVDA token, at the block the scan read (head less the lag)
    expect(seen).toEqual([{ token: tokenKey("nvda"), at: toHex(HEAD - READ_LAG) }]);
    // four Lighter reads, all against the Robinhood Chain exchange
    expect(l.asked.map((a) => a.split("?")[0]).sort()).toEqual(["/api/v1/assetDetails", "/api/v1/fundings", "/api/v1/orderBookDetails", "/api/v1/orderBookOrders"]);
  });

  test("a larger balance costs more slippage than a smaller one, so the book is walked at the exact size", async () => {
    const small = await plan({ address: OWNER }, { scanClient: holder({ nvda: 5n * E18 }).client as never, lighterFetch: lighter().f });
    const large = await plan({ address: OWNER }, { scanClient: holder({ nvda: 1500n * E18 }).client as never, lighterFetch: lighter().f });
    expect(small.isError).toBeUndefined();
    expect(large.isError).toBeUndefined();
    expect(large.structuredContent.notionalUsd).toBeGreaterThan(small.structuredContent.notionalUsd * 100);
    expect(large.structuredContent.slippageBp).toBeGreaterThan(small.structuredContent.slippageBp);
  });

  test("a wallet that holds a token Lighter lists no perp for answers with the reason, not a plan", async () => {
    const r = await plan({ address: OWNER }, { scanClient: holder({ gme: 3n * E18 }, { [tokenKey("gme")]: E18 }).client as never, lighterFetch: lighter().f });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ hedgeable: false, has_holding: true });
    expect(r.structuredContent.reason).toMatch(/no active perp for GME/);
    expect(r.structuredContent.shares).toBeUndefined();
  });

  test("a holding under Lighter's smallest order answers with the reason", async () => {
    const r = await plan({ address: OWNER }, { scanClient: holder({ nvda: E18 / 1000n }).client as never, lighterFetch: lighter().f });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ hedgeable: false, min_order_shares: "0.0400" });
    expect(r.structuredContent.reason).toMatch(/smallest NVDA order/);
  });

  test("the vault argument picks the token among several holdings", async () => {
    const h = holder({ nvda: 10n * E18, aapl: 4n * E18 }, { [tokenKey("nvda")]: NVDA_MULT, [tokenKey("aapl")]: 1_000_566_080_061_092_436n });
    // no recorded AAPL book: the tool must say so and return no plan, proving that AAPL was the market asked for
    const l = lighter();
    const r = await plan({ address: OWNER, vault: "aapl" }, { scanClient: h.client as never, lighterFetch: l.f });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.upstream_code).toBe(404);
    expect(l.asked).toContain("/api/v1/orderBookOrders?market_id=10&limit=250");
    expect(l.asked.some((a) => a.startsWith("/api/v1/fundings?market_id=10&"))).toBe(true);
  });
});

describe("plan_weekend_hedge with no holding or bad input", () => {
  test("an address that holds none of the tracked tokens returns an explicit reason", async () => {
    const r = await plan({ address: OWNER }, { scanClient: holder({}).client as never, lighterFetch: lighter().f });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ hedgeable: false, has_holding: false });
    expect(r.structuredContent.reason).toMatch(/holds none of the 17 Stock Tokens/);
    expect(r.structuredContent.shares).toBeUndefined();
  });

  test("a wallet that holds other tokens but not the asked vault says what it holds", async () => {
    const r = await plan({ address: OWNER, vault: "tsla" }, { scanClient: holder({ nvda: 10n * E18 }).client as never, lighterFetch: lighter().f });
    expect(r.structuredContent).toMatchObject({ hedgeable: false, has_holding: false });
    expect(r.structuredContent.reason).toMatch(/holds none of TSLA; it holds NVDA/);
  });

  test("an unknown vault is an error", async () => {
    const r = await plan({ address: OWNER, vault: "nope" }, { scanClient: holder({}).client as never, lighterFetch: lighter().f });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toBe('no vault with id "nope"');
  });

  test.each([
    ["a bad address", { address: "vitalik.eth" }, /valid 0x wallet address/],
    ["a bad source", { address: OWNER, source: "both" }, /source must be/],
    ["leverage above 20", { address: OWNER, leverage: 25 }, /from 1 to 20/],
    ["leverage under 1", { address: OWNER, leverage: 0.5 }, /from 1 to 20/],
    ["leverage that is not a number", { address: OWNER, leverage: "5" }, /from 1 to 20/],
    ["the loan source with no vault", { address: OWNER, source: "loan" }, /needs the vault id/],
  ])("%s is an error and no Lighter read is made", async (_name, args, message) => {
    const l = lighter();
    const r = await plan(args as Record<string, unknown>, { scanClient: holder({}).client as never, lighterFetch: l.f });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toMatch(message);
    expect(l.asked).toEqual([]);
  });

  test("leverage is capped by the market's minimum initial margin: PLTR allows 10x, not 15x", async () => {
    const mult = { [tokenKey("pltr")]: E18 };
    const ok = await plan({ address: OWNER, leverage: 10 }, { scanClient: holder({ pltr: 100n * E18 }, mult).client as never, lighterFetch: lighter({ "/api/v1/orderBookOrders": () => reply(book), "/api/v1/fundings": () => reply(fundings) }).f });
    // PLTR has no recorded book here, so the NVDA book stands in for the call: the leverage cap is checked before any book is walked
    const over = await plan({ address: OWNER, leverage: 15 }, { scanClient: holder({ pltr: 100n * E18 }, mult).client as never, lighterFetch: lighter({ "/api/v1/orderBookOrders": () => reply(book), "/api/v1/fundings": () => reply(fundings) }).f });
    expect(ok.isError).toBeUndefined();
    expect(ok.structuredContent.symbol).toBe("PLTR");
    expect(over.isError).toBe(true);
    expect(over.structuredContent.error).toMatch(/PLTR allows 1x to 10x, not 15x/);
  });

  test("a token whose uiMultiplier() reverts gets no size and no default of 1", async () => {
    const r = await plan({ address: OWNER }, { scanClient: holder({ nvda: 10n * E18 }, {}).client as never, lighterFetch: lighter().f });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toMatch(/uiMultiplier\(\) reverted/);
    expect(r.structuredContent.shares).toBeUndefined();
  });
});

describe("plan_weekend_hedge when Lighter does not answer cleanly", () => {
  const deps = () => ({ scanClient: holder({ nvda: 10n * E18 }).client as never });
  const noPlan = (p: Record<string, any>) => {
    for (const k of ["shares", "fundingBp", "slippageBp", "netBp", "notionalUsd", "handoffUrl", "sources"]) expect(p[k]).toBeUndefined();
  };

  test("the geo gate in the body of a 200 is an error carrying code 20558, never a zero-cost plan", async () => {
    const r = await plan({ address: OWNER }, { ...deps(), lighterFetch: (async () => reply({ code: 20558, message: "restricted jurisdiction" })) as unknown as typeof fetch });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toContain("20558");
    expect(r.structuredContent.upstream_code).toBe(20558);
    noPlan(r.structuredContent);
  });

  test("the geo gate as HTTP 400 with the code in the body is the same error", async () => {
    const r = await plan({ address: OWNER }, { ...deps(), lighterFetch: (async () => reply({ code: 20558, message: "restricted jurisdiction" }, 400)) as unknown as typeof fetch });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toContain("20558");
    expect(r.structuredContent).toMatchObject({ upstream: "lighter-rh", upstream_status: 400, upstream_code: 20558 });
    noPlan(r.structuredContent);
  });

  test("a CloudFront block page names the HTTP status and returns no plan", async () => {
    const r = await plan({ address: OWNER }, { ...deps(), lighterFetch: (async () => reply("<html><body><h1>403 ERROR</h1>The request could not be satisfied. Generated by cloudfront</body></html>", 403)) as unknown as typeof fetch });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toMatch(/HTTP 403/);
    expect(r.structuredContent.error).toMatch(/could not be satisfied/);
    expect(r.structuredContent.upstream_status).toBe(403);
    noPlan(r.structuredContent);
  });

  test("a network failure is an error, not a plan", async () => {
    const r = await plan({ address: OWNER }, { ...deps(), lighterFetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toMatch(/orderBookDetails: request failed \(fetch failed\)/);
    noPlan(r.structuredContent);
  });

  test("the failure can come from the second round of reads (book or fundings) and still ends in an error", async () => {
    for (const path of ["/api/v1/orderBookOrders", "/api/v1/fundings"]) {
      const r = await plan({ address: OWNER }, { ...deps(), lighterFetch: lighter({ [path]: () => reply({ code: 20558 }, 400) }).f });
      expect(r.isError).toBe(true);
      expect(r.structuredContent.error).toContain("20558");
      noPlan(r.structuredContent);
    }
  });

  test("an answer with the wrong shape is an error that names what is missing", async () => {
    const r = await plan({ address: OWNER }, { ...deps(), lighterFetch: lighter({ "/api/v1/assetDetails": () => reply({ code: 200, asset_details: [{ asset_id: 1 }] }) }).f });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toMatch(/assetDetails/);
  });

  test("a book too thin for the size is an error, not a free hedge", async () => {
    const thin = { ...book, bids: book.bids.slice(0, 2), asks: book.asks.slice(0, 2) };
    const r = await plan({ address: OWNER }, { scanClient: holder({ nvda: 1500n * E18 }).client as never, lighterFetch: lighter({ "/api/v1/orderBookOrders": () => reply(thin) }).f });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toMatch(/cannot fill/);
    noPlan(r.structuredContent);
  });

  test("too few weekend funding rows is an error, not a zero", async () => {
    const r = await plan({ address: OWNER }, { ...deps(), lighterFetch: lighter({ "/api/v1/fundings": () => reply({ ...fundings, fundings: fundings.fundings.slice(-30) }) }).f });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toMatch(/fewer weekend funding rows/);
    noPlan(r.structuredContent);
  });
});

describe("plan_weekend_hedge from a loan", () => {
  const loanEnv = { VAULTS: JSON.stringify({ nvda: VAULT }), NETWORK: "robinhood-chain-fork" } as unknown as Env;
  const loanCall = (args: Record<string, unknown>, chain: Chain, markets: Record<string, any> | undefined = { nvda: ENTRY }, e: Env = loanEnv) => {
    // the fake node has no eth_blockNumber: the wrapper answers the head the loan read is pinned to
    const client = withMultipliers(fakeClient(chain), { [tokenKey("nvda")]: NVDA_MULT }, [], HEAD);
    return handleMcp(
      new Request("https://uptick-evidence.test/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "plan_weekend_hedge", arguments: args } }) }),
      e,
      { now: () => NOW, lighterFetch: lighter().f, loan: { client, markets } },
    ).then(async (res) => ((await res.json()) as { result: ToolResult }).result);
  };

  test("sizes the short from the stock leg of the posted shares and prices the margin interest on the debt", async () => {
    const chain = freshChain();
    const r = await loanCall({ address: BORROWER, source: "loan", vault: "nvda" }, chain);
    expect(r.isError).toBeUndefined();
    const p = r.structuredContent;
    // freshChain's in-kind quote is 50 stock tokens for the whole collateral
    const sd = details.order_book_details.find((m: any) => m.symbol === "NVDA").size_decimals as number;
    const units = (50n * NVDA_MULT * 10n ** BigInt(sd)) / E18;
    expect(p.shares).toBe(`${units / 10n ** BigInt(sd)}.${(units % 10n ** BigInt(sd)).toString().padStart(sd, "0")}`);
    expect(p).toMatchObject({ source: "loan", vault: "nvda", symbol: "NVDA", sizedFrom: "vault_share_stock_leg", marginBorrowed: true });
    expect(p.marginCostBp).toBeGreaterThan(0);
    // interest = margin (notional / leverage) x rate x hours / 8760, rate from the fake IRM's per-second figure
    const hours = p.window.hours as number;
    const apr = (Number(chain.rate) * 31_536_000) / 1e18;
    expect(p.marginCostUsd).toBeCloseTo((p.notionalUsd / 5) * apr * (hours / 8760), 1);
    expect(p.netBp).toBeCloseTo(p.fundingBp - p.slippageBp - p.feeBp - p.marginCostBp, 1);
    expect(p.transactions).toBeUndefined();
  });

  test("a wallet with no shares posted answers with the reason", async () => {
    const chain = freshChain();
    chain.positions = {};
    const r = await loanCall({ address: BORROWER, source: "loan", vault: "nvda" }, chain);
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ hedgeable: false, has_position: false });
    expect(r.structuredContent.shares).toBeUndefined();
  });

  test("a vault with no configured market answers with the reason", async () => {
    const r = await loanCall({ address: BORROWER, source: "loan", vault: "nvda" }, freshChain(), {});
    expect(r.structuredContent).toMatchObject({ hedgeable: false, has_market: false });
    expect(r.structuredContent.reason).toMatch(/no Morpho market is configured for vault nvda/);
  });

  test("a vault the in-kind quote reverts on is an error", async () => {
    const chain = freshChain();
    chain.inKind = null;
    const r = await loanCall({ address: BORROWER, source: "loan", vault: "nvda" }, chain);
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toMatch(/chain did not answer/);
  });
});
