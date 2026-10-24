import drift from "./hedge-drift.json" with { type: "json" };
import { LIGHTER_RH } from "./lighter.ts";

/** The pieces of the hedge panel that are plain functions of numbers: what the panel prints, kept apart from React so each line can fail a test. */

/** The fall the loan block stresses: a 10% drop in the stock with the hedge ignored. */
export const STRESS_FALL_PCT = 10;

/** Health factor after the stock falls `fallPct` percent. The share is read one for one with the stock, the same way the loan screens price a liquidation, so the health factor falls in the same proportion. Null with no debt. */
export function healthAfterFall(healthFactor: number | null, fallPct: number): number | null {
  if (healthFactor === null) return null;
  if (!(fallPct >= 0 && fallPct < 100)) throw new RangeError("fall must be from 0 to under 100 percent");
  return healthFactor * (1 - fallPct / 100);
}

/** The order as Lighter's form asks for it, one field per line. Uptick places nothing: this is what the holder types or pastes. */
export function orderLines(symbol: string, shares: string, leverage: number): Array<[string, string]> {
  return [
    ["Market", symbol],
    ["Side", "Sell"],
    ["Order", "Market"],
    ["Size", shares],
    ["Leverage", `${leverage}x`],
  ];
}

export const orderText = (symbol: string, shares: string, leverage: number): string =>
  orderLines(symbol, shares, leverage).map(([k, v]) => `${k}: ${v}`).join("\n");

/** The market page on Lighter RH. The link carries the symbol and nothing else: size and side are entered in Lighter's form. */
export const lighterTradeUrl = (symbol: string): string => `${LIGHTER_RH.app}/trade/${encodeURIComponent(symbol)}`;

export type DriftPoint = { n: number; sdBp: number; maxAbsBp: number };
export type Drift = { unwind: DriftPoint; open: DriftPoint };

const SYMBOLS = drift.symbols as Record<string, Record<string, DriftPoint>>;

/** The measured gap between pool and perp at the unwind (30 minutes before the open) and at the open, over past weekends, or null for a symbol the spike did not measure. */
export function driftFor(symbol: string): Drift | null {
  const row = SYMBOLS[symbol.toUpperCase()];
  if (!row) return null;
  const unwind = row[drift.points.unwind];
  const open = row[drift.points.open];
  return unwind && open ? { unwind, open } : null;
}

export const DRIFT_SYMBOLS = Object.keys(SYMBOLS);

/** "Fri 20:00 UTC" from an ISO instant. */
export function utcStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError(`"${iso}" is not a time`);
  const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const hm = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
  return `${day} ${hm} UTC`;
}

/** "earns" or "pays" for a signed basis-point figure; zero earns nothing and pays nothing. */
export const earnsOrPays = (bp: number): "earns" | "pays" | "settles at zero" => (bp > 0 ? "earns" : bp < 0 ? "pays" : "settles at zero");

// ---- the live Morpho borrow rate on a Stock Token's USDG market ------------------------------------------------------------------------

export const MORPHO_API = "https://blue-api.morpho.org/graphql";

export const BORROW_APR_QUERY =
  "query($c:[String!],$l:[String!]){ markets(first: 20, where:{chainId_in:[4663], collateralAssetAddress_in:$c, loanAssetAddress_in:$l}, orderBy: SupplyAssetsUsd, orderDirection: Desc) { items { marketId lltv state{ borrowApy supplyAssetsUsd utilization timestamp } } } }";

export type MorphoBorrow = { pct: number; marketId: string; supplyUsd: number; observedAt: string };

/** The borrow rate of the deepest USDG market for a collateral token, as a yearly percent. The API answers an APY (compounded); the planner prices simple interest over a few days, so the
 *  rate is turned back into the continuous APR, ln(1 + apy). Null when no market for the pair holds any supply: a rate on an empty market is not a price anyone can borrow at. */
export function parseBorrowApr(json: unknown): MorphoBorrow | null {
  const items = (json as { data?: { markets?: { items?: unknown } } })?.data?.markets?.items;
  if (!Array.isArray(items)) throw new Error("Morpho API answered no markets list");
  let best: MorphoBorrow | null = null;
  for (const it of items) {
    const o = it as { marketId?: unknown; state?: { borrowApy?: unknown; supplyAssetsUsd?: unknown; timestamp?: unknown } | null };
    const s = o.state;
    if (!s || typeof o.marketId !== "string") continue;
    const apy = s.borrowApy;
    const supply = s.supplyAssetsUsd;
    const ts = s.timestamp;
    if (typeof apy !== "number" || !Number.isFinite(apy) || apy < 0 || typeof supply !== "number" || !(supply > 0) || typeof ts !== "number") continue;
    if (best === null || supply > best.supplyUsd) best = { pct: Math.log1p(apy) * 100, marketId: o.marketId, supplyUsd: supply, observedAt: new Date(ts * 1000).toISOString() };
  }
  return best;
}
