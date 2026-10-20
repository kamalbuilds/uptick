import { REDUCED_CAP_STOCK_USD } from "./evidence.ts";

/** A reduced vault's per-deposit cap: the global stock cap, or the vault's own size when it is smaller. */
export function perDepositLimitUsd(depositCapUsd: number): number {
  return Math.min(REDUCED_CAP_STOCK_USD, depositCapUsd);
}

export function usd(n: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "n/a";
  const compact = opts.compact ?? Math.abs(n) >= 100_000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : Math.abs(n) < 1 ? 4 : 2,
  }).format(n);
}

/** Whole dollars, never compacted: a size or a cap, "$100,000". */
export const usdWhole = (n: number): string => (Number.isFinite(n) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n) : "n/a");

/** Input is a percent: 40.557 renders as 40.6%. */
export function pct(percent: number, digits = 1): string {
  if (!Number.isFinite(percent)) return "n/a";
  return `${percent.toFixed(digits)}%`;
}

/** Percent with an explicit plus on gains: 2.513 renders as +2.5%. */
export const signed = (percent: number, digits = 1): string => `${percent > 0 ? "+" : ""}${pct(percent, digits)}`;

export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a;
}

export function num(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "n/a";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
}

export function dateShort(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** "5.1 million" from a swap count; "842,504" below a million. */
export function swapsLabel(swaps: number): string {
  return swaps >= 1_000_000 ? `${(swaps / 1_000_000).toFixed(1)} million` : swaps.toLocaleString("en-US");
}

/** Landing and metadata line, built from the vault list so it never names a fixed pair of tokens. */
export function pitchLine(vaultCount: number, replayedSwaps: number): string {
  return `Deposit any of ${vaultCount} Stock Tokens and earn a share of every trade’s fee. Uptick shows what you earn and what you keep after losses to fast traders, and opens a vault only where ${swapsLabel(replayedSwaps)} past trades say it holds up.`;
}

export type Room = { tokens: number; source: "vault" | "size"; over: boolean };

/** How much more a vault accepts. The vault's own `maxDeposit` (remaining capacity under its depositCap, 0 when paused) when it is
 *  deployed and readable; type(uint256).max means uncapped, and then the dollar size still applies. Otherwise the vault's size in
 *  dollars over the stock price, which is the whole cap with nothing yet deposited. Null when neither is known. */
export function depositRoom(amount: bigint | null, max: bigint | undefined, capUsd: number, priceUsd: number | undefined, decimals = 18): Room | null {
  const UNCAPPED = 2n ** 256n - 1n;
  if (max !== undefined && max !== UNCAPPED) return { tokens: Number(max) / 10 ** decimals, source: "vault", over: amount !== null && amount > max };
  if (priceUsd === undefined || !(priceUsd > 0) || !(capUsd > 0)) return null;
  const tokens = capUsd / priceUsd;
  return { tokens, source: "size", over: amount !== null && Number(amount) / 10 ** decimals > tokens };
}

/** What the 25/50/75/Max chips fill: `percent` of `max` in base units, rounded down. Undefined when there is no balance to take a share of. */
export function shareOfBalance(max: bigint | undefined, percent: number): bigint | undefined {
  if (max === undefined || max <= 0n || !Number.isInteger(percent) || percent < 1 || percent > 100) return undefined;
  return percent === 100 ? max : (max * BigInt(percent)) / 100n;
}
