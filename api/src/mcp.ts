import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  fallback,
  formatUnits,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseUnits,
} from "viem";
import vaultUniverse from "../data/vault-universe.json";
import replay from "../data/replay.json";
import collateralMarkets from "../data/collateral-markets.json";
import { parseMarkets } from "./shared/morpho.ts";
import { RHC_RPCS, parseOwner, scanWallet, type ScanClient, type ScanLltv, type ScanRow, type ScanVault, type WalletScan } from "./shared/scan.ts";
import type { TalkEnv } from "./talk";
import type { AlertsEnv } from "./alerts";
import { checkLoanHealth, prepareMakeSafer, type LoanToolDeps, type LoanToolResult } from "./loan-tools";
import { planWeekendHedge } from "./hedge-tools";

export interface Env extends TalkEnv, AlertsEnv {
  VAULTS?: string;
  ROUTER?: string;
  NETWORK?: string;
  /** JSON-RPC endpoint of the chain the VAULTS addresses live on. Unset, /keeper/vaults/:id serves replay figures only, and scan_wallet reads through the public Robinhood Chain endpoints. */
  CHAIN_RPC_URL?: string;
  /** StockVaultV4Lens address: the only way to read a v4 vault's value in USDG. Unset, a v4 vault's tvl_usd is null. */
  VAULT_LENS?: string;
  /** JSON {vaultId: MarketParams}; overrides data/collateral-markets.json per vault. */
  COLLATERAL_MARKETS?: string;
  /** JSON-RPC endpoint used to preview shares, read the oracle price and the market liquidity. */
  RPC_URL?: string;
}

interface HalfStats {
  fee_apr_pct: number | null;
  markout_apr_pct: number | null;
  cost_apr_pct: number | null;
  edge_apr_pct: number | null;
  rebalances: number;
}

interface PoolRow {
  kind: string;
  id: string;
  fee_tier: number;
  hooks: string | null;
  vault_capable: boolean;
  swaps: number;
  volume_usd: number;
  pool_fees_usd: number;
  full: HalfStats;
  calibration: HalfStats;
  test: HalfStats;
}

interface Gate {
  state: string;
  reason: string;
  floor_apr: number;
  worst_half_apr: number;
  swaps: number;
  days: number;
}

export interface Vault {
  id: string;
  symbol: string;
  name: string;
  token: string;
  /** The v3 pool address, or for a v4 vault the pool id (32 bytes, lowercase). */
  pool: string;
  feeTierPips: number;
  feeTier: string;
  /** Fee the vault keeps on deposit and mint, in bps: max(pool fee tier, 35). */
  entryFeeBps: number;
  /** The backend the vault holds its position in: a Uniswap v3 pool (StockVault) or a Uniswap v4 pool (StockVaultV4). */
  venue: "v3" | "v4";
  feed: string;
  /** Vault size in USD, sized to the pool depth; the vault is created with this deposit cap. */
  depositCapUsd: number;
  /** Chainlink price (USD per stock) read when the universe was built; converts a stock amount to dollars for the cap check. */
  refPriceUsd: number;
  open: boolean;
  gate?: Partial<Gate>;
  feeAprPct: number;
  keptAprPct: number;
}

interface TokenReplay {
  symbol: string;
  pools: PoolRow[];
  swaps_replayed: number;
}

interface Replay {
  generated_at: string;
  tokens: Record<string, TokenReplay>;
  window: { start: string; end: string; days: number; calibration_end: string };
}

/** keeper/scripts/export-web.ts writes poolManager (the Uniswap v4 PoolManager every StockVaultV4 holds its position in) beside the vault list. */
export const UNIVERSE = vaultUniverse as { poolManager: string; vaults: Vault[] };
const REPLAY = replay as unknown as Replay;

export const PROTOCOL_VERSION = "2025-06-18";
export const SERVER_INFO = { name: "uptick", version: "1.0.0" };
export const INSTRUCTIONS =
  "Uptick serves gate-checked evidence for tokenized stock vaults on Robinhood Chain. " +
  "When you report a vault, cite the gate reason verbatim and state the replay window. " +
  "Never present the fee APR or kept APR as a promise, a target, or an expected return: it is a replay of past swap flow, not a forecast. " +
  "The prepare tools only build unsigned transactions for the user to sign; never sign, send, or broadcast anything yourself.";

const SOURCE_BASE = "https://uptick-evidence.earn-shield-alerts.workers.dev";

const CHAIN_ID = 4663;
const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const STOCK_DECIMALS = 18;
const USDG_DECIMALS = 6;
const SHARES_DECIMALS = 24;

// Signatures match web/lib/abis.ts (erc20Abi, vaultAbi, routerAbi) and the compiled contracts; test/abi-sync.test.ts fails on drift.
export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);
export const ERC4626_ABI = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function redeemInKind(uint256 shares, address receiver, address owner) returns (uint256 stockOut, uint256 usdgOut)",
]);
export const ROUTER_ABI = parseAbi([
  "function depositUsdg(address vault, uint256 usdgIn, uint256 minShares, address receiver) returns (uint256 shares)",
  "function depositUsdgV4(address vault, uint256 usdgIn, uint256 minShares, address receiver) returns (uint256 shares)",
]);

// Morpho Blue singleton on Robinhood Chain; code at this address read with eth_getCode on chain 4663.
const MORPHO_BLUE = "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010";
// supplyCollateral gets this much less than the previewed shares so a small price move between preview and mining cannot revert it.
const SHARE_HAIRCUT_BPS = 10n;
const MARKET_PARAMS = "(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)";
const MORPHO_ABI = parseAbi([
  `function supplyCollateral(${MARKET_PARAMS} marketParams, uint256 assets, address onBehalf, bytes data)`,
  `function borrow(${MARKET_PARAMS} marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)`,
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
]);
const VAULT_READ_ABI = parseAbi(["function previewDeposit(uint256 assets) view returns (uint256)"]);
const ORACLE_ABI = parseAbi(["function price() view returns (uint256)"]);

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function findVault(id: string): Vault | undefined {
  return UNIVERSE.vaults.find((candidate) => candidate.id === id);
}

function gateOf(vault: Vault): Gate {
  return {
    state: "open",
    reason: "",
    floor_apr: -20,
    worst_half_apr: 0,
    swaps: 0,
    days: REPLAY.window.days,
    ...(vault.gate ?? {}),
  };
}

export function parseVaults(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Where the vault's position lives, for every tool that describes a vault. A v4 vault has a pool id inside the PoolManager singleton, not a pool address. */
export function venueFields(vault: Vault): Record<string, unknown> {
  return {
    venue: vault.venue,
    fee_tier_pips: vault.feeTierPips,
    fee_tier: vault.feeTier,
    pool: vault.pool,
    ...(vault.venue === "v4" ? { pool_id: vault.pool, pool_manager: UNIVERSE.poolManager } : {}),
  };
}

/** A configured address, or undefined when it is missing or malformed: a bad VAULTS or ROUTER entry reads as "not live", never as calldata to a wrong address. */
function liveAddress(raw: string | undefined): `0x${string}` | undefined {
  return raw && isAddress(raw) ? (raw as `0x${string}`) : undefined;
}

function textResult(payload: Record<string, unknown>, isError = false): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

function errorResult(message: string): McpToolResult {
  return textResult({ error: message }, true);
}

function listVaults(): McpToolResult {
  const vaults = UNIVERSE.vaults.map((vault) => {
    const gate = gateOf(vault);
    return {
      id: vault.id,
      ticker: vault.symbol,
      gate_state: gate.state,
      ...doorFields(vault),
      open: vault.open,
      ...venueFields(vault),
      deposit_cap_usd: vault.depositCapUsd,
      entry_fee_bps: vault.entryFeeBps,
      fee_apr_pct: vault.feeAprPct,
      kept_apr_pct: gate.worst_half_apr,
      reason: gate.reason,
    };
  });
  return textResult({ vaults });
}

function getVaultEvidence(id: string): McpToolResult {
  const vault = findVault(id);
  if (!vault) return errorResult(`no vault with id "${id}"`);

  const token = REPLAY.tokens[vault.symbol];
  const pools = token
    ? token.pools.map((pool) => ({
        kind: pool.kind,
        id: pool.id,
        fee_tier: pool.fee_tier,
        hooks: pool.hooks,
        vault_capable: pool.vault_capable,
        swaps: pool.swaps,
        volume_usd: pool.volume_usd,
        fee_apr_pct: pool.full.fee_apr_pct,
        calibration_edge_apr_pct: pool.calibration.edge_apr_pct,
        test_edge_apr_pct: pool.test.edge_apr_pct,
      }))
    : [];

  const gate = gateOf(vault);
  return textResult({
    id: vault.id,
    ticker: vault.symbol,
    name: vault.name,
    open: vault.open,
    deposit_cap_usd: vault.depositCapUsd,
    token: vault.token,
    ...venueFields(vault),
    entry_fee_bps: vault.entryFeeBps,
    feed: vault.feed,
    fee_apr_pct: vault.feeAprPct,
    kept_apr_pct: gate.worst_half_apr,
    gate: {
      state: gate.state,
      rule:
        "Open when the lower of the two replay halves keeps at least break-even; between the floor APR and break-even it is reduced with a per-transaction cap; below the floor it is closed.",
      reason: gate.reason,
      floor_apr: gate.floor_apr,
      worst_half_apr: gate.worst_half_apr,
      swaps: gate.swaps,
      days: gate.days,
    },
    window: {
      start: REPLAY.window.start,
      end: REPLAY.window.end,
      days: REPLAY.window.days,
      calibration_end: REPLAY.window.calibration_end,
    },
    swaps: token ? token.swaps_replayed : 0,
    pools,
    source: `${SOURCE_BASE}/vaults/${vault.id}`,
  });
}

export function reducedNotice(gate: Gate): Record<string, unknown> | null {
  if (gate.state !== "reduced") return null;
  const match = gate.reason.match(/capped at \$([\d,]+)/i);
  const cap = match ? Number(match[1].replace(/,/g, "")) : null;
  return {
    notice: gate.reason,
    per_transaction_cap_usd: cap,
  };
}

/** The most one deposit may add, in dollars: the vault's size cap, and for a reduced vault also its per-transaction cap. The stricter applies. */
export function depositLimitUsd(vault: Vault, gate: Gate): { usd: number; why: string } {
  const perTx = reducedNotice(gate)?.per_transaction_cap_usd;
  if (typeof perTx === "number" && perTx < vault.depositCapUsd) {
    return { usd: perTx, why: `the reduced gate caps a deposit at $${perTx.toLocaleString("en-US")} per transaction` };
  }
  return { usd: vault.depositCapUsd, why: `the ${vault.id} vault is sized to its pool at $${vault.depositCapUsd.toLocaleString("en-US")}` };
}

/** The door a vault shows: state (open | reduced | closed), the most one transaction may deposit (0 when closed) and what the weaker replay half kept, in percent a year.
 *  `open: true` elsewhere in the API means the vault accepts deposits, which is state open or reduced. */
export function doorFields(vault: Vault): { state: Gate["state"]; per_tx_cap_usd: number; kept_worst_half_pct: number } {
  const gate = gateOf(vault);
  return {
    state: gate.state,
    per_tx_cap_usd: gate.state === "closed" ? 0 : depositLimitUsd(vault, gate).usd,
    kept_worst_half_pct: gate.worst_half_apr,
  };
}

function parseAmount(raw: unknown, decimals: number, label: string): bigint | string {
  if (typeof raw !== "string" || raw.trim() === "") {
    return `${label} must be a decimal string`;
  }
  let parsed: bigint;
  try {
    parsed = parseUnits(raw.trim(), decimals);
  } catch {
    return `${label} must be a decimal string with at most ${decimals} decimal places`;
  }
  if (parsed <= 0n) return `${label} must be greater than 0`;
  return parsed;
}

function validateReceiver(raw: unknown): string | null {
  if (typeof raw !== "string" || !isAddress(raw)) {
    return "receiver must be a valid 0x address";
  }
  return null;
}

interface Tx {
  chainId: number;
  to: string;
  data: string;
  value: "0";
  description: string;
}

function tx(to: string, data: string, description: string): Tx {
  return { chainId: CHAIN_ID, to, data, value: "0", description };
}

/** The refusal for a vault whose address is not in VAULTS: the gate and venue ride along so the caller sees why and where, and no transaction is built. */
function notLive(vault: Vault, gate: Gate): McpToolResult {
  return textResult(
    {
      error: `no deployed vault for ${vault.id} on this network`,
      address_live: false,
      vault: vault.id,
      venue: vault.venue,
      gate: { state: gate.state, reason: gate.reason },
    },
    true,
  );
}

/** Refusal text when `usd` of deposit exceeds the vault's limit, else null. Stock amounts are valued at the universe's Chainlink read. */
function overLimit(vault: Vault, gate: Gate, usd: number, unit: string): string | null {
  const limit = depositLimitUsd(vault, gate);
  if (usd <= limit.usd) return null;
  const priced = unit === "USDG" ? "" : ` at $${vault.refPriceUsd} per ${unit}`;
  return `deposit of about $${Math.round(usd).toLocaleString("en-US")}${priced} is above the $${limit.usd.toLocaleString("en-US")} limit: ${limit.why}. Deposit less, or pick another vault.`;
}

function prepareDeposit(env: Env, args: Record<string, unknown>): McpToolResult {
  const id = typeof args.id === "string" ? args.id : "";
  const vault = findVault(id);
  if (!vault) return errorResult(`no vault with id "${id}"`);

  const gate = gateOf(vault);
  if (gate.state === "closed" || vault.open === false) {
    return errorResult(gate.reason || `vault ${id} is closed`);
  }

  const receiverError = validateReceiver(args.receiver);
  if (receiverError) return errorResult(receiverError);
  const receiver = args.receiver as string;

  const asset = args.asset === "usdg" ? "usdg" : "stock";

  const vaultAddress = liveAddress(parseVaults(env.VAULTS)[id]);
  if (!vaultAddress) return notLive(vault, gate);

  const transactions: Tx[] = [];
  const extra: Record<string, unknown> = {};

  if (asset === "usdg") {
    const router = liveAddress(env.ROUTER);
    if (!router) return errorResult("USDG zap router not deployed yet");
    const amount = parseAmount(args.amount, USDG_DECIMALS, "amount");
    if (typeof amount === "string") return errorResult(amount);
    const over = overLimit(vault, gate, Number(args.amount), "USDG");
    if (over) return errorResult(over);

    const approveData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [router, amount],
    });
    const zapData = encodeFunctionData({
      abi: ROUTER_ABI,
      // a StockVaultV4 swaps in its Uniswap v4 pool, so it has its own router entry point (web/components/deposit-panel.tsx picks the same one)
      functionName: vault.venue === "v4" ? "depositUsdgV4" : "depositUsdg",
      args: [vaultAddress, amount, 0n, receiver as `0x${string}`],
    });
    transactions.push(
      tx(USDG_ADDRESS, approveData, `Approve ${args.amount} USDG to the Uptick router`),
      tx(router, zapData, `Zap ${args.amount} USDG into vault ${id} for ${receiver}`),
    );
    extra.usdg_in = String(args.amount);
    extra.router_function = vault.venue === "v4" ? "depositUsdgV4" : "depositUsdg";
  } else {
    const amount = parseAmount(args.amount, STOCK_DECIMALS, "amount");
    if (typeof amount === "string") return errorResult(amount);
    const over = overLimit(vault, gate, Number(args.amount) * vault.refPriceUsd, vault.symbol);
    if (over) return errorResult(over);

    const approveData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [vaultAddress, amount],
    });
    const depositData = encodeFunctionData({
      abi: ERC4626_ABI,
      functionName: "deposit",
      args: [amount, receiver as `0x${string}`],
    });
    transactions.push(
      tx(vault.token, approveData, `Approve ${args.amount} ${vault.symbol} to the ${id} vault`),
      tx(vaultAddress, depositData, `Deposit ${args.amount} ${vault.symbol} into vault ${id} for ${receiver}`),
    );
  }

  const notice = reducedNotice(gate);
  const payload: Record<string, unknown> = {
    network: env.NETWORK ?? null,
    vault: id,
    venue: vault.venue,
    asset,
    receiver,
    entry_fee_bps: vault.entryFeeBps,
    entry_fee_note: `The vault keeps a ${vault.entryFeeBps / 100}% entry fee from this deposit for its existing holders; shares are minted against the amount net of it.`,
    transactions,
    ...extra,
  };
  if (notice) {
    payload.notice = notice.notice;
    payload.per_transaction_cap_usd = notice.per_transaction_cap_usd;
  }
  return textResult(payload);
}

function prepareWithdraw(env: Env, args: Record<string, unknown>): McpToolResult {
  const id = typeof args.id === "string" ? args.id : "";
  const vault = findVault(id);
  if (!vault) return errorResult(`no vault with id "${id}"`);

  const receiverError = validateReceiver(args.receiver);
  if (receiverError) return errorResult(receiverError);
  const receiver = args.receiver as string;

  const shares = parseAmount(args.shares, SHARES_DECIMALS, "shares");
  if (typeof shares === "string") return errorResult(shares);

  const mode = args.mode === undefined ? "redeem" : args.mode;
  if (mode !== "redeem" && mode !== "in_kind") return errorResult('mode must be "redeem" or "in_kind"');

  const vaultAddress = liveAddress(parseVaults(env.VAULTS)[id]);
  if (!vaultAddress) return notLive(vault, gateOf(vault));

  // StockVault and StockVaultV4 share both exit signatures. redeemInKind reads no oracle and swaps nothing, so it stays open when redeem is gated.
  const owner = receiver as `0x${string}`;
  const inKind = mode === "in_kind";
  const data = encodeFunctionData({
    abi: ERC4626_ABI,
    functionName: inKind ? "redeemInKind" : "redeem",
    args: [shares, owner, owner],
  });

  return textResult({
    network: env.NETWORK ?? null,
    vault: id,
    venue: vault.venue,
    mode,
    shares: String(args.shares),
    receiver,
    transactions: [
      tx(
        vaultAddress,
        data,
        inKind
          ? `Redeem ${args.shares} vault shares from ${id} in kind (both tokens, pro rata) to ${receiver}`
          : `Redeem ${args.shares} vault shares from ${id} to ${receiver}`,
      ),
    ],
  });
}

// ---- scan_wallet ---------------------------------------------------------------------------------------------------------------------

/** Loan-to-value limit of every vault with a configured Morpho market (web/lib/collateral-markets.json, synced to api/data). */
const LLTV: ScanLltv = Object.fromEntries(Object.entries(parseMarkets(collateralMarkets)).map(([id, m]) => [id, m.lltv]));

/** The tracked Stock Tokens as the scan reads them: address, feed, the gate the replay wrote, and the vault's size. */
export function scanVaults(): ScanVault[] {
  return UNIVERSE.vaults.map((v) => {
    const gate = gateOf(v);
    return {
      id: v.id,
      symbol: v.symbol,
      name: v.name,
      token: v.token as `0x${string}`,
      feed: v.feed as `0x${string}`,
      entryFeeBps: v.entryFeeBps,
      depositCapUsd: v.depositCapUsd,
      gate: { state: gate.state as ScanVault["gate"]["state"], reason: gate.reason, worstHalfApr: gate.worst_half_apr },
    };
  });
}

/** The configured chain RPC when there is one, else the keyless public endpoints for chain 4663 in order, one retry each. */
function scanClient(env: Env): ScanClient {
  const transport = env.CHAIN_RPC_URL ? http(env.CHAIN_RPC_URL) : fallback(RHC_RPCS.map((u) => http(u, { retryCount: 1, retryDelay: 500, timeout: 10_000 })));
  return createPublicClient({ transport });
}

const cents = (n: number): number => Math.round(n * 100) / 100;
const orNull = (n: number | null): number | null => (n === null ? null : cents(n));

function scanRow(r: ScanRow): Record<string, unknown> {
  return {
    id: r.id,
    ticker: r.symbol,
    token: r.token,
    balance: r.balance,
    price_usd: r.priceUsd,
    price_updated_at: r.priceUpdatedAt === null ? null : new Date(r.priceUpdatedAt * 1000).toISOString(),
    holding_usd: orNull(r.holdingUsd),
    gate_state: r.state,
    gate_reason: r.reason,
    can_deposit: r.state !== "closed",
    deposit_cap_usd: r.depositCapUsd,
    put_to_work_usd: orNull(r.putToWorkUsd),
    worst_half_apr_pct: r.worstHalfApr,
    kept_per_year_usd: orNull(r.keptPerYearUsd),
    entry_fee_bps: r.entryFeeBps,
    borrow:
      r.borrow.kind === "room"
        ? { status: "room", max_usd: cents(r.borrow.usd), lltv_pct: r.borrow.lltv }
        : r.borrow.kind === "none"
          ? { status: "none", note: "The vault is closed, so no shares exist to post as collateral." }
          : { status: "opens_with_market", note: "Borrowing opens with the Morpho market for this vault share." },
  };
}

export function scanPayload(env: Env, s: WalletScan): Record<string, unknown> {
  const t = s.totals;
  return {
    owner: s.owner,
    network: env.NETWORK ?? null,
    chain_id: CHAIN_ID,
    block: Number(s.block),
    read_at: new Date(s.readAt).toISOString(),
    tracked: s.tracked,
    totals: {
      idle_usd: cents(t.idleUsd),
      put_to_work: {
        tokens: t.putToWork.tokens,
        usd: cents(t.putToWork.usd),
        holding_usd: cents(t.putToWork.holdingUsd),
        kept_per_year_usd: cents(t.putToWork.keptPerYearUsd),
        borrow_room_usd: orNull(t.putToWork.borrowRoomUsd),
      },
      refused: { tokens: t.refused.tokens, usd: cents(t.refused.usd), reasons: t.refused.reasons.map((x) => ({ ticker: x.symbol, reason: x.reason })) },
      unpriced: t.unpriced,
    },
    holdings: s.rows.map(scanRow),
    kept_basis: `kept_per_year_usd is put_to_work_usd net of the entry fee at worst_half_apr_pct, the weaker 15-day half of the ${REPLAY.window.days}-day replay to ${REPLAY.window.end.slice(0, 10)}. It measures past swaps. It is not a forecast, a target or a promise.`,
    source: "eth_blockNumber, then one Multicall3 eth_call at that block reading every balanceOf and Chainlink round; read-only",
    next: "prepare_deposit for a holding with can_deposit true",
  };
}

async function scanWalletTool(env: Env, args: Record<string, unknown>, client?: ScanClient): Promise<McpToolResult> {
  const owner = typeof args.address === "string" ? parseOwner(args.address) : null;
  if (!owner) return errorResult("address must be a valid 0x wallet address (42 characters; names such as ENS are not resolved)");
  let scan: WalletScan;
  try {
    scan = await scanWallet(client ?? scanClient(env), owner, scanVaults(), LLTV);
  } catch (e) {
    return errorResult(`could not read Robinhood Chain: ${String((e as Error).message).split("\n")[0].slice(0, 200)}`);
  }
  return textResult(scanPayload(env, scan));
}

interface MarketParams {
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: string;
}

const WAD = 10n ** 18n;

/** The Morpho market configured for a vault, or the reason there is none. Never returns a half-valid market. */
function marketFor(env: Env, id: string, vaultAddress: string | undefined): MarketParams | string {
  let overrides: Record<string, unknown> = {};
  if (env.COLLATERAL_MARKETS) {
    try {
      overrides = JSON.parse(env.COLLATERAL_MARKETS) as Record<string, unknown>;
    } catch {
      return "COLLATERAL_MARKETS is not valid JSON";
    }
  }
  // web/lib/collateral-markets.json holds {oracle, irm, lltv} per vault under "markets"; the loan token is USDG and the collateral token is the deployed vault share.
  const configured = (collateralMarkets as { markets: Record<string, Record<string, unknown>> }).markets[id];
  const fromConfig = configured && vaultAddress ? { loanToken: USDG_ADDRESS, collateralToken: vaultAddress, ...configured } : undefined;
  const raw = (overrides[id] ?? fromConfig) as Record<string, unknown> | undefined;
  if (!raw) return configured ? `${id} has a configured Morpho market but no deployed vault share to use as collateral` : `no Morpho market configured for ${id}`;

  for (const field of ["loanToken", "collateralToken", "oracle", "irm"] as const) {
    if (typeof raw[field] !== "string" || !isAddress(raw[field] as string)) {
      return `collateral market for ${id} has an invalid ${field}`;
    }
  }
  if (typeof raw.lltv !== "string" || !/^\d+$/.test(raw.lltv) || BigInt(raw.lltv) <= 0n || BigInt(raw.lltv) >= WAD) {
    return `collateral market for ${id} has an invalid lltv (wad string between 0 and 1e18)`;
  }
  const market = raw as unknown as MarketParams;
  if (market.loanToken.toLowerCase() !== USDG_ADDRESS.toLowerCase()) {
    return `collateral market for ${id} does not lend USDG`;
  }
  if (vaultAddress && market.collateralToken.toLowerCase() !== vaultAddress.toLowerCase()) {
    return `collateral market for ${id} is not collateralised by the deployed ${id} vault share`;
  }
  return market;
}

function marketTuple(m: MarketParams) {
  return {
    loanToken: m.loanToken as `0x${string}`,
    collateralToken: m.collateralToken as `0x${string}`,
    oracle: m.oracle as `0x${string}`,
    irm: m.irm as `0x${string}`,
    lltv: BigInt(m.lltv),
  };
}

function marketId(m: MarketParams): `0x${string}` {
  const t = marketTuple(m);
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
      [t.loanToken, t.collateralToken, t.oracle, t.irm, t.lltv],
    ),
  );
}

function getCollateralTerms(env: Env, id: string): McpToolResult {
  const vault = findVault(id);
  if (!vault) return errorResult(`no vault with id "${id}"`);
  const vaultAddress = parseVaults(env.VAULTS)[id];
  const market = marketFor(env, id, vaultAddress);
  if (typeof market === "string") return errorResult(market);
  return textResult({
    network: env.NETWORK ?? null,
    vault: id,
    vault_address: vaultAddress ?? null,
    morpho: MORPHO_BLUE,
    market_id: marketId(market),
    market_params: market,
    lltv_wad: market.lltv,
    lltv_pct: Number(formatUnits(BigInt(market.lltv), 16)),
    collateral: "Uptick vault share (24 decimals)",
    loan: "USDG (6 decimals)",
  });
}

async function prepareEarnAndBorrow(env: Env, args: Record<string, unknown>): Promise<McpToolResult> {
  const id = typeof args.id === "string" ? args.id : "";
  // Reuse the deposit rules: unknown or closed vault, bad receiver or amount, no deployed vault, reduced-gate cap.
  const deposit = prepareDeposit(env, { ...args, asset: "stock" });
  if (deposit.isError) return deposit;

  const vaultAddress = parseVaults(env.VAULTS)[id] as `0x${string}`;
  const market = marketFor(env, id, vaultAddress);
  if (typeof market === "string") return errorResult(market);

  const borrow = parseAmount(args.borrow_usdg, USDG_DECIMALS, "borrow_usdg");
  if (typeof borrow === "string") return errorResult(borrow);
  if (!env.RPC_URL) {
    return errorResult("no RPC configured to preview the vault shares, so no collateral amount can be computed");
  }

  const amount = parseUnits((args.amount as string).trim(), STOCK_DECIMALS);
  const receiver = args.receiver as `0x${string}`;
  const client = createPublicClient({ transport: http(env.RPC_URL) });
  let previewShares: bigint;
  let price: bigint;
  let liquidity: bigint;
  try {
    [previewShares, price, liquidity] = await Promise.all([
      client.readContract({ address: vaultAddress, abi: VAULT_READ_ABI, functionName: "previewDeposit", args: [amount] }),
      client.readContract({ address: market.oracle as `0x${string}`, abi: ORACLE_ABI, functionName: "price" }),
      client
        .readContract({ address: MORPHO_BLUE, abi: MORPHO_ABI, functionName: "market", args: [marketId(market)] })
        .then(([supplied, , borrowed]) => supplied - borrowed),
    ]);
  } catch (error) {
    return errorResult(`on-chain read failed, no calldata returned: ${(error as Error).message.split("\n")[0]}`);
  }

  const collateral = previewShares - (previewShares * SHARE_HAIRCUT_BPS) / 10000n;
  if (collateral <= 0n) return errorResult("the deposit mints no shares, no calldata returned");
  // Morpho health: collateral * price / 1e36 * lltv / 1e18, rounded down.
  const maxBorrow = (((collateral * price) / 10n ** 36n) * BigInt(market.lltv)) / WAD;
  if (borrow > maxBorrow) {
    return errorResult(
      `borrow_usdg ${args.borrow_usdg} exceeds the ${formatUnits(maxBorrow, USDG_DECIMALS)} USDG this deposit supports at the ${formatUnits(BigInt(market.lltv), 16)}% LLTV`,
    );
  }
  if (borrow > liquidity) {
    return errorResult(
      `borrow_usdg ${args.borrow_usdg} exceeds the ${formatUnits(liquidity, USDG_DECIMALS)} USDG available to borrow in the market`,
    );
  }

  const params = marketTuple(market);
  const transactions: Tx[] = [
    ...(deposit.structuredContent.transactions as Tx[]),
    tx(
      vaultAddress,
      encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [MORPHO_BLUE, collateral] }),
      `Approve ${formatUnits(collateral, SHARES_DECIMALS)} ${id} vault shares to Morpho Blue`,
    ),
    tx(
      MORPHO_BLUE,
      encodeFunctionData({ abi: MORPHO_ABI, functionName: "supplyCollateral", args: [params, collateral, receiver, "0x"] }),
      `Supply ${formatUnits(collateral, SHARES_DECIMALS)} ${id} vault shares as collateral on Morpho Blue`,
    ),
    tx(
      MORPHO_BLUE,
      encodeFunctionData({ abi: MORPHO_ABI, functionName: "borrow", args: [params, borrow, 0n, receiver, receiver] }),
      `Borrow ${args.borrow_usdg} USDG against the ${id} vault shares, sent to ${receiver}`,
    ),
  ];

  const payload: Record<string, unknown> = {
    ...deposit.structuredContent,
    transactions,
    sender_must_be: receiver,
    shares_preview: formatUnits(previewShares, SHARES_DECIMALS),
    collateral_shares: formatUnits(collateral, SHARES_DECIMALS),
    borrow_usdg: String(args.borrow_usdg),
    max_borrow_usdg: formatUnits(maxBorrow, USDG_DECIMALS),
    market_id: marketId(market),
    lltv_pct: Number(formatUnits(BigInt(market.lltv), 16)),
  };
  delete payload.asset;
  return textResult(payload);
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

const TOOLS: McpTool[] = [
  {
    name: "list_vaults",
    description:
      "List every Uptick stock vault with its gate state (open, reduced, closed), fee APR, kept APR, and the gate reason.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_vault_evidence",
    description:
      "Full evidence for one vault: the replay pools, the gate rule and reason, the replay window, and the swap count, with a source URL.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Vault id, for example nvda." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "scan_wallet",
    description:
      "Read-only. For a wallet address, read its balances of all tracked Stock Tokens from Robinhood Chain (one Multicall3 call at one block), price them with the Chainlink feeds the vaults use, and return per token: the holding in USD, the vault's gate state and reason, what the holding would have kept a year at the weaker-half kept APR of the replay (a measurement of past swaps, never a forecast), and borrow room at the Morpho market's loan-to-value limit where a market is configured, otherwise opens_with_market. Totals give idle value, what the open and reduced vaults take (a vault takes at most its size), and what the closed vaults refuse with their reasons. Holdings are only the tokens the wallet holds. Use prepare_deposit for a holding with can_deposit true.",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", description: "0x wallet address to read. No signature or connection is needed." } },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: "prepare_deposit",
    description:
      "Build the unsigned transactions for a deposit into an open vault. Refuses closed vaults and returns the gate reason. Refuses an amount above the vault's deposit_cap_usd (its size, set from the pool's depth) or, for a reduced vault, above its per-transaction cap, whichever is lower; the vault contract also enforces the cap on-chain against its total. Asset is stock (approve the stock token then ERC4626 deposit) or usdg (approve USDG then zap through the Uptick router: depositUsdg for a Uniswap v3 vault, depositUsdgV4 for a Uniswap v4 vault, see venue). The vault keeps an entry fee (the larger of the pool's fee tier and 0.35%, returned as entry_fee_bps) out of every deposit, for the holders who stay; shares are minted against the amount net of it. The user signs and sends.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Vault id, for example nvda." },
        amount: { type: "string", description: "Decimal amount in token units." },
        receiver: { type: "string", description: "0x address that receives the vault shares." },
        asset: { type: "string", enum: ["stock", "usdg"], default: "stock" },
      },
      required: ["id", "amount", "receiver"],
      additionalProperties: false,
    },
  },
  {
    name: "prepare_withdraw",
    description:
      "Build the unsigned exit transaction for a vault on either venue (Uniswap v3 StockVault or Uniswap v4 StockVaultV4): ERC4626 redeem by default, or redeemInKind with mode in_kind. Share amounts are 24 decimals (18 plus the vault offset of 6). The user signs and sends.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Vault id, for example nvda." },
        shares: { type: "string", description: "Decimal share amount, 24 decimals." },
        receiver: { type: "string", description: "0x address that receives the underlying stock token (redeem) or both tokens (in_kind)." },
        mode: { type: "string", enum: ["redeem", "in_kind"], default: "redeem", description: "redeem: ERC4626 redeem into the stock token, priced to the oracle. in_kind: your slice of both the stock token and USDG, no oracle read, never gated." },
      },
      required: ["id", "shares", "receiver"],
      additionalProperties: false,
    },
  },
  {
    name: "get_collateral_terms",
    description:
      "Morpho Blue market for using a vault share as collateral against USDG: market params, market id and LLTV. Errors with the reason when no market is configured for the vault.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Vault id, for example nvda." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "check_loan_health",
    description:
      "Read a wallet's Morpho Blue loan against an Uptick vault share, live from the chain: collateral shares and their value, the debt with interest accrued to the latest block, health factor, the share price at which the loan liquidates and how far the share can fall first. A vault with no Morpho market, or a wallet with no position, answers with has_market or has_position false and the reason.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x address of the borrower." },
        vault: { type: "string", description: "Vault id, for example nvda." },
      },
      required: ["address", "vault"],
      additionalProperties: false,
    },
  },
  {
    name: "prepare_earn_and_borrow",
    description:
      "Build the unsigned transactions to deposit a stock token into an open vault, supply the shares as Morpho Blue collateral and borrow USDG, in order: approve, deposit, approve shares, supplyCollateral, borrow. The collateral amount is the previewed share mint minus 0.1%, and the borrow is refused above what the LLTV allows or the market holds. No deployed vault, no configured market or no RPC means no calldata and a reason. The receiver must sign every transaction. The user signs and sends.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Vault id, for example nvda." },
        amount: { type: "string", description: "Decimal amount of the stock token to deposit." },
        borrow_usdg: { type: "string", description: "Decimal USDG amount to borrow." },
        receiver: { type: "string", description: "0x address that owns the shares, the collateral and the loan, and receives the USDG." },
      },
      required: ["id", "amount", "borrow_usdg", "receiver"],
      additionalProperties: false,
    },
  },
  {
    name: "prepare_make_safer",
    description:
      "Build the unsigned calls that take a Morpho Blue loan on an Uptick vault share to a target health factor (default 1.6) with the least action. If the wallet holds the USDG: approve and repay. If it does not: rounds of withdrawCollateral, vault redeemInKind and repay with the USDG leg, the stock leg returning to the wallet. Sized on the debt ten minutes ahead. With no market, no position, a loan already at the target or a target out of reach, transactions is empty and reason says why. The user signs and sends the calls in order.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x address of the borrower." },
        vault: { type: "string", description: "Vault id, for example nvda." },
        target_health: { type: "number", minimum: 1.05, maximum: 5, default: 1.6, description: "Health factor to reach." },
      },
      required: ["address", "vault"],
      additionalProperties: false,
    },
  },
  {
    name: "plan_weekend_hedge",
    description:
      "Read-only. Sizes and prices a weekend short of the matching Stock Token perp on Lighter's Robinhood Chain exchange. source wallet sizes it from the Stock Tokens the wallet holds (vault optional, otherwise the largest holding Lighter lists a perp for); source loan sizes it from the stock leg of the vault shares the wallet posted as Morpho collateral (vault required). Shares use the token's on-chain ERC-8056 multiplier. Lighter is read live: funding over the weekend hours (a history of the last 28 days, never a forecast) as fundingBp with fundingDirection earns or pays, order-book slippage at the exact size as slippageBp, margin interest as marginCostBp when the margin is borrowed, whether Lighter accepts the token as margin (marginEligible, userCapTokens), the close (Friday US close) and the default unwind (30 minutes before the Monday US open), and a handoffUrl to the market on Lighter. It places nothing and returns no calldata: the holder enters the short on Lighter. If Lighter does not answer cleanly, isError carries its code and no plan is returned. A wallet with no holding, or one Lighter lists no perp for, answers with the reason.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x address of the holder or borrower." },
        source: { type: "string", enum: ["wallet", "loan"], default: "wallet", description: "wallet: size from Stock Token balances. loan: size from the stock leg of vault shares posted as Morpho collateral." },
        vault: { type: "string", description: "Vault id, for example nvda. Required for source loan; for source wallet it picks the token." },
        leverage: { type: "number", minimum: 1, maximum: 20, default: 5, description: "Leverage for the short, default 5, up to the market's maximum (1 / min initial margin); above it the tool returns an error." },
      },
      required: ["address"],
      additionalProperties: false,
    },
  },
];

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: string | number | null, result: unknown): Response {
  return json({ jsonrpc: "2.0", id, result });
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
): Response {
  return json({ jsonrpc: "2.0", id, error: { code, message } });
}

function loanTool(env: Env, args: Record<string, unknown>, deps: LoanToolDeps, run: (vaultId: string, deps: LoanToolDeps) => Promise<LoanToolResult>): Promise<McpToolResult> | McpToolResult {
  const id = typeof args.vault === "string" ? args.vault : "";
  if (!findVault(id)) return errorResult(`no vault with id "${id}"`);
  return run(id, deps).then(({ payload, steps, isError }) =>
    textResult(steps.length ? { ...payload, network: env.NETWORK ?? null, transactions: steps.map((s) => tx(s.call.to, s.call.data, s.label)) } : payload, isError));
}

async function callTool(
  env: Env,
  name: unknown,
  args: Record<string, unknown>,
  deps: McpDeps,
): Promise<McpToolResult> {
  switch (name) {
    case "list_vaults":
      return listVaults();
    case "get_vault_evidence":
      return getVaultEvidence(typeof args.id === "string" ? args.id : "");
    case "scan_wallet":
      return scanWalletTool(env, args, deps.scanClient);
    case "prepare_deposit":
      return prepareDeposit(env, args);
    case "prepare_withdraw":
      return prepareWithdraw(env, args);
    case "get_collateral_terms":
      return getCollateralTerms(env, typeof args.id === "string" ? args.id : "");
    case "prepare_earn_and_borrow":
      return prepareEarnAndBorrow(env, args);
    case "check_loan_health":
      return loanTool(env, args, deps.loan ?? {}, (id, d) => checkLoanHealth(env, id, args.address, d));
    case "prepare_make_safer":
      return loanTool(env, args, deps.loan ?? {}, (id, d) => prepareMakeSafer(env, id, args.address, args.target_health, d));
    case "plan_weekend_hedge": {
      const { payload, isError } = await planWeekendHedge({ env, vaults: scanVaults(), defaultClient: () => scanClient(env), deps }, args);
      return textResult(payload, isError);
    }
    default: {
      const result = errorResult(`unknown tool: ${String(name)}`);
      return result;
    }
  }
}

/** Injection point for tests: a client that answers the scan's RPC calls without a network. */
export interface McpDeps {
  scanClient?: ScanClient;
  /** A client and market list for the loan tools; a test stands in for the node with it. */
  loan?: LoanToolDeps;
  /** plan_weekend_hedge reads Lighter's Robinhood Chain API through this; the global fetch when absent. */
  lighterFetch?: typeof fetch;
  /** Wall clock in ms for plan_weekend_hedge's funding window and weekend; Date.now when absent. */
  now?: () => number;
}

export async function handleMcp(request: Request, env: Env, deps: McpDeps = {}): Promise<Response> {
  let message: JsonRpcMessage;
  try {
    message = (await request.json()) as JsonRpcMessage;
  } catch {
    return rpcError(null, -32700, "parse error");
  }

  const id = message.id ?? null;
  const isNotification = message.id === undefined || message.id === null;

  if (message.method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
  }

  if (isNotification) {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (message.method === "tools/list") {
    return rpcResult(id, { tools: TOOLS });
  }

  if (message.method === "tools/call") {
    const params = message.params ?? {};
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    if (typeof params.name !== "string") {
      return rpcError(id, -32602, "invalid params: name is required");
    }
    const known = TOOLS.some((tool) => tool.name === params.name);
    if (!known) {
      return rpcError(id, -32602, `unknown tool: ${params.name}`);
    }
    return rpcResult(id, await callTool(env, params.name, args, deps));
  }

  return rpcError(id, -32601, `method not found: ${String(message.method)}`);
}
