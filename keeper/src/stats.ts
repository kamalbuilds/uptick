import { readFileSync } from "node:fs";
import { loadTickers, type Ticker } from "./config.ts";
import { assertPoolOrdering, snapshot } from "./chain.ts";
import { etDate, sessionFor } from "./calendar.ts";
import { log } from "./log.ts";
import { onchainVault, samplePps } from "./vaultdata.ts";

const PORT = Number(process.env.STATS_PORT || 8790);
const SAMPLE_S = 300;
const replay = JSON.parse(readFileSync(new URL("../data/replay.json", import.meta.url), "utf8"));
const history = JSON.parse(readFileSync(new URL("../data/history.json", import.meta.url), "utf8"));
const tickers = loadTickers();

export interface Band { from: number; to: number; center: number; lower: number; upper: number }

/** The strategy band: +-pct around the latest Chainlink round at each NYSE open + 5 min, held until the next recentre.
 *  Weekends and holidays carry the previous band. Times are unix seconds; `cl` is [ts, usd] sorted by ts. */
export function bandSegments(cl: [number, number][], fromSec: number, toSec: number, pct: number): Band[] {
  const out: Band[] = [];
  const day = etDate(fromSec * 1000 - 86400_000);
  for (let i = 0; i < Math.ceil((toSec - fromSec) / 86400) + 3; i++) {
    const d = new Date(Date.UTC(day.y, day.m - 1, day.d + i));
    const s = sessionFor(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    if (!s) continue;
    const at = s.recentreMs / 1000;
    if (at >= toSec) break;
    const round = [...cl].reverse().find(([ts]) => ts <= at);
    if (!round) continue;
    out.push({ from: at, to: toSec, center: round[1], lower: round[1] * (1 - pct / 100), upper: round[1] * (1 + pct / 100) });
  }
  out.forEach((b, i) => { if (out[i + 1]) b.to = out[i + 1].from; });
  return out.filter((b) => b.to > fromSec);
}

async function chartFor(t: Ticker) {
  const h = history.tickers[t.symbol];
  const pct = replay.pools[t.symbol]?.runs?.[replay.headline_strategy]?.band_pct ?? 5;
  const snap = await snapshot(t);
  const points: [number, number][] = [...h.hourly.filter(([ts]: [number, number]) => ts < snap.ts), [snap.ts, snap.poolUsd]];
  const cl: [number, number][] = [...h.chainlink.filter(([ts]: [number, number]) => ts < snap.clUpdatedAt), [snap.clUpdatedAt, snap.clUsd]];
  const bands = bandSegments(cl, points[0][0], snap.ts, pct);
  const now = bands.at(-1) ?? null;
  return {
    band_pct: pct, block: Number(snap.block), as_of: snap.ts, pool_usd: snap.poolUsd, chainlink_usd: snap.clUsd, chainlink_updated_at: snap.clUpdatedAt,
    band: now && { lower: now.lower, upper: now.upper, center: now.center, since: now.from },
    in_band: now ? snap.poolUsd >= now.lower && snap.poolUsd <= now.upper : null,
    history: points.map(([ts, price]) => ({ t: ts, price })),
    bands: bands.map((b) => ({ from: b.from, to: b.to, lower: b.lower, upper: b.upper, center: b.center })),
  };
}

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
const vaultBase = (t: Ticker) => t.vault ? cached(`v:${t.id}`, 30_000, () => onchainVault(t)) : Promise.resolve(replayVault(t));
const vaultView = async (t: Ticker) => ({ ...(await vaultBase(t)), chart: await cached(`c:${t.id}`, 60_000, () => chartFor(t)) });
const strip = ({ share_price_history, ...rest }: any) => rest;

const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers });

export async function handle(req: Request): Promise<Response> {
  const u = new URL(req.url); const parts = u.pathname.split("/").filter(Boolean);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "GET" } });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    if (u.pathname === "/health") return json({ ok: true, tickers: tickers.map((t) => ({ id: t.id, source: t.vault ? "onchain" : "replay" })) });
    if (parts[0] === "vaults" && parts.length === 1) return json({ vaults: (await Promise.all(tickers.map(vaultBase))).map(strip) });
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
