import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { llmsText, type Deployed, type Universe } from "../scripts/llms-text.ts";

const universe = JSON.parse(readFileSync(new URL("../../web/lib/vault-universe.json", import.meta.url), "utf8")) as Universe;
const deployed = JSON.parse(readFileSync(new URL("../../deployments/4663.json", import.meta.url), "utf8")) as Deployed;
const published = readFileSync(new URL("../../web/public/llms.txt", import.meta.url), "utf8");

describe("llms.txt", () => {
  test("the universe is populated", () => {
    expect(universe.vaults.length).toBeGreaterThan(0);
  });

  test("prepare_earn_and_borrow is described as two batches with a wait between them", () => {
    const text = llmsText(universe);
    expect(text).toContain("two batches with a wait between them");
    expect(text).toContain("about 12 seconds");
    expect(text).not.toContain("as one ordered list");
  });

  test("the published file is what the generator writes", () => {
    expect(published).toBe(llmsText(universe, deployed));
  });

  test("the two deployed vaults read as live at their record addresses with their deployed caps, and the other ten as launching", () => {
    const symbols = Object.keys(deployed.vaults);
    expect(symbols.length).toBeGreaterThanOrEqual(2);
    for (const s of symbols) {
      const v = universe.vaults.find((x) => x.symbol === s)!;
      expect(v.depositCapUsd).toBeGreaterThan(deployed.vaults[s].capUsd);
      expect(published).toContain(`${s} at ${deployed.vaults[s].address} up to $${deployed.vaults[s].capUsd.toLocaleString("en-US")}`);
      expect(published).toContain(`${s} $${deployed.vaults[s].capUsd.toLocaleString("en-US")}`);
      expect(published).not.toContain(`${s} $${v.depositCapUsd.toLocaleString("en-US")}`);
    }
    const launching = universe.vaults.filter((v) => !deployed.vaults[v.symbol] && v.gate.state !== "closed").length;
    expect(launching).toBeGreaterThan(0);
    expect(published).toContain(`The other ${launching} launch next.`);
    for (const v of universe.vaults.filter((x) => !deployed.vaults[x.symbol])) expect(published).toContain(`${v.symbol} $${v.depositCapUsd.toLocaleString("en-US")}`);
  });

  test("with no deployment record the file keeps the launching wording and the launch caps", () => {
    const text = llmsText(universe);
    expect(text).toContain("vaults take deposits when they launch");
    expect(text).not.toContain("live on Robinhood Chain");
    expect(text).toContain(`AAPL $${universe.vaults.find((v) => v.symbol === "AAPL")!.depositCapUsd.toLocaleString("en-US")}`);
  });
});
