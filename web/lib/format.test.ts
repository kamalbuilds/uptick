import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pct, shortAddress, usd, ago, swapsLabel, pitchLine, depositRoom, perDepositLimitUsd } from "./format.ts";
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

test("copy states the vault count and replayed swaps it is given, and names no fixed pair of tokens", () => {
  assert.equal(swapsLabel(5_123_456), "5.1 million");
  assert.equal(swapsLabel(842_504), "842,504");
  const line = pitchLine(17, 7_950_000);
  assert.match(line, /any of 17 Stock Tokens/);
  assert.match(line, /8\.0 million past trades/);
  assert.doesNotMatch(line, /NVDA|GOOGL/);
  for (const f of ["../app/layout.tsx", "../app/page.tsx", "../components/vault-detail.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /NVDA or GOOGL|5\.1 million/, `${f} carries stale copy`);
  }
});

test("deposit room: the vault's maxDeposit wins once deployed, else the dollar size over the price", () => {
  const e18 = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
  // deployed, 40 tokens of room left: 41 is over, 40 is not
  assert.deepEqual(depositRoom(e18(41), e18(40), 70_000, 200), { tokens: 40, source: "vault", over: true });
  assert.equal(depositRoom(e18(40), e18(40), 70_000, 200)!.over, false);
  // full vault: maxDeposit 0 blocks any amount
  assert.equal(depositRoom(e18(0.001), 0n, 70_000, 200)!.over, true);
  // not deployed: $70,000 at $200 is 350 tokens
  assert.deepEqual(depositRoom(e18(351), undefined, 70_000, 200), { tokens: 350, source: "size", over: true });
  assert.equal(depositRoom(e18(350), undefined, 70_000, 200)!.over, false);
  // uncapped vault (maxDeposit = uint256 max) falls back to the dollar size
  assert.equal(depositRoom(e18(351), 2n ** 256n - 1n, 70_000, 200)!.source, "size");
  // no amount typed: room is reported, nothing is over
  assert.equal(depositRoom(null, e18(40), 70_000, 200)!.over, false);
  // no price and no vault: unknown, never a block
  assert.equal(depositRoom(e18(1), undefined, 70_000, undefined), null);
});

test("per-deposit limit never exceeds the vault's own size", () => {
  // a smaller reduced vault (PLTR at 24,207) keeps its own size as the limit
  assert.equal(perDepositLimitUsd(24_207), 24_207);
  // a full vault takes the global 25,000 cap
  assert.equal(perDepositLimitUsd(100_000), 25_000);
  // a vault at exactly the cap is unchanged
  assert.equal(perDepositLimitUsd(25_000), 25_000);
});

test("every vault in the list carries a positive size cap no larger than the full vault, and a price to read it by", () => {
  const { vaults } = JSON.parse(readFileSync(new URL("./vault-universe.json", import.meta.url), "utf8"));
  assert.ok(vaults.length >= 7);
  for (const v of vaults) {
    assert.ok(v.depositCapUsd >= 10_000 && v.depositCapUsd <= 100_000, `${v.symbol} cap ${v.depositCapUsd}`);
    assert.ok(v.refPriceUsd > 0, `${v.symbol} price`);
  }
  assert.ok(vaults.some((v: { depositCapUsd: number }) => v.depositCapUsd < 100_000), "thin-pool vaults carry less than the full size");
});
