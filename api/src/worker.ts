import replay from "../data/replay.json";
import { doorFields, handleMcp, liveVaults, UNIVERSE, venueFields, type Env } from "./mcp";
import LLMS from "./llms";
import { keeperList, keeperVault } from "./keeper";
import { postTalk, talkCount } from "./talk";
import { runAlerts, subscribe, unsubscribe } from "./alerts";

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
  capital_usd?: number;
  pools: PoolRow[];
  swaps_replayed: number;
}

interface ReplayWindow {
  start: string;
  end: string;
  days: number;
  calibration_end: string;
}

interface Replay {
  generated_at: string;
  strategy: string;
  capital_usd: number;
  tokens: Record<string, TokenReplay>;
  window: ReplayWindow;
}

const REPLAY = replay as unknown as Replay;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
};

const GATE = {
  floor_apr: -20,
  rule: "open when the lower of the two replay halves keeps at least break-even; between -20% and break-even it is reduced with a $25,000 per-transaction cap; below -20% it is closed",
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

function listVaults(env: Env) {
  return liveVaults(env).map((vault) => ({
    id: vault.id,
    ticker: vault.symbol,
    open: vault.open,
    ...doorFields(vault),
    deposit_cap_usd: vault.depositCapUsd,
    entry_fee_bps: vault.entryFeeBps,
    fee_apr_pct: vault.feeAprPct,
    kept_apr_pct: doorFields(vault).kept_worst_half_pct,
    ...venueFields(vault),
    window_days: REPLAY.window.days,
  }));
}

function vaultDetail(id: string, env: Env): Response {
  const vault = liveVaults(env).find((candidate) => candidate.id === id);
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
    ...doorFields(vault),
    deposit_cap_usd: vault.depositCapUsd,
    token: vault.token,
    ...venueFields(vault),
    entry_fee_bps: vault.entryFeeBps,
    feed: vault.feed,
    fee_apr_pct: vault.feeAprPct,
    kept_apr_pct: doorFields(vault).kept_worst_half_pct,
    window_days: REPLAY.window.days,
    pools,
    gate: { ...GATE, ...(vault.gate ?? {}) },
  });
}

async function keeperStats(id: string, env: Env): Promise<Response> {
  const vault = UNIVERSE.vaults.find((candidate) => candidate.id === id);
  const tok = vault && REPLAY.tokens[vault.symbol];
  if (!vault || !tok) return json({ error: "unknown_vault" }, 404);
  return json(await keeperVault(env, vault, REPLAY, tok));
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

  if (path === "/alerts/subscribe" || path === "/alerts/unsubscribe") {
    if (request.method !== "POST") return json({ error: "method_not_allowed", method: request.method }, 405);
    return path === "/alerts/subscribe" ? subscribe(request, env) : unsubscribe(request, env);
  }

  if (path === "/talk") {
    if (request.method === "POST") return postTalk(request, env);
    return json({ error: "method_not_allowed", method: request.method }, 405);
  }

  if (request.method !== "GET") {
    return json({ error: "method_not_allowed", method: request.method }, 405);
  }

  if (path === "/llms.txt" && request.method === "GET") {
    return new Response(LLMS, { headers: { ...CORS_HEADERS, "content-type": "text/plain; charset=utf-8" } });
  }
  if (path === "/talk/count") return talkCount(env);
  if (path === "/health") {
    return health();
  }

  if (path === "/vaults") {
    return json(listVaults(env));
  }

  // The web app's stats route (keeper/src/stats.ts shape), so the static site needs no keeper process.
  if (path === "/keeper/vaults") return keeperList(env, UNIVERSE.vaults, REPLAY).then((body) => json(body));
  const stats = path.match(/^\/keeper\/vaults\/([^/]+)$/);
  if (stats) return keeperStats(decodeURIComponent(stats[1]).toLowerCase(), env);

  const detail = path.match(/^\/vaults\/([^/]+)$/);
  if (detail) {
    return vaultDetail(decodeURIComponent(detail[1]), env);
  }

  return json({ error: "not_found", path }, 404);
}

export default {
  fetch: handleRequest,
  // The cron trigger in wrangler.toml: read every watched loan and send the webhooks that are due.
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(runAlerts(env));
  },
} satisfies ExportedHandler<Env>;
