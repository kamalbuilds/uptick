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
  /** Price against the strategy band; null when the stats API could not read the pool or the feed. */
  chart: PriceChart | null;
};

export type BandSegment = { from: number; to: number; center: number; lower: number; upper: number };
/** Times are unix seconds, prices are USD per stock token. */
export type PriceChart = {
  bandPct: number;
  poolUsd: number;
  chainlinkUsd: number;
  asOf: number;
  inBand: boolean | null;
  band: BandSegment | null;
  history: { t: number; price: number }[];
  bands: BandSegment[];
};

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

/** Onchain vaults report fee_apr_pct per window; the 7d figure leads. */
const ONCHAIN_WINDOW_DAYS: Record<string, number> = { "7d": 7, "24h": 1 };

function parseSegment(x: unknown): BandSegment {
  if (!isObj(x) || !isNum(x.from) || !isNum(x.to) || !isNum(x.center) || !isNum(x.lower) || !isNum(x.upper)) throw new Error("keeper band segment malformed");
  return { from: x.from, to: x.to, center: x.center, lower: x.lower, upper: x.upper };
}

export function parseChart(raw: unknown): PriceChart | null {
  if (raw === null || raw === undefined) return null;
  if (!isObj(raw) || !isNum(raw.band_pct) || !isNum(raw.pool_usd) || !isNum(raw.chainlink_usd) || !isNum(raw.as_of)) throw new Error("keeper chart malformed");
  if (!Array.isArray(raw.history) || raw.history.length < 2 || !Array.isArray(raw.bands) || raw.bands.length < 1) throw new Error("keeper chart has no series");
  const history = raw.history.map((h: unknown) => {
    if (!isObj(h) || !isNum(h.t) || !isNum(h.price)) throw new Error("keeper chart point malformed");
    return { t: h.t, price: h.price };
  });
  return {
    bandPct: raw.band_pct, poolUsd: raw.pool_usd, chainlinkUsd: raw.chainlink_usd, asOf: raw.as_of,
    inBand: typeof raw.in_band === "boolean" ? raw.in_band : null,
    band: raw.band ? parseSegment({ from: isObj(raw.band) ? raw.band.since : undefined, to: raw.as_of, ...(raw.band as object) }) : null,
    history, bands: raw.bands.map(parseSegment),
  };
}

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
    const apr = raw.fee_apr_pct as Record<string, unknown>;
    const key = Object.keys(ONCHAIN_WINDOW_DAYS).find((k) => isNum(apr[k]));
    const days = isObj(raw.replay) && isObj(raw.replay.window) ? raw.replay.window.days : 30;
    // A vault with no collected fees yet (zero) or no deposits yet (null) has no realized APR; lead with the pool's replay figure until it does.
    if ((key === undefined || apr[key] === 0) && isNum(apr.replay_30d) && isNum(days)) {
      return { id: raw.id as string, ticker: raw.ticker as string, source: "replay", pool: raw.pool as string, feeAprPct: apr.replay_30d, aprWindowDays: days, tvlUsd: raw.tvl_usd as number | null, chart: parseChart(raw.chart) };
    }
    if (key === undefined) throw new Error("keeper onchain fee APR missing");
    feeAprPct = apr[key] as number;
    aprWindowDays = ONCHAIN_WINDOW_DAYS[key];
  }
  if (typeof raw.id !== "string" || typeof raw.ticker !== "string" || typeof raw.pool !== "string") throw new Error("keeper id, ticker or pool missing");
  if (raw.tvl_usd !== null && !isNum(raw.tvl_usd)) throw new Error("keeper tvl_usd is neither a number nor null");
  return { id: raw.id, ticker: raw.ticker, source: raw.source, pool: raw.pool, feeAprPct, aprWindowDays, tvlUsd: raw.tvl_usd, chart: parseChart(raw.chart) };
}

/** Where the browser reads stats from: the local rewrite to the keeper by default, the evidence Worker origin plus "/keeper" in the static build. */
export const KEEPER_BASE = process.env.NEXT_PUBLIC_KEEPER_BASE || "/keeper";

export async function fetchVault(id: string): Promise<VaultStats> {
  const res = await fetch(`${KEEPER_BASE}/vaults/${id}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`stats API /vaults/${id} answered ${res.status}`);
  return parseVaultStats(await res.json());
}

export function sourceLabel(s: VaultStats): string {
  return s.source === "onchain"
    ? `${s.aprWindowDays}-day, read on-chain from the vault`
    : `${s.aprWindowDays}-day replay of the pool's swaps`;
}
