// Hourly pool price and Chainlink rounds for the stats API chart, for the chosen pool of every eligible token, from the swap pulls
// in data/engine (replay/pull.py). Run: bun scripts/build-history.ts   (writes data/history.json)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { priceFromSqrt } from "../src/price.ts";
import { eligibleTickers, readReplay, readUniverse } from "../src/registry.ts";

const ENGINE = new URL("../data/engine/", import.meta.url).pathname;
const DAYS = 14;
const grid = Object.entries(JSON.parse(readFileSync(ENGINE + "grid.json", "utf8")) as Record<string, number>).map(([b, t]) => [Number(b), t] as const).sort((a, b) => a[0] - b[0]);
function blockToSec(b: number): number {
  let lo = 0, hi = grid.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (grid[m][0] <= b) lo = m; else hi = m; }
  const [b0, t0] = grid[lo], [b1, t1] = grid[hi];
  return t0 + ((b - b0) / (b1 - b0)) * (t1 - t0);
}
const replay = readReplay();
const endSec = Math.floor(Date.parse(replay.window.end) / 1000 / 3600) * 3600;
const startSec = endSec - DAYS * 86400;

const out: Record<string, unknown> = {};
for (const t of eligibleTickers(readUniverse(), replay)) {
  if (t.venue === "v4") continue; // this builder reads v3 swap files, a v4 pool has none
  const cl = (JSON.parse(readFileSync(ENGINE + `cl-${t.symbol}.json`, "utf8")) as [number, number, number][]).map(([, a, ts]) => [ts, a / 1e8] as [number, number]).sort((a, b) => a[0] - b[0]);
  const dir = ENGINE + `v3/${t.pool.toLowerCase()}`;
  const last = new Map<number, number>(); // hour start -> last swap price in that hour
  for (const f of readdirSync(dir).sort()) {
    for (const r of JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as number[][]) {
      const s = blockToSec(r[0]);
      if (s < startSec - 3600 || s >= endSec) continue;
      last.set(Math.floor(s / 3600) * 3600, priceFromSqrt(BigInt(Math.round(r[2])), t.stockIsToken0));
    }
  }
  const clAt = (s: number) => { let v = cl[0][1]; for (const [ts, p] of cl) { if (ts <= s) v = p; else break; } return v; };
  const hourly: [number, number][] = [];
  let carry: number | undefined;
  for (let s = startSec; s < endSec; s += 3600) {
    const p = last.get(s) ?? carry;
    // a swap through an empty tick range prints a price far from the oracle; drop it
    if (p !== undefined && Math.abs(p / clAt(s + 3600) - 1) < 0.25) { carry = p; hourly.push([s + 3600, +p.toFixed(4)]); }
  }
  out[t.symbol] = { hourly, chainlink: cl.filter(([ts]) => ts >= startSec - 7 * 86400) };
  console.log(t.symbol, "hourly", hourly.length, "chainlink", (out[t.symbol] as any).chainlink.length, "first", hourly[0], "last", hourly.at(-1));
}
writeFileSync(new URL("../data/history.json", import.meta.url), JSON.stringify({ head_block: Number(readUniverse().block), window_days: DAYS, tickers: out }));
