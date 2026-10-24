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
/** `pool` is the Uniswap fee tier the gap was measured against: the one the symbol's Uptick vault trades in. */
export type Drift = { pool: string; unwind: DriftPoint; open: DriftPoint };

const SYMBOLS = drift.symbols as unknown as Record<string, Record<string, DriftPoint | string>>;

/** The measured gap between pool and perp at the unwind (30 minutes before the open) and at the open, over past weekends, or null for a symbol the spike did not measure. */
export function driftFor(symbol: string): Drift | null {
  const row = SYMBOLS[symbol.toUpperCase()];
  if (!row) return null;
  const pool = row.pool;
  const unwind = row[drift.points.unwind];
  const open = row[drift.points.open];
  return typeof pool === "string" && typeof unwind === "object" && typeof open === "object" ? { pool, unwind, open } : null;
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
  "query($c:[String!],$l:[String!]){ markets(first: 20, where:{chainId_in:[4663], collateralAssetAddress_in:$c, loanAssetAddress_in:$l}, orderBy: SupplyAssetsUsd, orderDirection: Desc) { items { marketId lltv state{ borrowApy supplyAssetsUsd borrowAssetsUsd utilization timestamp } } } }";

export type MorphoBorrow = { pct: number; marketId: string; supplyUsd: number; /** Supplied less borrowed: what a new borrower can still take out. */ liquidityUsd: number; observedAt: string };

/** A yearly rate for display: one decimal, or two below 0.1% so a thin market does not read "0.0%". */
export const aprText = (pct: number): string => `${pct.toFixed(Math.abs(pct) < 0.1 ? 2 : 1)}%`;

/** Whether the market has the USDG to lend that the margin needs. A rate on a market that cannot fill the borrow is not a price the holder can take. */
export const borrowCovers = (m: MorphoBorrow, marginUsdg: number): boolean => m.liquidityUsd >= marginUsdg;

/** The borrow rate of the deepest USDG market for a collateral token, as a yearly percent. The API answers an APY (compounded); the planner prices simple interest over a few days, so the
 *  rate is turned back into the continuous APR, ln(1 + apy). Null when no market for the pair holds any supply: a rate on an empty market is not a price anyone can borrow at. */
export function parseBorrowApr(json: unknown): MorphoBorrow | null {
  const items = (json as { data?: { markets?: { items?: unknown } } })?.data?.markets?.items;
  if (!Array.isArray(items)) throw new Error("Morpho API answered no markets list");
  let best: MorphoBorrow | null = null;
  for (const it of items) {
    const o = it as { marketId?: unknown; state?: { borrowApy?: unknown; supplyAssetsUsd?: unknown; borrowAssetsUsd?: unknown; timestamp?: unknown } | null };
    const s = o.state;
    if (!s || typeof o.marketId !== "string") continue;
    const apy = s.borrowApy;
    const supply = s.supplyAssetsUsd;
    const borrowed = s.borrowAssetsUsd;
    const ts = s.timestamp;
    if (typeof apy !== "number" || !Number.isFinite(apy) || apy < 0 || typeof supply !== "number" || !(supply > 0) || typeof borrowed !== "number" || !(borrowed >= 0) || typeof ts !== "number") continue;
    if (best === null || supply > best.supplyUsd) best = { pct: Math.log1p(apy) * 100, marketId: o.marketId, supplyUsd: supply, liquidityUsd: Math.max(0, supply - borrowed), observedAt: new Date(ts * 1000).toISOString() };
  }
  return best;
}

// ---- how the panel prints money and the first read of the cost -------------------------------------------------------------------------

/** Dollars for the panel, always two decimals and unsigned: a cent is the smallest figure printed, so anything under it reads "under $0.01" and zero reads "$0". */
export function money(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  const a = Math.abs(n);
  if (a === 0) return "$0";
  if (a < 0.01) return "under $0.01";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(a);
}

/** Basis points for the panel, unsigned: one decimal, two under 0.1, and "under 0.01 bp" below that. */
export function bpLabel(bp: number): string {
  const a = Math.abs(bp);
  if (a === 0) return "0 bp";
  if (a < 0.01) return "under 0.01 bp";
  return `${a.toFixed(a < 0.1 ? 2 : 1)} bp`;
}

export type CostInput = {
  symbol: string;
  notionalUsd: number;
  /** Round trip through the book in bp of the notional. */
  roundTripBp: number;
  /** Lighter's fee in bp of the notional, or null when the fee unit is not known. */
  feeBp: number | null;
  marginUsdg: number;
  /** Price of one token, to turn the margin into tokens. */
  tokenPrice: number;
  /** Lighter's loan-to-value on the token when it is posted as margin, else null. */
  stockLoanToValue: number | null;
  /** Interest on borrowed margin in USD, or null when nothing is borrowed. */
  marginInterestUsd: number | null;
  /** What past weekend funding paid (positive) or charged (negative) a short of this size over the hours left, or null with too little history. */
  fundingUsd: number | null;
};

const about = (n: number): string => (money(n).startsWith("under") ? money(n) : `about ${money(n)}`);

/** Whole tokens rounded up from 10 up, hundredths below, so the count posted always covers the margin. */
function tokensToPost(usdg: number, price: number, ltv: number): string {
  const t = usdg / (price * ltv);
  const v = t >= 10 ? Math.ceil(t) : Math.ceil(t * 100) / 100;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v);
}

/** The first read of the panel: what opening and closing costs, what it ties up, and what past funding paid, in dollars and with no basis points. */
export function costSentences(i: CostInput): string[] {
  const slip = (i.notionalUsd * (i.roundTripBp + (i.feeBp ?? 0))) / 1e4;
  const out = [i.feeBp === null ? `Opening and closing costs ${about(slip)} in book depth, before Lighter's fees.` : `Opening and closing costs ${about(slip)}.`];
  const tokens = i.stockLoanToValue !== null && i.stockLoanToValue > 0 ? `, or about ${tokensToPost(i.marginUsdg, i.tokenPrice, i.stockLoanToValue)} ${i.symbol},` : "";
  out.push(`It ties up ${money(i.marginUsdg)} USDG${tokens} as margin.${i.marginInterestUsd !== null ? ` Interest on the borrowed USDG is ${about(i.marginInterestUsd)}.` : ""}`);
  if (i.fundingUsd !== null) out.push(`At the funding of the last four weekends, a short this size would have ${i.fundingUsd >= 0 ? "been paid" : "paid"} ${money(i.fundingUsd)}.`);
  return out;
}
