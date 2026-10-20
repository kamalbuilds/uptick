import universeData from "../data/vault-universe.json";
const NVDA_GATE = (universeData as { vaults: Array<{ id: string; gate: { state: string; reason: string } }> }).vaults.find((v) => v.id === "nvda")!.gate;
import { describe, expect, test } from "bun:test";
import { decodeFunctionData, parseAbi } from "viem";
import worker from "../src/worker";
import { reducedNotice } from "../src/mcp";

const VAULTS = '{"nvda":"0x6852Adb5Fce1D73c08A9b3Aa7edE9A03437ac2fE"}';
const RECEIVER = "0x2222222222222222222222222222222222222222";
const ctx = {} as ExecutionContext;

const env = {
  VAULTS,
  NETWORK: "robinhood-chain-fork",
} as Record<string, unknown>;

async function post(
  body: unknown,
  e: Record<string, unknown> = env,
): Promise<Response> {
  return worker.fetch(
    new Request("https://uptick-evidence.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    e,
    ctx,
  );
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  e: Record<string, unknown> = env,
): Promise<{
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}> {
  const res = await post(
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } },
    e,
  );
  const envelope = (await res.json()) as { result: never };
  return envelope.result;
}

describe("MCP initialize", () => {
  test("returns the negotiated protocol version and server info", async () => {
    const res = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      jsonrpc: string;
      id: number;
      result: {
        protocolVersion: string;
        capabilities: { tools: Record<string, unknown> };
        serverInfo: { name: string; version: string };
        instructions: string;
      };
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo).toEqual({ name: "uptick", version: "1.0.0" });
    expect(body.result.capabilities).toEqual({ tools: {} });
    expect(body.result.instructions).toContain("gate reason");
    expect(body.result.instructions).toContain("never");
  });

  test("notifications/initialized is a 204 with no body", async () => {
    const res = await post({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(res.status).toBe(204);
  });
});

describe("MCP tools/list", () => {
  test("returns exactly the four prepare and evidence tools", async () => {
    const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.length).toBe(4);
    expect(body.result.tools.map((t) => t.name).sort()).toEqual([
      "get_vault_evidence",
      "list_vaults",
      "prepare_deposit",
      "prepare_withdraw",
    ]);
  });
});

describe("list_vaults", () => {
  test("includes nvda and crcl with gate state and reason", async () => {
    const body = await callTool("list_vaults", {});
    const vaults = body.structuredContent.vaults as Array<{
      id: string;
      gate_state: string;
      reason: string;
      fee_apr_pct: number;
      kept_apr_pct: number;
    }>;
    const ids = vaults.map((v) => v.id);
    expect(ids).toContain("nvda");
    expect(ids).toContain("crcl");

    const nvda = vaults.find((v) => v.id === "nvda")!;
    expect(nvda.gate_state).toBe(NVDA_GATE.state);
    expect(typeof nvda.reason).toBe("string");
    expect(typeof nvda.fee_apr_pct).toBe("number");
    expect(typeof nvda.kept_apr_pct).toBe("number");
  });
});

describe("get_vault_evidence", () => {
  test("carries pools, gate, window, swaps and a source URL", async () => {
    const body = await callTool("get_vault_evidence", { id: "nvda" });
    const sc = body.structuredContent;
    expect(sc.id).toBe("nvda");
    expect(Array.isArray(sc.pools)).toBe(true);
    expect((sc.pools as unknown[]).length).toBeGreaterThan(0);
    expect((sc.gate as { state: string }).state).toBe(NVDA_GATE.state);
    expect(typeof (sc.gate as { rule: string }).rule).toBe("string");
    expect(typeof (sc.window as { days: number }).days).toBe("number");
    expect(typeof sc.swaps).toBe("number");
    expect(sc.source).toBe(
      "https://uptick-evidence.earn-shield-alerts.workers.dev/vaults/nvda",
    );
  });
});

describe("prepare_deposit", () => {
  test("refuses a closed vault with the gate reason", async () => {
    const body = await callTool("prepare_deposit", {
      id: "crcl",
      amount: "10",
      receiver: RECEIVER,
    });
    expect(body.isError).toBe(true);
    expect(body.content[0].text).toContain("Closed");
  });

  test("builds approve then deposit for the stock asset whose calldata decodes", async () => {
    const body = await callTool("prepare_deposit", {
      id: "nvda",
      amount: "10",
      receiver: RECEIVER,
      asset: "stock",
    });
    expect(body.isError).toBeUndefined();
    expect(body.structuredContent.network).toBe("robinhood-chain-fork");

    const txs = body.structuredContent.transactions as Array<{ to: string; data: string; value: string }>;
    expect(txs.length).toBe(2);
    expect(txs[0].data.startsWith("0x095ea7b3")).toBe(true);
    expect(txs[1].data.startsWith("0x6e553f65")).toBe(true);
    expect(txs[0].to).toBe("0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC");
    expect(txs[1].to).toBe("0x6852Adb5Fce1D73c08A9b3Aa7edE9A03437ac2fE");
    expect(txs.every((t) => t.value === "0")).toBe(true);

    const decoded = decodeFunctionData({
      abi: parseAbi(["function deposit(uint256 assets, address receiver) returns (uint256)"]),
      data: txs[1].data as `0x${string}`,
    });
    expect(decoded.args[0]).toBe(10n * 10n ** 18n);
    expect((decoded.args[1] as string).toLowerCase()).toBe(RECEIVER.toLowerCase());
  });

  test("usdg path without a router is an error", async () => {
    const body = await callTool("prepare_deposit", {
      id: "nvda",
      amount: "100",
      receiver: RECEIVER,
      asset: "usdg",
    });
    expect(body.isError).toBe(true);
    expect(body.content[0].text).toContain("router");
  });

  test("usdg path with a router approves USDG then zaps through it", async () => {
    const router = "0x1111111111111111111111111111111111111111";
    const body = await callTool(
      "prepare_deposit",
      { id: "nvda", amount: "100", receiver: RECEIVER, asset: "usdg" },
      { VAULTS, NETWORK: "robinhood-chain-fork", ROUTER: router },
    );
    expect(body.isError).toBeUndefined();

    const txs = body.structuredContent.transactions as Array<{ to: string; data: string; value: string }>;
    expect(txs.length).toBe(2);
    expect(txs[0].to).toBe("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
    expect(txs[0].data.startsWith("0x095ea7b3")).toBe(true);
    expect(txs[1].to).toBe(router);

    const decoded = decodeFunctionData({
      abi: parseAbi([
        "function depositUsdg(address vault, uint256 usdgIn, uint256 minShares, address receiver) returns (uint256)",
      ]),
      data: txs[1].data as `0x${string}`,
    });
    expect((decoded.args[0] as string).toLowerCase()).toBe(
      "0x6852Adb5Fce1D73c08A9b3Aa7edE9A03437ac2fE".toLowerCase(),
    );
    expect(decoded.args[1]).toBe(100n * 10n ** 6n);
    expect(decoded.args[2]).toBe(0n);
    expect((decoded.args[3] as string).toLowerCase()).toBe(RECEIVER.toLowerCase());
  });

  test("a bad receiver is an error", async () => {
    const body = await callTool("prepare_deposit", {
      id: "nvda",
      amount: "10",
      receiver: "0xnotanaddress",
    });
    expect(body.isError).toBe(true);
    expect(body.content[0].text).toContain("receiver");
  });

  test("a vault with no deployed address is an error", async () => {
    const body = await callTool("prepare_deposit", {
      id: "googl",
      amount: "10",
      receiver: RECEIVER,
    });
    expect(body.isError).toBe(true);
    expect(body.content[0].text).toContain("no deployed vault for googl");
  });
});

describe("deposit caps", () => {
  const vaults = (universeData as unknown as { vaults: Array<{ id: string; symbol: string; token: string; depositCapUsd: number; refPriceUsd: number; gate: { state: string } }> }).vaults;
  const by = (id: string) => vaults.find((v) => v.id === id)!;
  const ROUTER = "0x1111111111111111111111111111111111111111";
  const withVaults = { VAULTS: JSON.stringify({ nvda: "0x6852Adb5Fce1D73c08A9b3Aa7edE9A03437ac2fE", aapl: "0x0000000000000000000000000000000000000a01", pltr: "0x0000000000000000000000000000000000000a02", qqq: "0x0000000000000000000000000000000000000a03" }), NETWORK: "robinhood-chain-fork", ROUTER };
  const usdg = (id: string, amount: string) => callTool("prepare_deposit", { id, amount, receiver: RECEIVER, asset: "usdg" }, withVaults);

  test("list_vaults and get_vault_evidence carry deposit_cap_usd from the universe", async () => {
    const list = await callTool("list_vaults", {});
    const rows = list.structuredContent.vaults as Array<{ id: string; deposit_cap_usd: number }>;
    expect(rows.length).toBe(vaults.length);
    for (const r of rows) expect(r.deposit_cap_usd).toBe(by(r.id).depositCapUsd);
    const ev = await callTool("get_vault_evidence", { id: "aapl" });
    expect(ev.structuredContent.deposit_cap_usd).toBe(by("aapl").depositCapUsd);
  });

  test("an open vault sized below the full 100K refuses a deposit one dollar above its cap and takes one at the cap", async () => {
    const cap = by("aapl").depositCapUsd;
    expect(cap).toBeLessThan(100_000);
    expect(by("aapl").gate.state).toBe("open");
    const over = await usdg("aapl", String(cap + 1));
    expect(over.isError).toBe(true);
    expect(over.content[0].text).toContain(`$${cap.toLocaleString("en-US")}`);
    expect(over.content[0].text).toContain("sized to its pool");
    const at = await usdg("aapl", String(cap));
    expect(at.isError).toBeUndefined();
    expect((at.structuredContent.transactions as unknown[]).length).toBe(2);
  });

  test("a stock deposit is valued at the universe's Chainlink read before the cap applies", async () => {
    const v = by("aapl");
    expect(v.gate.state).toBe("open");
    const tokensAtCap = v.depositCapUsd / v.refPriceUsd;
    const over = await callTool("prepare_deposit", { id: "aapl", amount: (tokensAtCap * 1.01).toFixed(6), receiver: RECEIVER, asset: "stock" }, withVaults);
    expect(over.isError).toBe(true);
    expect(over.content[0].text).toContain(`$${v.depositCapUsd.toLocaleString("en-US")}`);
    const under = await callTool("prepare_deposit", { id: "aapl", amount: (tokensAtCap * 0.99).toFixed(6), receiver: RECEIVER, asset: "stock" }, withVaults);
    expect(under.isError).toBeUndefined();
  });

  test("a reduced vault takes the stricter of its size and the 25K per-transaction cap", async () => {
    // qqq: size above 25K, so the per-transaction cap is the stricter
    expect(by("qqq").gate.state).toBe("reduced");
    expect(by("qqq").depositCapUsd).toBeGreaterThan(25_000);
    const perTx = await usdg("qqq", "25001");
    expect(perTx.isError).toBe(true);
    expect(perTx.content[0].text).toContain("$25,000 per transaction");
    expect((await usdg("qqq", "25000")).isError).toBeUndefined();
    // pltr: size below 25K, so the vault size is the stricter
    expect(by("pltr").gate.state).toBe("reduced");
    const pltrCap = by("pltr").depositCapUsd;
    expect(pltrCap).toBeLessThan(25_000);
    const size = await usdg("pltr", String(pltrCap + 1));
    expect(size.isError).toBe(true);
    expect(size.content[0].text).toContain("sized to its pool");
    expect((await usdg("pltr", String(pltrCap))).isError).toBeUndefined();
  });
});

describe("prepare_withdraw", () => {
  test("builds an ERC4626 redeem with the right selector", async () => {
    const body = await callTool("prepare_withdraw", {
      id: "nvda",
      shares: "1",
      receiver: RECEIVER,
    });
    expect(body.isError).toBeUndefined();
    const txs = body.structuredContent.transactions as Array<{ data: string }>;
    expect(txs.length).toBe(1);
    expect(txs[0].data.startsWith("0xba087652")).toBe(true);
  });
});

describe("reduced gate", () => {
  test("extracts the per-transaction cap from the real reduced reason", () => {
    const reason =
      "Reduced: the weaker half of the 30-day replay kept -0.4% a year, between the -20% floor and break-even, across 842,504 swaps. Deposits are capped at $25,000 per transaction.";
    const notice = reducedNotice({
      state: "reduced",
      reason,
      rule: "x",
      floor_apr: 0,
      worst_half_apr: 0,
      swaps: 0,
      days: 30,
    } as never);
    expect(notice).not.toBeNull();
    expect(notice!.per_transaction_cap_usd).toBe(25000);
    expect(String(notice!.notice)).toContain("$25,000");
  });

  test("an open gate has no notice", () => {
    expect(
      reducedNotice({ state: "open", reason: "ok" } as never),
    ).toBeNull();
  });
});

describe("MCP transport errors", () => {
  test("an unknown method is a JSON-RPC -32601 error", async () => {
    const res = await post({ jsonrpc: "2.0", id: 9, method: "does/not/exist" });
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
  });

  test("GET /mcp is a 405 JSON", async () => {
    const res = await worker.fetch(
      new Request("https://uptick-evidence.test/mcp"),
      env,
      ctx,
    );
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("method_not_allowed");
  });
});
