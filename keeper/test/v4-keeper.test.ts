import { describe, expect, test } from "bun:test";
import { spotFromSlot0 } from "../src/chain.ts";
import type { Ticker, TickerV3, TickerV4 } from "../src/config.ts";
import { applyCreated, applyEnv, eligibleTickers, readParams, readReplay, readUniverse, toCreated } from "../src/registry.ts";
import { pokeDue, simulatePoke } from "../src/simulate.ts";

const universe = readUniverse(), params = readParams();
const PLTR_POOL = "0xee430ee1003e1985e1828a01b9a20dad67ad4302994fe2abb4a173de4ac54623";
const OTHER_POOL = "0x3bb34a44f1b2b5f32c034c38a53065a521a47b199700fa9bd19d60985ff24bf1";
const VAULT = "0x74156A1F9736307b7AD34e3691f3A5B54A0B3Eb8" as const;

/** The real replay with the venues overridden: a token flipped takes its own chosen_v4 or chosen row, so both directions are exercised on real rows. The shipped replay has PLTR, SPY and USO on v4 and every other token on v3. */
function replayWith(venues: Record<string, "v3" | "v4">) {
  const r = structuredClone(readReplay());
  for (const [sym, v] of Object.entries(venues)) r.tokens[sym].venue = v;
  return r;
}
const by = (ts: Ticker[], s: string) => ts.find((t) => t.symbol === s)!;

describe("eligibleTickers venue", () => {
  const real = eligibleTickers(universe, readReplay(), params);
  test("the shipped replay yields PLTR, SPY and USO as v4 tickers on their pool ids and every other token as a v3 ticker on its chosen pool", () => {
    expect(real.length).toBeGreaterThanOrEqual(10);
    expect(real.filter((t) => t.venue === "v4").map((t) => t.symbol).sort()).toEqual(["PLTR", "SPY", "USO"]);
    for (const t of real.filter((x) => x.venue === "v3")) { expect(t.pool).toMatch(/^0x[0-9a-fA-F]{40}$/); expect(t.poolId).toBeUndefined(); }
    for (const t of real.filter((x) => x.venue === "v4") as TickerV4[]) { expect(t.poolId).toMatch(/^0x[0-9a-f]{64}$/); expect(t.pool).toBeUndefined(); }
  });
  test("PLTR is a v4 ticker on its 1% pool id, USDG sorting below the stock", () => {
    const pltr = by(real, "PLTR") as TickerV4;
    expect(pltr.venue).toBe("v4");
    expect(pltr.poolId).toBe(PLTR_POOL);
    expect(pltr.pool).toBeUndefined();
    expect(pltr.feeTier).toBe(10000);
    expect(pltr.stockIsToken0).toBe(false); // PLTR 0x894E sorts above USDG 0x5fc5
  });
  test("venue decides, not the presence of chosen_v4: a v3 token that has a chosen_v4 stays v3, and a v4 token without one falls back to v3", () => {
    const r = replayWith({ PLTR: "v3" });
    expect(r.tokens.PLTR.chosen_v4).toBeTruthy(); // the v4 pool is on the row, the venue still says v3
    const flipped = eligibleTickers(universe, r, params);
    expect(by(flipped, "PLTR").venue).toBe("v3");
    expect((by(flipped, "PLTR") as TickerV3).pool.toLowerCase()).toBe(r.tokens.PLTR.chosen.id.toLowerCase());
    const r2 = replayWith({ AMZN: "v4" });
    expect(r2.tokens.AMZN.chosen_v4).toBeFalsy();
    expect(by(eligibleTickers(universe, r2, params), "AMZN").venue).toBe("v3");
  });
  test("a v3 token flipped to v4 takes the v4 pool id and fee, and keeps its address order", () => {
    const r = replayWith({ NVDA: "v4" });
    const nvda = by(eligibleTickers(universe, r, params), "NVDA") as TickerV4;
    expect(nvda.venue).toBe("v4");
    expect(nvda.poolId).toBe(OTHER_POOL);
    expect(nvda.feeTier).toBe(r.tokens.NVDA.chosen_v4.fee_tier);
    expect(nvda.stockIsToken0).toBe(false);
  });
});

describe("factory registry", () => {
  const ticks = eligibleTickers(universe, readReplay(), params);
  const pltr = by(ticks, "PLTR") as TickerV4, nvda = by(ticks, "NVDA") as TickerV3;
  test("a VaultCreatedV4 matches a v4 ticker on (stock, poolId), case-insensitively", () => {
    const made = { stock: pltr.stock.toLowerCase(), poolId: PLTR_POOL.toUpperCase().replace("0X", "0x"), vault: VAULT, block: 7n };
    const out = applyCreated(ticks, [made]);
    expect(by(out, "PLTR").vault).toBe(VAULT);
    expect(by(out, "PLTR").deployBlock).toBe(7n);
    expect(out.filter((t) => t.vault).length).toBe(1);
  });
  test("the same stock on another pool id is not this ticker's vault (stock alone must not match)", () => {
    const made = { stock: pltr.stock, poolId: OTHER_POOL, vault: VAULT, block: 7n };
    expect(applyCreated(ticks, [made]).every((t) => t.vault === undefined)).toBe(true);
  });
  test("a v3 VaultCreated never fills a v4 ticker, and a v4 VaultCreatedV4 never fills a v3 ticker", () => {
    const v3Made = { stock: pltr.stock, pool: "0x851680416A4f4E1c463d45171d61ACDdBc8554c0", vault: VAULT, block: 1n };
    const v3WithPoolIdShape = { stock: pltr.stock, pool: PLTR_POOL, vault: VAULT, block: 1n }; // a pool field that happens to hold the pool id
    expect(by(applyCreated(ticks, [v3Made, v3WithPoolIdShape]), "PLTR").vault).toBeUndefined();
    const v4Made = { stock: nvda.stock, poolId: nvda.pool, vault: VAULT, block: 1n };
    expect(by(applyCreated(ticks, [v4Made]), "NVDA").vault).toBeUndefined();
    expect(by(applyCreated(ticks, [{ stock: nvda.stock, pool: nvda.pool, vault: VAULT, block: 2n }]), "NVDA").vault).toBe(VAULT); // the v3 path still matches
  });
  test("an explicit VAULT_ADDRESS_PLTR wins over the factory for a v4 ticker", () => {
    const explicit = applyEnv(ticks, { VAULT_ADDRESS_PLTR: VAULT, VAULT_DEPLOY_BLOCK_PLTR: "5" });
    const made = { stock: pltr.stock, poolId: PLTR_POOL, vault: "0x000000000000000000000000000000000000dEaD" as const, block: 9n };
    const t = by(applyCreated(explicit, [made]), "PLTR");
    expect(t.vault).toBe(VAULT);
    expect(t.deployBlock).toBe(5n);
  });
  test("toCreated reads args.pool from VaultCreated logs and args.poolId from VaultCreatedV4 logs", () => {
    const c = toCreated(
      [{ args: { stock: "0xa", pool: "0xb", vault: "0xc" }, blockNumber: 1n }],
      [{ args: { stock: "0xd", poolId: "0xe", vault: "0xf" }, blockNumber: 2n }],
    );
    expect(c).toEqual([
      { stock: "0xa", pool: "0xb", vault: "0xc", block: 1n },
      { stock: "0xd", poolId: "0xe", vault: "0xf", block: 2n },
    ]);
  });
});

describe("pokeDue", () => {
  test("sends only on a simulated true", () => {
    expect(pokeDue(true)).toEqual({ send: true, skip: null });
  });
  test("a simulated false sends nothing: the oracle would write no observation, so no gas is spent", () => {
    expect(pokeDue(false)).toEqual({ send: false, skip: "no_write" });
  });
  test("a failed simulation sends nothing and is flagged for logging, even when a stale result came with it", () => {
    expect(pokeDue(undefined, "OracleUnhealthy(2)")).toEqual({ send: false, skip: "failed" });
    expect(pokeDue(true, "boom")).toEqual({ send: false, skip: "failed" });
    expect(pokeDue(undefined)).toEqual({ send: false, skip: "no_write" });
  });
});

describe("v4 spot from slot0", () => {
  // 2^96 is 79228162514264337593543950336. USD 100 per stock with USDG at 6 decimals and the stock at 18 gives a raw token1/token0 of 1e-10 when the stock is
  // currency0 (sqrt 1e-5) and of 1e10 when the stock is currency1 (sqrt 1e5). Both literals are 2^96 times that, written out, not computed by the code under test.
  const SQRT_STOCK_IS_0 = 792281625142643375935439n;
  const SQRT_STOCK_IS_1 = 7922816251426433759354395033600000n;
  test("stock as currency0: USD 100 from sqrtPriceX96, tick passed through", () => {
    const s = spotFromSlot0([SQRT_STOCK_IS_0, -230270, 0, 3000] as const, true);
    expect(s.poolUsd).toBeCloseTo(100, 6);
    expect(s.tick).toBe(-230270);
  });
  test("stock as currency1: USD 100 from sqrtPriceX96, tick passed through", () => {
    const s = spotFromSlot0([SQRT_STOCK_IS_1, 230270, 0, 3000] as const, false);
    expect(s.poolUsd).toBeCloseTo(100, 6);
    expect(s.tick).toBe(230270);
  });
  test("the wrong order reads the same sqrt price as 1e22 dollars, so a flipped flag is visible", () => {
    expect(spotFromSlot0([SQRT_STOCK_IS_0, 0, 0, 0] as const, false).poolUsd / 1e22).toBeCloseTo(1, 6);
    expect(spotFromSlot0([SQRT_STOCK_IS_1, 0, 0, 0] as const, true).poolUsd / 1e22).toBeCloseTo(1, 6);
  });
  test("an uninitialised pool (sqrtPriceX96 0) throws instead of reporting an infinite price", () => {
    expect(() => spotFromSlot0([0n, 0, 0, 0] as const, false)).toThrow("not initialised");
  });
});

describe("simulatePoke feeds pokeDue", () => {
  const fake = (impl: (a: any) => Promise<unknown>) => ({ simulateContract: impl }) as any;
  test("passes the vault's own bool through, and asks poke() of the v4 ABI as the given account", async () => {
    let seen: any;
    const sent = await simulatePoke(fake(async (a) => { seen = a; return { result: true, request: { functionName: "poke" } }; }), VAULT, "0x00000000000000000000000000000000000000aa");
    expect(seen.functionName).toBe("poke");
    expect(seen.address).toBe(VAULT);
    expect(seen.account).toBe("0x00000000000000000000000000000000000000aa");
    expect(pokeDue(sent.result, sent.error).send).toBe(true);
    const idle = await simulatePoke(fake(async () => ({ result: false, request: {} })), VAULT);
    expect(idle.result).toBe(false);
    expect(pokeDue(idle.result, idle.error)).toEqual({ send: false, skip: "no_write" });
  });
  test("a reverting simulation comes back as an error string, never a throw, and pokeDue refuses to send", async () => {
    const r = await simulatePoke(fake(async () => { throw new Error("execution reverted\nDetails: OracleUnhealthy"); }), VAULT);
    expect(r.result).toBeUndefined();
    expect(r.error).toBe("execution reverted");
    expect(pokeDue(r.result, r.error)).toEqual({ send: false, skip: "failed" });
  });
});
