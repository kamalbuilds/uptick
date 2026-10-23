import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { KEEP_FLOOR_APR } from "../src/evidence.ts";
import { vaultShare } from "../src/universe.ts";

const script = new URL("../../scripts/deploy-list.mjs", import.meta.url).pathname;
const universe = JSON.parse(readFileSync(new URL("../data/universe.json", import.meta.url), "utf8"));
const list: { symbol: string; capUsd: number; depositCapTokens: string; [k: string]: unknown }[] = JSON.parse(
  Bun.spawnSync(["bun", script], { stderr: "inherit" }).stdout.toString(),
);

const params = JSON.parse(readFileSync(new URL("../data/params.json", import.meta.url), "utf8"));
const liveness = Object.entries<any>(params).filter(([, p]) => p.liveness_share);

test("the deploy list carries the universe cap for every token except those with a liveness_share, which deploy at that share of their pool's depth", () => {
  expect(list.length).toBeGreaterThan(10);
  expect(liveness.map(([s]) => s).sort()).toEqual(["AAPL", "GOOGL", "META"]);
  for (const row of list) {
    const u = universe.tokens.find((t: any) => t.symbol === row.symbol);
    if (params[row.symbol]?.liveness_share) continue;
    expect(row.capUsd).toBe(u.cap_usd);
  }
  for (const [symbol, p] of liveness) {
    const row = list.find((r) => r.symbol === symbol)!;
    const u = universe.tokens.find((t: any) => t.symbol === symbol);
    expect(row.capUsd).toBeLessThan(u.cap_usd);
    expect(vaultShare(u.pool.depth_usd_5pct, row.capUsd)).toBeLessThanOrEqual(p.liveness_share);
    expect(vaultShare(u.pool.depth_usd_5pct, row.capUsd + 1)).toBeGreaterThan(p.liveness_share - 1e-4);
  }
  expect(list.find((r) => r.symbol === "META")!.capUsd).toBe(17_025);
  expect(list.find((r) => r.symbol === "AAPL")!.capUsd).toBe(29_268);
  expect(list.find((r) => r.symbol === "GOOGL")!.capUsd).toBe(38_950);
});

test("a liveness token's token cap is its USD cap at the Chainlink price", () => {
  for (const [symbol] of liveness) {
    const row = list.find((r) => r.symbol === symbol)!;
    const u = universe.tokens.find((t: any) => t.symbol === symbol);
    const usd = (Number(BigInt(row.depositCapTokens) / 10n ** 12n) / 1e6) * u.feed.usd;
    expect(Math.abs(usd - row.capUsd)).toBeLessThan(1);
  }
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
  expect(toks.filter(([, t]) => t.venue === "v4").length).toBeGreaterThan(0);
  expect(toks.filter(([, t]) => t.venue === "v3").length).toBeGreaterThan(5);
  for (const [sym, t] of toks) {
    const w3 = t.chosen ? worstHalf(t.pools.find((p: any) => p.id === t.chosen.id)) : null;
    const w4 = t.chosen_v4 ? t.chosen_v4.worst_half : null;
    const want = w3 !== null && w3 >= KEEP_FLOOR_APR ? "v3" : w4 !== null && w4 >= KEEP_FLOOR_APR ? "v4" : "v3";
    expect({ sym, venue: t.venue }).toEqual({ sym, venue: want });
  }
});

test("a token whose replay venue is v4 has a v4 entry: pool id, tick spacing, no v3 pool field, deployable", () => {
  const v4Tokens = Object.entries<any>(replay.tokens).filter(([, t]) => t.venue === "v4").map(([s]) => s);
  expect(v4Tokens.length).toBeGreaterThan(0);
  expect(v4Entries.map((r) => r.symbol).sort()).toEqual(v4Tokens.sort());
  for (const r of v4Entries) {
    const c = replay.tokens[r.symbol].chosen_v4;
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
  expect(yes.length).toBeGreaterThan(0);
  expect(yes).toEqual(v4Entries.map((r) => r.symbol).sort());
});
