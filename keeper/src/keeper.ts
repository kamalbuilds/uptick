import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, type Address, type Hash } from "viem";
import { vaultAbi } from "./abi.ts";
import { assertPoolOrdering, boundedLogs, client, retry, sleep, snapshot, type Snapshot } from "./chain.ts";
import { CL_MAX_AGE_S, MAX_DEV_BPS, MIN_GAP_H, OOR_MINUTES, RPC_URL, robinhood, type Ticker } from "./config.ts";
import { loadTickers, withFactory } from "./registry.ts";
import { recentreDue, sessionAt, nextRecentreMs } from "./calendar.ts";
import { evaluateGuards } from "./guards.ts";
import { log } from "./log.ts";
import { simulateRebalance } from "./simulate.ts";
import { priceFromTick } from "./price.ts";

const DRY = process.argv.includes("--dry-run");
const ASSUME_DUE = DRY && process.argv.includes("--assume-due"); // dry-run only: pretend the recentre slot is open
const POLL_S = Number(process.env.POLL_S || 60);

type Trigger = "scheduled" | "out_of_range" | null;

function loadAccount() {
  const k = process.env.VAULT_KEEPER_KEY?.trim();
  if (!k) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("VAULT_KEEPER_KEY has invalid format (expected 0x + 64 hex)");
  return privateKeyToAccount(k as `0x${string}`);
}

/** Receipt wait that survives RPC hiccups: repeated bounded waits, then a direct lookup. */
export async function waitReceipt(hash: Hash, attempts = 8) {
  let err: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await client.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 1_000, retryCount: 3 }); }
    catch (e) {
      err = e;
      try { const r = await client.getTransactionReceipt({ hash }); if (r) return r; } catch { /* not mined yet or RPC error: loop */ }
      await sleep(Math.min(15_000, 1_000 * 2 ** i));
    }
  }
  throw new Error(`receipt for ${hash} not found after ${attempts} attempts: ${String(err).slice(0, 200)}`);
}

async function lastRebalanceMs(t: Ticker): Promise<number> {
  const head = await client.getBlockNumber();
  const from = head - 2_000_000n < t.deployBlock! ? t.deployBlock! : head - 2_000_000n; // ~55 h at 10 blocks/s
  const ev = vaultAbi.find((x) => x.type === "event" && x.name === "Rebalanced")!;
  const logs = await boundedLogs({ address: t.vault!, event: ev as any, from, to: head });
  if (!logs.length) return 0;
  const b = await retry(() => client.getBlock({ blockNumber: logs[logs.length - 1].blockNumber! }));
  return Number(b.timestamp) * 1000;
}

interface State { lastMs: number; oorSince: number | null }

function decide(t: Ticker, s: Snapshot, range: [number, number] | null, st: State, nowMs: number): { trigger: Trigger; note: string } {
  if (recentreDue(nowMs, st.lastMs)) return { trigger: "scheduled", note: "recentre slot reached" };
  if (!sessionAt(nowMs)) return { trigger: null, note: "not_a_trading_day" };
  if (range) {
    const oor = s.tick < range[0] || s.tick >= range[1];
    if (!oor) { st.oorSince = null; return { trigger: null, note: "in_range" }; }
    st.oorSince ??= nowMs;
    const oorMin = (nowMs - st.oorSince) / 60_000, gapH = (nowMs - st.lastMs) / 3_600_000;
    if (oorMin >= OOR_MINUTES && gapH >= MIN_GAP_H) return { trigger: "out_of_range", note: `oor ${oorMin.toFixed(0)} min, ${gapH.toFixed(1)} h since last` };
    return { trigger: null, note: `oor ${oorMin.toFixed(0)}/${OOR_MINUTES} min, gap ${gapH.toFixed(1)}/${MIN_GAP_H} h` };
  }
  return { trigger: null, note: "no_range" };
}

async function tick(t: Ticker, st: State, account: ReturnType<typeof loadAccount>, wallet: ReturnType<typeof createWalletClient> | null) {
  const nowMs = Date.now();
  const snap = await snapshot(t);
  const guard = evaluateGuards({ poolUsd: snap.poolUsd, clUsd: snap.clUsd, clUpdatedAt: snap.clUpdatedAt, now: snap.ts, maxDevBps: MAX_DEV_BPS, clMaxAgeS: CL_MAX_AGE_S });
  let range: [number, number] | null = null;
  if (t.vault) {
    const r = await retry(() => client.readContract({ address: t.vault!, abi: vaultAbi, functionName: "currentRange" }));
    range = [Number(r[0]), Number(r[1])];
  }
  const { trigger, note } = ASSUME_DUE ? { trigger: "scheduled" as Trigger, note: "assumed due (--assume-due)" } : decide(t, snap, range, st, nowMs);
  const base = {
    ticker: t.symbol, block: snap.block, pool_usd: snap.poolUsd, chainlink_usd: snap.clUsd, chainlink_age_s: guard.clAgeS,
    deviation_bps: Number(guard.devBps.toFixed(2)), guards_ok: guard.ok, guard_reasons: guard.reasons,
    range_usd: range ? [priceFromTick(range[0], t.stockIsToken0), priceFromTick(range[1], t.stockIsToken0)].sort((a, b) => a - b) : null,
    trigger, note, next_recentre: new Date(nextRecentreMs(nowMs)).toISOString(),
  };
  if (!trigger) return log("tick", { ...base, action: "none" });
  if (!guard.ok) return log("tick", { ...base, action: "blocked_by_guard" });
  if (!t.vault) return log("tick", { ...base, action: "skipped", why: "vault_not_deployed (VAULT_ADDRESS not set)" });

  const from: Address | undefined = account?.address ?? (process.env.VAULT_KEEPER_ADDRESS as Address | undefined);
  if (!from) return log("tick", { ...base, action: "skipped", why: "no signer: set VAULT_KEEPER_KEY (or VAULT_KEEPER_ADDRESS for dry-run simulation)" });
  const sim = await simulateRebalance(client, t.vault, from);
  if (!sim.ok) return log("simulate_failed", { ...base, action: "not_sent", error: sim.error, retry: "next_tick" });
  const { request } = sim;
  log("simulate_ok", { ...base });
  if (DRY || !wallet || !account) return log("tick", { ...base, action: "dry_run_would_send" });
  const hash = await wallet.writeContract({ ...(request as any), account, chain: robinhood });
  log("sent", { ticker: t.symbol, hash });
  const rc = await waitReceipt(hash);
  if (rc.status !== "success") return log("reverted", { ticker: t.symbol, hash, block: rc.blockNumber });
  st.lastMs = nowMs; st.oorSince = null;
  log("rebalanced", { ticker: t.symbol, hash, block: rc.blockNumber, gas_used: rc.gasUsed });
}

async function main() {
  const tickers = await withFactory(loadTickers());
  const account = DRY ? null : loadAccount();
  if (!DRY && !account) throw new Error("VAULT_KEEPER_KEY is not set. Put it in keeper/.env, or run with --dry-run.");
  const wallet = account ? createWalletClient({ account, chain: robinhood, transport: http(RPC_URL, { retryCount: 3 }) }) : null;
  const active = DRY ? tickers : tickers.filter((t) => t.vault);
  if (!active.length) throw new Error("no deployed vault: set VAULT_ADDRESS_<SYM> or VAULT_FACTORY");
  log("start", { mode: DRY ? "dry-run" : "live", chain: 4663, rpc: RPC_URL, signer: account?.address ?? null, tickers: active.map((t) => t.symbol), max_dev_bps: MAX_DEV_BPS, cl_max_age_s: CL_MAX_AGE_S });
  const state = new Map<string, State>();
  for (const t of active) {
    await assertPoolOrdering(t);
    state.set(t.id, { lastMs: t.vault ? await lastRebalanceMs(t) : 0, oorSince: null });
  }
  do {
    for (const t of active) {
      try { await tick(t, state.get(t.id)!, account, wallet); }
      catch (e) { log("error", { ticker: t.symbol, error: String((e as Error).message).split("\n")[0].slice(0, 300) }); }
    }
    if (DRY) break;
    await sleep(POLL_S * 1000);
  } while (true);
}

if (import.meta.main) main().catch((e) => { log("fatal", { error: String(e.message).slice(0, 300) }); process.exit(1); });
