import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { vaultShare } from "../src/universe.ts";

const script = new URL("../../scripts/deploy-list.mjs", import.meta.url).pathname;
const universe = JSON.parse(readFileSync(new URL("../data/universe.json", import.meta.url), "utf8"));
const list: { symbol: string; capUsd: number; depositCapTokens: string }[] = JSON.parse(
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
