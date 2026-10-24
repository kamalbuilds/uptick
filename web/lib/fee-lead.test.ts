import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FEES_EARNED, KEPT_AFTER, feesLine, feesPerYearUsd, keptLine, leadsWithFees, yieldLines, yieldOrder } from "./fee-lead.ts";
import { TERMS } from "./terms.ts";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const universe = JSON.parse(src("lib/vault-universe.json")) as { vaults: Array<{ id: string; keep: { fee_apr_pct: number }; gate: { worst_half_apr: number } }> };
const byId = (id: string) => universe.vaults.find((v) => v.id === id)!;

test("AAPL and PLTR print the universe's fee figure first and the weaker-half kept figure second, both labelled", () => {
  const aapl = byId("aapl"), pltr = byId("pltr");
  assert.deepEqual(yieldLines(aapl.keep.fee_apr_pct, aapl.gate.worst_half_apr), ["Fees earned 18.7% a year", "Kept after fast traders +2.7% a year"]);
  assert.deepEqual(yieldLines(pltr.keep.fee_apr_pct, pltr.gate.worst_half_apr), ["Fees earned 167.1% a year", "Kept after fast traders +7.9% a year"]);
});

test("a negative kept figure keeps its minus sign and the labels never say APY", () => {
  assert.equal(keptLine(-93.5347), "Kept after fast traders -93.5% a year");
  assert.equal(feesLine(271.7667), "Fees earned 271.8% a year");
  assert.ok(!/APY/i.test(`${FEES_EARNED} ${KEPT_AFTER} ${TERMS.feesEarned.text} ${TERMS.feesEarned.label}`));
});

test("fees a year are earned on the deposit net of the entry fee, the base the kept dollars use", () => {
  // $10,000 into a 1% entry fee vault is worth $9,900; at 18.7374% that is $1,855.00 a year.
  assert.ok(Math.abs(feesPerYearUsd(10_000, 100, byId("aapl").keep.fee_apr_pct) - 1855.00) < 0.01);
  assert.equal(feesPerYearUsd(0, 100, 50), 0);
});

// A surface that prints the fee figure must print kept after fast traders beside it. Detected on source: a file that formats the fee APR
// without KEPT_AFTER, the YieldPair that carries both, or the kept gloss is a fee figure standing alone.
const printsFee = (s: string) => /keep\.feeApr|feeAprOf|FEE_APR|id="feesEarned"/.test(s);
const printsKept = (s: string) => /KEPT_AFTER|<YieldPair/.test(s);
const FEE_SURFACES = ["components/vault-detail.tsx", "components/vault-list.tsx", "components/idle-finder.tsx", "components/yield-pair.tsx"];

test("every surface that leads with the fee figure carries the kept line beside it", () => {
  for (const f of FEE_SURFACES) {
    const s = src(f);
    assert.ok(printsFee(s), `${f} no longer prints a fee figure, so the surface list is stale`);
    assert.ok(printsKept(s), `${f} prints a fee figure without kept after fast traders`);
  }
});

test("the detector fails on a fee figure printed alone", () => {
  const alone = `export const A = ({ cfg }) => <Term id="feesEarned" /> {pct(cfg.keep.feeApr)} a year`;
  assert.ok(printsFee(alone) && !printsKept(alone));
});

test("the hero and the list's panel can only print the fee through the pair, which requires the kept figure", () => {
  const pair = src("components/yield-pair.tsx");
  assert.match(pair, /keptApr: number/, "keptApr is a required prop");
  for (const f of ["components/vault-detail.tsx"]) assert.ok(!/pct\(cfg\.keep\.feeApr\)/.test(src(f)), `${f} prints the fee outside the pair`);
  assert.match(src("components/vault-detail.tsx"), /<YieldPair[^>]*keptApr=\{worst\}/, "the hero passes the weaker-half figure the gate reads");
});

test("the gate still reads the weaker half, not the fee", () => {
  assert.match(src("lib/vaults.ts"), /worstHalfApr: v\.gate\.worst_half_apr/);
  for (const f of FEE_SURFACES.slice(0, 3)) assert.ok(!/state[^;\n]*feeApr|feeApr[^;\n]*state/.test(src(f).replace(/\{feeUsd[^\n]*/g, "")), `${f} derives a gate from the fee`);
});

test("a vault that kept less than nothing never headlines the fee figure; zero and positive kept lead with the fee", () => {
  const negative = universe.vaults.filter((v) => v.gate.worst_half_apr < 0), nonNegative = universe.vaults.filter((v) => v.gate.worst_half_apr >= 0);
  assert.ok(negative.length >= 5 && nonNegative.length >= 3, `the rule is exercised on both sides: ${negative.length} negative, ${nonNegative.length} not`);
  for (const v of negative) assert.deepEqual(yieldOrder(v.gate.worst_half_apr), ["kept", "fees"], `${v.id} kept ${v.gate.worst_half_apr} but leads with the fee`);
  for (const v of nonNegative) assert.deepEqual(yieldOrder(v.gate.worst_half_apr), ["fees", "kept"], `${v.id} kept ${v.gate.worst_half_apr} but does not lead with the fee`);
  assert.equal(leadsWithFees(0), true);
  assert.equal(leadsWithFees(-0.01), false);
  assert.deepEqual(yieldOrder(byId("nvda").gate.worst_half_apr), ["kept", "fees"]);
  assert.deepEqual(yieldOrder(byId("aapl").gate.worst_half_apr), ["fees", "kept"]);
});

test("the pair and the /check cell take their headline from yieldOrder, never a fixed fee-first order", () => {
  const pair = src("components/yield-pair.tsx"), cell = src("components/idle-finder.tsx");
  assert.match(pair, /yieldOrder\(keptApr\)/);
  assert.equal((pair.match(/line\[order\[0\]\]/g) ?? []).length, 2, "hero and side both print order[0] as the headline");
  assert.match(cell, /yieldOrder\(r\.worstHalfApr\)/);
  assert.match(cell, /yieldOrder\(lead\.worstHalfApr\)/, "the ticket orders its two rows by the same rule");
  assert.ok(!/data-lead="fees"/.test(pair + cell), "no fixed fee headline");
});
