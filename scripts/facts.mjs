#!/usr/bin/env node
/** One source for every number a public surface repeats. Writes docs/facts.json; scripts/check-facts.sh greps the public files for stale strings.
 *  Run from anywhere: node scripts/facts.mjs. Needs forge on PATH and a built contracts/ (forge test --list compiles if it is not). */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const must = (m, what) => { if (!m) throw new Error(`facts: could not read ${what}`); return m; };

// Tests: every test function forge discovers, split by whether it lives under test/security.
const listing = JSON.parse(execFileSync("forge", ["test", "--list", "--json"], { cwd: resolve(root, "contracts"), encoding: "utf8", maxBuffer: 64 << 20 }));
const perFile = Object.entries(listing).map(([file, suites]) => [file, Object.values(suites).reduce((n, fns) => n + fns.length, 0)]);
const total = perFile.reduce((n, [, c]) => n + c, 0);
const security = perFile.filter(([f]) => f.startsWith("test/security/")).reduce((n, [, c]) => n + c, 0);
if (!(total > 0 && security > 0)) throw new Error("facts: forge test --list returned no tests");

// Review reports: SECURITY-REVIEW* is the rounds, SECURITY-REREVIEW* the re-read of a round's fixes.
const files = readdirSync(resolve(root, "contracts")).sort();
const reviews = files.filter((f) => /^SECURITY-REVIEW.*\.md$/.test(f));
const rereviews = files.filter((f) => /^SECURITY-REREVIEW.*\.md$/.test(f));

// Doors: the universe the app and the API serve.
const universe = JSON.parse(read("web/lib/vault-universe.json"));
const by = (s) => universe.vaults.filter((v) => v.gate.state === s);
const doors = {
  vaults: universe.vaults.length,
  open: by("open").length, reduced: by("reduced").length, closed: by("closed").length,
  takes_deposits: by("open").length + by("reduced").length,
  open_symbols: by("open").map((v) => v.symbol), reduced_symbols: by("reduced").map((v) => v.symbol), closed_symbols: by("closed").map((v) => v.symbol),
  v3: universe.vaults.filter((v) => v.venue === "v3").length, v4: universe.vaults.filter((v) => v.venue === "v4").length,
  replay_days: universe.window.days,
  replay_swaps: universe.vaults.reduce((n, v) => n + v.gate.swaps, 0),
};
if (doors.open + doors.reduced + doors.closed !== doors.vaults) throw new Error("facts: a vault has a gate state outside open, reduced, closed");

// Fees: the performance fee the deploy script launches with, the entry fee each vault carries, the range per token.
const perf = must(read("contracts/script/DeployAll.s.sol").match(/vm\.envOr\("PERF_FEE_BPS",\s*uint256\((\d+)\)\)/), "PERF_FEE_BPS default in DeployAll.s.sol");
const cap = must(read("contracts/src/StockVault.sol").match(/_within\(p\.perfFeeBps,\s*0,\s*(\d+)\)/), "perfFeeBps bound in StockVault.sol");
const params = JSON.parse(read("keeper/data/params.json"));
const entry = universe.vaults.map((v) => v.entryFeeBps);
const fee = {
  perf_fee_bps_at_launch: Number(perf[1]), perf_fee_bps_max: Number(cap[1]),
  entry_fee_bps_min: Math.min(...entry), entry_fee_bps_max: Math.max(...entry),
  range_bps_by_symbol: Object.fromEntries(Object.entries(params).map(([s, p]) => [s, p.range_bps])),
};

// The weekend study behind the paper is its own sample, separate from the 30-day replay that gates the vaults.
const abs = must(read("paper/main.tex").match(/We replay ([\d,]+) swaps on three Stock Token pools over (\d+) days/), "sample size in paper/main.tex");
const study = { swaps: Number(abs[1].replaceAll(",", "")), days: Number(abs[2]), pools: 3, source: "paper/main.tex abstract" };

// MCP tools: the entries of the TOOLS array in api/src/mcp.ts (what tools/list returns).
const mcpSrc = read("api/src/mcp.ts");
const toolsBlock = must(mcpSrc.match(/const TOOLS: McpTool\[\] = \[([\s\S]*?)\n\];/), "TOOLS array in api/src/mcp.ts");
const mcp = { tools: [...toolsBlock[1].matchAll(/^ {4}name: "([a-z_]+)"/gm)].map((m) => m[1]) };
mcp.count = mcp.tools.length;
if (mcp.count === 0) throw new Error("facts: no MCP tools found");

// Mutation checks: rows of every "| Mutation | Tests that went red |" table in contracts/SECURITY.md whose second cell names a test that went red.
// A row whose cell starts with "none" is a documented non-guard and is not counted.
const mutations = { by_table: [], total: 0 };
{
  const lines = read("contracts/SECURITY.md").split("\n");
  let section = "", inTable = false, n = 0, name = "";
  const flush = () => { if (inTable) mutations.by_table.push({ section: name, checks: n }); inTable = false; };
  for (const l of lines) {
    if (l.startsWith("## ")) { flush(); section = l.slice(3); }
    if (/^\| Mutation \| Tests that went red \|/.test(l)) { flush(); inTable = true; n = 0; name = section; continue; }
    if (inTable) {
      if (!l.startsWith("|")) { flush(); continue; }
      if (/^\|[-| ]+\|$/.test(l)) continue;
      const cell = l.split("|")[2]?.trim() ?? "";
      if (cell && !/^none/i.test(cell)) n++;
    }
  }
  flush();
  mutations.total = mutations.by_table.reduce((a, t) => a + t.checks, 0);
  if (!(mutations.by_table.length >= 3 && mutations.total > 0)) throw new Error("facts: mutation tables not found in contracts/SECURITY.md");
}

// SPCX holders: Blockscout API v2 /tokens/<addr>, docs/research/founder-house/PLATFORM-TRUTH.md "Stock Tokens" table (outside this repo), read 2026-10-16. One value for every surface.
const holders = { spcx: 114222, nvda: 189012, read_at: "2026-10-16", source: "Blockscout API v2 /tokens/<addr> via docs/research/founder-house/PLATFORM-TRUTH.md Stock Tokens table" };

// The two weekend fee-per-$1-lost samples. The 30-day replay (17 gate pools) is web/lib/moment.json; the study is the fixed-range spike.
const moment = JSON.parse(read("web/lib/moment.json"));
const feePerDollarLost = {
  replay_30d: Object.fromEntries(Object.entries(moment.sessions).map(([k, v]) => [k, { vault: v.feePerDollarLost, pool: v.poolFeePerDollarLost }])),
  replay_label: "30-day replay",
  spike: { weekend: 13.64, nyse: 1.16, sample: "fixed range, NVDA, SPCX and TSLA pools, 24 August to 17 October 2026 (54 days), 5,113,049 swaps", source: "spikes/stock-vaults/FINDINGS.md" },
};

const repo = "https://github.com/kamalbuilds/uptick";

const facts = {
  generated_by: "scripts/facts.mjs",
  sources: {
    tests: "forge test --list --json in contracts/",
    reviews: "ls contracts/SECURITY-REVIEW* and contracts/SECURITY-REREVIEW*",
    doors: "web/lib/vault-universe.json",
    fee: "contracts/script/DeployAll.s.sol PERF_FEE_BPS default, contracts/src/StockVault.sol perfFeeBps bound, web/lib/vault-universe.json entryFeeBps, keeper/data/params.json",
    study: "paper/main.tex",
    mcp: "TOOLS array in api/src/mcp.ts",
    mutations: "contracts/SECURITY.md tables headed Mutation | Tests that went red, rows that name a test",
    holders: "constant in this script, read 2026-10-16 from Blockscout (see holders.source)",
    fee_per_dollar_lost: "web/lib/moment.json and the spike constants in this script",
  },
  tests: { total, security },
  reviews: { files: reviews, count: reviews.length, rereview_files: rereviews, reports_total: reviews.length + rereviews.length },
  mcp, mutations, holders, fee_per_dollar_lost: feePerDollarLost, repo,
  doors, fee, study,
};
writeFileSync(resolve(root, "docs/facts.json"), JSON.stringify(facts, null, 2) + "\n");
console.log(JSON.stringify({ tests: facts.tests, reviews: facts.reviews.reports_total, doors: [doors.open, doors.reduced, doors.closed], perf_fee_bps: fee.perf_fee_bps_at_launch }));
