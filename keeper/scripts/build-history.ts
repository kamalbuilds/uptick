// Hourly pool price and Chainlink rounds for the stats API chart, from the cached swap pulls in spikes/stock-vaults/data.
// Run: bun scripts/build-history.ts   (writes data/history.json)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { priceFromSqrt } from "../src/price.ts";

const SPIKE = new URL("../../../spikes/stock-vaults/data/", import.meta.url).pathname;
const DAYS = 14;
const POOLS: Record<string, { dir: string; stockIsToken0: boolean; cl: string }> = {
  NVDA: { dir: "NVDA500", stockIsToken0: false, cl: "cl-NVDA.json" },
  TSLA: { dir: "TSLA3000", stockIsToken0: true, cl: "cl-TSLA.json" },
  SPCX: { dir: "SPCX500", stockIsToken0: true, cl: "cl-SPCX.json" },
};
const grid = Object.entries(JSON.parse(readFileSync(SPIKE + "grid.json", "utf8")) as Record<string, number>).map(([b, t]) => [Number(b), t] as const).sort((a, b) => a[0] - b[0]);
function blockToSec(b: number): number {
  let lo = 0, hi = grid.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (grid[m][0] <= b) lo = m; else hi = m; }
  const [b0, t0] = grid[lo], [b1, t1] = grid[hi];
  return t0 + ((b - b0) / (b1 - b0)) * (t1 - t0);
}
const headBlock = Number(readFileSync(SPIKE + "head.txt", "utf8").trim());
const endSec = Math.floor(blockToSec(headBlock) / 3600) * 3600;
const startSec = endSec - DAYS * 86400;

const out: Record<string, unknown> = {};
for (const [sym, c] of Object.entries(POOLS)) {
  const cl = (JSON.parse(readFileSync(SPIKE + c.cl, "utf8")) as [number, number, number][]).map(([, a, ts]) => [ts, a / 1e8] as [number, number]).sort((a, b) => a[0] - b[0]);
  const last = new Map<number, number>(); // hour start -> last swap price in that hour
  for (const f of readdirSync(SPIKE + `v3/${c.dir}`).sort()) {
    for (const r of JSON.parse(readFileSync(SPIKE + `v3/${c.dir}/${f}`, "utf8")) as number[][]) {
      const t = blockToSec(r[0]);
      if (t < startSec - 3600 || t >= endSec) continue;
      last.set(Math.floor(t / 3600) * 3600, priceFromSqrt(BigInt(Math.round(r[2])), c.stockIsToken0));
    }
  }
  const clAt = (t: number) => { let v = cl[0][1]; for (const [ts, p] of cl) { if (ts <= t) v = p; else break; } return v; };
  const hourly: [number, number][] = [];
  let carry: number | undefined;
  for (let t = startSec; t < endSec; t += 3600) {
    const p = last.get(t) ?? carry;
    // a swap through an empty tick range prints a price far from the oracle; drop it
    if (p !== undefined && Math.abs(p / clAt(t + 3600) - 1) < 0.25) { carry = p; hourly.push([t + 3600, +p.toFixed(4)]); }
  }
  out[sym] = { hourly, chainlink: cl.filter(([ts]) => ts >= startSec - 7 * 86400) };
  console.log(sym, "hourly", hourly.length, "chainlink", (out[sym] as any).chainlink.length, "first", hourly[0], "last", hourly.at(-1));
}
writeFileSync(new URL("../data/history.json", import.meta.url), JSON.stringify({ head_block: headBlock, window_days: DAYS, tickers: out }));
