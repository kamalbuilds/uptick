import { describe, expect, test } from "bun:test";
import { MIN_VAULT_CAP_USD, RULE, VAULT_CAPITAL_USD, bandDepthUsd, eligibility, feedSymbol, rowVerdict, valuePerLiquidity, vaultCapUsd, vaultShare } from "../src/universe.ts";
import { readUniverse } from "../src/registry.ts";

const good = { hasCode: true, hasFeed: true, feedOk: true, feedAgeS: 40_000, poolFound: true, volume7dUsdPerDay: 5_000_000, capUsd: VAULT_CAPITAL_USD, feedDeviationBps: 5 };

describe("liquidity math", () => {
  test("USD value of one unit of liquidity over +-5% matches the replay engine's lv_for", () => {
    // spikes/stock-vaults/scripts/engine.py lv_for(1e5, P, 0.95P, 1.05P): 1e5 / L, printed from the engine
    expect(valuePerLiquidity(100)).toBeCloseTo(0.4942049257057046, 12);
    expect(valuePerLiquidity(214.5)).toBeCloseTo(0.7238035651538135, 12);
    expect(valuePerLiquidity(3.7)).toBeCloseTo(0.09506221551118985, 12);
  });
  test("raw pool liquidity converts through 1e-12 and the band value", () => {
    expect(bandDepthUsd(2_000_000_000_000_000n, 100)).toBeCloseTo(2e15 * 1e-12 * 0.4942049257057046, 6);
  });
  test("vault share of in-range liquidity", () => {
    expect(vaultShare(900_000)).toBeCloseTo(0.1, 12);
    expect(vaultShare(0)).toBe(1);
  });
});

describe("vault size from pool depth", () => {
  test("a deep pool carries the full vault", () => {
    expect(vaultCapUsd(1_612_210)).toBe(VAULT_CAPITAL_USD);
    expect(vaultCapUsd(400_000)).toBe(VAULT_CAPITAL_USD); // 400K * 0.2 / 0.8 = 100K exactly
  });
  test("a thin pool gets depth * share / (1 - share), rounded down, and that size holds exactly the max share or less", () => {
    expect(vaultCapUsd(292_486)).toBe(73_121); // 292,486 / 4 = 73,121.5
    expect(vaultCapUsd(73_687)).toBe(18_421);
    for (const depth of [73_687, 96_449, 197_000, 292_486, 346_569]) {
      const cap = vaultCapUsd(depth);
      expect(cap).toBeLessThan(VAULT_CAPITAL_USD);
      expect(vaultShare(depth, cap)).toBeLessThanOrEqual(RULE.maxVaultShare);
      expect(vaultShare(depth, cap + 1)).toBeGreaterThan(RULE.maxVaultShare); // the cap is the largest whole-dollar vault
    }
  });
  test("a pool with no depth carries nothing", () => {
    expect(vaultCapUsd(0)).toBe(0);
    expect(vaultCapUsd(NaN)).toBe(0);
    expect(vaultCapUsd(-5)).toBe(0);
  });
});

describe("eligibility rule", () => {
  test("passes a deep, busy, fresh pool", () => expect(eligibility(good)).toEqual({ eligible: true, reason: "feed, volume and depth pass" }));
  test("each condition alone rejects, with its own reason", () => {
    const cases: [Partial<typeof good>, string][] = [
      [{ hasCode: false }, "no contract code"],
      [{ hasFeed: false }, "no Chainlink feed"],
      [{ feedOk: false }, "unreadable"],
      [{ poolFound: false }, "no USDG pool"],
      [{ feedAgeS: RULE.maxFeedAgeS + 1 }, "older than"],
      [{ volume7dUsdPerDay: RULE.minVolume7dUsdPerDay - 1 }, "7-day volume"],
      [{ capUsd: MIN_VAULT_CAP_USD - 1 }, "below the $10.0K minimum"],
      [{ capUsd: null }, "below the $10.0K minimum"],
      [{ feedDeviationBps: RULE.maxFeedDeviationBps + 1 }, "differs from Chainlink"],
      [{ feedDeviationBps: -(RULE.maxFeedDeviationBps + 1) }, "differs from Chainlink"],
    ];
    for (const [patch, why] of cases) {
      const r = eligibility({ ...good, ...patch });
      expect(r.eligible).toBe(false);
      expect(r.reason).toContain(why);
    }
  });
  test("thresholds sit exactly on the boundary", () => {
    expect(eligibility({ ...good, volume7dUsdPerDay: RULE.minVolume7dUsdPerDay }).eligible).toBe(true);
    expect(eligibility({ ...good, capUsd: MIN_VAULT_CAP_USD }).eligible).toBe(true);
  });
  test("a pool too thin for a USD 10K vault is excluded with the size it could carry, derived from its depth", () => {
    const depth = 30_000, cap = vaultCapUsd(depth); // 7,500
    expect(cap).toBe(7_500);
    const r = eligibility({ ...good, capUsd: cap });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("pool depth carries a vault of at most $7.5K at 20% of in-range liquidity, below the $10.0K minimum");
  });
  test("a capped vault says so, an uncapped one does not", () => {
    expect(eligibility({ ...good, capUsd: 73_121 }).reason).toBe("feed and volume pass; vault capped at $73.1K to stay within 20% of in-range liquidity");
    expect(eligibility({ ...good, capUsd: VAULT_CAPITAL_USD }).reason).toBe("feed, volume and depth pass");
  });
});

describe("feed names", () => {
  test("Robinhood equity feeds map to a ticker, crypto and wrapped feeds do not", () => {
    expect(feedSymbol("Robinhood NVDA / USD")).toBe("NVDA");
    expect(feedSymbol("Robinhood DELL-USD")).toBe("DELL");
    expect(feedSymbol("Robinhood SGOV-USD")).toBe("SGOV");
    for (const n of ["GLD / USD", "BTC.B / USD", "WSTETH / USD", "RHNVDA / USD", "SYRUPUSDC / USDC Exchange Rate"]) expect(feedSymbol(n)).toBeNull();
  });
});

describe("data/universe.json, read from the chain", () => {
  const u = readUniverse();
  const by = (s: string) => u.tokens.find((t: any) => t.symbol === s);
  test("covers the whole registry and the verdicts are the rule's output", () => {
    expect(u.tokens.length).toBeGreaterThanOrEqual(190);
    expect(u.tokens.every((t: any) => t.has_code)).toBe(true);
    for (const t of u.tokens) expect(rowVerdict(t)).toEqual({ eligible: t.eligible, reason: t.reason });
  });
  test("NVDA gets the full vault; TSLA clears feed and volume and is admitted at a vault sized to its pool", () => {
    expect(by("NVDA").eligible).toBe(true);
    expect(by("NVDA").cap_usd).toBe(VAULT_CAPITAL_USD);
    expect(by("TSLA").eligible).toBe(true);
    expect(by("TSLA").pool.volume_usd_per_day).toBeGreaterThanOrEqual(RULE.minVolume7dUsdPerDay);
    expect(by("TSLA").pool.vault_share_100k).toBeGreaterThan(RULE.maxVaultShare); // a full USD 100K vault would be too big for it
    expect(by("TSLA").cap_usd).toBeLessThan(VAULT_CAPITAL_USD);
    expect(by("TSLA").cap_usd).toBeGreaterThanOrEqual(MIN_VAULT_CAP_USD);
    expect(by("TSLA").reason).toContain("vault capped at");
  });
  test("cap_usd is the pool depth's cap on every row, and no vault holds more than the max share of its pool", () => {
    const withPool = u.tokens.filter((t: any) => t.pool);
    expect(withPool.length).toBeGreaterThan(50);
    for (const t of withPool) expect(t.cap_usd).toBe(vaultCapUsd(t.pool.depth_usd_5pct));
    for (const t of u.tokens.filter((x: any) => !x.pool)) expect(t.cap_usd).toBeNull();
    const capped = u.tokens.filter((t: any) => t.eligible && t.cap_usd < VAULT_CAPITAL_USD);
    expect(capped.length).toBeGreaterThanOrEqual(5); // thin-pool vaults exist, so the cap math is exercised on real rows
    for (const t of u.tokens.filter((x: any) => x.eligible)) expect(vaultShare(t.pool.depth_usd_5pct, t.cap_usd)).toBeLessThanOrEqual(RULE.maxVaultShare);
  });
  test("a feed token under the volume floor is rejected on volume, and the floor is USD 100K/day", () => {
    expect(RULE.minVolume7dUsdPerDay).toBe(100_000);
    const thin = u.tokens.filter((t: any) => t.feed && t.pool && t.pool.volume_usd_per_day < RULE.minVolume7dUsdPerDay);
    expect(thin.length).toBeGreaterThan(0);
    for (const t of thin) { expect(t.eligible).toBe(false); expect(t.reason).toContain("7-day volume"); }
    const admitted = u.tokens.filter((t: any) => t.feed && t.pool && t.pool.volume_usd_per_day >= RULE.minVolume7dUsdPerDay);
    expect(admitted.some((t: any) => t.pool.volume_usd_per_day < 1_000_000)).toBe(true); // the old USD 1M floor would have dropped these
  });
  test("tokens without a feed are never eligible, whatever their pools carry", () => {
    const noFeed = u.tokens.filter((t: any) => !t.feed);
    expect(noFeed.length).toBeGreaterThan(100);
    expect(noFeed.some((t: any) => t.pool && t.pool.volume_usd_per_day >= RULE.minVolume7dUsdPerDay)).toBe(true); // a busy pool without a feed exists, so this check can fail
    expect(noFeed.every((t: any) => !t.eligible)).toBe(true);
  });
  test("eligible tokens carry pool, feed and a fresh feed read", () => {
    const e = u.tokens.filter((t: any) => t.eligible);
    expect(e.length).toBeGreaterThanOrEqual(3);
    for (const t of e) {
      expect(t.feed.usd).toBeGreaterThan(0);
      expect(t.pool.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(t.cap_usd).toBeGreaterThanOrEqual(MIN_VAULT_CAP_USD);
    }
  });
});

describe("vault names", () => {
  test("share-class boilerplate is dropped, other names are untouched, and it is idempotent", async () => {
    const { cleanName } = await import("../src/universe.ts");
    expect(cleanName("Space Exploration Technologies Corp. Class A Common Stock Stock Token")).toBe("Space Exploration Technologies Corp. Stock Token");
    expect(cleanName("Acme Common Stock Stock Token")).toBe("Acme Stock Token");
    expect(cleanName("NVIDIA Stock Token")).toBe("NVIDIA Stock Token");
    expect(cleanName("Alphabet Class A Stock Token")).toBe("Alphabet Class A Stock Token");
    expect(cleanName(cleanName("Acme Common Stock Stock Token"))).toBe("Acme Stock Token");
  });
});
