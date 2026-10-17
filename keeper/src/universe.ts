/** Universe math and the eligibility rule. Pure functions, no network. See README "Eligibility rule". */

export const VAULT_CAPITAL_USD = 100_000;
export const RANGE_PCT = 5;

/** The rule. A Stock Token is eligible when it has a Chainlink feed AND its deepest USDG pool is deep and busy enough
 *  that a USD 100,000 vault is a small share of it. Thresholds come from the replay: NVDA (about USD 10.5M/day) supports
 *  the vault, TSLA (about USD 0.2M/day) does not. */
export const RULE = {
  minVolume7dUsdPerDay: 1_000_000, // pool volume, 7-day average
  maxVaultShare: 0.2, // the vault's share of in-range liquidity once deposited: V / (depth + V)
  maxFeedDeviationBps: 300, // pool price vs Chainlink at read time
  maxFeedAgeS: 86_400 + 600 + 3 * 86_400, // a feed silent beyond heartbeat plus a long weekend is broken, not closed
};

/** USD value of one unit of canonical liquidity across a +-pct% band around price p (USD per stock). */
export function valuePerLiquidity(p: number, pct = RANGE_PCT): number {
  const pa = p * (1 - pct / 100), pb = p * (1 + pct / 100);
  const sp = Math.sqrt(p);
  return p * (1 / sp - 1 / Math.sqrt(pb)) + (sp - Math.sqrt(pa));
}

/** Canonical liquidity (the replay engine's units): raw pool liquidity x 1e-12 for an 18 dp stock against a 6 dp USDG. */
export const canonicalLiquidity = (rawL: bigint): number => Number(rawL) * 1e-12;

/** USD value of the pool's active liquidity spread across the vault's +-5% band. */
export function bandDepthUsd(rawL: bigint, p: number): number {
  return canonicalLiquidity(rawL) * valuePerLiquidity(p);
}

/** Share of in-range liquidity (hence of fees) the vault holds after depositing `capitalUsd`. */
export function vaultShare(depthUsd: number, capitalUsd = VAULT_CAPITAL_USD): number {
  return capitalUsd / (depthUsd + capitalUsd);
}

export interface EligibilityInput {
  hasCode: boolean;
  hasFeed: boolean;
  feedOk: boolean; // description matches, answer positive
  feedAgeS: number | null;
  poolFound: boolean;
  volume7dUsdPerDay: number | null;
  vaultShare: number | null;
  feedDeviationBps: number | null;
}

/** First failing condition wins; the string is shown in universe.json. */
export function eligibility(i: EligibilityInput, rule = RULE): { eligible: boolean; reason: string } {
  if (!i.hasCode) return { eligible: false, reason: "no contract code at the registry address" };
  if (!i.hasFeed) return { eligible: false, reason: "no Chainlink feed" };
  if (!i.feedOk) return { eligible: false, reason: "Chainlink feed unreadable or non-positive" };
  if (!i.poolFound) return { eligible: false, reason: "no USDG pool with liquidity" };
  if (i.feedAgeS === null || i.feedAgeS > rule.maxFeedAgeS) return { eligible: false, reason: `Chainlink feed older than ${(rule.maxFeedAgeS / 3600).toFixed(0)} h` };
  if (i.volume7dUsdPerDay === null || i.volume7dUsdPerDay < rule.minVolume7dUsdPerDay)
    return { eligible: false, reason: `7-day volume ${fmtUsd(i.volume7dUsdPerDay ?? 0)}/day is below ${fmtUsd(rule.minVolume7dUsdPerDay)}/day` };
  if (i.vaultShare === null || i.vaultShare > rule.maxVaultShare)
    return { eligible: false, reason: `a ${fmtUsd(VAULT_CAPITAL_USD)} vault would hold ${((i.vaultShare ?? 1) * 100).toFixed(0)}% of in-range liquidity, above ${rule.maxVaultShare * 100}%` };
  if (i.feedDeviationBps === null || Math.abs(i.feedDeviationBps) > rule.maxFeedDeviationBps)
    return { eligible: false, reason: `pool price differs from Chainlink by ${i.feedDeviationBps?.toFixed(0)} bps, above ${rule.maxFeedDeviationBps}` };
  return { eligible: true, reason: "feed, volume and depth pass" };
}

export function fmtUsd(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Feed symbol from a Chainlink directory name: "Robinhood NVDA / USD", "Robinhood DELL-USD". Null for non-Robinhood feeds. */
export function feedSymbol(name: string): string | null {
  const m = /^Robinhood ([A-Z0-9.]+)\s*(?:\/|-)\s*USD$/.exec(name.trim());
  return m ? m[1] : null;
}

/** Verdict for a universe.json row (the shape scripts/build-universe.ts writes). */
export function rowVerdict(t: any, rule = RULE): { eligible: boolean; reason: string } {
  const p = t.pool, f = t.feed;
  return eligibility({
    hasCode: t.has_code, hasFeed: !!f, feedOk: !!f && f.usd > 0, feedAgeS: f?.age_s ?? null, poolFound: !!p,
    volume7dUsdPerDay: p?.volume_usd_per_day ?? null, vaultShare: p?.vault_share_100k ?? null, feedDeviationBps: p?.feed_deviation_bps ?? null,
  }, rule);
}

/** Registry names carry share-class boilerplate ("Space Exploration Technologies Corp. Class A Common Stock"); the vault name drops it. Idempotent. */
export const cleanName = (name: string): string => name.replace(/\s+(?:Class [A-Z]\s+)?Common Stock(?=\s+Stock Token$)/i, "");
