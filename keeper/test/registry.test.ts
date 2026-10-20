import { describe, expect, test } from "bun:test";
import { buildEvidence } from "../src/evidence.ts";
import { applyCreated, applyEnv, eligibleTickers, readReplay, readUniverse } from "../src/registry.ts";

const universe = readUniverse(), replay = readReplay();
const tickers = eligibleTickers(universe, replay);
const by = (s: string) => tickers.find((t) => t.symbol === s)!;

describe("eligible tickers", () => {
  test("one per eligible token, with the replay's chosen pool and a v3 token order", () => {
    const eligible = universe.tokens.filter((t: any) => t.eligible).map((t: any) => t.symbol).sort();
    expect(eligible.length).toBeGreaterThanOrEqual(3);
    expect(tickers.map((t) => t.symbol).sort()).toEqual(eligible);
    for (const t of tickers) expect(t.pool.toLowerCase()).toBe(replay.tokens[t.symbol].chosen.id.toLowerCase());
    expect(by("NVDA").stockIsToken0).toBe(false); // NVDA 0xd060 sorts above USDG 0x5fc5
    expect(by("SPCX").stockIsToken0).toBe(true);
  });
  test("each vault was replayed at its own size, the universe's cap_usd, and the ticker carries it", () => {
    expect(tickers.length).toBeGreaterThanOrEqual(10);
    for (const t of tickers) {
      const row = universe.tokens.find((x: any) => x.symbol === t.symbol);
      expect(t.capUsd).toBe(row.cap_usd);
      expect(replay.tokens[t.symbol].capital_usd).toBe(row.cap_usd);
      expect(buildEvidence(replay.tokens[t.symbol], replay)!.capital_usd).toBe(row.cap_usd);
    }
    expect(tickers.some((t) => t.capUsd < 100_000)).toBe(true); // thin-pool vaults are replayed small
  });
  test("a different replay choice flows through to the ticker", () => {
    const r = structuredClone(replay);
    r.tokens.NVDA.chosen = { ...r.tokens.NVDA.chosen, id: "0xB944cec30Bd4175855215D767ADC81F39e5f7E2B", fee_tier: 3000 };
    const t = eligibleTickers(universe, r).find((x) => x.symbol === "NVDA")!;
    expect(t.pool).toBe("0xB944cec30Bd4175855215D767ADC81F39e5f7E2B");
    expect(t.feeTier).toBe(3000);
  });
});

describe("vault addresses", () => {
  const nvda = by("NVDA"), v = "0x74156A1F9736307b7AD34e3691f3A5B54A0B3Eb8";
  test("an explicit address needs its deploy block, and must be an address", () => {
    expect(() => applyEnv(tickers, { VAULT_ADDRESS_NVDA: v })).toThrow("VAULT_DEPLOY_BLOCK_NVDA");
    expect(() => applyEnv(tickers, { VAULT_ADDRESS_NVDA: "0x12", VAULT_DEPLOY_BLOCK_NVDA: "1" })).toThrow("not an address");
    const t = applyEnv(tickers, { VAULT_ADDRESS_NVDA: v, VAULT_DEPLOY_BLOCK_NVDA: "90600000" }).find((x) => x.symbol === "NVDA")!;
    expect(t.vault).toBe(v);
    expect(t.deployBlock).toBe(90600000n);
    expect(applyEnv(tickers, {}).every((x) => x.vault === undefined)).toBe(true);
  });
  test("a factory VaultCreated matches on stock and pool, case-insensitively", () => {
    const made = { stock: nvda.stock.toLowerCase(), pool: nvda.pool.toLowerCase(), vault: v as `0x${string}`, block: 91_000_000n };
    const out = applyCreated(tickers, [made]);
    expect(out.find((x) => x.symbol === "NVDA")!.vault).toBe(v);
    expect(out.find((x) => x.symbol === "NVDA")!.deployBlock).toBe(91_000_000n);
    expect(out.filter((x) => x.vault).length).toBe(1);
  });
  test("a vault on another pool of the same stock is not this ticker's vault", () => {
    const other = { stock: nvda.stock, pool: "0xB944cec30Bd4175855215D767ADC81F39e5f7E2B", vault: v as `0x${string}`, block: 1n };
    expect(applyCreated(tickers, [other]).every((x) => x.vault === undefined)).toBe(true);
  });
  test("an explicit address wins over the factory", () => {
    const explicit = applyEnv(tickers, { VAULT_ADDRESS_NVDA: v, VAULT_DEPLOY_BLOCK_NVDA: "5" });
    const made = { stock: nvda.stock, pool: nvda.pool, vault: "0x000000000000000000000000000000000000dEaD" as `0x${string}`, block: 9n };
    const t = applyCreated(explicit, [made]).find((x) => x.symbol === "NVDA")!;
    expect(t.vault).toBe(v);
    expect(t.deployBlock).toBe(5n);
  });
});
