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
