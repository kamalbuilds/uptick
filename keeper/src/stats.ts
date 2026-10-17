import { readFileSync } from "node:fs";
import { loadTickers, type Ticker } from "./config.ts";
import { assertPoolOrdering } from "./chain.ts";
import { log } from "./log.ts";
import { onchainVault, samplePps } from "./vaultdata.ts";

const PORT = Number(process.env.STATS_PORT || 8790);
const SAMPLE_S = 300;
const replay = JSON.parse(readFileSync(new URL("../data/replay.json", import.meta.url), "utf8"));
const tickers = loadTickers();

function replayVault(t: Ticker) {
  const p = replay.pools[t.symbol], run = p.runs[replay.headline_strategy];
  return {
    id: t.id, ticker: t.symbol, source: "replay" as const, pool: t.pool, fee_tier: t.feeTier,
    vault: null, tvl_usd: null,
    fee_apr_pct: { replay_30d: run.fee_apr_pct },
    replay: { strategy: `daily recentre at the NYSE open + 5 min, +-${run.band_pct}% around Chainlink`, capital_usd: replay.capital_usd, window: replay.window,
      edge_apr_pct: run.edge_apr_pct, net_vs_hold_apr_pct: run.net_vs_hold_apr_pct, rebalances: run.rebalances },
  };
}

const cache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(k: string, ttlMs: number, f: () => Promise<T>): Promise<T> {
  const h = cache.get(k);
  if (h && Date.now() - h.at < ttlMs) return h.v as T;
  const v = await f(); cache.set(k, { at: Date.now(), v }); return v;
}
const vaultView = (t: Ticker) => t.vault ? cached(`v:${t.id}`, 30_000, () => onchainVault(t)) : Promise.resolve(replayVault(t));
const strip = ({ share_price_history, ...rest }: any) => rest;

const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers });

export async function handle(req: Request): Promise<Response> {
  const u = new URL(req.url); const parts = u.pathname.split("/").filter(Boolean);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "GET" } });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    if (u.pathname === "/health") return json({ ok: true, tickers: tickers.map((t) => ({ id: t.id, source: t.vault ? "onchain" : "replay" })) });
    if (parts[0] === "vaults" && parts.length === 1) return json({ vaults: (await Promise.all(tickers.map(vaultView))).map(strip) });
    if (parts[0] === "vaults" && parts.length === 2) {
      const t = tickers.find((x) => x.id === parts[1].toLowerCase());
      return t ? json(await vaultView(t)) : json({ error: "unknown_vault" }, 404);
    }
    if (parts[0] === "pools" && parts[2] === "replay" && parts.length === 3) {
      const k = parts[1].toLowerCase();
      const t = tickers.find((x) => x.id === k || x.pool.toLowerCase() === k);
      if (!t) return json({ error: "unknown_pool" }, 404);
      return json({ id: t.id, source: "replay", ticker: t.symbol, headline_strategy: replay.headline_strategy, generated_at: replay.generated_at,
        window: replay.window, capital_usd: replay.capital_usd, cost_model: replay.cost_model, ...replay.pools[t.symbol] });
    }
    return json({ error: "not_found" }, 404);
  } catch (e) {
    log("request_error", { path: u.pathname, error: String((e as Error).message).slice(0, 300) });
    return json({ error: "upstream_error", detail: String((e as Error).message).split("\n")[0].slice(0, 200) }, 502);
  }
}

if (import.meta.main) {
  for (const t of tickers) await assertPoolOrdering(t);
  Bun.serve({ port: PORT, fetch: handle });
  log("stats_listening", { port: PORT, vaults: tickers.map((t) => ({ id: t.id, source: t.vault ? "onchain" : "replay" })) });
  const live = tickers.filter((t) => t.vault);
  const sample = () => live.forEach((t) => samplePps(t).catch((e) => log("sample_error", { ticker: t.symbol, error: String(e.message).slice(0, 200) })));
  if (live.length) { sample(); setInterval(sample, SAMPLE_S * 1000); }
}
