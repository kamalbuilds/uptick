import assert from "node:assert/strict";
import { test } from "node:test";
import { inKindSlice, type VaultHoldings } from "./in-kind.ts";

const h: VaultHoldings = { supply: 1000n, idleStock: 100n, idleUsdg: 40n, positionStock: 500n, positionUsdg: 300n, feesStock: 10n, feesUsdg: 20n };

test("a tenth of the supply takes a tenth of every bucket of both tokens", () => {
  assert.deepEqual(inKindSlice(100n, h), { stock: 61n, usdg: 36n });
});

test("the whole supply takes everything the vault holds", () => {
  assert.deepEqual(inKindSlice(1000n, h), { stock: 610n, usdg: 360n });
});

test("zero shares, an empty vault and shares above supply give no quote", () => {
  assert.equal(inKindSlice(0n, h), null);
  assert.equal(inKindSlice(1n, { ...h, supply: 0n }), null);
  assert.equal(inKindSlice(1001n, h), null);
});

test("rounds down so the quote never promises more than the vault pays", () => {
  assert.deepEqual(inKindSlice(1n, h), { stock: 0n, usdg: 0n });
  assert.deepEqual(inKindSlice(3n, h), { stock: 1n, usdg: 1n });
});
