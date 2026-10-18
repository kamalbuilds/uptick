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

  test("nvda and googl are open, crcl and spcx are closed", async () => {
    const body = (await (await get("/vaults")).json()) as VaultSummary[];
    const byId = Object.fromEntries(body.map((v) => [v.id, v.open]));

    expect(byId.nvda).toBe(true);
    expect(byId.googl).toBe(true);
    expect(byId.crcl).toBe(false);
    expect(byId.spcx).toBe(false);
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
    expect(body.gate.state).toBe("reduced");
    expect(body.gate.reason).toContain("between the -20% floor and break-even");
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
      rule: "open when the lower of the two replay halves keeps at least -20% APR",
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
