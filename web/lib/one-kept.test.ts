import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const universe = JSON.parse(src("lib/vault-universe.json")) as { vaults: Array<{ id: string; gate: { worst_half_apr: number } }> };

// Every screen that prints a "you keep" rate: /vaults list, vault page, deposit panel, earn-and-borrow, /check (idle-finder via scan), home (home-view), portfolio.
const KEPT_SCREENS = ["vault-row", "vault-list", "vault-detail", "deposit-panel", "earn-borrow", "gate-scale", "portfolio", "idle-finder", "home-view"].map((n) => `components/${n}.tsx`);

test("the shared selector VAULTS[].gate.worstHalfApr is vault-universe.json gate.worst_half_apr, for all 17 vaults", () => {
  assert.equal(universe.vaults.length, 17);
  assert.match(src("lib/vaults.ts"), /worstHalfApr: v\.gate\.worst_half_apr/, "VAULTS maps the universe figure straight through");
  assert.match(src("lib/scan.ts"), /worstHalfApr: v\.gate\.worstHalfApr/, "scan rows (/check, idle finder) take the universe figure");
  assert.ok(universe.vaults.every((u) => Number.isFinite(u.gate.worst_half_apr)));
});

test("PLTR keeps the replayed 7.9, not the pre-snap 12.8", () => {
  const pltr = universe.vaults.find((v) => v.id === "pltr")!;
  assert.equal(pltr.gate.worst_half_apr.toFixed(1), "7.9");
});

test("no screen reads its kept rate or gate from the live keeper evidence", () => {
  for (const f of KEPT_SCREENS) {
    assert.ok(!/useEvidence/.test(src(f)), `${f} reads the keeper evidence payload; kept rates come from vault-universe.json only`);
  }
});

test("the screens that print the rate read it from the universe gate", () => {
  for (const f of ["vault-row", "vault-list", "vault-detail", "deposit-panel", "earn-borrow", "gate-scale", "portfolio"].map((n) => `components/${n}.tsx`)) {
    assert.match(src(f), /\.worstHalfApr/, `${f} does not read gate.worstHalfApr`);
  }
});
