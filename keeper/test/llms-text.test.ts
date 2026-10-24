import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { llmsText, type Universe } from "../scripts/llms-text.ts";

const universe = JSON.parse(readFileSync(new URL("../../web/lib/vault-universe.json", import.meta.url), "utf8")) as Universe;
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
    expect(published).toBe(llmsText(universe));
  });
});
