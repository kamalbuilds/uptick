import { describe, expect, test } from "bun:test";
import { KEEP_FLOOR_APR, MIN_TABLE_VOLUME_USD, buildEvidence, depositGate, feeLabel, replayFeeApr } from "../src/evidence.ts";
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

    test(`${sym}: keep figures are finite and pool labels are unique`, () => {
      const ev: any = buildEvidence(replay.tokens[sym], replay);
      for (const v of Object.values(ev.keep)) expect(Number.isFinite(v)).toBe(true);
      const labels = ev.pools.map((p: any) => p.label);
      expect(new Set(labels).size).toBe(labels.length);
      expect(ev.open).toBe(Math.min(ev.keep.kept_first_half, ev.keep.kept_second_half) >= KEEP_FLOOR_APR);
    });
  }

  test("the deposit-taking set is exactly AMZN, GOOGL, NVDA and SPY", () => {
    const open = syms.filter((s) => (buildEvidence(replay.tokens[s], replay) as any).open).sort();
    expect(open).toEqual(["AMZN", "GOOGL", "NVDA", "SPY"]);
  });

  test("NVDA clears break-even on its weaker half, so its gate is open with no cap", () => {
    const ev: any = buildEvidence(replay.tokens.NVDA, replay);
    expect(ev.gate.state).toBe("open");
    expect(ev.open).toBe(true);
    expect(ev.gate.reason).toContain("Open");
    expect(ev.gate.reason).not.toContain("capped");
    expect(ev.gate.reason).toContain(ev.gate.worst_half_apr.toFixed(1));
    expect(ev.gate.worst_half_apr).toBe(Math.min(ev.keep.kept_first_half, ev.keep.kept_second_half));
    expect(ev.gate.floor_apr).toBe(KEEP_FLOOR_APR);
    expect(ev.gate.swaps).toBe(replay.tokens.NVDA.swaps_replayed);
    expect(ev.gate.days).toBe(replay.window.days);
  });

  test("GOOGL sits between the floor and break-even, so its gate is reduced and names the weaker half", () => {
    const ev: any = buildEvidence(replay.tokens.GOOGL, replay);
    expect(ev.gate.state).toBe("reduced");
    expect(ev.open).toBe(true);
    expect(ev.gate.reason).toContain("Reduced");
    expect(ev.gate.reason).toContain("capped at $25,000");
    expect(ev.gate.worst_half_apr).toBe(Math.min(ev.keep.kept_first_half, ev.keep.kept_second_half));
  });

  test("every token's gate state matches its weaker half, NVDA is the only open vault, AMZN, GOOGL and SPY are reduced", () => {
    for (const s of syms) {
      const ev: any = buildEvidence(replay.tokens[s], replay);
      const worst = ev.gate.worst_half_apr;
      expect(ev.gate.state).toBe(worst >= 0 ? "open" : worst >= KEEP_FLOOR_APR ? "reduced" : "closed");
      expect(ev.gate.reason.startsWith(ev.gate.state === "open" ? "Open" : ev.gate.state === "reduced" ? "Reduced" : "Closed")).toBe(true);
    }
    const reduced = syms.filter((s) => (buildEvidence(replay.tokens[s], replay) as any).gate.state === "reduced").sort();
    expect(reduced).toEqual(["AMZN", "GOOGL", "SPY"]);
    const opened = syms.filter((s) => (buildEvidence(replay.tokens[s], replay) as any).gate.state === "open").sort();
    expect(opened).toEqual(["NVDA"]);
    const closed = syms.filter((s) => (buildEvidence(replay.tokens[s], replay) as any).gate.state === "closed").sort();
    expect(closed).toEqual(["CRCL", "SPCX", "USO"]);
  });

  test("a half at or above break-even opens the gate outright, with no cap", () => {
    const open = depositGate(3.2, 120_000, 30);
    expect(open.state).toBe("open");
    expect(open.reason).toContain("Open");
    expect(open.reason).not.toContain("capped");
    const reduced = depositGate(-0.4, 120_000, 30);
    expect(reduced.state).toBe("reduced");
    expect(reduced.reason).toContain("capped at $25,000");
  });

  test("CRCL's gate is closed and states the floor it missed", () => {
    const ev: any = buildEvidence(replay.tokens.CRCL, replay);
    expect(ev.gate.state).toBe("closed");
    expect(ev.open).toBe(false);
    expect(ev.gate.reason).toContain("Closed");
    expect(ev.gate.reason).toContain(ev.gate.worst_half_apr.toFixed(1));
    expect(ev.gate.worst_half_apr).toBeLessThan(KEEP_FLOOR_APR);
  });

  test("a zero floor would close GOOGL", () => {
    const ev: any = buildEvidence(replay.tokens.GOOGL, replay);
    const flipped = depositGate(ev.gate.worst_half_apr, ev.gate.swaps, ev.gate.days, 0);
    expect(flipped.state).toBe("closed");
    expect(flipped.reason).toContain("Closed");
  });

  test("the path-mode weaker half is exposed beside the conservative one", () => {
    for (const s of syms) {
      const ev: any = buildEvidence(replay.tokens[s], replay);
      const row = replay.tokens[s].pools.find((p: any) => p.id === ev.chosen_pool);
      expect(Number.isFinite(ev.keep.kept_apr_upper)).toBe(true);
      expect(ev.keep.kept_first_half_upper).toBe(row.calibration.edge_apr_pct_upper);
      expect(ev.keep.kept_second_half_upper).toBe(row.test.edge_apr_pct_upper);
      expect(ev.keep.kept_apr_upper).toBe(Math.min(ev.keep.kept_first_half_upper, ev.keep.kept_second_half_upper));
    }
  });

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
