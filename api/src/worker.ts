import vaultUniverse from "../data/vault-universe.json";
import replay from "../data/replay.json";
import { handleMcp, type Env } from "./mcp";
import LLMS from "./llms";

interface HalfStats {
  fee_apr_pct: number | null;
  markout_apr_pct: number | null;
  cost_apr_pct: number | null;
  edge_apr_pct: number | null;
  rebalances: number;
}

interface PoolRow {
  kind: string;
  id: string;
  fee_tier: number;
  hooks: string | null;
  vault_capable: boolean;
  swaps: number;
  volume_usd: number;
  pool_fees_usd: number;
  full: HalfStats;
  calibration: HalfStats;
  test: HalfStats;
}

interface TokenReplay {
  symbol: string;
  pools: PoolRow[];
  swaps_replayed: number;
}

interface Vault {
  id: string;
  symbol: string;
  name: string;
  token: string;
  pool: string;
  feeTierPips: number;
  feeTier: string;
  feed: string;
  open: boolean;
  feeAprPct: number;
  keptAprPct: number;
  gate?: { state: string; reason: string; floor_apr: number; worst_half_apr: number; swaps: number; days: number };
}

interface ReplayWindow {
  start: string;
  end: string;
  days: number;
  calibration_end: string;
}

interface Replay {
  generated_at: string;
  tokens: Record<string, TokenReplay>;
  window: ReplayWindow;
}

const UNIVERSE = vaultUniverse as { vaults: Vault[] };
const REPLAY = replay as unknown as Replay;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
};

const GATE = {
  floor_apr: -20,
  rule: "open when the lower of the two replay halves keeps at least -20% APR",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function listVaults() {
  return UNIVERSE.vaults.map((vault) => ({
    id: vault.id,
    ticker: vault.symbol,
    open: vault.open,
    fee_apr_pct: vault.feeAprPct,
    kept_apr_pct: vault.keptAprPct,
    pool: vault.pool,
    window_days: REPLAY.window.days,
  }));
}

function vaultDetail(id: string): Response {
  const vault = UNIVERSE.vaults.find((candidate) => candidate.id === id);
  if (!vault) {
    return json(
      { error: "not_found", id, message: `no vault with id "${id}"` },
      404,
    );
  }

  const token = REPLAY.tokens[vault.symbol];
  const pools = token
    ? token.pools.map((pool) => ({
        kind: pool.kind,
        fee_tier: pool.fee_tier,
        hooks: pool.hooks,
        volume_usd: pool.volume_usd,
        fee_apr_pct: pool.full.fee_apr_pct,
        calibration_edge_apr_pct: pool.calibration.edge_apr_pct,
        test_edge_apr_pct: pool.test.edge_apr_pct,
      }))
    : [];

  return json({
    id: vault.id,
    ticker: vault.symbol,
    name: vault.name,
    open: vault.open,
    token: vault.token,
    pool: vault.pool,
    fee_tier_pips: vault.feeTierPips,
    fee_tier: vault.feeTier,
    feed: vault.feed,
    fee_apr_pct: vault.feeAprPct,
    kept_apr_pct: vault.keptAprPct,
    window_days: REPLAY.window.days,
    pools,
    gate: { ...GATE, ...(vault.gate ?? {}) },
  });
}

function health() {
  const swapsReplayed = Object.values(REPLAY.tokens).reduce(
    (total, token) => total + token.swaps_replayed,
    0,
  );
  return json({
    ok: true,
    generated_at: REPLAY.generated_at,
    window: REPLAY.window,
    swaps_replayed: swapsReplayed,
  });
}

function handleRequest(
  request: Request,
  env: Env = {},
): Response | Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  if (path === "/mcp") {
    if (request.method === "POST") {
      return handleMcp(request, env);
    }
    return json({ error: "method_not_allowed", method: request.method }, 405);
  }

  if (request.method !== "GET") {
    return json({ error: "method_not_allowed", method: request.method }, 405);
  }

  if (path === "/llms.txt" && request.method === "GET") {
    return new Response(LLMS, { headers: { ...CORS_HEADERS, "content-type": "text/plain; charset=utf-8" } });
  }
  if (path === "/health") {
    return health();
  }

  if (path === "/vaults") {
    return json(listVaults());
  }

  const detail = path.match(/^\/vaults\/([^/]+)$/);
  if (detail) {
    return vaultDetail(decodeURIComponent(detail[1]));
  }

  return json({ error: "not_found", path }, 404);
}

export default { fetch: handleRequest } satisfies ExportedHandler<Env>;
