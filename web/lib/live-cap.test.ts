import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Address } from "viem";
import { liveCapUsd, type DeployedRecord } from "./live-cap.ts";
import { E18, mockChain, px } from "./scan-mock.ts";
import { scanWallet, type ScanVault } from "./scan.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const record = read("../../deployments/4663.json") as DeployedRecord;
const universe = read("./vault-universe.json") as { vaults: Array<{ id: string; symbol: string; token: string; feed: string; entryFeeBps: number; depositCapUsd: number; gate: { state: "open" | "reduced" | "closed"; reason: string; worst_half_apr: number } }> };
const OWNER: Address = "0x335836A23a2E475265058CB55318EF91A07136b7";

/** The vault list as the app builds it when the record's vaults are live at their record addresses. */
const live = (addressOf: (symbol: string) => string | undefined): ScanVault[] =>
  universe.vaults.map((v) => ({
    id: v.id, symbol: v.symbol, name: v.symbol, token: v.token as Address, feed: v.feed as Address, entryFeeBps: v.entryFeeBps,
    depositCapUsd: liveCapUsd(v.depositCapUsd, v.symbol, addressOf(v.symbol), record),
    gate: { state: v.gate.state, reason: v.gate.reason, worstHalfApr: v.gate.worst_half_apr },
  }));
const deployedAddr = (s: string) => record.vaults[s]?.address;

test("the record names vaults the universe also names, and their launch caps are above the deployed caps (the case the override exists for)", () => {
  const deployed = Object.entries(record.vaults);
  assert.ok(deployed.length >= 2);
  for (const [symbol, d] of deployed) {
    const u = universe.vaults.find((v) => v.symbol === symbol);
    assert.ok(u, `${symbol} is in the universe`);
    assert.ok(u.depositCapUsd > d.capUsd, `${symbol} launch cap ${u.depositCapUsd} exceeds deployed cap ${d.capUsd}`);
  }
});

test("a deployed vault never reports a cap above its deployed cap", () => {
  const vaults = live(deployedAddr);
  for (const [symbol, d] of Object.entries(record.vaults)) {
    const v = vaults.find((x) => x.symbol === symbol)!;
    assert.equal(v.depositCapUsd, d.capUsd);
    assert.ok(v.depositCapUsd <= d.capUsd, `${symbol} reports ${v.depositCapUsd}, deployed cap is ${d.capUsd}`);
  }
});

test("a launching vault keeps its launch cap, and so does a vault live at an address the record does not name", () => {
  const vaults = live(deployedAddr);
  for (const u of universe.vaults.filter((x) => !record.vaults[x.symbol])) assert.equal(vaults.find((v) => v.id === u.id)!.depositCapUsd, u.depositCapUsd);
  const fork = live((s) => (record.vaults[s] ? "0x0000000000000000000000000000000000000a01" : undefined));
  for (const [symbol] of Object.entries(record.vaults)) assert.equal(fork.find((v) => v.symbol === symbol)!.depositCapUsd, universe.vaults.find((v) => v.symbol === symbol)!.depositCapUsd);
  assert.equal(liveCapUsd(1, "PLTR", record.vaults.PLTR.address.toLowerCase(), record), record.vaults.PLTR.capUsd, "address compare ignores case");
  assert.equal(liveCapUsd(1, "PLTR", undefined, record), 1, "a vault with no address is launching");
});

test("a wallet holding more PLTR than the deployed vault takes is put to work at the deployed cap, not the launch cap", async () => {
  const vaults = live(deployedAddr);
  const pltr = vaults.find((v) => v.symbol === "PLTR")!;
  const chain = mockChain(vaults, { [pltr.token.toLowerCase()]: 100n * E18 }, { [pltr.feed.toLowerCase()]: px(200) });
  const scan = await scanWallet(chain.client, OWNER, vaults);
  assert.equal(scan.rows[0].holdingUsd, 20_000);
  assert.equal(scan.rows[0].putToWorkUsd, record.vaults.PLTR.capUsd);
  assert.equal(scan.rows[0].depositCapUsd, record.vaults.PLTR.capUsd);
});

test("the app's vault list takes its cap through liveCapUsd from the deployment record", () => {
  const src = readFileSync(new URL("./vaults.ts", import.meta.url), "utf8");
  assert.match(src, /depositCapUsd: liveCapUsd\(v\.depositCapUsd, v\.symbol, asAddress\(fromEnv\[v\.symbol\]\), deployed\)/);
  assert.match(src, /import deployed from "\.\/deployments\.json"/);
  assert.equal(readFileSync(new URL("./deployments.json", import.meta.url), "utf8"), readFileSync(new URL("../../deployments/4663.json", import.meta.url), "utf8"), "web/lib/deployments.json is the record, byte for byte");
});
