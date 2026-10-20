import universeData from "../data/vault-universe.json";
const NVDA_GATE = (universeData as { vaults: Array<{ id: string; gate: { state: string; reason: string } }> }).vaults.find((v) => v.id === "nvda")!.gate;
import { describe, expect, test } from "bun:test";
import worker from "../src/worker";
import vaultUniverse from "../data/vault-universe.json";
import replay from "../data/replay.json";

const env = {} as Record<string, unknown>;
const ctx = {} as ExecutionContext;

function get(path: string): Promise<Response> {
  return worker.fetch(
    new Request(`https://uptick-evidence.test${path}`),
    env,
    ctx,
  );
}

interface VaultSummary {
  id: string;
  ticker: string;
  open: boolean;
  deposit_cap_usd: number;
  fee_apr_pct: number;
  kept_apr_pct: number;
  pool: string;
  window_days: number;
}

describe("GET /vaults", () => {
  test("returns exactly the vaults in vault-universe.json", async () => {
    const res = await get("/vaults");
    expect(res.status).toBe(200);

    const body = (await res.json()) as VaultSummary[];
    const universe = vaultUniverse.vaults;

    expect(body.length).toBe(universe.length);
    expect(body.map((v) => v.id)).toEqual(universe.map((v) => v.id));
    expect(body.map((v) => v.ticker)).toEqual(universe.map((v) => v.symbol));
    expect(body.map((v) => v.pool)).toEqual(universe.map((v) => v.pool));
    expect(body.map((v) => v.fee_apr_pct)).toEqual(
      universe.map((v) => v.feeAprPct),
    );
    expect(body.map((v) => v.kept_apr_pct)).toEqual(
      universe.map((v) => v.keptAprPct),
    );
    expect(body.every((v) => v.window_days === replay.window.days)).toBe(true);
  });

  test("seventeen vaults: nvda, aapl, googl, amzn, pltr, qqq and spy take deposits, the other ten are closed", async () => {
    const body = (await (await get("/vaults")).json()) as VaultSummary[];
    const byId = Object.fromEntries(body.map((v) => [v.id, v.open]));

    expect(body.length).toBe(17);
    expect(byId).toEqual({
      nvda: true, aapl: true, googl: true, amzn: true, pltr: true, qqq: true, spy: true,
      amd: false, crcl: false, gme: false, intc: false, meta: false, mstr: false, mu: false, spcx: false, tsla: false, uso: false,
    });
  });

  test("every vault lists deposit_cap_usd, the vault size from its pool depth, and it matches the keeper universe", async () => {
    const body = (await (await get("/vaults")).json()) as VaultSummary[];
    expect(body.map((v) => v.deposit_cap_usd)).toEqual(vaultUniverse.vaults.map((v) => v.depositCapUsd));
    for (const v of body) {
      expect(v.deposit_cap_usd).toBeGreaterThanOrEqual(10_000);
      expect(v.deposit_cap_usd).toBeLessThanOrEqual(100_000);
    }
    const cap = Object.fromEntries(body.map((v) => [v.id, v.deposit_cap_usd]));
    expect(cap.nvda).toBe(100_000);
    expect(cap.aapl).toBeLessThan(100_000); // a thin pool carries a smaller vault
    const detail = (await (await get("/vaults/aapl")).json()) as { deposit_cap_usd: number };
    expect(detail.deposit_cap_usd).toBe(cap.aapl);
  });

  test("every vault carries a gate state and a written reason", async () => {
    const body = (await (await get("/vaults")).json()) as VaultSummary[];
    const want: Record<string, string> = {
      nvda: "open", aapl: "open", amzn: "reduced", googl: "reduced", spy: "reduced", pltr: "reduced", qqq: "reduced",
      uso: "closed", spcx: "closed", crcl: "closed", amd: "closed", gme: "closed", intc: "closed", meta: "closed", mstr: "closed", mu: "closed", tsla: "closed",
    };
    expect(body.length).toBeGreaterThan(0);
    for (const v of body) {
      const d = (await (await get(`/vaults/${v.id}`)).json()) as { gate: { state: string; reason: string } };
      expect(d.gate.state).toBe(want[v.id]);
      expect(d.gate.reason.toLowerCase().startsWith(want[v.id])).toBe(true);
    }
  });
});

describe("GET /vaults/:id", () => {
  test("includes one pool row per replay pool plus the gate rule", async () => {
    const res = await get("/vaults/nvda");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      id: string;
      ticker: string;
      open: boolean;
      pools: Array<{
        kind: string;
        fee_tier: number;
        hooks: string | null;
        volume_usd: number;
        fee_apr_pct: number | null;
        calibration_edge_apr_pct: number | null;
        test_edge_apr_pct: number | null;
      }>;
      gate: { floor_apr: number; rule: string; state: string; reason: string };
    };

    expect(body.id).toBe("nvda");
    expect(body.gate.state).toBe(NVDA_GATE.state);
    expect(body.gate.reason).toBe(NVDA_GATE.reason);
    expect(body.ticker).toBe("NVDA");
    expect(body.open).toBe(true);
    expect(body.pools.length).toBe(replay.tokens.NVDA.pools.length);

    const first = body.pools[0];
    expect(typeof first.kind).toBe("string");
    expect(typeof first.fee_tier).toBe("number");
    expect("hooks" in first).toBe(true);
    expect(typeof first.volume_usd).toBe("number");
    expect(first.fee_apr_pct).toBe(replay.tokens.NVDA.pools[0].full.fee_apr_pct);
    expect(first.calibration_edge_apr_pct).toBe(
      replay.tokens.NVDA.pools[0].calibration.edge_apr_pct,
    );
    expect(first.test_edge_apr_pct).toBe(
      replay.tokens.NVDA.pools[0].test.edge_apr_pct,
    );

    expect(body.gate).toMatchObject({
      floor_apr: -20,
      rule: "open when the lower of the two replay halves keeps at least break-even; between -20% and break-even it is reduced with a $25,000 per-transaction cap; below -20% it is closed",
    });
  });

  test("carries a hook address for hook pools", async () => {
    const res = await get("/vaults/crcl");
    const body = (await res.json()) as {
      pools: Array<{ hooks: string | null }>;
    };
    expect(body.pools.some((p) => typeof p.hooks === "string")).toBe(true);
  });
});

describe("GET /health", () => {
  test("reports the replay window and total swaps replayed", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      generated_at: string;
      window: { days: number };
      swaps_replayed: number;
    };
    const expected = Object.values(replay.tokens).reduce(
      (total, token) => total + token.swaps_replayed,
      0,
    );

    expect(body.ok).toBe(true);
    expect(body.generated_at).toBe(replay.generated_at);
    expect(body.window.days).toBe(replay.window.days);
    expect(body.swaps_replayed).toBe(expected);
  });
});

describe("errors and CORS", () => {
  test("an unknown route is 404 JSON", async () => {
    const res = await get("/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  test("an unknown vault id is 404 JSON", async () => {
    const res = await get("/vaults/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  test("every response carries access-control-allow-origin *", async () => {
    for (const path of ["/health", "/vaults", "/vaults/nvda", "/nope"]) {
      const res = await get(path);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });
});

describe("GET /llms.txt", () => {
  test("serves the agent context file without site-relative links", async () => {
    const res = await get("/llms.txt");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.startsWith("# Uptick")).toBe(true);
    expect(body).toContain("/mcp");
    expect(body).not.toContain("](/");
  });
});
