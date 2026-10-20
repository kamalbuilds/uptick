#!/usr/bin/env node
// Rewrites README.md's gate table (between the gates:start / gates:end markers) from web/lib/vault-universe.json, so the
// table can never drift from the data the app, API and deploy list read. Run after keeper/scripts/export-web.ts.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const u = JSON.parse(readFileSync(new URL("web/lib/vault-universe.json", root), "utf8"));
const pct = (x) => (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
const order = { open: 0, reduced: 1, closed: 2 };
const reason = (v) =>
  v.gate.state === "open" ? "Both halves at or above break-even"
  : v.gate.state === "reduced" ? `Weaker half between -20% and break-even; up to $${Math.min(25000, v.depositCapUsd).toLocaleString("en-US")} a deposit`
  : "Weaker half below the -20% floor, the gate shuts deposits";
const rows = [...u.vaults]
  .sort((a, b) => order[a.gate.state] - order[b.gate.state] || b.gate.worst_half_apr - a.gate.worst_half_apr)
  .map((v) => `| ${v.symbol} | ±${(v.bandBps / 100).toFixed(1).replace(/\.0$/, "")}% | $${v.depositCapUsd.toLocaleString("en-US")} | ${pct(v.keep.kept_first_half)} | ${pct(v.keep.kept_second_half)} to ${pct(v.keep.kept_second_half_upper)} | ${v.gate.state[0].toUpperCase() + v.gate.state.slice(1)} | ${reason(v)} |`);
const table = ["| Vault | Band | Vault size cap | First half kept | Held-out half kept (conservative to upper) | Status | Reason |", "|---|---|---|---|---|---|---|", ...rows].join("\n");
const p = new URL("README.md", root);
const s = readFileSync(p, "utf8");
const re = /<!-- gates:start -->[\s\S]*?<!-- gates:end -->/;
if (!re.test(s)) throw new Error("README.md has no <!-- gates:start --> / <!-- gates:end --> markers");
writeFileSync(p, s.replace(re, `<!-- gates:start -->\n${table}\n<!-- gates:end -->`));
console.log(`README gate table: ${rows.length} vaults`);
