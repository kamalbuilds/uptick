import { describe, expect, test } from "bun:test";
import { MIN_TABLE_VOLUME_USD, buildEvidence, feeLabel, replayFeeApr } from "../src/evidence.ts";
import { readReplay } from "../src/registry.ts";

const replay = readReplay();
const syms: string[] = Object.keys(replay.tokens);

describe("evidence built from data/replay.json", () => {
  test("the replay covers several tokens and at least one carries v4 pools", () => {
    expect(syms.length).toBeGreaterThanOrEqual(3);
    expect(syms.some((s) => replay.tokens[s].pools.some((p: any) => p.kind === "v4"))).toBe(true);
  });

  for (const sym of syms) {
    test(`${sym}: chosen pool is one v3 row in a table sorted by fee APR`, () => {
      const tok = replay.tokens[sym], ev: any = buildEvidence(tok, replay);
      expect(ev).not.toBeNull();
      const chosen = ev.pools.filter((p: any) => p.chosen);
      expect(chosen.length).toBe(1);
      expect(chosen[0].pool).toBe(ev.chosen_pool);
      expect(chosen[0].kind).toBe("v3");
      expect(chosen[0].vault_capable).toBe(true);
      expect(chosen[0].fee_apr_pct).toBe(ev.chosen_fee_apr_pct);
      expect(ev.chosen_fee_apr_pct).toBe(replayFeeApr(tok));
      for (let i = 1; i < ev.pools.length; i++) expect(ev.pools[i - 1].fee_apr_pct).toBeGreaterThanOrEqual(ev.pools[i].fee_apr_pct);
      for (const p of ev.pools) {
        expect(p.volume_usd).toBeGreaterThanOrEqual(MIN_TABLE_VOLUME_USD);
        expect(Number.isFinite(p.fee_apr_pct)).toBe(true);
        expect(p.fee_tier).toBeGreaterThan(0);
        expect(p.fee_tier).toBeLessThan(100_000); // dynamic-fee pools are shown at the fee their swaps paid
      }
    });

    test(`${sym}: fee per dollar lost is finite for the three sessions and swaps and window are stated`, () => {
      const ev: any = buildEvidence(replay.tokens[sym], replay);
      for (const k of ["regular", "night", "weekend"]) expect(Number.isFinite(ev.fee_per_loss[k])).toBe(true);
      expect(ev.swaps_replayed).toBeGreaterThan(10_000);
      expect(Date.parse(ev.window.start)).toBeLessThan(Date.parse(ev.window.end));
      expect(ev.window.days).toBe(30);
      expect(ev.out_of_sample.window.days).toBe(15);
      expect(Date.parse(ev.out_of_sample.window.start)).toBe(Date.parse(ev.window.start) + 15 * 86400_000);
    });

    test(`${sym}: edge, markout, cost and net-vs-hold stay out of the evidence`, () => {
      const text = JSON.stringify(buildEvidence(replay.tokens[sym], replay));
      expect(text).not.toMatch(/edge|net_vs_hold|markout_apr|cost_apr/);
    });
  }

  test("a token whose session split has no loss to divide by yields no evidence rather than a null ratio", () => {
    const tok = structuredClone(replay.tokens[syms[0]]);
    tok.sessions.weekend.fee_per_dollar_lost = null;
    expect(buildEvidence(tok, replay)).toBeNull();
  });

  test("fee labels", () => {
    expect(feeLabel(500)).toBe("0.05%");
    expect(feeLabel(3000)).toBe("0.3%");
    expect(feeLabel(100)).toBe("0.01%");
    expect(feeLabel(10000)).toBe("1%");
    expect(feeLabel(0x800000)).toBe("dynamic");
  });
});
