import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import worker from "../src/worker";
import universe from "../data/vault-universe.json";
import record from "../data/deployments.json";
import { parseVaults, scanVaults } from "../src/mcp";
import { scanWallet } from "../src/shared/scan.ts";
import { E18, mockChain, px } from "../../web/lib/scan-mock.ts";

const ctx = {} as ExecutionContext;
const ROUTER = "0x599BE83442e02810B501fab280dC2eBD6d0D2c48";
const RECEIVER = "0x2222222222222222222222222222222222222222";
const deployed = Object.entries(record.vaults).map(([symbol, d]) => ({ id: symbol.toLowerCase(), symbol, address: d.address, capUsd: d.capUsd }));
const launching = universe.vaults.filter((v) => !deployed.some((d) => d.id === v.id));
const env = { VAULTS: JSON.stringify(Object.fromEntries(deployed.map((d) => [d.id, d.address]))), ROUTER, NETWORK: "robinhood-chain" } as Record<string, unknown>;

const rpc = async (name: string, args: Record<string, unknown>, e = env) => {
  const res = await worker.fetch(new Request("https://uptick-evidence.test/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), e, ctx);
  return ((await res.json()) as { result: { structuredContent: Record<string, any>; isError?: boolean } }).result;
};
const get = async (path: string, e = env) => (await worker.fetch(new Request(`https://uptick-evidence.test${path}`), e, ctx)).json() as Promise<any>;

describe("a deployed vault reports the cap its contract enforces on every surface", () => {
  test("the record deploys vaults whose launch cap is higher, so the override has something to fix", () => {
    expect(deployed.length).toBeGreaterThanOrEqual(2);
    for (const d of deployed) expect(universe.vaults.find((v) => v.id === d.id)!.depositCapUsd).toBeGreaterThan(d.capUsd);
  });

  test("list_vaults, get_vault_evidence, GET /vaults and GET /vaults/:id never report a cap above the deployed cap, and launching vaults keep the launch cap", async () => {
    const list = (await rpc("list_vaults", {})).structuredContent.vaults as Array<{ id: string; deposit_cap_usd: number; per_tx_cap_usd: number }>;
    const rest = (await get("/vaults")) as Array<{ id: string; deposit_cap_usd: number; per_tx_cap_usd: number }>;
    for (const surface of [list, rest]) {
      for (const d of deployed) {
        const row = surface.find((v) => v.id === d.id)!;
        expect(row.deposit_cap_usd).toBeLessThanOrEqual(d.capUsd);
        expect(row.deposit_cap_usd).toBe(d.capUsd);
        expect(row.per_tx_cap_usd).toBeLessThanOrEqual(d.capUsd);
      }
      expect(launching.length).toBeGreaterThan(0);
      for (const u of launching) expect(surface.find((v) => v.id === u.id)!.deposit_cap_usd).toBe(u.depositCapUsd);
    }
    for (const d of deployed) {
      expect((await rpc("get_vault_evidence", { id: d.id })).structuredContent.deposit_cap_usd).toBe(d.capUsd);
      expect((await get(`/vaults/${d.id}`)).deposit_cap_usd).toBe(d.capUsd);
    }
  });

  test("with no VAULTS configured, or an address the record does not name, the launch cap stands", async () => {
    const bare = (await get("/vaults", { NETWORK: "robinhood-chain" })) as Array<{ id: string; deposit_cap_usd: number }>;
    const fork = (await get("/vaults", { VAULTS: JSON.stringify({ pltr: "0x0000000000000000000000000000000000000a01" }) })) as Array<{ id: string; deposit_cap_usd: number }>;
    for (const surface of [bare, fork]) for (const u of universe.vaults) expect(surface.find((v) => v.id === u.id)!.deposit_cap_usd).toBe(u.depositCapUsd);
  });

  test("prepare_deposit refuses an amount above the deployed cap and accepts one below it", async () => {
    for (const d of deployed) {
      const over = await rpc("prepare_deposit", { id: d.id, amount: String(d.capUsd + 1), asset: "usdg", receiver: RECEIVER });
      expect(over.isError).toBe(true);
      expect(over.structuredContent.error).toContain(`$${d.capUsd.toLocaleString("en-US")}`);
      const ok = await rpc("prepare_deposit", { id: d.id, amount: String(d.capUsd - 1), asset: "usdg", receiver: RECEIVER });
      expect(ok.isError).toBeUndefined();
      expect(ok.structuredContent.transactions.length).toBe(2);
    }
  });

  test("scan_wallet puts a large holding to work at the deployed cap", async () => {
    for (const d of deployed) {
      const vaults = scanVaults(env as { VAULTS: string });
      const v = vaults.find((x) => x.id === d.id)!;
      const chain = mockChain(vaults, { [v.token.toLowerCase()]: 1000n * E18 }, { [v.feed.toLowerCase()]: px(100) });
      const scan = await scanWallet(chain.client, "0x335836A23a2E475265058CB55318EF91A07136b7", vaults);
      expect(scan.rows[0].holdingUsd).toBe(100_000);
      expect(scan.rows[0].putToWorkUsd).toBe(d.capUsd);
      expect(scan.rows[0].depositCapUsd).toBeLessThanOrEqual(d.capUsd);
    }
  });
});

describe("api/wrangler.toml wires the record", () => {
  const toml = readFileSync(resolve(import.meta.dir, "../wrangler.toml"), "utf8");
  const quoted = (key: string) => toml.match(new RegExp(`^${key} = ['"](.*)['"]$`, "m"))?.[1];

  test("VAULTS is keyed by vault id (what parseVaults and findVault look up) at the record's addresses, and ROUTER is the record's router", () => {
    const vaults = parseVaults(quoted("VAULTS"));
    expect(Object.keys(vaults).sort()).toEqual(deployed.map((d) => d.id).sort());
    for (const d of deployed) {
      expect(universe.vaults.some((v) => v.id === d.id)).toBe(true);
      expect(vaults[d.id]).toBe(d.address);
    }
    expect(quoted("ROUTER")).toBe(record.router.address);
  });

  test("the Worker reads the chain through a keyless https endpoint", () => {
    expect(quoted("CHAIN_RPC_URL")).toBe("https://robinhood-rpc.publicnode.com");
  });
});
