import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEEP_FLOOR_APR } from "../src/evidence.ts";
import { vaultShare } from "../src/universe.ts";

const script = new URL("../../scripts/deploy-list.mjs", import.meta.url).pathname;
const universe = JSON.parse(readFileSync(new URL("../data/universe.json", import.meta.url), "utf8"));
const list: { symbol: string; capUsd: number; depositCapTokens: string; [k: string]: unknown }[] = JSON.parse(
  Bun.spawnSync(["bun", script], { stderr: "inherit" }).stdout.toString(),
);

test("the deploy list carries the universe cap for every v3 token except META, whose on-chain cap is 15% of its pool's depth, and the replay's own cap for a v4 token", () => {
  expect(list.length).toBeGreaterThan(10);
  expect(list.some((r) => r.venue === "v4")).toBe(true); // the v4 branch is exercised
  for (const row of list) {
    const u = universe.tokens.find((t: any) => t.symbol === row.symbol);
    if (row.venue === "v4") { expect(row.capUsd).toBe(replay.tokens[row.symbol].chosen_v4.cap_usd); expect(row.capUsd).toBeLessThanOrEqual(u.cap_usd); continue; }
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

/** The venue rule of keeper/replay/replay.py venue_for: the backend whose chosen pool keeps more in its weaker half, among those at or above the floor; v3 on a tie and when neither clears it. keeper/test/fixtures/venue-cases.json pins this copy and the Python one to the same table. */
const venueFor = (w3: number | null, w4: number | null): "v3" | "v4" => {
  const ok3 = w3 !== null && w3 >= KEEP_FLOOR_APR, ok4 = w4 !== null && w4 >= KEEP_FLOOR_APR;
  return ok4 && (!ok3 || w4! > w3!) ? "v4" : "v3";
};
const cases = JSON.parse(readFileSync(new URL("./fixtures/venue-cases.json", import.meta.url), "utf8"));

test("the TS copy of the venue rule gives the venue the shared table lists for every case", () => {
  expect(cases.floor_apr).toBe(KEEP_FLOOR_APR);
  expect(cases.cases.length).toBeGreaterThan(10);
  for (const c of cases.cases) expect({ ...c, got: venueFor(c.v3, c.v4) }).toEqual({ ...c, got: c.venue });
});

test("the replay's venue is the weaker-half rule: the backend whose chosen pool keeps more, v3 on a tie, v3 when neither clears the floor", () => {
  const toks = Object.entries<any>(replay.tokens).filter(([, t]) => t.venue !== undefined);
  expect(toks.length).toBeGreaterThan(10);
  const w = toks.map(([sym, t]) => ({
    sym, venue: t.venue,
    w3: t.chosen ? worstHalf(t.pools.find((p: any) => p.id === t.chosen.id)) : null,
    w4: t.chosen_v4 ? (t.chosen_v4.worst_half as number) : null,
  }));
  for (const x of w) expect({ sym: x.sym, venue: x.venue }).toEqual({ sym: x.sym, venue: venueFor(x.w3, x.w4) });
  // the rule is exercised on both sides: a v3 pool that clears the floor yet loses to a v4 pool (PLTR), v3 winning with a v4 rival present, and a token under the floor everywhere
  expect(w.filter((x) => x.venue === "v4" && x.w3 !== null && x.w3 >= KEEP_FLOOR_APR).map((x) => x.sym)).toContain("PLTR");
  expect(w.filter((x) => x.venue === "v3" && x.w4 !== null && x.w4 >= KEEP_FLOOR_APR && x.w3 !== null && x.w3 >= x.w4).length).toBeGreaterThan(0);
  expect(w.filter((x) => x.venue === "v3" && (x.w3 === null || x.w3 < KEEP_FLOOR_APR) && (x.w4 === null || x.w4 < KEEP_FLOOR_APR)).length).toBeGreaterThan(0);
});

// The same replay with PLTR's venue set to v3, to show that the venue field decides and not the presence of a v4 pool.
const forcedV3Path = join(mkdtempSync(join(tmpdir(), "deploy-list-")), "replay-pltr-v3.json");
writeFileSync(forcedV3Path, JSON.stringify({ ...replay, tokens: { ...replay.tokens, PLTR: { ...replay.tokens.PLTR, venue: "v3" } } }));
const forcedV3List: any[] = JSON.parse(Bun.spawnSync(["bun", script], { stderr: "inherit", env: { ...process.env, DEPLOY_REPLAY: forcedV3Path } }).stdout.toString());

test("the shipped replay's v4-venue tokens are exactly the list's v4 entries: PLTR, SPY and USO", () => {
  const v4Tokens = Object.entries<any>(replay.tokens).filter(([, t]) => t.venue === "v4").map(([s]) => s);
  expect(v4Entries.map((r) => r.symbol).sort()).toEqual(v4Tokens.sort());
  expect(v4Tokens.sort()).toEqual(["PLTR", "SPY", "USO"]);
});

test("a token whose replay venue is v4 has a v4 entry: pool id, tick spacing, no v3 pool field, deployable", () => {
  expect(v4Entries.length).toBe(3);
  expect(v3Entries.length).toBeGreaterThan(10); // the other tokens stay on v3
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

test("venue decides: the same replay with PLTR's venue set to v3 lists PLTR as a v3 entry on its chosen v3 pool", () => {
  const pltr = forcedV3List.find((r) => r.symbol === "PLTR");
  expect(pltr.venue).toBe("v3");
  expect(pltr.pool).toBe(replay.tokens.PLTR.chosen.id);
  expect("poolId" in pltr).toBe(false);
  expect(forcedV3List.filter((r) => r.venue === "v4").map((r) => r.symbol).sort()).toEqual(["SPY", "USO"]);
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
  expect(out[0]).toContain("ON V4");
});
