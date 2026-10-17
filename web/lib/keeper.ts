export type Source = "replay" | "onchain";

export type VaultStats = {
  id: string;
  ticker: string;
  source: Source;
  pool: string;
  /** Percent: 40.6 is 40.6%. */
  feeAprPct: number;
  /** Window the fee APR was measured over, in days. */
  aprWindowDays: number;
  /** Null while the keeper has no vault to read (replay). */
  tvlUsd: number | null;
};

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

/** Onchain vaults report fee_apr_pct per window; the 7d figure leads. */
const ONCHAIN_WINDOW_DAYS: Record<string, number> = { "7d": 7, "24h": 1 };

export function parseVaultStats(raw: unknown): VaultStats {
  if (!isObj(raw)) throw new Error("keeper vault is not an object");
  if (raw.source !== "replay" && raw.source !== "onchain") throw new Error("keeper source is neither replay nor onchain");
  if (!isObj(raw.fee_apr_pct)) throw new Error("keeper fee_apr_pct missing");
  let feeAprPct: number;
  let aprWindowDays: number;
  if (raw.source === "replay") {
    const days = isObj(raw.replay) && isObj(raw.replay.window) ? raw.replay.window.days : undefined;
    if (!isNum(raw.fee_apr_pct.replay_30d) || !isNum(days)) throw new Error("keeper replay fee APR or window missing");
    feeAprPct = raw.fee_apr_pct.replay_30d;
    aprWindowDays = days;
  } else {
    const key = Object.keys(ONCHAIN_WINDOW_DAYS).find((k) => isNum((raw.fee_apr_pct as Record<string, unknown>)[k]));
    if (!key) throw new Error("keeper onchain fee APR missing");
    feeAprPct = (raw.fee_apr_pct as Record<string, number>)[key];
    aprWindowDays = ONCHAIN_WINDOW_DAYS[key];
  }
  if (typeof raw.id !== "string" || typeof raw.ticker !== "string" || typeof raw.pool !== "string") throw new Error("keeper id, ticker or pool missing");
  if (raw.tvl_usd !== null && !isNum(raw.tvl_usd)) throw new Error("keeper tvl_usd is neither a number nor null");
  return { id: raw.id, ticker: raw.ticker, source: raw.source, pool: raw.pool, feeAprPct, aprWindowDays, tvlUsd: raw.tvl_usd };
}

export async function fetchVault(id: string): Promise<VaultStats> {
  const res = await fetch(`/keeper/vaults/${id}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`stats API /vaults/${id} answered ${res.status}`);
  return parseVaultStats(await res.json());
}

export function sourceLabel(s: VaultStats): string {
  return s.source === "onchain"
    ? `${s.aprWindowDays}-day, read on-chain from the vault`
    : `${s.aprWindowDays}-day replay of the pool's swaps`;
}
