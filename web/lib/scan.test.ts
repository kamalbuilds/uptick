import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { toHex, type Address } from "viem";
import { E18, HEAD, mockChain as mock, px } from "./scan-mock.ts";
import { READ_LAG, borrowRoomUsd, parseOwner, holdingUsd, keptPerYearUsd, netOfFee, placeableUsd, scanWallet, type ScanVault } from "./scan.ts";

// ---- the real 17 vaults, read from the same JSON the app ships ------------------------------------------------------------------------

type Raw = { id: string; symbol: string; name: string; token: string; feed: string; entryFeeBps: number; depositCapUsd: number; gate: { state: "open" | "reduced" | "closed"; reason: string; worst_half_apr: number } };
const universe = JSON.parse(readFileSync(new URL("./vault-universe.json", import.meta.url), "utf8")) as { vaults: Raw[] };
const VAULTS: ScanVault[] = universe.vaults.map((v) => ({
  id: v.id, symbol: v.symbol, name: v.name, token: v.token as Address, feed: v.feed as Address, entryFeeBps: v.entryFeeBps, depositCapUsd: v.depositCapUsd,
  gate: { state: v.gate.state, reason: v.gate.reason, worstHalfApr: v.gate.worst_half_apr },
}));
const by = (id: string) => VAULTS.find((v) => v.id === id)!;
const mockChain = (...a: [Record<string, bigint>, Record<string, bigint>, { failBalanceOf?: string }?]) => mock(VAULTS, ...a);
const OWNER: Address = "0x28C66690Ae101a4f07546b07a2Ac8Eb439b6C245";

// ---- the address a visitor pastes -----------------------------------------------------------------------------------------------------

test("parseOwner accepts a checksummed or lowercase address, trims it, and rejects everything else", () => {
  assert.equal(parseOwner(OWNER), OWNER);
  assert.equal(parseOwner(`  ${OWNER.toLowerCase()}\n`), OWNER);
  assert.equal(parseOwner("0x000000000000000000000000000000000000dEaD"), "0x000000000000000000000000000000000000dEaD");
  const wrongChecksum = OWNER.slice(0, 10) + OWNER.slice(10).toUpperCase();
  assert.notEqual(wrongChecksum, OWNER);
  assert.equal(parseOwner(wrongChecksum), null);
  assert.equal(parseOwner("vitalik.eth"), null);
  assert.equal(parseOwner("0x1234"), null);
  assert.equal(parseOwner(""), null);
});

// ---- the math -------------------------------------------------------------------------------------------------------------------------

test("holding value is the balance in tokens times the price", () => {
  assert.equal(holdingUsd(2_500_000_000_000_000_000n, 18, 200), 500);
  assert.ok(Math.abs(holdingUsd(1n, 18, 200) - 200e-18) < 1e-30);
  assert.equal(holdingUsd(0n, 18, 200), 0);
});

test("kept per year is the weaker-half rate on the deposit net of the entry fee, and keeps its sign", () => {
  assert.equal(netOfFee(10_000, 35), 9_965);
  // $10,000 of a vault at +12% a year in its weaker half, 35 bp entry fee: 9,965 * 0.12
  assert.ok(Math.abs(keptPerYearUsd(10_000, 35, 12) - 1_195.8) < 1e-9);
  // a reduced vault whose weaker half kept -4.5% shows a loss, not a zero
  assert.ok(Math.abs(keptPerYearUsd(10_000, 35, -4.5) - -448.425) < 1e-9);
  assert.equal(keptPerYearUsd(0, 35, 12), 0);
  assert.equal(keptPerYearUsd(10_000, 35, 0), 0);
});

test("borrow room is the net deposit times the loan-to-value limit", () => {
  const lltv = 625_000_000_000_000_000n; // 62.5%, the AMZN market read on-chain
  assert.ok(Math.abs(borrowRoomUsd(10_000, 35, lltv) - 6_228.125) < 1e-9);
  assert.equal(borrowRoomUsd(0, 35, lltv), 0);
  assert.ok(Math.abs(borrowRoomUsd(10_000, 100, 860_000_000_000_000_000n) - 8_514) < 1e-9);
});

test("a vault takes the holding or its size, whichever is smaller", () => {
  assert.equal(placeableUsd(250_000, 100_000), 100_000);
  assert.equal(placeableUsd(40_000, 100_000), 40_000);
});

// ---- scanWallet against a mock transport that decodes every call (lib/scan-mock.ts) ----------------------------------------------------

test("scan reads every balance and feed in one eth_call, pinned to the head less the lag, and decodes to the right tokens", async () => {
  const nvda = by("nvda"), aapl = by("aapl"), tsla = by("tsla");
  const chain = mockChain(
    { [nvda.token.toLowerCase()]: 10n * E18, [aapl.token.toLowerCase()]: 3n * E18, [tsla.token.toLowerCase()]: E18 / 2n },
    Object.fromEntries(VAULTS.map((v) => [v.feed.toLowerCase(), px(v.id === "nvda" ? 200 : v.id === "aapl" ? 250 : 400)])),
  );
  const scan = await scanWallet(chain.client, OWNER, VAULTS, { nvda: 625_000_000_000_000_000n });

  // the calls themselves: one eth_blockNumber and one eth_call at head less the lag, holding 17 balanceOf for the owner at the 17 token addresses in order, then 17 round + decimals pairs on the 17 feeds
  assert.deepEqual(chain.rpc, ["eth_blockNumber", "eth_call"]);
  assert.equal(chain.ethCalls.length, 1);
  assert.equal(chain.ethCalls[0].at, toHex(HEAD - READ_LAG));
  const inner = chain.ethCalls[0].inner;
  assert.equal(inner.length, 17 + 34);
  inner.slice(0, 17).forEach((c, i) => {
    assert.equal(c.fn, "balanceOf");
    assert.equal(c.to, VAULTS[i].token.toLowerCase());
    assert.equal((c.args[0] as string).toLowerCase(), OWNER.toLowerCase());
  });
  inner.slice(17).forEach((c, i) => {
    assert.equal(c.to, VAULTS[Math.floor(i / 2)].feed.toLowerCase());
    assert.equal(c.fn, i % 2 === 0 ? "latestRoundData" : "decimals");
  });

  assert.equal(scan.block, HEAD - READ_LAG);
  assert.equal(scan.tracked, 17);
  assert.deepEqual(scan.rows.map((r) => r.symbol), ["NVDA", "AAPL", "TSLA"], "largest holding first");

  const row = (id: string) => scan.rows.find((r) => r.id === id)!;
  assert.equal(row("nvda").holdingUsd, 2000);
  assert.equal(row("nvda").state, "reduced");
  assert.equal(row("nvda").putToWorkUsd, 2000);
  assert.ok(Math.abs((row("nvda").keptPerYearUsd as number) - (2000 * 0.9965 * by("nvda").gate.worstHalfApr) / 100) < 1e-9, "written out by hand, not through keptPerYearUsd");
  assert.deepEqual(row("nvda").borrow, { kind: "room", usd: borrowRoomUsd(2000, 35, 625_000_000_000_000_000n), lltv: 62.5 });
  assert.equal(row("aapl").holdingUsd, 750);
  assert.deepEqual(row("aapl").borrow, { kind: "opens-with-market" });
  assert.equal(row("tsla").holdingUsd, 200);
  assert.equal(row("tsla").state, "closed");
  assert.equal(row("tsla").putToWorkUsd, null);
  assert.equal(row("tsla").keptPerYearUsd, null);
  assert.deepEqual(row("tsla").borrow, { kind: "none" });

  assert.equal(scan.totals.idleUsd, 2950);
  assert.equal(scan.totals.putToWork.tokens, 2);
  assert.equal(scan.totals.putToWork.usd, 2750);
  assert.equal(scan.totals.putToWork.borrowRoomUsd, null, "one working token has no market, so there is no total");
  assert.equal(scan.totals.refused.tokens, 1);
  assert.equal(scan.totals.refused.usd, 200);
  assert.equal(scan.totals.refused.reasons[0].symbol, "TSLA");
  assert.match(scan.totals.refused.reasons[0].reason, /^Closed/);
  assert.deepEqual(scan.totals.unpriced, []);
});

test("a holding above the vault's size counts only the part the vault takes", async () => {
  const nvda = by("nvda");
  const chain = mockChain({ [nvda.token.toLowerCase()]: 1000n * E18 }, { [nvda.feed.toLowerCase()]: px(200) });
  const scan = await scanWallet(chain.client, OWNER, VAULTS);
  const r = scan.rows[0];
  assert.equal(r.holdingUsd, 200_000);
  assert.equal(r.putToWorkUsd, nvda.depositCapUsd);
  assert.equal(scan.totals.idleUsd, 200_000);
  assert.equal(scan.totals.putToWork.usd, nvda.depositCapUsd);
  assert.equal(scan.totals.putToWork.holdingUsd, 200_000);
});

test("an empty wallet scans to no rows and zero totals", async () => {
  const chain = mockChain({}, Object.fromEntries(VAULTS.map((v) => [v.feed.toLowerCase(), px(100)])));
  const scan = await scanWallet(chain.client, "0x0000000000000000000000000000000000000000", VAULTS);
  assert.equal(scan.rows.length, 0);
  assert.equal(scan.tracked, 17);
  assert.equal(scan.totals.idleUsd, 0);
  assert.equal(scan.totals.putToWork.tokens, 0);
  assert.equal(scan.totals.refused.tokens, 0);
});

test("a held token whose feed fails is unpriced and in no dollar total", async () => {
  const nvda = by("nvda"), aapl = by("aapl");
  const chain = mockChain({ [nvda.token.toLowerCase()]: E18, [aapl.token.toLowerCase()]: E18 }, { [aapl.feed.toLowerCase()]: px(250) });
  const scan = await scanWallet(chain.client, OWNER, VAULTS);
  assert.deepEqual(scan.rows.map((r) => r.symbol), ["AAPL", "NVDA"]);
  assert.equal(scan.rows[1].holdingUsd, null);
  assert.equal(scan.rows[1].keptPerYearUsd, null);
  assert.deepEqual(scan.totals.unpriced, ["NVDA"]);
  assert.equal(scan.totals.idleUsd, 250);
  assert.equal(scan.totals.putToWork.tokens, 1);
});

test("a feed answering zero is a broken round, not a price", async () => {
  const nvda = by("nvda");
  const chain = mockChain({ [nvda.token.toLowerCase()]: E18 }, { [nvda.feed.toLowerCase()]: 0n });
  const scan = await scanWallet(chain.client, OWNER, VAULTS);
  assert.equal(scan.rows[0].priceUsd, null);
  assert.deepEqual(scan.totals.unpriced, ["NVDA"]);
});

test("a failed balance read is an error, never a zero", async () => {
  const chain = mockChain({}, {}, { failBalanceOf: "NVDA" });
  await assert.rejects(() => scanWallet(chain.client, OWNER, VAULTS), /balanceOf failed for NVDA/);
});

// ---- room: a live vault takes what its own maxDeposit says -----------------------------------------------------------------------------

const AAPL_VAULT: Address = "0x127eCb0e814EF0cC296910DFd5E946050d85534f";
const PLTR_VAULT: Address = "0xD769d94E43447937Eaa85Dc6AE291468649085a3";
/** AAPL and PLTR deployed at $5,000, every other vault launching. */
const WITH_LIVE: ScanVault[] = VAULTS.map((v) => ({ ...v, depositCapUsd: v.id === "aapl" || v.id === "pltr" ? 5_000 : v.depositCapUsd, vault: v.id === "aapl" ? AAPL_VAULT : v.id === "pltr" ? PLTR_VAULT : undefined }));
const liveBy = (id: string) => WITH_LIVE.find((v) => v.id === id)!;
const flat = (usd: number) => Object.fromEntries(WITH_LIVE.map((v) => [v.feed.toLowerCase(), px(usd)]));

test("a live vault near its cap takes the room it has left, not its size", async () => {
  const aapl = liveBy("aapl");
  // $20,000 of AAPL at $200; the vault holds $4,000 already, so its maxDeposit is 5 tokens ($1,000)
  const chain = mock(WITH_LIVE, { [aapl.token.toLowerCase()]: 100n * E18 }, flat(200), { rooms: { [AAPL_VAULT.toLowerCase()]: 5n * E18, [PLTR_VAULT.toLowerCase()]: 25n * E18 } });
  const scan = await scanWallet(chain.client, OWNER, WITH_LIVE);
  const r = scan.rows[0];
  assert.equal(r.vault, AAPL_VAULT);
  assert.equal(r.roomUsd, 1_000);
  assert.equal(r.putToWorkUsd, 1_000, "not the $5,000 size");
  assert.equal(scan.totals.putToWork.live.usd, 1_000);
  assert.deepEqual(scan.totals.putToWork.live.symbols, ["AAPL"]);
  // the call is one more entry in the same eth_call: the owner is the argument, the target the deployed vault
  const inner = chain.ethCalls[0].inner;
  assert.equal(chain.ethCalls.length, 1);
  assert.equal(inner.length, 17 + 34 + 2, "one maxDeposit per deployed vault");
  const rooms = inner.slice(17 + 34);
  assert.deepEqual(rooms.map((c) => [c.fn, c.to]), WITH_LIVE.filter((v) => v.vault).map((v) => ["maxDeposit", (v.vault as string).toLowerCase()]), "in the order of the vault list");
  for (const c of rooms) assert.equal((c.args[0] as string).toLowerCase(), OWNER.toLowerCase());
});

test("a paused or full vault reports no room, takes nothing, and is named as full rather than counted as working", async () => {
  const aapl = liveBy("aapl"), nvda = liveBy("nvda");
  const chain = mock(WITH_LIVE, { [aapl.token.toLowerCase()]: 100n * E18, [nvda.token.toLowerCase()]: 10n * E18 }, flat(200), { rooms: { [AAPL_VAULT.toLowerCase()]: 0n, [PLTR_VAULT.toLowerCase()]: 0n } });
  const scan = await scanWallet(chain.client, OWNER, WITH_LIVE);
  const a = scan.rows.find((r) => r.id === "aapl")!;
  assert.equal(a.roomUsd, 0);
  assert.equal(a.putToWorkUsd, 0);
  assert.equal(a.keptPerYearUsd, 0);
  assert.deepEqual(scan.totals.putToWork.full, ["AAPL"]);
  assert.equal(scan.totals.putToWork.live.usd, 0);
  assert.deepEqual(scan.totals.putToWork.live.symbols, []);
  // the launching NVDA still counts, on its size
  assert.equal(scan.totals.putToWork.tokens, 1);
  assert.equal(scan.totals.putToWork.launching.usd, 2_000);
  assert.deepEqual(scan.totals.putToWork.launching.symbols, ["NVDA"]);
});

test("the room caps the holding only when it is the smaller; a small holding is taken whole", async () => {
  const aapl = liveBy("aapl");
  const chain = mock(WITH_LIVE, { [aapl.token.toLowerCase()]: E18 / 10n }, flat(200), { rooms: { [AAPL_VAULT.toLowerCase()]: 25n * E18, [PLTR_VAULT.toLowerCase()]: 25n * E18 } });
  const r = (await scanWallet(chain.client, OWNER, WITH_LIVE)).rows[0];
  assert.equal(r.holdingUsd, 20);
  assert.equal(r.roomUsd, 5_000);
  assert.equal(r.putToWorkUsd, 20);
});

test("an uncapped vault and an unreadable maxDeposit leave the room unknown, and the vault's size stands in", async () => {
  const aapl = liveBy("aapl");
  const held = { [aapl.token.toLowerCase()]: 100n * E18 };
  const uncapped = await scanWallet(mock(WITH_LIVE, held, flat(200), { rooms: { [AAPL_VAULT.toLowerCase()]: 2n ** 256n - 1n, [PLTR_VAULT.toLowerCase()]: 0n } }).client, OWNER, WITH_LIVE);
  assert.equal(uncapped.rows[0].roomUsd, null);
  assert.equal(uncapped.rows[0].putToWorkUsd, 5_000);
  const unreadable = await scanWallet(mock(WITH_LIVE, held, flat(200), { rooms: {} }).client, OWNER, WITH_LIVE);
  assert.equal(unreadable.rows[0].roomUsd, null);
  assert.equal(unreadable.rows[0].putToWorkUsd, 5_000);
});

test("a vault that is launching is never asked for its room, and splits into the launching total", async () => {
  const nvda = liveBy("nvda");
  const chain = mock(WITH_LIVE, { [nvda.token.toLowerCase()]: 10n * E18 }, flat(200), { rooms: { [AAPL_VAULT.toLowerCase()]: 5n * E18, [PLTR_VAULT.toLowerCase()]: 5n * E18 } });
  const scan = await scanWallet(chain.client, OWNER, WITH_LIVE);
  assert.equal(scan.rows[0].vault, null);
  assert.equal(scan.rows[0].roomUsd, null);
  assert.equal(scan.totals.putToWork.live.usd, 0);
  assert.equal(scan.totals.putToWork.launching.usd, 2_000);
  assert.equal(scan.totals.putToWork.usd, 2_000);
  assert.deepEqual(scan.totals.putToWork.full, []);
});
