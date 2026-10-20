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

  test("seventeen vaults: aapl, amd, amzn, googl, intc, nvda, pltr, qqq, spy and uso take deposits, the other seven are closed", async () => {
    const body = (await (await get("/vaults")).json()) as VaultSummary[];
    const byId = Object.fromEntries(body.map((v) => [v.id, v.open]));

    expect(body.length).toBe(17);
    expect(byId).toEqual({
      nvda: true, aapl: true, googl: true, amzn: true, pltr: true, qqq: true, spy: true, amd: true, intc: true, uso: true,
      crcl: false, gme: false, meta: false, mstr: false, mu: false, spcx: false, tsla: false,
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
      aapl: "open", nvda: "reduced", amzn: "reduced", googl: "reduced", spy: "reduced", pltr: "reduced", qqq: "reduced", amd: "reduced", intc: "reduced", uso: "reduced",
      spcx: "closed", crcl: "closed", gme: "closed", meta: "closed", mstr: "closed", mu: "closed", tsla: "closed",
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

  test("serves no pool the replay cannot model: no hook-set dynamic fee, hooks null or an address", async () => {
    let seen = 0;
    for (const id of ["nvda", "crcl", "meta", "spcx", "qqq", "tsla"]) {
      const body = (await (await get(`/vaults/${id}`)).json()) as {
        pools: Array<{ hooks: string | null; fee_tier: number; volume_usd: number }>;
      };
      for (const p of body.pools) {
        seen++;
        expect(p.fee_tier & 0x800000).toBe(0);
        expect(p.hooks === null || /^0x[0-9a-fA-F]{40}$/.test(p.hooks)).toBe(true);
        expect(p.volume_usd).toBeLessThan(1e10);
      }
    }
    expect(seen).toBeGreaterThan(10);
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

describe("GET /keeper/vaults/:id (the stats shape the web app reads)", () => {
  interface Stats {
    id: string;
    ticker: string;
    source: string;
    pool: string;
    vault: string | null;
    tvl_usd: number | null;
    price_per_share_raw: string | null;
    fees_lifetime_view_raw: string | null;
    onchain_error?: string;
    open: boolean;
    chart: unknown;
    fee_apr_pct: { replay_30d: number; "7d": number | null };
    replay: { window: { days: number } };
    evidence: { open: boolean; band_bps: number; gate: { state: string }; pools: unknown[]; chosen_pool: string; swaps_replayed: number };
  }
  const NVDA = "0x6852Adb5Fce1D73c08A9b3Aa7edE9A03437ac2fE";
  const getWith = (path: string, e: Record<string, unknown>) =>
    worker.fetch(new Request(`https://uptick-evidence.test${path}`), e, ctx);

  test("serves all seventeen vaults from the replay, with no on-chain figures and no chart", async () => {
    expect(vaultUniverse.vaults.length).toBe(17);
    for (const v of vaultUniverse.vaults) {
      const res = await get(`/keeper/vaults/${v.id}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Stats;
      expect(body.id).toBe(v.id);
      expect(body.ticker).toBe(v.symbol);
      expect(body.pool).toBe(v.pool);
      expect(body.source).toBe("replay");
      expect(body.vault).toBeNull();
      expect(body.tvl_usd).toBeNull();
      expect(body.chart).toBeNull();
      expect(body.fee_apr_pct.replay_30d).toBe(v.feeAprPct);
      expect(body.evidence.band_bps).toBe(v.bandBps);
      expect(body.replay.window.days).toBe(replay.window.days);
      expect(body.open).toBe(v.open);
      expect(body.evidence.gate.state).toBe(v.gate.state);
      expect(body.evidence.chosen_pool).toBe(v.pool);
      expect(body.evidence.pools.length).toBeGreaterThan(0);
      expect(body.evidence.swaps_replayed).toBe(v.gate.swaps);
    }
  });

  test("the list serves all seventeen, best replay fee APR first, each entry equal to its own /keeper/vaults/:id answer", async () => {
    const res = await get("/keeper/vaults");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as { count: number; window: { days: number }; vaults: Stats[] };
    expect(body.count).toBe(17);
    expect(body.vaults.length).toBe(17);
    expect(body.window.days).toBe(replay.window.days);
    const aprs = body.vaults.map((v) => v.fee_apr_pct.replay_30d);
    expect([...aprs].sort((a, b) => b - a)).toEqual(aprs);
    expect(new Set(body.vaults.map((v) => v.id)).size).toBe(17);
    const one = (await (await get("/keeper/vaults/spy")).json()) as Stats;
    expect(body.vaults.find((v) => v.id === "spy")).toEqual(one);
  });

  test("ids are case-insensitive, unknown ids are 404 JSON, every answer carries CORS, OPTIONS preflights", async () => {
    expect(((await (await get("/keeper/vaults/NVDA")).json()) as Stats).id).toBe("nvda");
    const missing = await get("/keeper/vaults/nope");
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe("unknown_vault");
    expect(missing.headers.get("access-control-allow-origin")).toBe("*");
    expect((await get("/keeper/vaults/nvda")).headers.get("access-control-allow-origin")).toBe("*");
    const pre = await worker.fetch(new Request("https://uptick-evidence.test/keeper/vaults/nvda", { method: "OPTIONS" }), env, ctx);
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("a VAULTS address without CHAIN_RPC_URL stays replay-only: nothing is read from a chain it was not configured for", async () => {
    const body = (await (await getWith("/keeper/vaults/nvda", { VAULTS: JSON.stringify({ nvda: NVDA }) })).json()) as Stats;
    expect(body.source).toBe("replay");
    expect(body.vault).toBeNull();
    expect(body.tvl_usd).toBeNull();
    expect(body.onchain_error).toBeUndefined();
  });

  describe("with VAULTS and CHAIN_RPC_URL configured", () => {
    const realFetch = globalThis.fetch;
    const calls: { to: string; data: string }[] = [];
    const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
    const answers: Record<string, bigint> = {};
    const rpcEnv = { VAULTS: JSON.stringify({ nvda: NVDA }), CHAIN_RPC_URL: "https://rpc.test" };

    function stub(handler: (selector: string, id: number) => Response) {
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        const req = JSON.parse(String(init?.body)) as { id: number; method: string; params: [{ to: string; data: string }] };
        calls.push({ to: req.params[0].to, data: req.params[0].data });
        return handler(req.params[0].data.slice(0, 10).toLowerCase(), req.id);
      }) as typeof fetch;
    }
    const ok = (id: number, result: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));

    test("TVL, share price and lifetime fees come from the vault contract; realized APR stays null", async () => {
      const { toFunctionSelector } = await import("viem");
      answers[toFunctionSelector("totalValueInUSDG()")] = 1_234_500_000n;
      answers[toFunctionSelector("pricePerShare()")] = 1_050_000_000_000_000_000_000_000n;
      answers[toFunctionSelector("feesEarnedLifetime()")] = 777n;
      calls.length = 0;
      stub((sel, id) => ok(id, word(answers[sel])));
      try {
        const body = (await (await getWith("/keeper/vaults/nvda", rpcEnv)).json()) as Stats;
        expect(body.source).toBe("onchain");
        expect(body.vault).toBe(NVDA);
        expect(body.tvl_usd).toBe(1234.5);
        expect(body.price_per_share_raw).toBe("1050000000000000000000000");
        expect(body.fees_lifetime_view_raw).toBe("777");
        expect(body.fee_apr_pct["7d"]).toBeNull();
        expect(body.fee_apr_pct.replay_30d).toBe(vaultUniverse.vaults.find((v) => v.id === "nvda")!.feeAprPct);
        expect(calls.length).toBe(3);
        expect(calls.every((c) => c.to.toLowerCase() === NVDA.toLowerCase())).toBe(true);
        // an id with no VAULTS entry never touches the RPC
        calls.length = 0;
        const other = (await (await getWith("/keeper/vaults/aapl", rpcEnv)).json()) as Stats;
        expect(other.source).toBe("replay");
        expect(other.tvl_usd).toBeNull();
        expect(calls.length).toBe(0);
      } finally {
        globalThis.fetch = realFetch;
      }
    });

    test("an RPC failure keeps the page alive on replay figures and says why", async () => {
      stub(() => new Response("upstream down", { status: 502 }));
      try {
        const res = await getWith("/keeper/vaults/nvda", rpcEnv);
        expect(res.status).toBe(200);
        const body = (await res.json()) as Stats;
        expect(body.source).toBe("replay");
        expect(body.tvl_usd).toBeNull();
        expect(typeof body.onchain_error).toBe("string");
        expect(body.evidence.gate.state).toBe("reduced");
      } finally {
        globalThis.fetch = realFetch;
      }
    });
  });
});
