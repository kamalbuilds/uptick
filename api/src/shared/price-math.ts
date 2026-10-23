/** Chainlink answer to dollars. No imports, so node's test runner loads it directly. */

/** A feed answer is a signed integer scaled by the feed's decimals. A zero or negative answer is a broken round, not a price. */
export function feedUsd(answer: bigint, decimals: number): number | null {
  if (answer <= 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const n = Number(answer) / 10 ** decimals;
  return Number.isFinite(n) ? n : null;
}

/** "$217.02", "$1,234.50", "$0.0421". */
export function priceLabel(usd: number): string {
  if (!Number.isFinite(usd)) return "n/a";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: usd < 1 ? 4 : 2, maximumFractionDigits: usd < 1 ? 4 : 2 }).format(usd);
}

/** Seconds since a feed round, from its unix updatedAt. Never negative. */
export const feedAgeSeconds = (updatedAtSec: number, nowMs: number): number => Math.max(0, Math.round(nowMs / 1000 - updatedAtSec));

/** "12s", "9m", "9h", "2d": how old a feed round is. */
export function feedAgeLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}
