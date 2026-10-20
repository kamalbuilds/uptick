// Review 4 liveness measurement for maxTwapOracleBps (30 bp) on every deployable vault's pool.
// For each pool, every STEP seconds back through the pool's observation ring: the 600 s TWAP tick (the vault's
// twapWindow), the spot tick (1 s mean), and the Chainlink answer in force at that second (getRoundData walk).
// A second is "rebalanceable" when the feed is at most 90,000 s old, |TWAP vs feed| <= 30 bp and |spot vs TWAP| <= 10 bp,
// the three checks rebalance() makes besides the oracle-gate 100 bp ones (which the 30 bp one implies for the TWAP).
// Reports the share of samples in bound and the longest contiguous stretch out of bound.
// Usage: node test/security/twap-feed-liveness.mjs [hours=96] [step=120]   (public keyless RPC, read-only)
import { createPublicClient, http, parseAbi } from "../../../keeper/node_modules/viem/_esm/index.js";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const HOURS = Number(process.argv[2] ?? 96);
const STEP = Number(process.argv[3] ?? 120);
const WINDOW = 600;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168".toLowerCase();
const VAULTS = [
  ["AAPL", "0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D", "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0"],
  ["AMD", "0x48D284A2A4d3DC1b3Da08231Fe44317e7e7Aa51f", "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72"],
  ["AMZN", "0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef", "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C"],
  ["GOOGL", "0x34D0dC122CF9A8Eb296fC5e0D3A233625D7d19b7", "0xF6f373a037c30F0e5010d854385cA89185AE638b"],
  ["INTC", "0x2e5a92f5013a64661A49312111be2e8aBd33F56a", "0x3f390C5C24628Ac7C489515402235FeAD71D1913"],
  ["META", "0x107a7Cb40d8665360ba10E59471Af06150A50922", "0x7C38C00C30BEe9378381E7B6135d7283356D71b1"],
  ["MU", "0xd057B1Bc54917855BBee58eAd58647f47caB35E5", "0x425EEFdCf05ed6526C3cE61Af99429A228a6d596"],
  ["NVDA", "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3", "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15"],
  ["QQQ", "0xD60A5d14dB690B7Afad71F76B108071D7175597d", "0x80901d846d5D7B030F26B480776EE3b29374C2ae"],
  ["SPY", "0xa7Bb1AC63BBaB0C44316E6c8C455213441689167", "0x319724394D3A0e3669269846abE664Cd621f9f6A"],
  ["USO", "0x02175608F1b5E6b5ed221cCFdC7Be197D111D915", "0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c"],
];
const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function observations(uint256) view returns (uint32,int56,uint160,bool)",
  "function observe(uint32[]) view returns (int56[],uint160[])",
]);
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
  "function decimals() view returns (uint8)",
]);
const c = createPublicClient({ transport: http(RPC, { retryCount: 6, retryDelay: 800, timeout: 60_000 }) });
const read = (address, abi, functionName, args = [], blockNumber) =>
  c.readContract({ address, abi, functionName, args, blockNumber });

// NYSE regular session 13:30-20:00 UTC (EDT, valid for Oct 2026), Mon-Fri.
const nyse = (t) => {
  const d = new Date(t * 1000);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const wd = d.getUTCDay();
  return wd >= 1 && wd <= 5 && m >= 810 && m < 1200;
};
// |a vs b| in bp from two ticks: 1.0001^|ta - tb| - 1 (sign-free, as StockVault._deviates)
const tickGapBps = (ta, tb) => (Math.pow(1.0001, Math.abs(ta - tb)) - 1) * 1e4;

async function run([sym, pool, feed]) {
  const blk = await c.getBlockNumber();
  const now = Number((await c.getBlock({ blockNumber: blk })).timestamp);
  const token0 = (await read(pool, poolAbi, "token0", [], blk)).toLowerCase();
  const stockIs0 = token0 !== USDG;
  const [, , obsIdx, card] = await read(pool, poolAbi, "slot0", [], blk);
  let oldest = await read(pool, poolAbi, "observations", [BigInt((obsIdx + 1) % card)], blk);
  if (!oldest[3]) oldest = await read(pool, poolAbi, "observations", [0n], blk);
  const depth = now - Number(oldest[0]);
  const span = Math.min(HOURS * 3600, depth - WINDOW - 2);
  // feed rounds back to now - span - 90000
  const fdec = await read(feed, feedAbi, "decimals", [], blk);
  const rounds = [];
  let [rid, ans, , upd] = await read(feed, feedAbi, "latestRoundData", [], blk);
  rounds.push([Number(upd), Number(ans) / 10 ** fdec]);
  while (Number(upd) > now - span - 90_000) {
    rid -= 1n;
    try {
      [, ans, , upd] = await read(feed, feedAbi, "getRoundData", [rid], blk);
    } catch { break; }
    if (Number(upd) === 0) break;
    rounds.push([Number(upd), Number(ans) / 10 ** fdec]);
  }
  rounds.sort((a, b) => a[0] - b[0]);
  const feedAt = (t) => {
    let r = null;
    for (const x of rounds) if (x[0] <= t) r = x; else break;
    return r;
  };
  // samples: secondsAgo s in [0, span], step STEP; need cum at s, s+1 (spot) and s+WINDOW (TWAP)
  const samples = [];
  for (let s = 0; s <= span; s += STEP) samples.push(s);
  const ago = [];
  for (const s of samples) ago.push(s, s + 1, s + WINDOW);
  const cum = [];
  const CHUNK = 240;
  for (let i = 0; i < ago.length; i += CHUNK) {
    const [ticks] = await read(pool, poolAbi, "observe", [ago.slice(i, i + CHUNK)], blk);
    cum.push(...ticks.map(Number));
  }
  const tickToUsd = (tick) => (stockIs0 ? Math.pow(1.0001, tick) * 1e12 : 1e12 / Math.pow(1.0001, tick));
  const rows = samples.map((s, i) => {
    const t = now - s;
    const spotTick = cum[3 * i] - cum[3 * i + 1];
    const d = cum[3 * i] - cum[3 * i + 2];
    const twapTick = Math.floor(d / WINDOW);
    const f = feedAt(t);
    const twapUsd = tickToUsd(twapTick);
    const gapExact = f ? Math.max(twapUsd / f[1], f[1] / twapUsd) * 1e4 - 1e4 : Infinity;
    const stale = !f || t - f[0] > 90_000;
    const band = tickGapBps(spotTick, twapTick);
    return { t, gap: gapExact, stale, band, nyse: nyse(t) };
  }).reverse();
  const ok = (r) => !r.stale && r.gap <= 30 && r.band <= 10;
  const okBound = (r) => !r.stale && r.gap <= 30;
  const longest = (pred, subset) => {
    let best = 0, cur = 0, start = 0, bestStart = 0;
    for (const r of subset) {
      if (!pred(r)) { if (cur === 0) start = r.t; cur += STEP; if (cur > best) { best = cur; bestStart = start; } }
      else cur = 0;
    }
    return [best, bestStart];
  };
  const pct = (xs, p) => (xs.length ? (100 * xs.filter(p).length) / xs.length : NaN);
  const ny = rows.filter((r) => r.nyse);
  const [lAll, lAllStart] = longest(ok, rows);
  const [lBound] = longest((r) => r.stale || r.gap <= 30, rows); // feed fresh but TWAP more than 30 bp off it
  // longest stretch out of bound counting only NYSE minutes: sequences over consecutive NYSE samples
  let lNy = 0, cur = 0, prevT = 0;
  for (const r of ny) {
    if (!ok(r)) { cur += STEP; lNy = Math.max(lNy, cur); } else cur = 0;
    prevT = r.t;
  }
  // per-24h-window: is there at least one rebalanceable sample in every rolling 24 h window?
  let worstGap24 = 0, lastOk = rows[0].t;
  for (const r of rows) { if (ok(r)) { worstGap24 = Math.max(worstGap24, r.t - lastOk); lastOk = r.t; } }
  worstGap24 = Math.max(worstGap24, rows[rows.length - 1].t - lastOk);
  // keeper recentre slots (keeper/src/calendar.ts): 02:00-08:00 UTC Tue-Sat, after each weekday session (holidays ignored)
  const slots = [];
  for (const r of rows) {
    const d = new Date(r.t * 1000), h = d.getUTCHours(), wd = d.getUTCDay();
    if (h < 2 || h >= 8 || wd < 2 || wd > 6) continue;
    const key = d.toISOString().slice(0, 10);
    let sl = slots.find((x) => x.day === key);
    if (!sl) slots.push((sl = { day: key, n: 0, ok: 0, bound: 0, stale: 0 }));
    sl.n++; if (ok(r)) sl.ok++; if (okBound(r)) sl.bound++; if (r.stale) sl.stale++;
  }
  const p95 = (arr) => { const a = arr.filter(Number.isFinite).sort((x, y) => x - y); return a[Math.floor(a.length * 0.95)]; };
  return {
    sym, block: Number(blk), hours: +(span / 3600).toFixed(1), samples: rows.length, nyseSamples: ny.length, rounds: rounds.length,
    inBoundAllPct: +pct(rows, okBound).toFixed(1), inBoundNysePct: +pct(ny, okBound).toFixed(1),
    rebalanceableNysePct: +pct(ny, ok).toFixed(1), rebalanceableAllPct: +pct(rows, ok).toFixed(1),
    longestNoRebalanceH: +(lAll / 3600).toFixed(2), longestNoRebalanceStart: new Date(lAllStart * 1000).toISOString(),
    longestFreshButOver30H: +(lBound / 3600).toFixed(2), longestNyseRunOutH: +(lNy / 3600).toFixed(2),
    longestGapBetweenRebalanceableSamplesH: +(worstGap24 / 3600).toFixed(2),
    slots: slots.map((x) => `${x.day}:${x.ok}/${x.bound}/${x.n}${x.stale ? "s" + x.stale : ""}`).join(" "), slotsMissed: slots.filter((x) => x.n >= 150 && x.ok === 0).length,
    gapP95Nyse: +p95(ny.map((r) => r.gap)).toFixed(1), staleSamples: rows.filter((r) => r.stale).length,
  };
}

const only = process.env.ONLY?.split(",");
for (const v of VAULTS) {
  if (only && !only.includes(v[0])) continue;
  try {
    console.log(JSON.stringify(await run(v)));
  } catch (e) {
    console.log(JSON.stringify({ sym: v[0], error: String(e.shortMessage ?? e.message).slice(0, 200) }));
  }
}
