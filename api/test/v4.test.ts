import { describe, expect, test } from "bun:test";
import { decodeFunctionData, parseAbi, parseUnits, toFunctionSelector } from "viem";
import worker from "../src/worker";
import LLMS from "../src/llms";
import universeData from "../data/vault-universe.json";

const ctx = {} as ExecutionContext;
const RECEIVER = "0x2222222222222222222222222222222222222222";
const ROUTER = "0x1111111111111111111111111111111111111111";
const PLTR_VAULT = "0x0000000000000000000000000000000000000b04";
const AAPL_VAULT = "0x0000000000000000000000000000000000000a01";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const live = { VAULTS: JSON.stringify({ pltr: PLTR_VAULT, aapl: AAPL_VAULT }), NETWORK: "robinhood-chain-fork", ROUTER } as Record<string, unknown>;
const launching = { VAULTS: "{}", NETWORK: "robinhood-chain" } as Record<string, unknown>;

// Independent of the ABI the Worker encodes with: the signatures as the contracts declare them.
const routerAbi = parseAbi([
  "function depositUsdg(address vault, uint256 usdgIn, uint256 minShares, address receiver) returns (uint256 shares)",
  "function depositUsdgV4(address vault, uint256 usdgIn, uint256 minShares, address receiver) returns (uint256 shares)",
]);
const vaultAbi = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function redeemInKind(uint256 shares, address receiver, address owner) returns (uint256 stockOut, uint256 usdgOut)",
]);
const erc20Abi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

interface ToolResult {
  isError?: boolean;
  structuredContent: Record<string, any>;
}

async function callTool(name: string, args: Record<string, unknown>, env: Record<string, unknown>): Promise<ToolResult> {
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

const pltr = universeData.vaults.find((v) => v.id === "pltr")!;
const aapl = universeData.vaults.find((v) => v.id === "aapl")!;
type Tx = { to: string; data: `0x${string}`; chainId: number; value: string };

describe("the vault universe the Worker serves carries PLTR on Uniswap v4", () => {
  test("the data the tests read says v4, open, a 32-byte pool id and a PoolManager address", () => {
    expect(pltr.venue).toBe("v4");
    expect(pltr.open).toBe(true);
    expect(pltr.pool).toMatch(/^0x[0-9a-f]{64}$/);
    expect(universeData.poolManager).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(aapl.venue).toBe("v3");
  });

  test("GET /vaults and /vaults/:id show venue, fee tier, pool id and PoolManager for pltr, and a plain v3 pool for aapl", async () => {
    const list = (await (await worker.fetch(new Request("https://x.test/vaults"), {}, ctx)).json()) as Array<Record<string, any>>;
    const p = list.find((v) => v.id === "pltr")!;
    expect(p).toMatchObject({ venue: "v4", fee_tier: "1%", fee_tier_pips: 10000, open: true, deposit_cap_usd: 24207, pool: pltr.pool, pool_id: pltr.pool, pool_manager: universeData.poolManager });
    const a = list.find((v) => v.id === "aapl")!;
    expect(a).toMatchObject({ venue: "v3", fee_tier: "0.05%", pool: aapl.pool });
    expect(a.pool_id).toBeUndefined();
    expect(a.pool_manager).toBeUndefined();
    const detail = (await (await worker.fetch(new Request("https://x.test/vaults/pltr"), {}, ctx)).json()) as Record<string, any>;
    expect(detail).toMatchObject({ venue: "v4", fee_tier: "1%", pool_id: pltr.pool, pool_manager: universeData.poolManager, entry_fee_bps: 109.9 });
  });

  test("list_vaults and get_vault_evidence carry the same venue fields over MCP", async () => {
    const list = await callTool("list_vaults", {}, launching);
    const rows = list.structuredContent.vaults as Array<Record<string, any>>;
    expect(rows.length).toBe(universeData.vaults.length);
    for (const r of rows) {
      const u = universeData.vaults.find((v) => v.id === r.id)!;
      expect(r.venue).toBe(u.venue);
      expect(r.fee_tier).toBe(u.feeTier);
      expect(r.fee_tier_pips).toBe(u.feeTierPips);
    }
    expect(rows.filter((r) => r.venue === "v4").map((r) => r.id).sort()).toEqual(["pltr", "spy", "uso"]);
    const ev = await callTool("get_vault_evidence", { id: "pltr" }, launching);
    expect(ev.structuredContent).toMatchObject({ venue: "v4", fee_tier: "1%", pool_id: pltr.pool, pool_manager: universeData.poolManager, open: true, deposit_cap_usd: 24207 });
  });
});

describe("prepare_deposit routes by venue", () => {
  test("a v4 vault zaps through depositUsdgV4: the calldata decodes back to the vault, amount, minShares and receiver", async () => {
    const out = await callTool("prepare_deposit", { id: "pltr", amount: "1000", receiver: RECEIVER, asset: "usdg" }, live);
    expect(out.isError).toBeUndefined();
    expect(out.structuredContent.venue).toBe("v4");
    const [approve, zap] = out.structuredContent.transactions as Tx[];
    expect(approve.to).toBe(USDG);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve.data })).toMatchObject({ functionName: "approve", args: [ROUTER, parseUnits("1000", 6)] });
    expect(zap.to).toBe(ROUTER);
    expect(zap.chainId).toBe(4663);
    const call = decodeFunctionData({ abi: routerAbi, data: zap.data });
    expect(call.functionName).toBe("depositUsdgV4");
    expect(call.args).toEqual([PLTR_VAULT, parseUnits("1000", 6), 0n, RECEIVER]);
    expect(zap.data.slice(0, 10)).toBe(toFunctionSelector("depositUsdgV4(address,uint256,uint256,address)"));
  });

  test("a v3 vault still zaps through depositUsdg", async () => {
    const out = await callTool("prepare_deposit", { id: "aapl", amount: "1000", receiver: RECEIVER, asset: "usdg" }, live);
    expect(out.isError).toBeUndefined();
    const zap = (out.structuredContent.transactions as Tx[])[1];
    const call = decodeFunctionData({ abi: routerAbi, data: zap.data });
    expect(call.functionName).toBe("depositUsdg");
    expect(call.args).toEqual([AAPL_VAULT, parseUnits("1000", 6), 0n, RECEIVER]);
    expect(zap.data.slice(0, 10)).not.toBe(toFunctionSelector("depositUsdgV4(address,uint256,uint256,address)"));
  });

  test("a v4 vault takes a stock deposit through ERC-4626 deposit on the vault, like v3", async () => {
    const out = await callTool("prepare_deposit", { id: "pltr", amount: "10", receiver: RECEIVER }, live);
    expect(out.isError).toBeUndefined();
    const [approve, deposit] = out.structuredContent.transactions as Tx[];
    expect(decodeFunctionData({ abi: erc20Abi, data: approve.data }).args).toEqual([PLTR_VAULT, parseUnits("10", 18)]);
    expect(deposit.to).toBe(PLTR_VAULT);
    expect(decodeFunctionData({ abi: vaultAbi, data: deposit.data })).toMatchObject({ functionName: "deposit", args: [parseUnits("10", 18), RECEIVER] });
  });

  test("the v4 cap applies: a deposit one dollar above $24,207 is refused, one at the cap is built", async () => {
    expect(pltr.depositCapUsd).toBe(24207);
    const over = await callTool("prepare_deposit", { id: "pltr", amount: "24208", receiver: RECEIVER, asset: "usdg" }, live);
    expect(over.isError).toBe(true);
    expect(over.structuredContent.error).toContain("$24,207");
    expect((await callTool("prepare_deposit", { id: "pltr", amount: "24207", receiver: RECEIVER, asset: "usdg" }, live)).isError).toBeUndefined();
  });
});

describe("a vault whose address is not live builds no transaction", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["VAULTS empty", launching],
    ["VAULTS unset", { ROUTER }],
    ["VAULTS names only another vault", { VAULTS: JSON.stringify({ aapl: AAPL_VAULT }), ROUTER }],
    ["VAULTS entry is not an address", { VAULTS: JSON.stringify({ pltr: "0xnot-an-address" }), ROUTER }],
    ["VAULTS entry has a bad checksum", { VAULTS: JSON.stringify({ pltr: "0x6852adb5Fce1D73c08A9b3Aa7edE9A03437ac2fE" }), ROUTER }],
  ];
  for (const [label, env] of cases) {
    test(`prepare_deposit pltr usdg, ${label}: error with the gate and the venue, no transactions`, async () => {
      const out = await callTool("prepare_deposit", { id: "pltr", amount: "100", receiver: RECEIVER, asset: "usdg" }, env);
      expect(out.isError).toBe(true);
      expect(out.structuredContent.error).toContain("no deployed vault for pltr");
      expect(out.structuredContent).toMatchObject({ address_live: false, venue: "v4", gate: { state: "open", reason: pltr.gate.reason } });
      expect(out.structuredContent.transactions).toBeUndefined();
    });
  }

  test("prepare_deposit stock asset and both prepare_withdraw modes refuse the same way", async () => {
    for (const [tool, args] of [
      ["prepare_deposit", { id: "pltr", amount: "10", receiver: RECEIVER }],
      ["prepare_withdraw", { id: "pltr", shares: "1", receiver: RECEIVER }],
      ["prepare_withdraw", { id: "pltr", shares: "1", receiver: RECEIVER, mode: "in_kind" }],
    ] as const) {
      const out = await callTool(tool, args, launching);
      expect(out.isError).toBe(true);
      expect(out.structuredContent.address_live).toBe(false);
      expect(out.structuredContent.transactions).toBeUndefined();
    }
  });

  test("a malformed ROUTER is not used as a zap target", async () => {
    const out = await callTool("prepare_deposit", { id: "pltr", amount: "100", receiver: RECEIVER, asset: "usdg" }, { ...live, ROUTER: "0xrouter" });
    expect(out.isError).toBe(true);
    expect(out.structuredContent.transactions).toBeUndefined();
  });

  test("a closed vault still answers with its gate reason before anything else", async () => {
    const gme = universeData.vaults.find((v) => v.id === "gme")!;
    const out = await callTool("prepare_deposit", { id: "gme", amount: "100", receiver: RECEIVER }, live);
    expect(out.isError).toBe(true);
    expect(out.structuredContent.error).toBe(gme.gate.reason);
  });
});

describe("prepare_withdraw on a v4 vault", () => {
  test("redeem is the same ERC-4626 call as v3, on the v4 vault address", async () => {
    const out = await callTool("prepare_withdraw", { id: "pltr", shares: "2.5", receiver: RECEIVER }, live);
    expect(out.isError).toBeUndefined();
    expect(out.structuredContent).toMatchObject({ venue: "v4", mode: "redeem" });
    const [t] = out.structuredContent.transactions as Tx[];
    expect(t.to).toBe(PLTR_VAULT);
    expect(decodeFunctionData({ abi: vaultAbi, data: t.data })).toMatchObject({ functionName: "redeem", args: [parseUnits("2.5", 24), RECEIVER, RECEIVER] });
    const v3 = await callTool("prepare_withdraw", { id: "aapl", shares: "2.5", receiver: RECEIVER }, live);
    expect((v3.structuredContent.transactions as Tx[])[0].data).toBe(t.data);
  });

  test("mode in_kind builds redeemInKind, on v4 and v3", async () => {
    for (const [id, vault] of [["pltr", PLTR_VAULT], ["aapl", AAPL_VAULT]] as const) {
      const out = await callTool("prepare_withdraw", { id, shares: "1", receiver: RECEIVER, mode: "in_kind" }, live);
      expect(out.isError).toBeUndefined();
      const [t] = out.structuredContent.transactions as Tx[];
      expect(t.to).toBe(vault);
      expect(decodeFunctionData({ abi: vaultAbi, data: t.data })).toMatchObject({ functionName: "redeemInKind", args: [parseUnits("1", 24), RECEIVER, RECEIVER] });
    }
  });

  test("an unknown mode is refused", async () => {
    const out = await callTool("prepare_withdraw", { id: "pltr", shares: "1", receiver: RECEIVER, mode: "withdraw" }, live);
    expect(out.isError).toBe(true);
    expect(out.structuredContent.error).toContain("mode");
  });
});

describe("GET /llms.txt lists the universe", () => {
  test("every vault's cap and gate state is in the file, and PLTR is on Uniswap v4 with its pool id and PoolManager", () => {
    expect(universeData.vaults.length).toBeGreaterThan(0);
    for (const v of universeData.vaults) {
      expect(LLMS).toContain(`${v.symbol} $${v.depositCapUsd.toLocaleString("en-US")}`);
    }
    expect(LLMS).toContain(`PLTR holds its position in the 1% Uniswap v4 pool with id ${pltr.pool}`);
    expect(LLMS).toContain(universeData.poolManager);
    expect(LLMS).toContain("depositUsdgV4");
    expect(LLMS).toMatch(/Current gates: [^;]*PLTR[^;]* open;/);
    expect(LLMS).toContain("1.099% on PLTR");
    expect(LLMS).not.toContain(" — ");
    expect(LLMS).not.toContain(" -- ");
  });
});
