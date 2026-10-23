#!/usr/bin/env node
// Writes docs/DIY-BASELINE.md from keeper/data/diy-baseline.json: hold vs a set-once Uniswap position vs the Uptick vault, per token,
// in the half the gate reads (the vault's weaker half). Run after keeper/replay/diy_baseline.py.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const d = JSON.parse(readFileSync(new URL("keeper/data/diy-baseline.json", root), "utf8"));
const state = Object.fromEntries(JSON.parse(readFileSync(new URL("web/lib/vault-universe.json", root), "utf8")).vaults.map((v) => [v.symbol, v.gate.state]));
const halfDays = d.window.days / 2;
const signed = (x, dp = 1) => { const v = Math.abs(x) < 0.5 * 10 ** -dp ? 0 : x; return (v >= 0 ? "+" : "") + v.toFixed(dp) + "%"; };
const period = (apr) => apr * halfDays / 365; // annualised -> the half's own return on the deposit
const order = { open: 0, reduced: 1, closed: 2 };
const syms = Object.keys(d.tokens).sort((a, b) => order[state[a]] - order[state[b]] || d.tokens[b].vault.gate_half_edge_apr_pct - d.tokens[a].vault.gate_half_edge_apr_pct);
const label = { calibration: "first 15 days", test: "last 15 days" };
const rows = syms.map((s) => {
  const t = d.tokens[s];
  return `| ${s} | ${state[s][0].toUpperCase() + state[s].slice(1)} | ${label[t.gate_half]} | ${signed(t.hold[t.gate_half].price_move_pct)} | ${signed(period(t.set_and_forget.gate_half_total_return_apr_pct))} | ${signed(period(t.vault.gate_half_total_return_apr_pct))} | ${signed(t.set_and_forget.gate_half_edge_apr_pct)} | ${signed(t.vault.gate_half_edge_apr_pct)} |`;
});
const n = syms.length;
const within2 = syms.filter((s) => Math.abs(d.tokens[s].vault.gate_half_edge_apr_pct - d.tokens[s].set_and_forget.gate_half_edge_apr_pct) <= 2).length;
const aheadOfHold = syms.filter((s) => d.tokens[s].vault.gate_half_total_return_apr_pct > d.tokens[s].hold.gate_half_return_apr_pct).length;
const md = `# Doing it yourself

Three ways to own the same Stock Token across the same 30 days, priced half by half on the same swaps with the same markout and cost model as the gate: hold it, open one Uniswap position by hand and leave it, or deposit into the Uptick vault, which recentres once a day after each NYSE session. Window ${d.window.start.slice(0, 10)} to ${d.window.end.slice(0, 10)}, two halves of ${halfDays} days. Every range bound of the set-once position and of the vault sits on a multiple of its pool's tick spacing, rounded outward, so each is a position Uniswap can hold.

All ${n} tokens are read in the half the gate reads, the vault's weaker half by kept:

- **Hold** is the token's price move at the vault's pool over the half: no fees, no position, the full inventory drift.
- **Set once** is one position in the vault's pool at the vault's band width, centred on the pool price at the start of the window and never moved. Its return is what the depositor of the token ends with against the deposit: the fees plus the position's mark at the end, less the deposit.
- **Uptick vault** is the same measure for the vault.
- **Kept** is the gate's own unit: fees less losses to informed traders and rebalancing cost, annualised, with the position's own price drift left out.

<!-- diy:start -->
| Token | Gate | Half read | Hold | Set once | Uptick vault | Set once kept a year | Vault kept a year |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}
<!-- diy:end -->

Returns are over the half's ${halfDays} days, on the deposit. A vault holds roughly half stock and half USDG while the price sits inside its range, so its return carries about half of the stock's move; the kept columns leave that move out.

## What the table shows

- The vault's return beats holding the token in ${aheadOfHold} of ${n} gate halves, because it carries only part of every move.
- In kept, a set-once range and the vault land within 2 points of each other on ${within2} of ${n} tokens.
- The vault is a position nobody has to watch. It recentres itself, its share is an ERC-4626 token, \`redeemInKind\` pays out both tokens, and a share is collateral a lender can price: a set-once Uniswap position cannot be posted as Morpho collateral; an Uptick share can, through \`UptickShareOracle\` in a Morpho Blue market.

Source: \`keeper/data/diy-baseline.json\`, written by \`keeper/replay/diy_baseline.py\` over \`keeper/data/replay.json\`; this page is written by \`scripts/diy-table.mjs\`.
`;
writeFileSync(new URL("docs/DIY-BASELINE.md", root), md);
console.log(`docs/DIY-BASELINE.md: ${n} tokens`);
