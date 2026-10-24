import { LIGHTER_RH, type FundingRow, type LighterAsset, type Level, type OrderBook, type PerpMarket, type Sourced } from "./lighter.ts";

/** The weekend hedge planner, pure: balances, the on-chain ERC-8056 multiplier and Lighter RH reads in, a sized short and its cost lines out. Nothing here signs or sends an order.
 *  web/lib/hedge.ts is the one source: `npm run sync` in api/ copies it (with lighter.ts) into api/src/shared. */

export const DEFAULT_LEVERAGE = 5;
/** Minutes before the US open the short is closed: the pool lags the perp at the open, so the default stays out of the first half hour. */
export const DEFAULT_UNWIND_MINUTES = 30;
/** Fewest weekend funding rows a carry figure is read from; fewer is "no history", not a number. */
export const MIN_CARRY_ROWS = 24;

// ---- sizing -----------------------------------------------------------------------------------------------------------------------

export type Sized = { shares: string; units: bigint } | { reason: "below_min" };

function formatUnits(units: bigint, decimals: number): string {
  const s = units.toString().padStart(decimals + 1, "0");
  return decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

/** The short's size in shares: the balance times the ERC-8056 multiplier (1e18-scaled), floored to the market's size decimals so it never exceeds what is held.
 *  Under the market's smallest order there is nothing to place. */
export function sizeShares(balanceRaw: bigint, tokenDecimals: number, uiMultiplier1e18: bigint, sizeDecimals: number, minBase: string): Sized {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(minBase);
  if (!m) throw new RangeError(`min_base_amount "${minBase}" is not a decimal`);
  if (balanceRaw < 0n || uiMultiplier1e18 <= 0n) throw new RangeError("balance must be non-negative and the multiplier positive");
  const units = (balanceRaw * uiMultiplier1e18 * 10n ** BigInt(sizeDecimals)) / (10n ** BigInt(tokenDecimals) * 10n ** 18n);
  const frac = m[2] ?? "";
  const scale = Math.max(frac.length, sizeDecimals);
  const minScaled = BigInt(m[1] + frac.padEnd(scale, "0"));
  if (units * 10n ** BigInt(scale - sizeDecimals) < minScaled) return { reason: "below_min" };
  return { shares: formatUnits(units, sizeDecimals), units };
}

// ---- the book at your size ----------------------------------------------------------------------------------------------------------

/** One walk down a side of the book, best level first: the average price of `usd` of fills and the price of the last level it reached (the worst price the order would trade at).
 *  "unfillable" when the side is empty or the levels given are too thin for the size: never zero. */
function walk(levels: readonly Level[], usd: number, side: "sell" | "buy"): { avg: number; worst: number } | "unfillable" {
  if (!(usd > 0)) throw new RangeError("usd must be positive");
  const live = levels.filter((l) => l.price > 0 && l.size > 0).sort((a, b) => (side === "sell" ? b.price - a.price : a.price - b.price));
  let rem = usd;
  let base = 0;
  let worst = 0;
  for (const l of live) {
    const take = Math.min(rem, l.price * l.size);
    base += take / l.price;
    rem -= take;
    worst = l.price;
    if (rem <= 1e-9) break;
  }
  return rem > 1e-9 ? "unfillable" : { avg: usd / base, worst };
}

/** Cost in basis points versus mid of selling `usd` into the bids ("sell") or buying it from the asks ("buy"), walking the levels best first. "unfillable" when the
 *  side is empty or the levels given are too thin for the size: never zero. */
export function walkBook(levels: readonly Level[], usd: number, mid: number, side: "sell" | "buy"): number | "unfillable" {
  if (!(usd > 0) || !(mid > 0)) throw new RangeError("usd and mid must be positive");
  const w = walk(levels, usd, side);
  if (w === "unfillable") return w;
  return side === "sell" ? ((mid - w.avg) / mid) * 1e4 : ((w.avg - mid) / mid) * 1e4;
}

/** The price of the deepest level that selling (bids) or buying (asks) `usd` reaches, or "unfillable". */
export function worstPrice(levels: readonly Level[], usd: number, side: "sell" | "buy"): number | "unfillable" {
  const w = walk(levels, usd, side);
  return w === "unfillable" ? w : w.worst;
}

/** Mid of the best bid and best ask, or null when either side is empty. */
export function midOf(book: OrderBook): number | null {
  const bids = book.bids.filter((l) => l.size > 0);
  const asks = book.asks.filter((l) => l.size > 0);
  if (bids.length === 0 || asks.length === 0) return null;
  return (Math.max(...bids.map((l) => l.price)) + Math.min(...asks.map((l) => l.price))) / 2;
}

/** Opening a short sells into the bids and closing it buys from the asks; the sum of both walks, in basis points of the notional. */
export function roundTripBp(bids: readonly Level[], asks: readonly Level[], usd: number): number | "unfillable" {
  const mid = midOf({ bids: [...bids], asks: [...asks] });
  if (mid === null) return "unfillable";
  const open = walkBook(bids, usd, mid, "sell");
  const close = walkBook(asks, usd, mid, "buy");
  return open === "unfillable" || close === "unfillable" ? "unfillable" : open + close;
}

// ---- the weekend --------------------------------------------------------------------------------------------------------------------

const NY = "America/New_York";
const nyFormat = new Intl.DateTimeFormat("en-US", { timeZone: NY, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function nyParts(ms: number) {
  const p = Object.fromEntries(nyFormat.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), dow: DOW[p.weekday] };
}

/** The UTC instant at which New York's wall clock reads y-mo-d h:mi. Two passes settle the offset, which differs by an hour across the March and November changes. */
function nyWallToUtcMs(y: number, mo: number, d: number, h: number, mi: number): number {
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let guess = want;
  for (let i = 0; i < 2; i++) {
    const p = nyParts(guess);
    guess += want - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  }
  return guess;
}

export type WeekendWindow = {
  /** Friday 16:00 New York, the US close. */
  closeAt: Date;
  /** Monday 09:30 New York, the US open. */
  openAt: Date;
  /** The open less the unwind lead: 13:00Z in EDT by default. */
  unwindAt: Date;
  /** The later of `now` and the Friday close: once the close has passed, the short is held from now. */
  startAt: Date;
  /** Hours the short is held, start to unwind. */
  hours: number;
};

/** The next weekend not yet over for `now`: the Friday close and Monday open in America/New_York (daylight saving included), with the short closed `unwindMinutes`
 *  before the open. The hours run from the later of `now` and the close, so Saturday morning prices the hours that are left. US market holidays are not in the calendar. */
export function weekendWindow(now: Date, unwindMinutes = DEFAULT_UNWIND_MINUTES): WeekendWindow {
  const p = nyParts(now.getTime());
  const daysBack = (p.dow - 5 + 7) % 7;
  for (let week = 0; week < 2; week++) {
    const fri = new Date(Date.UTC(p.y, p.mo - 1, p.d - daysBack + 7 * week));
    const mon = new Date(fri.getTime() + 3 * 86_400_000);
    const closeMs = nyWallToUtcMs(fri.getUTCFullYear(), fri.getUTCMonth() + 1, fri.getUTCDate(), 16, 0);
    const openMs = nyWallToUtcMs(mon.getUTCFullYear(), mon.getUTCMonth() + 1, mon.getUTCDate(), 9, 30);
    const unwindMs = openMs - unwindMinutes * 60_000;
    if (unwindMs > now.getTime()) {
      const startMs = Math.max(now.getTime(), closeMs);
      return { closeAt: new Date(closeMs), openAt: new Date(openMs), unwindAt: new Date(unwindMs), startAt: new Date(startMs), hours: (unwindMs - startMs) / 3_600_000 };
    }
  }
  throw new Error("unreachable: a weekend is always within the next two Fridays");
}

/** Whether a funding row (unix seconds, the start of its hour) falls between the Friday close and the Monday unwind. */
export function isWeekendHour(tsSec: number, unwindMinutes = DEFAULT_UNWIND_MINUTES): boolean {
  const p = nyParts(tsSec * 1000);
  const min = p.h * 60 + p.mi;
  return (p.dow === 5 && min >= 16 * 60) || p.dow === 6 || p.dow === 0 || (p.dow === 1 && min < 9 * 60 + 30 - unwindMinutes);
}

// ---- cost of carrying the short -----------------------------------------------------------------------------------------------------

/** Funding a short earns (positive) or pays (negative) over `hours`, in basis points of the notional: the mean hourly value/price of the rows given, signed by each
 *  row's direction ("long" means longs pay shorts), times the hours. A history, not a forecast. */
export function carryBp(rows: readonly FundingRow[], hours: number, price: number): number {
  if (rows.length === 0) throw new RangeError("no funding rows");
  if (!(price > 0) || !(hours > 0)) throw new RangeError("price and hours must be positive");
  const sum = rows.reduce((a, r) => a + (r.direction === "long" ? 1 : -1) * (r.value / price) * 1e4, 0);
  return (sum / rows.length) * hours;
}

export const carryUsd = (bp: number, notionalUsd: number): number => (bp / 1e4) * notionalUsd;

/** Interest on the margin a borrower took in USDG to fund the short, over `hours`: positive is a cost. `borrowAprPct` is Morpho's borrowRateView through aprPct. */
export function marginCarryBp(notionalUsd: number, leverage: number, borrowAprPct: number, hours: number): { bp: number; usd: number } {
  if (!(notionalUsd > 0) || !(leverage >= 1) || !(borrowAprPct >= 0) || !(hours > 0)) throw new RangeError("notional, leverage >= 1, apr >= 0 and hours > 0 are required");
  const usd = (notionalUsd / leverage) * (borrowAprPct / 100) * (hours / 8760);
  return { bp: (usd / notionalUsd) * 1e4, usd };
}

// ---- which tokens can be hedged ---------------------------------------------------------------------------------------------------

export type UniverseToken = { symbol: string; token: string };

export type Hedgeable = {
  symbol: string;
  token: string;
  /** The Lighter RH perp's market id, or "no_perp" when Lighter lists none that is active. */
  perp: number | "no_perp";
  /** Lighter counts the token toward margin right now (margin_mode "enabled" and a loan-to-value above zero). */
  marginEligible: boolean;
  /** What one account may supply, in tokens; null when Lighter lists no such asset. */
  userCapTokens: number | null;
  /** Global supply cap less what is supplied, in tokens; null when Lighter lists no such asset. */
  globalRoom: number | null;
};

/** The tokens of the vault universe against Lighter's markets and assets. A perp matches on symbol (perps carry no address); an asset matches on the token's address. */
export function hedgeable(universe: readonly UniverseToken[], perps: readonly PerpMarket[], assets: readonly LighterAsset[]): Hedgeable[] {
  return universe.map((u) => {
    const perp = perps.find((p) => p.symbol.toUpperCase() === u.symbol.toUpperCase() && p.status === "active");
    const asset = assets.find((a) => a.l1Address.toLowerCase() === u.token.toLowerCase());
    return {
      symbol: u.symbol,
      token: u.token,
      perp: perp ? perp.marketId : "no_perp",
      marginEligible: asset !== undefined && asset.marginMode === "enabled" && asset.loanToValue > 0,
      userCapTokens: asset ? asset.userSupplyCap : null,
      globalRoom: asset ? asset.globalSupplyCap - asset.totalSupplied : null,
    };
  });
}

// ---- the hand-off to the holder's own agent -------------------------------------------------------------------------------------------

/** How long a proposal stays good: the book it was priced from is this old at most. */
export const PROPOSAL_VALID_MINUTES = 10;
/** The protective limit sits this far below the deepest bid the order walks, so a book that moves a little still fills and one that moves a lot does not. */
export const PROTECTIVE_BUFFER_BP = 10;

type OkPlan = Omit<Extract<HedgePlan, { status: "ok" }>, "proposal">;

/** A short for the holder's own agent running lighter-agent-kit to place with the holder's own key. Uptick signs nothing, holds no key and places nothing. */
export type ExecutionProposal = {
  status: "proposed";
  venue: "lighter-robinhood-chain";
  /** The kit's LIGHTER_HOST for this deployment. */
  api_host: string;
  /** The symbol is the one lighter-agent-kit takes for a perp: the bare ticker, as Lighter lists it (a spot pair would carry a slash). */
  market: { symbol: string; market_id: number; type: "perp" };
  side: "sell";
  size: { base: string; notional_usd: number };
  /** A marketable limit: it sells into the bids and never below limit_price. Whatever the book does not take at that price rests, so the agent cancels it. */
  order: { type: "limit"; limit_price: string; reduce_only: false; limit_basis: string; reference_mid: string; expected_avg_fill_price: string };
  leverage: { suggested: number; max: number; margin_mode: "cross" };
  margin_usdg: number;
  estimated_costs: {
    slippage_bp: number;
    slippage_usd: number;
    /** Null when Lighter's fee strings are not zero: their unit is not read from the API, so no figure is invented. */
    fees_bp: number | null;
    fees_usd: number | null;
    funding_bp: number | null;
    funding_usd: number | null;
    funding_direction: "earns" | "pays" | null;
    margin_borrow_bp: number;
    margin_borrow_usd: number;
    net_bp: number | null;
    net_usd: number | null;
  };
  estimated_liquidation_price: number;
  /** When the book the limit was derived from was read. */
  market_data_at: string;
  valid_until: string;
  exit_by: string;
  exit: { side: "buy"; reduce_only: true; size: string };
  risk_notes: string[];
};

const SAFE_SYMBOL = /^[A-Z0-9]{1,12}$/;
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The proposal for a finished plan: the plan's size, leverage, costs and exit time carried over unchanged, plus the two things only the book gives, the protective limit and the
 *  expected average fill. Null when the book cannot fill the notional and its close. */
export function proposeExecution(plan: OkPlan, perp: PerpMarket, book: Sourced<OrderBook>): ExecutionProposal | null {
  if (!SAFE_SYMBOL.test(plan.symbol)) throw new RangeError(`symbol "${plan.symbol}" is not a bare ticker`);
  const mid = midOf(book.data);
  if (mid === null) return null;
  const notional = plan.notionalUsd.value;
  const w = walk(book.data.bids, notional, "sell");
  if (w === "unfillable") return null;
  const rt = plan.slippage.value.roundTripBp;
  if (rt === "unfillable") return null;
  const dp = perp.priceDecimals;
  const scale = 10 ** dp;
  // A sell limit rounded down to the tick only widens what it accepts, so the order is never refused for price precision.
  const limit = Math.floor((w.worst * (1 - PROTECTIVE_BUFFER_BP / 1e4)) * scale + 1e-6) / scale;
  const m = perp.maintenanceMarginFraction / 1e4;
  const liq = (w.avg * (1 + 1 / plan.leverage)) / (1 + m);
  const carry = plan.carry.value;
  const mc = plan.marginCarry.value;
  const fees = plan.fees.value.bp;
  const maxLeverage = 1e4 / perp.minInitialMarginFraction;
  const validMs = Math.min(Date.parse(book.fetchedAt) + PROPOSAL_VALID_MINUTES * 60_000, Date.parse(plan.window.unwindAt));
  const notes = [
    "A proposal for your own agent to place, not an executed hedge: Uptick signs nothing, holds no keys or funds, and has placed nothing. The vault itself is not hedged.",
    `Estimated liquidation price ${liq.toFixed(dp)} for a short entered near ${w.avg.toFixed(dp)} at ${plan.leverage}x, with the margin set to notional / leverage and ${r2(m * 100)}% maintenance margin. An account with more collateral liquidates higher.`,
    carry === null
      ? "Lighter returned too few weekend funding rows for a funding figure."
      : `Funding: past weekends ${carry.bp >= 0 ? "paid a short" : "charged a short"} ${r2(Math.abs(carry.bp))} bp over this window. It is the mean of the last 28 days of weekend hours, a history and not a forecast, and the sign can flip.`,
    `The short is closed by ${plan.window.unwindAt}, before the US open at ${plan.window.openAt}. A stock can gap against a short between checks, so the agent watches the position until then.`,
  ];
  return {
    status: "proposed",
    venue: "lighter-robinhood-chain",
    api_host: LIGHTER_RH.api,
    market: { symbol: plan.symbol, market_id: plan.marketId, type: "perp" },
    side: "sell",
    size: { base: plan.size.value.shares, notional_usd: r2(notional) },
    order: {
      type: "limit",
      reduce_only: false,
      limit_price: limit.toFixed(dp),
      limit_basis: `the deepest bid a ${r2(notional)} USD sell walks (${w.worst.toFixed(dp)}) less ${PROTECTIVE_BUFFER_BP} bp, floored to the tick`,
      reference_mid: mid.toFixed(dp),
      expected_avg_fill_price: w.avg.toFixed(dp),
    },
    leverage: { suggested: plan.leverage, max: maxLeverage, margin_mode: "cross" },
    margin_usdg: r2(plan.marginUsdg.value),
    estimated_costs: {
      slippage_bp: r2(rt),
      slippage_usd: r2((rt / 1e4) * notional),
      fees_bp: fees,
      fees_usd: fees === null ? null : r2((fees / 1e4) * notional),
      funding_bp: carry === null ? null : r2(carry.bp),
      funding_usd: carry === null ? null : r2(carry.usd),
      funding_direction: carry === null ? null : carry.bp >= 0 ? "earns" : "pays",
      margin_borrow_bp: r2(mc.bp),
      margin_borrow_usd: r2(mc.usd),
      net_bp: plan.netBp === null ? null : r2(plan.netBp),
      net_usd: plan.netUsd === null ? null : r2(plan.netUsd),
    },
    estimated_liquidation_price: Number(liq.toFixed(dp)),
    market_data_at: book.fetchedAt,
    valid_until: new Date(validMs).toISOString(),
    exit_by: plan.window.unwindAt,
    exit: { side: "buy", reduce_only: true, size: plan.size.value.shares },
    risk_notes: notes,
  };
}

/** The proposal as one instruction to paste into an agent that has lighter-agent-kit: paper first, then live only on the holder's word. Every number in it is read from the proposal. */
export function agentInstruction(p: ExecutionProposal): string {
  const c = p.estimated_costs;
  const sym = p.market.symbol;
  const fmt = (n: number | null, unit: string) => (n === null ? "n/a" : `${n} ${unit}`);
  const tier = c.fees_bp === 0 ? " --tier standard" : "";
  return [
    `Place a proposed weekend hedge on Lighter's Robinhood Chain exchange with lighter-agent-kit, from my own Lighter account. Paper trade it first with scripts/paper.py, and place it live with scripts/trade.py only after the paper run looks right and I say so.`,
    ``,
    `Host: LIGHTER_HOST=${p.api_host}`,
    `Market: ${sym} perp (market_id ${p.market.market_id}), symbol ${sym}`,
    `Side: sell (short)`,
    `Size: ${p.size.base} ${sym}, about ${p.size.notional_usd} USD notional`,
    `Order: limit sell at ${p.order.limit_price} or higher (a protective limit below the deepest bid this size walks; expected average fill about ${p.order.expected_avg_fill_price}). Cancel any part that does not fill.`,
    `Leverage: ${p.leverage.suggested}x ${p.leverage.margin_mode} (the market allows up to ${p.leverage.max}x), about ${p.margin_usdg} USDG of margin`,
    `Valid until: ${p.valid_until} (the book was read at ${p.market_data_at}). After that, ask Uptick for a new plan before placing.`,
    `Exit by: ${p.exit_by}. Check the position every few hours and close by ${p.exit_by} with a reduce-only buy of ${p.exit.size} ${sym}.`,
    `Estimated: round trip slippage ${fmt(c.slippage_bp, "bp")}, fees ${fmt(c.fees_bp, "bp")}, funding ${c.funding_direction ?? "n/a"} ${fmt(c.funding_bp, "bp")}, margin interest ${c.margin_borrow_bp} bp, liquidation near ${p.estimated_liquidation_price.toFixed((p.order.limit_price.split(".")[1] ?? "").length)}.`,
    ``,
    `Paper (run from the kit folder, no key needed; use reset in place of init if a paper account already exists):`,
    `python3 scripts/paper.py init --collateral ${p.margin_usdg}${tier}`,
    `python3 scripts/paper.py order ioc ${sym} --side short --amount ${p.size.base} --price ${p.order.limit_price}`,
    `python3 scripts/paper.py positions --symbol ${sym}`,
    `python3 scripts/paper.py order market ${sym} --side long --amount ${p.exit.size}`,
    ``,
    `Live, only after I confirm:`,
    `python3 scripts/trade.py position leverage ${sym} --leverage ${p.leverage.suggested} --margin_mode ${p.leverage.margin_mode}`,
    `python3 scripts/trade.py order limit ${sym} --side short --amount ${p.size.base} --price ${p.order.limit_price}`,
    `python3 scripts/trade.py order market ${sym} --side long --amount ${p.exit.size} --reduce_only`,
    ``,
    `This is a proposal from Uptick's planner, not an executed hedge. Uptick placed nothing and holds no keys or funds; the key, the order and the funds stay with me.`,
  ].join("\n");
}

// ---- the plan ---------------------------------------------------------------------------------------------------------------------

/** A figure with where it came from: the URL or call that produced it and the UTC time it arrived. */
export type Line<T> = { value: T; source: string; fetchedAt: string };

export type HedgePlan =
  | { status: "no_perp"; symbol: string }
  | {
      status: "below_min";
      symbol: string;
      marketId: number;
      /** Which of Lighter's two floors the short is under: the smallest size, or the smallest order value. */
      limit: "min_base_amount" | "min_quote_amount";
      minBase: Line<string>;
      minQuoteUsd: Line<number>;
    }
  | {
      status: "ok";
      symbol: string;
      marketId: number;
      side: "short";
      window: { closeAt: string; startAt: string; openAt: string; unwindAt: string; hours: number };
      size: Line<{ shares: string; units: string; multiplier: string }>;
      notionalUsd: Line<number>;
      leverage: number;
      marginUsdg: Line<number>;
      stockMargin: Line<{ eligible: boolean; loanToValue: number | null; userCapTokens: number | null; globalRoom: number | null }>;
      slippage: Line<{ openBp: number | "unfillable"; closeBp: number | "unfillable"; roundTripBp: number | "unfillable" }>;
      fees: Line<{ takerFee: string; makerFee: string; bp: number | null }>;
      /** Positive: a short earned funding over the weekend hours in the window. Null: fewer than MIN_CARRY_ROWS weekend rows. */
      carry: Line<{ bp: number; usd: number; weekendRows: number } | null>;
      marginCarry: Line<{ borrowed: boolean; bp: number; usd: number }>;
      /** carry less round-trip slippage, fees and borrow interest, in bp of the notional: positive earns. Null when any part is not a number. */
      netBp: number | null;
      netUsd: number | null;
      /** The same short as an order for the holder's own agent to place; null when the book cannot fill the size and its close, so no protective limit or cost exists. Nothing in it is placed by Uptick. */
      proposal: ExecutionProposal | null;
    };

export type PlanInput = {
  symbol: string;
  /** The token's address, matched to Lighter's assetDetails. */
  token: string;
  balanceRaw: bigint;
  tokenDecimals: number;
  /** uiMultiplier() read on chain, 1e18-scaled, and the call that read it. */
  uiMultiplier: bigint;
  uiMultiplierRead: { source: string; fetchedAt: string };
  leverage?: number;
  /** The borrower's Morpho rate as a yearly percent (aprPct of borrowRateView) and the read it came from; absent when the margin is the holder's own USDG. */
  borrowApr?: { pct: number; source: string; fetchedAt: string };
  now: Date;
  unwindMinutes?: number;
  perps: Sourced<PerpMarket[]>;
  assets: Sourced<LighterAsset[]>;
  book: Sourced<OrderBook>;
  fundings: Sourced<FundingRow[]>;
};

export function planHedge(p: PlanInput): HedgePlan {
  const perp = p.perps.data.find((m) => m.symbol.toUpperCase() === p.symbol.toUpperCase() && m.status === "active");
  if (!perp) return { status: "no_perp", symbol: p.symbol };
  const src = (s: Sourced<unknown>) => ({ source: s.url, fetchedAt: s.fetchedAt });
  const unwindMinutes = p.unwindMinutes ?? DEFAULT_UNWIND_MINUTES;

  const sized = sizeShares(p.balanceRaw, p.tokenDecimals, p.uiMultiplier, perp.sizeDecimals, perp.minBaseAmount);
  const belowMin = (limit: "min_base_amount" | "min_quote_amount"): HedgePlan => ({
    status: "below_min", symbol: p.symbol, marketId: perp.marketId, limit,
    minBase: { value: perp.minBaseAmount, ...src(p.perps) }, minQuoteUsd: { value: perp.minQuoteAmount, ...src(p.perps) },
  });
  if ("reason" in sized) return belowMin("min_base_amount");

  const leverage = p.leverage ?? DEFAULT_LEVERAGE;
  const maxLeverage = 1e4 / perp.minInitialMarginFraction;
  if (!(leverage >= 1) || leverage > maxLeverage) throw new RangeError(`${p.symbol} allows 1x to ${maxLeverage}x, not ${leverage}x`);

  const mid = midOf(p.book.data);
  if (mid === null) throw new RangeError(`${p.symbol} has an empty side in the order book`);
  const shares = Number(sized.shares);
  const notional = shares * mid;
  if (notional < perp.minQuoteAmount) return belowMin("min_quote_amount");
  const w = weekendWindow(p.now, unwindMinutes);

  const open = walkBook(p.book.data.bids, notional, mid, "sell");
  const close = walkBook(p.book.data.asks, notional, mid, "buy");
  const rt = open === "unfillable" || close === "unfillable" ? "unfillable" : open + close;

  const feeNum = [perp.takerFee, perp.makerFee].map(Number);
  const feeBp = feeNum.every((n) => n === 0) ? 0 : null;

  const weekendRows = p.fundings.data.filter((r) => isWeekendHour(r.timestamp, unwindMinutes));
  const carry = weekendRows.length >= MIN_CARRY_ROWS ? carryBp(weekendRows, w.hours, perp.markPrice) : null;

  const borrowed = p.borrowApr !== undefined;
  const mc = p.borrowApr ? marginCarryBp(notional, leverage, p.borrowApr.pct, w.hours) : { bp: 0, usd: 0 };

  const asset = p.assets.data.find((a) => a.l1Address.toLowerCase() === p.token.toLowerCase());
  const net = carry !== null && rt !== "unfillable" && feeBp !== null ? carry - rt - feeBp - mc.bp : null;

  const body: OkPlan = {
    status: "ok",
    symbol: p.symbol,
    marketId: perp.marketId,
    side: "short",
    window: { closeAt: w.closeAt.toISOString(), startAt: w.startAt.toISOString(), openAt: w.openAt.toISOString(), unwindAt: w.unwindAt.toISOString(), hours: w.hours },
    size: { value: { shares: sized.shares, units: sized.units.toString(), multiplier: p.uiMultiplier.toString() }, ...p.uiMultiplierRead },
    notionalUsd: { value: notional, ...src(p.book) },
    leverage,
    marginUsdg: { value: notional * Math.max(1 / leverage, perp.minInitialMarginFraction / 1e4), ...src(p.perps) },
    stockMargin: {
      value: {
        eligible: asset !== undefined && asset.marginMode === "enabled" && asset.loanToValue > 0,
        loanToValue: asset ? asset.loanToValue : null,
        userCapTokens: asset ? asset.userSupplyCap : null,
        globalRoom: asset ? asset.globalSupplyCap - asset.totalSupplied : null,
      },
      ...src(p.assets),
    },
    slippage: { value: { openBp: open, closeBp: close, roundTripBp: rt }, ...src(p.book) },
    fees: { value: { takerFee: perp.takerFee, makerFee: perp.makerFee, bp: feeBp }, ...src(p.perps) },
    carry: { value: carry === null ? null : { bp: carry, usd: carryUsd(carry, notional), weekendRows: weekendRows.length }, ...src(p.fundings) },
    marginCarry: { value: { borrowed, bp: mc.bp, usd: mc.usd }, source: p.borrowApr?.source ?? "own USDG margin, no borrow", fetchedAt: p.borrowApr?.fetchedAt ?? p.now.toISOString() },
    netBp: net,
    netUsd: net === null ? null : carryUsd(net, notional),
  };
  return { ...body, proposal: proposeExecution(body, perp, p.book) };
}
