import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseVaultStats } from "./keeper.ts";
import { parseEvidence } from "./evidence.ts";

const fx = (f: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), "utf8"));

test("the keeper's /vaults list parses, every vault carries its replay APR and 30-day window, best first", () => {
  const { count, vaults } = fx("vault-list.json");
  assert.equal(count, vaults.length);
  assert.ok(vaults.length >= 4, "the list is the eligible set, not two hard-coded vaults");
  const rows = vaults.map(parseVaultStats);
  for (const r of rows) {
    assert.equal(r.source, "replay");
    assert.equal(r.aprWindowDays, 30);
    assert.ok(r.feeAprPct > 0);
    assert.equal(r.tvlUsd, null);
    assert.equal(r.chart, null);
  }
  const aprs = rows.map((r: { feeAprPct: number }) => r.feeAprPct);
  assert.deepEqual([...aprs].sort((a, b) => b - a), aprs);
  assert.equal(new Set(rows.map((r: { id: string }) => r.id)).size, rows.length);
});

test("each list entry's evidence parses and names a pool that is in its own table", () => {
  for (const v of fx("vault-list.json").vaults) {
    const e = parseEvidence(v.evidence);
    assert.ok(e.pools.length >= 1);
    assert.ok(e.pools.some((p: { pool: string }) => p.pool === e.chosenPool));
    assert.equal(e.chosenPool, v.pool);
    assert.ok(e.swapsReplayed > 10_000);
  }
});

test("a factory vault with no deposits yet reports null realized APRs and the list leads with the replay figure", () => {
  const raw = fx("vault-googl-onchain-empty.json");
  assert.equal(raw.source, "onchain");
  assert.equal(raw.fee_apr_pct["7d"], null);
  const s = parseVaultStats(raw);
  assert.equal(s.source, "replay");
  assert.equal(s.aprWindowDays, 30);
  assert.equal(s.feeAprPct, raw.fee_apr_pct.replay_30d);
  assert.equal(s.tvlUsd, 0);
});

test("an onchain payload with neither a realized APR nor a replay APR is rejected, not shown as zero", () => {
  const raw = fx("vault-googl-onchain-empty.json");
  assert.throws(() => parseVaultStats({ ...raw, fee_apr_pct: { "24h": null, "7d": null, lifetime: null } }), /onchain fee APR missing/);
});
