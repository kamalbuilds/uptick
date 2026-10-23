import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import worker from "../src/worker";

const root = resolve(import.meta.dir, "../..");
const webUniverse = JSON.parse(readFileSync(resolve(root, "web/lib/vault-universe.json"), "utf8")) as {
  vaults: Array<{ id: string; symbol: string; depositCapUsd: number; gate: { state: string; worst_half_apr: number } }>;
};

/** The README gate table (rows between the gates markers): symbol to Status cell. */
function readmeDoors(): Map<string, string> {
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  const block = readme.match(/<!-- gates:start -->([\s\S]*?)<!-- gates:end -->/)?.[1] ?? "";
  const rows = block.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Vault") && !l.startsWith("|---"));
  return new Map(rows.map((l) => {
    const cells = l.split("|").map((c) => c.trim());
    return [cells[1], cells[6].toLowerCase()] as [string, string];
  }));
}

interface Door {
  id: string;
  ticker: string;
  open: boolean;
  state: string;
  per_tx_cap_usd: number;
  kept_worst_half_pct: number;
  deposit_cap_usd: number;
  kept_apr_pct: number;
}

async function apiVaults(): Promise<Door[]> {
  const res = await worker.fetch(new Request("https://uptick-evidence.test/vaults"), {} as Record<string, unknown>, {} as ExecutionContext);
  expect(res.status).toBe(200);
  return (await res.json()) as Door[];
}

const count = (xs: Array<{ state: string }>, s: string) => xs.filter((x) => x.state === s).length;

describe("doors: state, per_tx_cap_usd and kept_worst_half_pct on /vaults", () => {
  test("door counts equal docs/facts.json and the README gate table", async () => {
    const vaults = await apiVaults();
    const readme = readmeDoors();
    expect(readme.size).toBe(17);
    expect(vaults.length).toBe(17);
    const fromReadme = [...readme.values()].map((state) => ({ state }));
    const doors = JSON.parse(readFileSync(new URL("../../docs/facts.json", import.meta.url), "utf8")).doors as number[];
    expect(doors.reduce((a, b) => a + b, 0)).toBe(17);
    expect([count(vaults, "open"), count(vaults, "reduced"), count(vaults, "closed")]).toEqual(doors);
    expect([count(fromReadme, "open"), count(fromReadme, "reduced"), count(fromReadme, "closed")]).toEqual(doors);
    for (const v of vaults) expect(v.state).toBe(readme.get(v.ticker.toUpperCase()));
  });

  test("kept_worst_half_pct equals web/lib/vault-universe.json for every vault", async () => {
    const vaults = await apiVaults();
    expect(webUniverse.vaults.length).toBe(17);
    for (const w of webUniverse.vaults) {
      const v = vaults.find((x) => x.id === w.id);
      expect(v).toBeDefined();
      expect(v!.kept_worst_half_pct).toBe(w.gate.worst_half_apr);
      expect(v!.state).toBe(w.gate.state);
    }
  });

  test("open means accepts deposits: open is true for state open and reduced, false for closed", async () => {
    for (const v of await apiVaults()) expect(v.open).toBe(v.state !== "closed");
  });

  test("per_tx_cap_usd is the smaller of the reduced-gate cap and the vault size, and 0 when closed", async () => {
    for (const v of await apiVaults()) {
      if (v.state === "closed") expect(v.per_tx_cap_usd).toBe(0);
      else if (v.state === "reduced") expect(v.per_tx_cap_usd).toBe(Math.min(25_000, v.deposit_cap_usd));
      else expect(v.per_tx_cap_usd).toBe(v.deposit_cap_usd);
    }
  });

  test("the fields from before stay: deposit_cap_usd, fee_apr_pct, kept_apr_pct, entry_fee_bps, venue, pool", async () => {
    const [first] = await apiVaults();
    for (const k of ["id", "ticker", "open", "deposit_cap_usd", "entry_fee_bps", "fee_apr_pct", "kept_apr_pct", "venue", "fee_tier", "pool", "window_days"]) {
      expect(first).toHaveProperty(k);
    }
  });

  test("MCP list_vaults carries the same three fields", async () => {
    const res = await worker.fetch(
      new Request("https://uptick-evidence.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_vaults", arguments: {} } }),
      }),
      {} as Record<string, unknown>,
      {} as ExecutionContext,
    );
    const body = (await res.json()) as { result: { structuredContent: { vaults: Array<Door & { gate_state: string }> } } };
    const rest = await apiVaults();
    const mcp = body.result.structuredContent.vaults;
    expect(mcp.length).toBe(17);
    for (const m of mcp) {
      const r = rest.find((x) => x.id === m.id)!;
      expect([m.state, m.per_tx_cap_usd, m.kept_worst_half_pct]).toEqual([r.state, r.per_tx_cap_usd, r.kept_worst_half_pct]);
      expect(m.state).toBe(m.gate_state);
    }
  });
});
