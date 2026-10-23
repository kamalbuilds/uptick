import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { KEEP_FLOOR_APR } from "../src/evidence.ts";
import { vaultShare } from "../src/universe.ts";

const script = new URL("../../scripts/deploy-list.mjs", import.meta.url).pathname;
const universe = JSON.parse(readFileSync(new URL("../data/universe.json", import.meta.url), "utf8"));
const list: { symbol: string; capUsd: number; depositCapTokens: string; [k: string]: unknown }[] = JSON.parse(
  Bun.spawnSync(["bun", script], { stderr: "inherit" }).stdout.toString(),
);

test("the deploy list carries the universe cap for every token except META, whose on-chain cap is 15% of its pool's depth", () => {
  expect(list.length).toBeGreaterThan(10);
  for (const row of list) {
    const u = universe.tokens.find((t: any) => t.symbol === row.symbol);
    if (row.symbol === "META") continue;
    expect(row.capUsd).toBe(u.cap_usd);
  }
  const meta = list.find((r) => r.symbol === "META")!;
  const u = universe.tokens.find((t: any) => t.symbol === "META");
  expect(meta.capUsd).toBe(17_025);
  expect(meta.capUsd).toBeLessThan(u.cap_usd);
  expect(vaultShare(u.pool.depth_usd_5pct, meta.capUsd)).toBeLessThanOrEqual(0.15);
  expect(vaultShare(u.pool.depth_usd_5pct, meta.capUsd + 1)).toBeGreaterThan(0.15 - 1e-4);
});

test("META's token cap is its USD cap at the Chainlink price", () => {
  const meta = list.find((r) => r.symbol === "META")!;
  const u = universe.tokens.find((t: any) => t.symbol === "META");
  const usd = (Number(BigInt(meta.depositCapTokens) / 10n ** 12n) / 1e6) * u.feed.usd;
  expect(Math.abs(usd - meta.capUsd)).toBeLessThan(1);
});

const replay = JSON.parse(readFileSync(new URL("../data/replay.json", import.meta.url), "utf8"));
const v4Pools = JSON.parse(readFileSync(new URL("../data/v4-pools.json", import.meta.url), "utf8")).pools;
const all: any[] = list as any[];
const v3Entries = all.filter((r) => r.venue === "v3");
const v4Entries = all.filter((r) => r.venue === "v4");
const worstHalf = (row: any) => Math.min(row.calibration.edge_apr_pct, row.test.edge_apr_pct);

test("every entry names its venue, and the venue is the replay's", () => {
  expect(all.length).toBeGreaterThan(10);
  for (const r of all) expect(["v3", "v4"]).toContain(r.venue);
  for (const r of all) expect(r.venue).toBe(replay.tokens[r.symbol]?.venue ?? "v3");
});

test("the replay's venue is the floor rule: v3 while its pool keeps the floor, else v4 when the v4 pool does", () => {
  const toks = Object.entries<any>(replay.tokens).filter(([, t]) => t.venue !== undefined);
  expect(toks.length).toBeGreaterThan(10);
  expect(toks.filter(([, t]) => t.venue === "v3").length).toBeGreaterThan(5);
  expect(toks.filter(([, t]) => t.chosen && worstHalf(t.pools.find((p: any) => p.id === t.chosen.id)) < KEEP_FLOOR_APR).length).toBeGreaterThan(0); // the rule is exercised: some v3 pools are under the floor
  for (const [sym, t] of toks) {
    const w3 = t.chosen ? worstHalf(t.pools.find((p: any) => p.id === t.chosen.id)) : null;
    const w4 = t.chosen_v4 ? t.chosen_v4.worst_half : null;
    const want = w3 !== null && w3 >= KEEP_FLOOR_APR ? "v3" : w4 !== null && w4 >= KEEP_FLOOR_APR ? "v4" : "v3";
    expect({ sym, venue: t.venue }).toEqual({ sym, venue: want });
  }
});

// The shipped replay has every token on v3 (the v3 pool of each keeps the floor or no v4 pool does), so the v4 entry shape is read from the same replay run with venue_for forced to v4 for PLTR.
const v4FixturePath = new URL("./fixtures/replay-pltr-v4-venue.json", import.meta.url).pathname;
const v4Fixture = JSON.parse(readFileSync(v4FixturePath, "utf8"));
const fixtureList: any[] = JSON.parse(Bun.spawnSync(["bun", script], { stderr: "inherit", env: { ...process.env, DEPLOY_REPLAY: v4FixturePath } }).stdout.toString());

test("the shipped replay's v4-venue tokens are exactly the list's v4 entries", () => {
  const v4Tokens = Object.entries<any>(replay.tokens).filter(([, t]) => t.venue === "v4").map(([s]) => s);
  expect(v4Entries.map((r) => r.symbol).sort()).toEqual(v4Tokens.sort());
});

test("a token whose replay venue is v4 has a v4 entry: pool id, tick spacing, no v3 pool field, deployable", () => {
  const entries = fixtureList.filter((r) => r.venue === "v4");
  expect(entries.map((r) => r.symbol)).toEqual(["PLTR"]);
  expect(fixtureList.filter((r) => r.venue === "v3").length).toBeGreaterThan(10); // the other tokens fall back to v3
  for (const r of entries) {
    const c = v4Fixture.tokens[r.symbol].chosen_v4;
    expect(r.poolId).toHaveLength(66);
    expect(r.poolId).toBe(c.id);
    expect(r.tickSpacing).toBe(c.tick_spacing);
    expect(r.feeTier).toBe(c.fee_tier);
    expect(r.hooks).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect("pool" in r).toBe(false);
    expect(r.deployable).toBe(true);
    expect(c.worst_half).toBeGreaterThanOrEqual(KEEP_FLOOR_APR);
    const u = universe.tokens.find((t: any) => t.symbol === r.symbol);
    expect(r.capUsd).toBe(Math.min(u.cap_usd, Math.floor((v4Pools[r.poolId].depth_usd_5pct * 0.2) / 0.8)));
    expect(r.capUsd).toBe(c.cap_usd);
    expect(BigInt(r.depositCapTokens)).toBeGreaterThan(0n);
  }
});

test("v3 entries keep their v3 shape: pool address, no pool id, the replay's chosen pool", () => {
  expect(v3Entries.length).toBeGreaterThan(10);
  for (const r of v3Entries) {
    expect(r.pool).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect("poolId" in r).toBe(false);
    expect("tickSpacing" in r).toBe(false);
    const chosen = replay.tokens[r.symbol]?.chosen;
    if (chosen) { expect(r.pool).toBe(chosen.id); expect(r.feeTier).toBe(chosen.fee_tier); }
  }
  expect(all.map((r) => r.symbol).sort()).toEqual([...new Set(all.map((r) => r.symbol))].sort());
});

test("--v4-report lists every replayed token and marks exactly the tokens the list moves to v4", () => {
  const out = Bun.spawnSync(["bun", script, "--v4-report"], { stderr: "inherit" }).stdout.toString().trim().split("\n");
  const rows = out.slice(2).map((l) => l.split("|").map((c) => c.trim()));
  expect(rows.map((r) => r[0]).sort()).toEqual(Object.keys(replay.tokens).sort());
  const yes = rows.filter((r) => r[r.length - 1] === "YES").map((r) => r[0]).sort();
  expect(yes).toEqual(v4Entries.map((r) => r.symbol).sort());
});
