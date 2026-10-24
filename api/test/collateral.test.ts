import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  parseUnits,
  type Hex,
} from "viem";
import worker from "../src/worker";

const VAULT = "0x6852Adb5Fce1D73c08A9b3Aa7edE9A03437ac2fE";
const STOCK = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const MORPHO = "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010";
const ORACLE = "0x3333333333333333333333333333333333333333";
const IRM = "0x4444444444444444444444444444444444444444";
const RECEIVER = "0x2222222222222222222222222222222222222222";
const LLTV = "625000000000000000";
const ctx = {} as ExecutionContext;

const MARKET = { loanToken: USDG, collateralToken: VAULT, oracle: ORACLE, irm: IRM, lltv: LLTV };
const MARKETS = JSON.stringify({ nvda: MARKET });

const STRUCT = "(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)";
const MORPHO_ABI = parseAbi([
  `function supplyCollateral(${STRUCT} marketParams, uint256 assets, address onBehalf, bytes data)`,
  `function borrow(${STRUCT} marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)`,
  "function market(bytes32 id) view returns (uint128, uint128, uint128, uint128, uint128, uint128)",
]);
const ERC20_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const VAULT_ABI = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
]);
const ORACLE_ABI = parseAbi(["function price() view returns (uint256)"]);

// Chain fixture: a fresh vault mints assets * 1e6 shares, one stock token is worth 200 USDG, the market holds 1100 USDG of free liquidity.
const PRICE = 200n * 10n ** 18n;
const SUPPLIED = 5000n * 10n ** 6n;
const BORROWED = 3900n * 10n ** 6n;

let rpc: ReturnType<typeof Bun.serve>;
let rpcUrl = "";
let rpcCalls: string[] = [];

beforeAll(() => {
  rpc = Bun.serve({
    port: 0,
    async fetch(req) {
      const { id, method, params } = (await req.json()) as { id: number; method: string; params: [{ to: string; data: Hex }] };
      if (method !== "eth_call") {
        return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `unexpected ${method}` } });
      }
      const { to, data } = params[0];
      rpcCalls.push(to.toLowerCase());
      let result: Hex;
      if (to.toLowerCase() === VAULT.toLowerCase()) {
        const { args } = decodeFunctionData({ abi: VAULT_ABI, data });
        result = encodeFunctionResult({ abi: VAULT_ABI, functionName: "previewDeposit", result: (args![0] as bigint) * 10n ** 6n });
      } else if (to.toLowerCase() === ORACLE.toLowerCase()) {
        result = encodeFunctionResult({ abi: ORACLE_ABI, functionName: "price", result: PRICE });
      } else if (to.toLowerCase() === MORPHO.toLowerCase()) {
        result = encodeFunctionResult({
          abi: MORPHO_ABI,
          functionName: "market",
          result: [SUPPLIED, 0n, BORROWED, 0n, 0n, 0n],
        });
      } else {
        return Response.json({ jsonrpc: "2.0", id, error: { code: 3, message: `no contract at ${to}` } });
      }
      return Response.json({ jsonrpc: "2.0", id, result });
    },
  });
  rpcUrl = `http://127.0.0.1:${rpc.port}`;
});

afterAll(() => rpc.stop(true));

type Env = Record<string, unknown>;
const base = (): Env => ({
  VAULTS: `{"nvda":"${VAULT}"}`,
  NETWORK: "robinhood-chain-fork",
  COLLATERAL_MARKETS: MARKETS,
  RPC_URL: rpcUrl,
});

interface ToolResult {
  content: Array<{ text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

async function callTool(name: string, args: Record<string, unknown>, env: Env = base()): Promise<ToolResult> {
  const res = await worker.fetch(
    new Request("https://uptick-evidence.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
    env,
    ctx,
  );
  return ((await res.json()) as { result: ToolResult }).result;
}

async function listTools(): Promise<{ name: string; description: string }[]> {
  const res = await worker.fetch(
    new Request("https://uptick-evidence.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
    base(),
    ctx,
  );
  return ((await res.json()) as { result: { tools: { name: string; description: string }[] } }).result.tools;
}

const earn = (over: Record<string, unknown> = {}) => ({
  id: "nvda",
  amount: "10",
  borrow_usdg: "1000",
  receiver: RECEIVER,
  ...over,
});

type MarketTuple = { loanToken: string; collateralToken: string; oracle: string; irm: string; lltv: bigint };
type Tx = { to: string; data: Hex; value: string; chainId: number };

describe("get_collateral_terms", () => {
  test("returns the configured Morpho market with its LLTV and market id", async () => {
    const r = await callTool("get_collateral_terms", { id: "nvda" });
    expect(r.isError).toBeUndefined();
    const sc = r.structuredContent;
    expect(sc.market_params).toEqual(MARKET);
    expect(sc.morpho).toBe(MORPHO);
    expect(sc.lltv_wad).toBe(LLTV);
    expect(sc.lltv_pct).toBe(62.5);
    expect(sc.vault_address).toBe(VAULT);
    expect(sc.market_id).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("market id equals the id of the live USDe/USDG market on Morpho Blue 4663 (read at block 95890710)", async () => {
    const live = {
      loanToken: USDG,
      collateralToken: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
      oracle: "0xE64849bd4AD03DfaBbe02bb521de19997a19055f",
      irm: "0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1",
      lltv: "915000000000000000",
    };
    const r = await callTool(
      "get_collateral_terms",
      { id: "nvda" },
      { VAULTS: `{"nvda":"${live.collateralToken}"}`, COLLATERAL_MARKETS: JSON.stringify({ nvda: live }) },
    );
    expect(r.structuredContent.market_id).toBe("0xc845da65a020ddca5f132efa8fea79676d8edfdea504226a4c01e7a9e34cddd6");
    expect(r.structuredContent.lltv_pct).toBe(91.5);
  });

  test("the shipped config has no markets, so every vault errors with a reason and no params", async () => {
    const r = await callTool("get_collateral_terms", { id: "nvda" }, { VAULTS: base().VAULTS });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("no Morpho market configured for nvda");
    expect(r.structuredContent.market_params).toBeUndefined();
  });

  test("unknown vault errors", async () => {
    const r = await callTool("get_collateral_terms", { id: "zzz" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("no vault with id");
  });

  test("a market whose collateral is not the deployed vault share is refused", async () => {
    const bad = JSON.stringify({ nvda: { ...MARKET, collateralToken: STOCK } });
    const r = await callTool("get_collateral_terms", { id: "nvda" }, { ...base(), COLLATERAL_MARKETS: bad });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("not collateralised by the deployed nvda vault share");
  });

  test("a market that does not lend USDG or has a bad LLTV is refused", async () => {
    for (const [patch, text] of [
      [{ loanToken: STOCK }, "does not lend USDG"],
      [{ lltv: "1000000000000000000" }, "invalid lltv"],
      [{ lltv: "62.5" }, "invalid lltv"],
      [{ oracle: "0xabc" }, "invalid oracle"],
    ] as const) {
      const bad = JSON.stringify({ nvda: { ...MARKET, ...patch } });
      const r = await callTool("get_collateral_terms", { id: "nvda" }, { ...base(), COLLATERAL_MARKETS: bad });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain(text);
    }
  });
});

describe("prepare_earn_and_borrow", () => {
  test("returns two batches, approve and deposit then approve shares, supplyCollateral and borrow, and every call decodes", async () => {
    rpcCalls = [];
    const r = await callTool("prepare_earn_and_borrow", earn());
    expect(r.isError).toBeUndefined();
    const batches = r.structuredContent.batches as { step: number; name: string; transactions: Tx[] }[];
    expect(batches.map((b) => b.step)).toEqual([1, 2]);
    expect(batches.map((b) => b.transactions.map((t) => t.to))).toEqual([[STOCK, VAULT], [VAULT, MORPHO, MORPHO]]);
    // the flat list is gone, so no agent can send the deposit and supplyCollateral together by accident
    expect(r.structuredContent.transactions).toBeUndefined();
    const txs = batches.flatMap((b) => b.transactions);
    expect(txs.length).toBe(5);
    expect(txs.every((t) => t.value === "0" && t.chainId === 4663)).toBe(true);
    expect(txs.map((t) => t.to)).toEqual([STOCK, VAULT, VAULT, MORPHO, MORPHO]);

    const amount = parseUnits("10", 18);
    const previewed = amount * 10n ** 6n;
    const collateral = previewed - (previewed * 10n) / 10000n;
    const lc = (v: unknown) => String(v).toLowerCase();

    const a1 = decodeFunctionData({ abi: ERC20_ABI, data: txs[0].data });
    expect(lc(a1.args[0])).toBe(lc(VAULT));
    expect(a1.args[1]).toBe(amount);

    const dep = decodeFunctionData({ abi: VAULT_ABI, data: txs[1].data });
    expect(dep.functionName).toBe("deposit");
    expect(dep.args[0]).toBe(amount);
    expect(lc(dep.args[1])).toBe(lc(RECEIVER));

    const a2 = decodeFunctionData({ abi: ERC20_ABI, data: txs[2].data });
    expect(lc(a2.args[0])).toBe(lc(MORPHO));
    expect(a2.args[1]).toBe(collateral);

    const sup = decodeFunctionData({ abi: MORPHO_ABI, data: txs[3].data });
    expect(sup.functionName).toBe("supplyCollateral");
    const [p1, supAssets, supOnBehalf, supData] = sup.args as [MarketTuple, bigint, string, string];
    expect(lc(p1.collateralToken)).toBe(lc(VAULT));
    expect(lc(p1.loanToken)).toBe(lc(USDG));
    expect(lc(p1.oracle)).toBe(lc(ORACLE));
    expect(lc(p1.irm)).toBe(lc(IRM));
    expect(p1.lltv).toBe(BigInt(LLTV));
    expect(supAssets).toBe(collateral);
    expect(lc(supOnBehalf)).toBe(lc(RECEIVER));
    expect(supData).toBe("0x");

    const bor = decodeFunctionData({ abi: MORPHO_ABI, data: txs[4].data });
    expect(bor.functionName).toBe("borrow");
    const [p2, borAssets, borShares, borOnBehalf, borReceiver] = bor.args as [MarketTuple, bigint, bigint, string, string];
    expect(p2).toEqual(p1);
    expect(borAssets).toBe(1000n * 10n ** 6n);
    expect(borShares).toBe(0n);
    expect(lc(borOnBehalf)).toBe(lc(RECEIVER));
    expect(lc(borReceiver)).toBe(lc(RECEIVER));

    // selectors of the live Morpho Blue singleton: cast sig, and eth_call of these signatures reverted with Morpho's own errors
    expect(txs[3].data.slice(0, 10)).toBe("0x238d6579");
    expect(txs[4].data.slice(0, 10)).toBe("0x50d8cd4b");

    expect(r.structuredContent.sender_must_be).toBe(RECEIVER);
    expect(r.structuredContent.max_borrow_usdg).toBe("1248.75");
    expect(r.structuredContent.market_id).toMatch(/^0x[0-9a-f]{64}$/);
    // all three reads hit the vault, the oracle and Morpho, so the amounts above come from the chain fixture and not constants
    expect(new Set(rpcCalls)).toEqual(new Set([VAULT, ORACLE, MORPHO].map((a) => a.toLowerCase())));
  });

  test("MUST FAIL: an unconfigured market returns a reason and no calldata", async () => {
    const r = await callTool("prepare_earn_and_borrow", earn(), { ...base(), COLLATERAL_MARKETS: "{}" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("no Morpho market configured for nvda");
    expect(r.structuredContent.transactions).toBeUndefined();
    expect(r.structuredContent.batches).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('"data"');
  });

  test("no deployed vault returns a reason and no calldata", async () => {
    const r = await callTool("prepare_earn_and_borrow", earn({ id: "googl" }));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("no deployed vault for googl");
    expect(r.structuredContent.transactions).toBeUndefined();
  });

  test("closed vault is refused with the gate reason", async () => {
    const r = await callTool("prepare_earn_and_borrow", earn({ id: "crcl" }));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("Closed");
    expect(r.structuredContent.transactions).toBeUndefined();
  });

  test("a borrow above the LLTV limit is refused and names the limit", async () => {
    const r = await callTool("prepare_earn_and_borrow", earn({ borrow_usdg: "1300" }));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("exceeds the 1248.75 USDG");
    expect(r.structuredContent.transactions).toBeUndefined();
  });

  test("a borrow within the LLTV limit but above market liquidity is refused", async () => {
    const r = await callTool("prepare_earn_and_borrow", earn({ borrow_usdg: "1200" }));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("available to borrow in the market");
    expect(r.structuredContent.transactions).toBeUndefined();
  });

  test("a borrow one micro-USDG above the LLTV limit is refused", async () => {
    const over = await callTool("prepare_earn_and_borrow", earn({ borrow_usdg: "1248.750001" }));
    expect(over.isError).toBe(true);
    expect(over.content[0].text).toContain("exceeds the 1248.75 USDG");
  });

  test("a borrow equal to the market liquidity is allowed", async () => {
    const r = await callTool("prepare_earn_and_borrow", earn({ borrow_usdg: "1100" }));
    expect(r.isError).toBeUndefined();
    expect((r.structuredContent.batches as { transactions: unknown[] }[]).flatMap((b) => b.transactions).length).toBe(5);
  });

  test("the wait between the batches is in plain words: about 12 seconds, the parent chain's block, Multicall3", async () => {
    const r = await callTool("prepare_earn_and_borrow", earn());
    const wait = String(r.structuredContent.wait_between_batches);
    expect(wait).toContain("about 12 seconds");
    expect(wait).toContain("parent chain");
    expect(wait).toContain("getBlockNumber()");
    expect(wait).toContain("0xcA11bde05977b3631167028862bE2a173976CA11");
    expect(wait).toContain("Never put the deposit and supplyCollateral in one batch");
    const tool = (await listTools()).find((t) => t.name === "prepare_earn_and_borrow");
    expect(tool?.description).toContain("two batches");
    expect(tool?.description).toContain("12 seconds");
  });

  test("no RPC means no calldata", async () => {
    const env = base();
    delete env.RPC_URL;
    const r = await callTool("prepare_earn_and_borrow", earn(), env);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("no RPC configured");
    expect(r.structuredContent.transactions).toBeUndefined();
  });

  test("an unreachable RPC means no calldata", async () => {
    const r = await callTool("prepare_earn_and_borrow", earn(), { ...base(), RPC_URL: "http://127.0.0.1:1" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("on-chain read failed");
    expect(r.structuredContent.transactions).toBeUndefined();
  });

  test("bad inputs are errors", async () => {
    for (const [patch, text] of [
      [{ receiver: "0xnope" }, "receiver"],
      [{ amount: "0" }, "amount"],
      [{ borrow_usdg: "0" }, "borrow_usdg"],
      [{ borrow_usdg: "abc" }, "borrow_usdg"],
      [{ borrow_usdg: undefined }, "borrow_usdg"],
    ] as const) {
      const r = await callTool("prepare_earn_and_borrow", earn(patch));
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain(text);
    }
  });
});
