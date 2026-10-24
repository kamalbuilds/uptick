import assert from "node:assert/strict";
import { test } from "node:test";
import { REVERTS, knownRevert, revertCopy } from "./revert.ts";

const wrap = (data: string) => Object.assign(new Error("contract call reverted"), { cause: Object.assign(new Error("inner"), { cause: { data } }) });

test("each known selector, nested in the cause chain, maps to its own sentence", () => {
  for (const r of REVERTS) assert.equal(revertCopy(wrap(`${r.selector}${"0".repeat(64)}`)), r.copy);
  assert.equal(new Set(REVERTS.map((r) => r.copy)).size, REVERTS.length);
});

test("the two new vault errors read as the spec says", () => {
  assert.equal(revertCopy(wrap("0xe16ad561")), "The pool price is moving. Deposits reopen when it settles, usually within minutes.");
  assert.equal(revertCopy(wrap("0x7a1cb75d")), "Fresh shares can move from the next block, about 12 seconds after the deposit. Try again in a moment.");
});

test("a wallet that relays only text still gets the sentence by error name", () => {
  assert.equal(revertCopy(new Error("execution reverted: SharesLocked()")), REVERTS[3].copy);
});

test("an unknown selector and a plain error fall through to null so the raw message is shown", () => {
  assert.equal(revertCopy(wrap("0xdeadbeef")), null);
  assert.equal(revertCopy(new Error("User rejected the request.")), null);
});

test("selectors are the hash of the contract's error signatures (contracts/src/StockVault.sol, UptickRouter.sol)", async () => {
  const { toFunctionSelector } = await import("viem");
  const sigs = { Unhealthy: "Unhealthy(uint8)", InsufficientShares: "InsufficientShares(uint256,uint256)", SpotOffTwap: "SpotOffTwap()", SharesLocked: "SharesLocked()", ExitBelowMinimum: "ExitBelowMinimum(uint256,uint256)" } as const;
  for (const r of REVERTS) assert.equal(toFunctionSelector(sigs[r.name]), r.selector, r.name);
});

test("ExitBelowMinimum is recognised by name so the panel can offer the in-kind exit", () => {
  assert.equal(knownRevert(wrap("0x3b751a36"))?.name, "ExitBelowMinimum");
  assert.equal(revertCopy(wrap("0x3b751a36")), "The pool cannot fill this exit right now. Exit in kind always works.");
  assert.equal(knownRevert(wrap("0x7a1cb75d"))?.name, "SharesLocked");
  assert.equal(knownRevert(new Error("User rejected the request.")), null);
});
