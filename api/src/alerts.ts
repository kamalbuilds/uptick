/**
 * Loan health alerts without accounts or secrets.
 *
 * POST /alerts/subscribe   {address, vault, threshold, channel: "webhook", url}  watches a Morpho Blue loan on an Uptick vault share.
 * POST /alerts/unsubscribe {address, vault, url}                                 removes it; the url is the only credential, and only the subscriber knows it.
 * scheduled()              reads every watched loan from the chain and POSTs the webhook once when the health factor crosses below the threshold.
 *
 * State per subscription lives in the ALERTS KV namespace. `armed` is true until the webhook has been delivered for a crossing, and
 * goes true again only when the health factor is back at or above the threshold, so staying below never re-fires and a second crossing does.
 * `nextAttemptAt` rate-limits both a flapping position and a webhook that is down.
 */
import { getAddress, isAddress } from "viem";
import type { PublicClient } from "viem";
import { MARKETS, describeLoan, makeClient, marketOf, readMarketSide, readPosition, viewOf, type MarketSide } from "./loan-chain";
import { ipKey } from "./talk";
import { parseVaults, UNIVERSE } from "./mcp";
import type { MarketEntry } from "./shared/morpho.ts";

export interface AlertsEnv {
  ALERTS?: KVNamespace;
  TALK_SALT?: string;
  VAULTS?: string;
  CHAIN_RPC_URL?: string;
}

export const ALERT_LIMITS = {
  body: 2048,
  url: 512,
  minThreshold: 1.05,
  maxThreshold: 5,
  /** Subscriptions per wallet and vault. */
  perWallet: 3,
  /** Subscribe calls per IP hash per window. */
  perWindow: 10,
  windowSeconds: 3600,
  /** Seconds between two webhooks for one subscription, even when the position leaves and re-enters the zone. */
  refireSeconds: 3600,
  /** Seconds before a webhook that failed is tried again. */
  retrySeconds: 900,
  /** Subscriptions read per scheduled run: the free plan allows 50 subrequests, and a run spends one or two per vault, one per wallet and one per webhook. */
  perRun: 20,
} as const;

const HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };
const reply = (body: unknown, status: number, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

export type Subscription = {
  address: string;
  vault: string;
  threshold: number;
  channel: "webhook";
  url: string;
  createdAt: string;
  armed: boolean;
  /** Epoch ms before which no webhook is sent. */
  nextAttemptAt: number;
  lastFiredAt?: number;
  failures: number;
};

const PREFIX = "a:";
const CURSOR = "meta:cursor";

async function sha(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const keyOf = async (vault: string, address: string, url: string) => `${PREFIX}${vault}:${address.toLowerCase()}:${(await sha(url)).slice(0, 16)}`;

/** A webhook the Worker will call: https, a named host (no IP literal, no localhost or internal suffix), no credentials in the URL. */
export function webhookProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > ALERT_LIMITS.url) return `url must be a string of at most ${ALERT_LIMITS.url} characters`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "url is not a valid URL";
  }
  if (u.protocol !== "https:") return "url must be https";
  if (u.username || u.password) return "url must not carry credentials";
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return "url must name a host, not an IP address";
  if (/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return "url must be a public host";
  return null;
}

function parse(raw: unknown, markets: Record<string, MarketEntry>): { ok: true; value: { address: string; vault: string; threshold: number; url: string } } | { ok: false; field: string; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, field: "body", message: "expected a JSON object" };
  const b = raw as Record<string, unknown>;
  if (typeof b.address !== "string" || !isAddress(b.address)) return { ok: false, field: "address", message: "a 0x address" };
  if (typeof b.vault !== "string" || !UNIVERSE.vaults.some((v) => v.id === b.vault)) return { ok: false, field: "vault", message: "a vault id from /vaults" };
  if (!markets[b.vault]) return { ok: false, field: "vault", message: `no Morpho market is configured for ${b.vault}, so there is no loan to watch` };
  if (typeof b.threshold !== "number" || !Number.isFinite(b.threshold) || b.threshold < ALERT_LIMITS.minThreshold || b.threshold > ALERT_LIMITS.maxThreshold) {
    return { ok: false, field: "threshold", message: `a health factor between ${ALERT_LIMITS.minThreshold} and ${ALERT_LIMITS.maxThreshold}` };
  }
  if (b.channel !== "webhook") return { ok: false, field: "channel", message: 'only "webhook"' };
  const problem = webhookProblem(b.url);
  if (problem) return { ok: false, field: "url", message: problem };
  return { ok: true, value: { address: getAddress(b.address), vault: b.vault, threshold: b.threshold, url: b.url as string } };
}

async function readBody(request: Request): Promise<{ ok: true; json: unknown } | { ok: false; response: Response }> {
  const text = await request.text();
  if (text.length > ALERT_LIMITS.body) return { ok: false, response: reply({ error: "too_large", max: ALERT_LIMITS.body }, 413) };
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, response: reply({ error: "invalid", field: "body", message: "not valid JSON" }, 400) };
  }
}

export async function subscribe(request: Request, env: AlertsEnv, markets: Record<string, MarketEntry> = MARKETS, now: () => number = Date.now): Promise<Response> {
  const kv = env.ALERTS;
  if (!kv) return reply({ error: "alerts_unavailable" }, 503);
  const body = await readBody(request);
  if (!body.ok) return body.response;
  const parsed = parse(body.json, markets);
  if (!parsed.ok) return reply({ error: "invalid", field: parsed.field, message: parsed.message }, 400);
  const { address, vault, threshold, url } = parsed.value;

  // ponytail: KV get-then-put is not atomic, so a burst can pass the limits by a few; a Durable Object counter closes it.
  const rl = await ipKey(request, env);
  const used = Number((await kv.get(rl)) ?? "0");
  if (used >= ALERT_LIMITS.perWindow) return reply({ error: "rate_limited" }, 429, { "retry-after": String(ALERT_LIMITS.windowSeconds) });

  const key = await keyOf(vault, address, url);
  const existing = await kv.get(key, "json") as Subscription | null;
  if (!existing) {
    const mine = await kv.list({ prefix: `${PREFIX}${vault}:${address.toLowerCase()}:` });
    if (mine.keys.length >= ALERT_LIMITS.perWallet) return reply({ error: "too_many", max: ALERT_LIMITS.perWallet }, 409);
  }
  // Subscribing again re-arms the alert at the new threshold but keeps the rate limit, so it cannot be used to force a second webhook inside the refire window.
  const sub: Subscription = {
    address, vault, threshold, channel: "webhook", url, createdAt: existing?.createdAt ?? new Date(now()).toISOString(), armed: true,
    nextAttemptAt: existing?.nextAttemptAt ?? 0, lastFiredAt: existing?.lastFiredAt, failures: 0,
  };
  await kv.put(key, JSON.stringify(sub));
  await kv.put(rl, String(used + 1), { expirationTtl: ALERT_LIMITS.windowSeconds });
  return reply({ ok: true, armed: true, threshold, vault, address }, existing ? 200 : 201);
}

export async function unsubscribe(request: Request, env: AlertsEnv): Promise<Response> {
  const kv = env.ALERTS;
  if (!kv) return reply({ error: "alerts_unavailable" }, 503);
  const body = await readBody(request);
  if (!body.ok) return body.response;
  const b = body.json as Record<string, unknown> | null;
  if (!b || typeof b.address !== "string" || !isAddress(b.address) || typeof b.vault !== "string" || typeof b.url !== "string") {
    return reply({ error: "invalid", message: "address, vault and url are required" }, 400);
  }
  const key = await keyOf(b.vault, getAddress(b.address), b.url);
  if (!(await kv.get(key))) return reply({ error: "not_found" }, 404);
  await kv.delete(key);
  return reply({ ok: true }, 200);
}

// ---- the scheduled run ------------------------------------------------------------------------------------------------------------

export type Snapshot = { health: number | null; fields: Record<string, unknown> };
export interface AlertDeps {
  /** The loan's health now, or null when the wallet has no loan. Throws when the chain cannot be read. */
  readHealth: (vault: string, address: string) => Promise<Snapshot | null>;
  fetch: typeof fetch;
  now: () => number;
}
export type AlertRun = { checked: number; fired: number; rearmed: number; failed: number; skipped: number; errors: number };

/** The deps a deployed Worker uses: one batched client, and one market read per vault per run. */
export function chainDeps(env: AlertsEnv, client?: PublicClient): AlertDeps {
  const c = client ?? (env.CHAIN_RPC_URL ? makeClient(env.CHAIN_RPC_URL) : undefined);
  const sides = new Map<string, Promise<MarketSide | null>>();
  const vaults = parseVaults(env.VAULTS);
  return {
    fetch: (input, init) => fetch(input, init),
    now: Date.now,
    async readHealth(vault, address) {
      if (!c) throw new Error("CHAIN_RPC_URL is not set");
      const found = marketOf(vaults, vault);
      if (!found.ok) throw new Error(found.reason);
      if (!sides.has(vault)) sides.set(vault, readMarketSide(c, found.market, found.vault));
      const side = await sides.get(vault)!;
      if (!side) throw new Error(`the market for ${vault} does not exist on-chain`);
      const pos = await readPosition(c, side, getAddress(address));
      if (pos.collateral === 0n && pos.borrowShares === 0n) return null;
      const view = viewOf(side, pos);
      return { health: view.risk.healthFactor, fields: describeLoan(side, view) };
    },
  };
}

async function deliver(sub: Subscription, snap: Snapshot, deps: AlertDeps): Promise<boolean> {
  const payload = {
    event: "loan_health_below_threshold",
    at: new Date(deps.now()).toISOString(),
    address: sub.address,
    vault: sub.vault,
    threshold: sub.threshold,
    health_factor: snap.health,
    ...snap.fields,
    next: "Call prepare_make_safer on the Uptick MCP server, or open the Portfolio page and choose Make it safer.",
  };
  try {
    const res = await deps.fetch(sub.url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "uptick-alerts/1" },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

export async function runAlerts(env: AlertsEnv, deps: AlertDeps = chainDeps(env)): Promise<AlertRun> {
  const run: AlertRun = { checked: 0, fired: 0, rearmed: 0, failed: 0, skipped: 0, errors: 0 };
  const kv = env.ALERTS;
  if (!kv) return run;
  const cursor = (await kv.get(CURSOR)) ?? undefined;
  const page = await kv.list({ prefix: PREFIX, cursor, limit: ALERT_LIMITS.perRun });
  for (const { name } of page.keys) {
    const sub = (await kv.get(name, "json")) as Subscription | null;
    if (!sub) continue;
    run.checked++;
    let snap: Snapshot | null;
    try {
      snap = await deps.readHealth(sub.vault, sub.address);
    } catch {
      run.errors++;
      continue;
    }
    const below = snap !== null && snap.health !== null && snap.health < sub.threshold;
    if (!below) {
      if (!sub.armed) {
        await kv.put(name, JSON.stringify({ ...sub, armed: true }));
        run.rearmed++;
      }
      continue;
    }
    if (!sub.armed || deps.now() < sub.nextAttemptAt) {
      run.skipped++;
      continue;
    }
    if (await deliver(sub, snap!, deps)) {
      await kv.put(name, JSON.stringify({ ...sub, armed: false, lastFiredAt: deps.now(), nextAttemptAt: deps.now() + ALERT_LIMITS.refireSeconds * 1000, failures: 0 }));
      run.fired++;
    } else {
      await kv.put(name, JSON.stringify({ ...sub, nextAttemptAt: deps.now() + ALERT_LIMITS.retrySeconds * 1000, failures: sub.failures + 1 }));
      run.failed++;
    }
  }
  // The next run continues where this one stopped, and wraps to the start when the list is done.
  if (!page.list_complete) await kv.put(CURSOR, page.cursor);
  else if (cursor) await kv.delete(CURSOR);
  return run;
}
