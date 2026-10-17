import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pct, shortAddress, usd, ago } from "./format.ts";
import { parseVaultStats } from "./keeper.ts";

const fx = (f: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), "utf8"));

test("pct treats input as a percent", () => {
  assert.equal(pct(40.5574), "40.6%");
  assert.equal(pct(NaN), "n/a");
});

test("usd and address", () => {
  assert.equal(usd(1234.5), "$1,234.50");
  assert.equal(usd(2_500_000), "$2.5M");
  assert.equal(shortAddress("0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"), "0xd060...9EEC");
  assert.equal(ago(1000, 61_000), "1m ago");
});

test("parseVaultStats reads the real keeper /vaults payload", () => {
  const { vaults } = fx("vaults.json");
  assert.ok(vaults.length >= 2);
  const nvda = parseVaultStats(vaults.find((v: { id: string }) => v.id === "nvda"));
  assert.equal(nvda.feeAprPct.toFixed(1), "40.6");
  assert.equal(nvda.aprWindowDays, 30);
  assert.equal(nvda.source, "replay");
  assert.equal(nvda.tvlUsd, null);
  assert.deepEqual(parseVaultStats(fx("vault-nvda.json")), nvda);
});

test("parseVaultStats rejects malformed input", () => {
  const good = fx("vault-nvda.json");
  assert.throws(() => parseVaultStats({ ...good, fee_apr_pct: { replay_30d: "x" } }));
  assert.throws(() => parseVaultStats({ ...good, fee_apr_pct: {} }));
  assert.throws(() => parseVaultStats({ ...good, source: "guess" }));
  assert.throws(() => parseVaultStats({ ...good, tvl_usd: "1" }));
});

test("parseVaultStats reads the keeper price chart and rejects a malformed one", () => {
  const raw = fx("vault-nvda-chart.json");
  const c = parseVaultStats(raw).chart!;
  assert.ok(c.history.length > 300);
  assert.ok(c.bands.length >= 5);
  assert.ok(c.band!.lower < c.poolUsd && c.poolUsd < c.band!.upper === c.inBand);
  assert.equal(parseVaultStats({ ...raw, chart: null }).chart, null);
  assert.throws(() => parseVaultStats({ ...raw, chart: { ...raw.chart, history: [] } }), /no series/);
});

test("a new onchain vault with no fees leads with the replay APR; one with fees leads with its own", () => {
  const base = { id: "nvda", ticker: "NVDA", source: "onchain", pool: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3", tvl_usd: 49968.98, replay: { window: { days: 30 } } };
  const fresh = parseVaultStats({ ...base, fee_apr_pct: { "7d": 0, lifetime: 0, replay_30d: 40.6 } });
  assert.equal(fresh.feeAprPct, 40.6);
  assert.equal(fresh.source, "replay");
  const earning = parseVaultStats({ ...base, fee_apr_pct: { "7d": 38.2, lifetime: 38.2, replay_30d: 40.6 } });
  assert.equal(earning.feeAprPct, 38.2);
  assert.equal(earning.source, "onchain");
});
