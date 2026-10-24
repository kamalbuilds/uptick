/** Lighter's Robinhood Chain exchange, read-only. Lighter RH is its own exchange (accounts, API keys and signatures do not carry over from Lighter mainnet), so the ids,
 *  decimals and caps here are read from api.rh.lighter.xyz and never from the mainnet API. Every fetcher is a keyless GET, takes an injectable fetch, returns the URL it
 *  called and the time the answer arrived, and throws when the answer is not the shape this file reads: a missing field is an error, never a zero. */

export const LIGHTER_RH = {
  api: "https://api.rh.lighter.xyz",
  signingChainId: 466324,
  app: "https://robinhoodchain.lighter.xyz",
} as const;

export type LighterOpts = {
  fetch?: typeof fetch;
  /** Wall-clock ms; injectable so a fixture can carry its own capture time. */
  now?: () => number;
};

/** What a fetcher returns: the parsed answer, the exact URL asked, and the UTC time it arrived. */
export type Sourced<T> = { data: T; url: string; fetchedAt: string };

export class LighterShapeError extends Error {
  constructor(where: string, what: string) {
    super(`Lighter RH ${where}: ${what}`);
    this.name = "LighterShapeError";
  }
}

// ---- shape readers ------------------------------------------------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function rec(v: unknown, where: string): Rec {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new LighterShapeError(where, "expected an object");
  return v as Rec;
}

function arr(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) throw new LighterShapeError(where, "expected an array");
  return v;
}

function str(o: Rec, k: string, where: string): string {
  const v = o[k];
  if (typeof v !== "string" || v === "") throw new LighterShapeError(where, `${k} is missing or not a string`);
  return v;
}

/** A finite number from a JSON number or a decimal string (the API sends both). */
function dec(o: Rec, k: string, where: string): number {
  const v = o[k];
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new LighterShapeError(where, `${k} is missing or not a finite number`);
  return n;
}

function int(o: Rec, k: string, where: string): number {
  const n = dec(o, k, where);
  if (!Number.isInteger(n)) throw new LighterShapeError(where, `${k} is not an integer`);
  return n;
}

/** "1.000775159164630595" as a 1e18-scaled bigint, exactly. */
export function parseWad(s: string, where = "decimal"): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(s);
  if (!m) throw new LighterShapeError(where, `"${s}" is not a decimal with at most 18 places`);
  return BigInt(m[1]) * 10n ** 18n + BigInt((m[2] ?? "").padEnd(18, "0"));
}

async function getJson(path: string, params: Record<string, string | number>, opts: LighterOpts, where: string): Promise<{ json: Rec; url: string; fetchedAt: string }> {
  const u = new URL(path, LIGHTER_RH.api);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const url = u.toString();
  const res = await (opts.fetch ?? fetch)(url);
  if (!res.ok) throw new LighterShapeError(where, `HTTP ${res.status} from ${url}`);
  const fetchedAt = new Date((opts.now ?? Date.now)()).toISOString();
  const json = rec(await res.json(), where);
  if (json.code !== 200) throw new LighterShapeError(where, `code ${String(json.code)}, not 200`);
  return { json, url, fetchedAt };
}

// ---- orderBookDetails: the perps ----------------------------------------------------------------------------------------------------

export type PerpMarket = {
  symbol: string;
  marketId: number;
  status: string;
  sizeDecimals: number;
  priceDecimals: number;
  /** Decimal string exactly as sent: the smallest order, in base units. */
  minBaseAmount: string;
  /** The smallest order value in USD (min_quote_amount): a size over the base minimum is still refused when it is worth less than this. */
  minQuoteAmount: number;
  /** Margin fractions are in 1e-4 units: 500 is 5%, so 20x at most. */
  defaultInitialMarginFraction: number;
  minInitialMarginFraction: number;
  maintenanceMarginFraction: number;
  /** Fee strings exactly as sent; the unit is not read from the API, so a nonzero value is carried raw and never scaled. */
  takerFee: string;
  makerFee: string;
  markPrice: number;
  indexPrice: number;
  openInterest: number;
};

export function parsePerp(v: unknown): PerpMarket {
  const where = "orderBookDetails";
  const o = rec(v, where);
  return {
    symbol: str(o, "symbol", where),
    marketId: int(o, "market_id", where),
    status: str(o, "status", where),
    sizeDecimals: int(o, "size_decimals", where),
    priceDecimals: int(o, "price_decimals", where),
    minBaseAmount: str(o, "min_base_amount", where),
    minQuoteAmount: dec(o, "min_quote_amount", where),
    defaultInitialMarginFraction: int(o, "default_initial_margin_fraction", where),
    minInitialMarginFraction: int(o, "min_initial_margin_fraction", where),
    maintenanceMarginFraction: int(o, "maintenance_margin_fraction", where),
    takerFee: str(o, "taker_fee", where),
    makerFee: str(o, "maker_fee", where),
    markPrice: dec(o, "mark_price", where),
    indexPrice: dec(o, "index_price", where),
    openInterest: dec(o, "open_interest", where),
  };
}

export function parseOrderBookDetails(json: unknown): PerpMarket[] {
  const o = rec(json, "orderBookDetails");
  return arr(o.order_book_details, "orderBookDetails.order_book_details")
    .map((e) => ({ e, t: rec(e, "orderBookDetails").market_type }))
    .filter((x) => x.t === "perp")
    .map((x) => parsePerp(x.e));
}

export async function fetchOrderBookDetails(opts: LighterOpts = {}): Promise<Sourced<PerpMarket[]>> {
  const { json, url, fetchedAt } = await getJson("/api/v1/orderBookDetails", {}, opts, "orderBookDetails");
  return { data: parseOrderBookDetails(json), url, fetchedAt };
}

// ---- assetDetails: what Lighter accepts as margin -----------------------------------------------------------------------------------

export type LighterAsset = {
  assetId: number;
  symbol: string;
  /** The token's address on Robinhood Chain, as sent. */
  l1Address: string;
  /** "enabled" counts toward margin; "disabled" and "priced_only" do not. */
  marginMode: string;
  /** Fractions of 1: 0.5 is a 50% loan-to-value. */
  loanToValue: number;
  liquidationThreshold: number;
  /** Caps and the running total, in tokens. */
  userSupplyCap: number;
  globalSupplyCap: number;
  totalSupplied: number;
  /** ERC-8056 multiplier as Lighter reads it, 1e18-scaled. */
  multiplier: bigint;
};

export function parseAsset(v: unknown): LighterAsset {
  const where = "assetDetails";
  const o = rec(v, where);
  return {
    assetId: int(o, "asset_id", where),
    symbol: str(o, "symbol", where),
    l1Address: str(o, "l1_address", where),
    marginMode: str(o, "margin_mode", where),
    loanToValue: dec(o, "loan_to_value", where),
    liquidationThreshold: dec(o, "liquidation_threshold", where),
    userSupplyCap: dec(o, "user_supply_cap", where),
    globalSupplyCap: dec(o, "global_supply_cap", where),
    totalSupplied: dec(o, "total_supplied", where),
    multiplier: parseWad(str(o, "multiplier", where), "assetDetails.multiplier"),
  };
}

export function parseAssetDetails(json: unknown): LighterAsset[] {
  return arr(rec(json, "assetDetails").asset_details, "assetDetails.asset_details").map(parseAsset);
}

export async function fetchAssetDetails(opts: LighterOpts = {}): Promise<Sourced<LighterAsset[]>> {
  const { json, url, fetchedAt } = await getJson("/api/v1/assetDetails", {}, opts, "assetDetails");
  return { data: parseAssetDetails(json), url, fetchedAt };
}

// ---- orderBookOrders: the book at your size -----------------------------------------------------------------------------------------

export type Level = { price: number; size: number };
export type OrderBook = { bids: Level[]; asks: Level[] };

function parseLevels(v: unknown, where: string): Level[] {
  return arr(v, where).map((e) => {
    const o = rec(e, where);
    return { price: dec(o, "price", where), size: dec(o, "remaining_base_amount", where) };
  });
}

export function parseOrderBook(json: unknown): OrderBook {
  const o = rec(json, "orderBookOrders");
  return { bids: parseLevels(o.bids, "orderBookOrders.bids"), asks: parseLevels(o.asks, "orderBookOrders.asks") };
}

/** The 250 best orders a side returns at most. */
export const BOOK_LIMIT = 250;

export async function fetchOrderBookOrders(marketId: number, opts: LighterOpts = {}): Promise<Sourced<OrderBook>> {
  const { json, url, fetchedAt } = await getJson("/api/v1/orderBookOrders", { market_id: marketId, limit: BOOK_LIMIT }, opts, "orderBookOrders");
  return { data: parseOrderBook(json), url, fetchedAt };
}

// ---- fundings ---------------------------------------------------------------------------------------------------------------------

/** One hourly funding row. `value` is the payment per unit of base in USD and `rate` the same as a percent rounded to four places, both unsigned: `direction` says
 *  who pays. "long" means longs pay shorts. */
export type FundingRow = { timestamp: number; value: number; rate: number; direction: "long" | "short" };

export function parseFundings(json: unknown): FundingRow[] {
  const where = "fundings";
  return arr(rec(json, where).fundings, "fundings.fundings").map((e) => {
    const o = rec(e, where);
    const direction = o.direction;
    if (direction !== "long" && direction !== "short") throw new LighterShapeError(where, `direction "${String(direction)}" is neither long nor short`);
    return { timestamp: int(o, "timestamp", where), value: dec(o, "value", where), rate: dec(o, "rate", where), direction };
  });
}

/** 28 days of hourly rows: the weekends a carry figure is read from. */
export const FUNDING_WINDOW_HOURS = 28 * 24;

export async function fetchFundings(marketId: number, opts: LighterOpts & { windowHours?: number } = {}): Promise<Sourced<FundingRow[]>> {
  const end = Math.floor((opts.now ?? Date.now)() / 1000);
  const start = end - (opts.windowHours ?? FUNDING_WINDOW_HOURS) * 3600;
  const { json, url, fetchedAt } = await getJson(
    "/api/v1/fundings",
    { market_id: marketId, resolution: "1h", start_timestamp: start, end_timestamp: end, count_back: 0 },
    opts,
    "fundings",
  );
  return { data: parseFundings(json), url, fetchedAt };
}
