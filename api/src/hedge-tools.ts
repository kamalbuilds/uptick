import type { Address, PublicClient } from "viem";
import { vaultAbi } from "./shared/abis.ts";
import { DEFAULT_LEVERAGE, planHedge, type HedgePlan } from "./shared/hedge.ts";
import { readMultipliers } from "./shared/hedge-chain.ts";
import { LIGHTER_RH, fetchAssetDetails, fetchFundings, fetchOrderBookDetails, fetchOrderBookOrders, type LighterOpts, type Sourced } from "./shared/lighter.ts";
import { hasLoan } from "./shared/loan.ts";
import { MORPHO_BLUE, aprPct, type MarketEntry } from "./shared/morpho.ts";
import { READ_LAG, parseOwner, scanWallet, type ScanClient, type ScanRow, type ScanVault } from "./shared/scan.ts";
import { MARKETS, makeClient, marketOf, readMarketSide, readPosition } from "./loan-chain";

/** plan_weekend_hedge: sizes and prices a weekend short of the matching Stock Token perp on Lighter's Robinhood Chain exchange. Read-only: it signs nothing, places nothing and returns no calldata. */

export interface HedgeToolEnv {
  VAULTS?: string;
  CHAIN_RPC_URL?: string;
}
export interface HedgeToolDeps {
  /** Answers the wallet scan and the uiMultiplier read. With none, the Worker's keyless public endpoints for chain 4663 (passed in by mcp.ts). */
  scanClient?: ScanClient;
  /** The node and market list the loan source reads, as the loan tools take them. */
  loan?: { client?: PublicClient; markets?: Record<string, MarketEntry> };
  /** Lighter RH reads go through this; the global fetch when absent. A test serves recorded Lighter responses with it. */
  lighterFetch?: typeof fetch;
  now?: () => number;
}
export interface HedgeToolContext {
  env: HedgeToolEnv;
  /** The tracked Stock Tokens, as scan_wallet reads them. */
  vaults: readonly ScanVault[];
  /** The client to use when no scanClient was injected. */
  defaultClient: () => ScanClient;
  deps: HedgeToolDeps;
}
export interface HedgeToolResult {
  payload: Record<string, unknown>;
  isError?: boolean;
}

const MAX_LEVERAGE = 20;

const refuse = (message: string, extra: Record<string, unknown> = {}): HedgeToolResult => ({ payload: { error: message, ...extra }, isError: true });
const reason = (fields: Record<string, unknown>): HedgeToolResult => ({ payload: fields });
const bp = (n: number): number => Math.round(n * 100) / 100;
const usd = (n: number): number => Math.round(n * 100) / 100;
const short = (e: unknown): string => String((e as Error)?.message ?? e).split("\n")[0].slice(0, 220);

/** Thrown for any answer from Lighter that is not a clean 200: its own `code` (20558 is the geo gate) or the HTTP status, never swallowed into a plan. */
class LighterUpstreamError extends Error {
  constructor(readonly status: number | null, readonly code: number | null, detail: string) {
    super(`Lighter RH did not answer ${detail}`);
  }
}

/** A fetch that turns a non-2xx answer into an error that carries Lighter's `code` from the body (the geo gate answers HTTP 400 with {"code":20558}) or, for an HTML block page, its first words. */
function guarded(f: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const path = new URL(String(input)).pathname;
    let res: Response;
    try {
      res = await f(input, init);
    } catch (e) {
      throw new LighterUpstreamError(null, null, `${path}: request failed (${short(e)})`);
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => "");
    let code: number | null = null;
    try {
      const parsed = JSON.parse(text) as { code?: unknown };
      if (typeof parsed.code === "number") code = parsed.code;
    } catch {
      /* an HTML block page has no JSON body */
    }
    const detail = code !== null ? `${path}: HTTP ${res.status}, code ${code}` : `${path}: HTTP ${res.status} ${text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)}`;
    throw new LighterUpstreamError(res.status, code, detail);
  }) as typeof fetch;
}

function upstreamFields(e: unknown): Record<string, unknown> {
  if (e instanceof LighterUpstreamError) return { upstream: "lighter-rh", upstream_status: e.status, upstream_code: e.code };
  const m = /code (\d+)/.exec(short(e));
  return { upstream: "lighter-rh", upstream_status: null, upstream_code: m ? Number(m[1]) : null };
}

type Holding = { client: Pick<PublicClient, "multicall">; symbol: string; vaultId: string; token: Address; balanceRaw: bigint; block: bigint; readAt: number; sizedFrom: "wallet_balance" | "vault_share_stock_leg"; borrowApr?: { pct: number; source: string; fetchedAt: string }; sourceNote: string };

export async function planWeekendHedge(ctx: HedgeToolContext, args: Record<string, unknown>): Promise<HedgeToolResult> {
  const owner = typeof args.address === "string" ? parseOwner(args.address) : null;
  if (!owner) return refuse("address must be a valid 0x wallet address (42 characters; names such as ENS are not resolved)");
  const source = args.source === undefined ? "wallet" : args.source;
  if (source !== "wallet" && source !== "loan") return refuse('source must be "wallet" or "loan"');
  const leverage = args.leverage === undefined ? DEFAULT_LEVERAGE : args.leverage;
  if (typeof leverage !== "number" || !Number.isFinite(leverage) || leverage < 1 || leverage > MAX_LEVERAGE) return refuse(`leverage must be a number from 1 to ${MAX_LEVERAGE}`);
  const vaultId = typeof args.vault === "string" && args.vault !== "" ? args.vault : undefined;
  if (args.vault !== undefined && vaultId === undefined) return refuse("vault must be a vault id such as nvda");
  if (vaultId && !ctx.vaults.some((v) => v.id === vaultId)) return refuse(`no vault with id "${vaultId}"`);
  if (source === "loan" && !vaultId) return refuse('source "loan" needs the vault id of the loan, for example "nvda"');

  const now = ctx.deps.now ?? Date.now;
  const lighter: LighterOpts = { fetch: guarded(ctx.deps.lighterFetch ?? fetch), now };

  // Lighter first: the perp list says which holdings can be hedged at all, and a Lighter failure ends the run before any chain read is spent.
  let perps: Sourced<Awaited<ReturnType<typeof fetchOrderBookDetails>>["data"]>;
  let assets: Sourced<Awaited<ReturnType<typeof fetchAssetDetails>>["data"]>;
  try {
    [perps, assets] = await Promise.all([fetchOrderBookDetails(lighter), fetchAssetDetails(lighter)]);
  } catch (e) {
    return refuse(`${short(e)}. No plan returned.`, upstreamFields(e));
  }

  const picked = source === "wallet" ? await fromWallet(ctx, owner, vaultId, new Set(perps.data.filter((p) => p.status === "active").map((p) => p.symbol.toUpperCase()))) : await fromLoan(ctx, owner, vaultId!);
  if ("payload" in picked) return picked;
  const h = picked;

  const perp = perps.data.find((p) => p.symbol.toUpperCase() === h.symbol.toUpperCase() && p.status === "active");
  if (!perp) return reason({ ...head(owner, source, h), hedgeable: false, reason: `Lighter RH lists no active perp for ${h.symbol}, so there is nothing to short` });

  let multiplier: Awaited<ReturnType<typeof readMultipliers>>[number];
  try {
    [multiplier] = await readMultipliers(h.client, [h.token], h.block);
  } catch (e) {
    return refuse(`could not read the ERC-8056 multiplier from Robinhood Chain: ${short(e)}`);
  }
  if (!multiplier.ok) return refuse(`${h.symbol}: ${multiplier.reason}; no size is returned without it`);

  let book: Sourced<Awaited<ReturnType<typeof fetchOrderBookOrders>>["data"]>;
  let fundings: Sourced<Awaited<ReturnType<typeof fetchFundings>>["data"]>;
  try {
    [book, fundings] = await Promise.all([fetchOrderBookOrders(perp.marketId, lighter), fetchFundings(perp.marketId, lighter)]);
  } catch (e) {
    return refuse(`${short(e)}. No plan returned.`, upstreamFields(e));
  }

  const readAt = new Date(h.readAt).toISOString();
  let plan: HedgePlan;
  try {
    plan = planHedge({
      symbol: h.symbol,
      token: h.token,
      balanceRaw: h.balanceRaw,
      tokenDecimals: 18,
      uiMultiplier: multiplier.multiplier,
      uiMultiplierRead: { source: `eth_call Multicall3 uiMultiplier() on ${h.token} at block ${h.block}`, fetchedAt: readAt },
      leverage,
      borrowApr: h.borrowApr,
      now: new Date(now()),
      perps,
      assets,
      book,
      fundings,
    });
  } catch (e) {
    return refuse(short(e), { symbol: h.symbol });
  }
  if (plan.status === "no_perp") return reason({ ...head(owner, source, h), hedgeable: false, reason: `Lighter RH lists no active perp for ${h.symbol}, so there is nothing to short` });
  if (plan.status === "below_min") {
    const what = h.sizedFrom === "wallet_balance" ? "holding" : "stock leg of the shares";
    const why = plan.limit === "min_base_amount" ? `is under Lighter's smallest ${h.symbol} order of ${plan.minBase.value} shares` : `is worth under Lighter's smallest order of ${usd(plan.minQuoteUsd.value)} USD`;
    return reason({ ...head(owner, source, h), hedgeable: false, reason: `the ${what} ${why}, so there is nothing to place`, min_order_shares: plan.minBase.value, min_order_usd: plan.minQuoteUsd.value });
  }
  if (plan.slippage.value.roundTripBp === "unfillable") {
    return refuse(`the ${h.symbol} order book Lighter returned (250 orders a side) cannot fill a ${usd(plan.notionalUsd.value)} USD short and its close, so no cost is returned`, { symbol: h.symbol, requested_notional_usd: usd(plan.notionalUsd.value) });
  }
  if (plan.carry.value === null) {
    return refuse(`Lighter returned fewer weekend funding rows than the 24 needed for a funding figure for ${h.symbol}, so no cost is returned`, { symbol: h.symbol });
  }

  const carry = plan.carry.value;
  const stock = plan.stockMargin.value;
  const sources = [
    ...[perps, assets, book, fundings].map((s) => ({ url: s.url, fetchedAt: s.fetchedAt })),
    { url: plan.size.source, fetchedAt: plan.size.fetchedAt },
    ...(h.borrowApr ? [{ url: h.borrowApr.source, fetchedAt: h.borrowApr.fetchedAt }] : []),
  ];
  return {
    payload: {
      ...head(owner, source, h),
      hedgeable: true,
      side: plan.side,
      shares: plan.size.value.shares,
      sizedFrom: h.sizedFrom,
      uiMultiplier: plan.size.value.multiplier,
      notionalUsd: usd(plan.notionalUsd.value),
      leverage: plan.leverage,
      marginUsdg: usd(plan.marginUsdg.value),
      slippageBp: bp(plan.slippage.value.roundTripBp),
      openSlippageBp: plan.slippage.value.openBp === "unfillable" ? null : bp(plan.slippage.value.openBp),
      closeSlippageBp: plan.slippage.value.closeBp === "unfillable" ? null : bp(plan.slippage.value.closeBp),
      feeBp: plan.fees.value.bp,
      fundingBp: bp(carry.bp),
      fundingUsd: usd(carry.usd),
      fundingDirection: carry.bp >= 0 ? "earns" : "pays",
      fundingWeekendRows: carry.weekendRows,
      marginCostBp: bp(plan.marginCarry.value.bp),
      marginCostUsd: usd(plan.marginCarry.value.usd),
      marginBorrowed: plan.marginCarry.value.borrowed,
      netBp: plan.netBp === null ? null : bp(plan.netBp),
      netUsd: plan.netUsd === null ? null : usd(plan.netUsd),
      marginEligible: stock.eligible,
      loanToValue: stock.loanToValue,
      userCapTokens: stock.userCapTokens,
      globalRoomTokens: stock.globalRoom,
      window: { close: plan.window.closeAt, start: plan.window.startAt, unwind: plan.window.unwindAt, open: plan.window.openAt, hours: Math.round(plan.window.hours * 10) / 10 },
      handoffUrl: `${LIGHTER_RH.app}/trade/${h.symbol}`,
      sources,
      note: "Read-only plan: nothing is placed or signed and no calldata is returned. The holder enters the short on Lighter with this size, side and leverage. netBp is funding less the round trip through the book, fees and any margin interest, positive when the weekend earns. Funding is the mean of the weekend hours in the last 28 days of Lighter RH funding, a history and not a forecast.",
    },
  };
}

const head = (owner: Address, source: string, h: Holding) => ({ address: owner, source, vault: h.vaultId, symbol: h.symbol, token: h.token, block: Number(h.block), basis: h.sourceNote });

async function fromWallet(ctx: HedgeToolContext, owner: Address, vaultId: string | undefined, perpSymbols: Set<string>): Promise<Holding | HedgeToolResult> {
  const client = ctx.deps.scanClient ?? ctx.defaultClient();
  let scan: Awaited<ReturnType<typeof scanWallet>>;
  try {
    scan = await scanWallet(client, owner, ctx.vaults);
  } catch (e) {
    return refuse(`could not read Robinhood Chain: ${short(e)}`);
  }
  const held = scan.rows.filter((r) => r.balanceRaw > 0n);
  if (held.length === 0) {
    return reason({ address: owner, source: "wallet", hedgeable: false, has_holding: false, block: Number(scan.block), reason: `this wallet holds none of the ${scan.tracked} Stock Tokens Uptick tracks, so there is nothing to hedge` });
  }
  const pool: ScanRow[] = vaultId ? held.filter((r) => r.id === vaultId) : held;
  if (vaultId && pool.length === 0) {
    return reason({ address: owner, source: "wallet", vault: vaultId, hedgeable: false, has_holding: false, block: Number(scan.block), reason: `this wallet holds none of ${vaultId.toUpperCase()}; it holds ${held.map((r) => r.symbol).join(", ")}` });
  }
  const row = pool.find((r) => perpSymbols.has(r.symbol.toUpperCase()));
  if (!row) {
    return reason({ address: owner, source: "wallet", hedgeable: false, has_holding: true, block: Number(scan.block), reason: `Lighter RH lists no active perp for ${pool.map((r) => r.symbol).join(", ")}, so there is nothing to short` });
  }
  return { client, symbol: row.symbol, vaultId: row.id, token: row.token, balanceRaw: row.balanceRaw, block: scan.block, readAt: scan.readAt, sizedFrom: "wallet_balance", sourceNote: `sized from the wallet's ${row.balance} ${row.symbol} (balanceOf at block ${scan.block})` };
}

function parseVaultMap(raw: string | undefined): Record<string, string> {
  try {
    const m = raw ? (JSON.parse(raw) as unknown) : {};
    return typeof m === "object" && m !== null ? (m as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function fromLoan(ctx: HedgeToolContext, owner: Address, vaultId: string): Promise<Holding | HedgeToolResult> {
  const lead = { address: owner, source: "loan", vault: vaultId, hedgeable: false };
  const found = marketOf(parseVaultMap(ctx.env.VAULTS), vaultId, ctx.deps.loan?.markets ?? MARKETS);
  if (!found.ok) return reason({ ...lead, has_market: false, has_position: false, reason: found.reason });
  const client = ctx.deps.loan?.client ?? (ctx.env.CHAIN_RPC_URL ? makeClient(ctx.env.CHAIN_RPC_URL) : undefined);
  if (!client) return refuse("chain reads are not configured on this server (CHAIN_RPC_URL)");
  const token = ctx.vaults.find((v) => v.id === vaultId)!.token;
  try {
    const side = await readMarketSide(client, found.market, found.vault);
    if (!side) return reason({ ...lead, has_market: false, has_position: false, reason: `the Morpho market for vault ${vaultId} is configured but not created on-chain` });
    const pos = await readPosition(client, side, owner);
    if (!hasLoan(pos.collateral, pos.borrowShares) || pos.collateral === 0n) {
      return reason({ ...lead, has_market: true, has_position: false, reason: "this wallet has no vault shares posted as collateral in the market, so there is no stock leg to hedge" });
    }
    // The vault is asked as Morpho would ask it: Morpho holds the shares, so it can redeem them. No signature, no state change.
    const quote = await client.simulateContract({ address: found.vault, abi: vaultAbi, functionName: "redeemInKind", args: [pos.collateral, owner, MORPHO_BLUE], account: MORPHO_BLUE });
    const block = (await client.getBlockNumber()) - READ_LAG;
    const readAt = Number(side.now) * 1000;
    return {
      client,
      symbol: ctx.vaults.find((v) => v.id === vaultId)!.symbol,
      vaultId,
      token,
      balanceRaw: quote.result[0],
      block,
      readAt,
      sizedFrom: "vault_share_stock_leg",
      borrowApr: pos.borrowShares > 0n ? { pct: aprPct(side.rate), source: `eth_call borrowRateView on the Morpho market ${side.id}`, fetchedAt: new Date(readAt).toISOString() } : undefined,
      sourceNote: `sized from the stock leg of ${pos.collateral} posted ${vaultId.toUpperCase()} vault shares (redeemInKind simulated for the collateral)`,
    };
  } catch (e) {
    return refuse(`the chain did not answer: ${short(e)}`);
  }
}
