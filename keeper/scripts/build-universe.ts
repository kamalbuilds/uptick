/** Builds data/universe.json: every Robinhood Stock Token on 4663 with its Chainlink feed, deepest USDG v3 pool,
 *  7-day volume and the eligibility verdict. Public RPC only. Run: bun scripts/build-universe.ts */
import { readFileSync, writeFileSync } from "node:fs";
import { parseAbi, type Address } from "viem";
import { client, retry } from "../src/chain.ts";
import { USDG } from "../src/config.ts";
import { log } from "../src/log.ts";
import { priceFromSqrt } from "../src/price.ts";
import { RULE, VAULT_CAPITAL_USD, bandDepthUsd, eligibility, feedSymbol, vaultShare } from "../src/universe.ts";

const REPO = new URL("../../../", import.meta.url).pathname;
const FACTORY: Address = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const FEE_TIERS = [100, 500, 3000, 10000] as const;
const FEEDS_URL = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
const SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
const VOL_DAYS = 7;
const MIN_USDG_FOR_VOLUME = 1_000; // pools holding less USDG than this are not worth a log scan
const ZERO = "0x0000000000000000000000000000000000000000";

const erc20 = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)", "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const poolAbi = parseAbi(["function liquidity() view returns (uint128)", "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)", "function token0() view returns (address)", "function tickSpacing() view returns (int24)"]);
const feedAbi = parseAbi(["function description() view returns (string)", "function decimals() view returns (uint8)", "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function aggregator() view returns (address)"]);

const sym = (a: string) => a.toLowerCase();

async function loadTokens() {
  const files = ["docs/research/rhj-assets.json", "docs/research/founder-house/nightmarket/raw/rhj-assets.json"];
  const by = new Map<string, { symbol: string; company: string; address: Address; multiplier: string; decimals: number }>();
  for (const f of files) {
    const j = JSON.parse(readFileSync(REPO + f, "utf8"));
    for (const a of j.assets ?? j) {
      const d = a.deployments.find((x: any) => x.chainId === 4663);
      if (!d || a.status !== "ASSET_STATUS_ACTIVE") continue;
      by.set(a.tokenSymbol, { symbol: a.tokenSymbol, company: String(a.tokenName).replace(/\s*•\s*Robinhood Token$/, ""), address: d.contractAddress, multiplier: a.currentMultiplier, decimals: a.tokenDecimals });
    }
  }
  return [...by.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

async function mapLimit<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); } }));
  return out;
}

/** Block at or just after unix time `ts`, by bisection on block timestamps. */
async function blockAtTime(ts: number, head: bigint): Promise<bigint> {
  let lo = 1n, hi = head;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const b = await retry(() => client.getBlock({ blockNumber: mid }));
    if (Number(b.timestamp) < ts) lo = mid + 1n; else hi = mid;
  }
  return lo;
}

/** All Swap logs of `pool` in [from,to]; bisects on a range error or a full 10,000-log page. Returns USDG-leg volume (USD) and swap count. */
async function swapVolume(pool: Address, usdgIsToken0: boolean, from: bigint, to: bigint): Promise<{ usd: number; swaps: number }> {
  const rec = async (a: bigint, b: bigint): Promise<{ usd: number; swaps: number }> => {
    let logs: any[];
    try {
      logs = await retry(() => client.request({ method: "eth_getLogs", params: [{ address: pool, topics: [SWAP_TOPIC], fromBlock: `0x${a.toString(16)}`, toBlock: `0x${b.toString(16)}` }] }) as Promise<any[]>, 4, 700);
    } catch (e) {
      if (b > a) { const m = (a + b) / 2n; const [x, y] = [await rec(a, m), await rec(m + 1n, b)]; return { usd: x.usd + y.usd, swaps: x.swaps + y.swaps }; }
      throw e;
    }
    if (logs.length >= 10_000 && b > a) { const m = (a + b) / 2n; const [x, y] = [await rec(a, m), await rec(m + 1n, b)]; return { usd: x.usd + y.usd, swaps: x.swaps + y.swaps }; }
    let usd = 0;
    for (const l of logs) {
      const d = (l.data as string).slice(2);
      const w = BigInt.asIntN(256, BigInt("0x" + d.slice(usdgIsToken0 ? 0 : 64, usdgIsToken0 ? 64 : 128)));
      usd += Math.abs(Number(w)) / 1e6;
    }
    return { usd, swaps: logs.length };
  };
  let usd = 0, swaps = 0;
  const PAGE = 500_000n;
  for (let a = from; a <= to; a += PAGE) { const r = await rec(a, a + PAGE - 1n > to ? to : a + PAGE - 1n); usd += r.usd; swaps += r.swaps; }
  return { usd, swaps };
}

async function main() {
  const tokens = await loadTokens();
  log("tokens", { count: tokens.length });
  const head = await client.getBlockNumber();
  const headBlock = await client.getBlock({ blockNumber: head });
  const headTs = Number(headBlock.timestamp);

  // 1. code + onchain identity
  const codes = await mapLimit(tokens, 8, (t) => retry(() => client.getCode({ address: t.address })));
  const ident = await client.multicall({
    allowFailure: true, blockNumber: head,
    contracts: tokens.flatMap((t) => [
      { address: t.address, abi: erc20, functionName: "symbol" }, { address: t.address, abi: erc20, functionName: "decimals" },
    ] as const),
  });

  // 2. v3 pools for every fee tier
  const poolReq = tokens.flatMap((t) => FEE_TIERS.map((f) => ({ address: FACTORY, abi: factoryAbi, functionName: "getPool", args: [t.address, USDG, f] } as const)));
  const poolRes = await client.multicall({ allowFailure: true, blockNumber: head, contracts: poolReq });
  const poolList: { ti: number; fee: number; pool: Address }[] = [];
  poolRes.forEach((r, k) => { if (r.status === "success" && r.result !== ZERO) poolList.push({ ti: Math.floor(k / 4), fee: FEE_TIERS[k % 4], pool: r.result as Address }); });
  log("pools_found", { count: poolList.length });
  const stat = await client.multicall({
    allowFailure: true, blockNumber: head,
    contracts: poolList.flatMap((p) => [
      { address: p.pool, abi: poolAbi, functionName: "liquidity" }, { address: p.pool, abi: poolAbi, functionName: "slot0" },
      { address: p.pool, abi: poolAbi, functionName: "token0" }, { address: p.pool, abi: poolAbi, functionName: "tickSpacing" },
      { address: USDG, abi: erc20, functionName: "balanceOf", args: [p.pool] }, { address: tokens[p.ti].address, abi: erc20, functionName: "balanceOf", args: [p.pool] },
    ] as const),
  });

  // 3. Chainlink feeds
  const dir: any[] = await (await fetch(FEEDS_URL)).json();
  const feedBySym = new Map<string, any>();
  for (const f of dir) { const s = feedSymbol(f.name); if (s && f.docs?.marketHours?.startsWith("us_equities")) feedBySym.set(s, f); }
  const fsyms = tokens.map((t) => t.symbol).filter((s) => feedBySym.has(s));
  const fres = await client.multicall({
    allowFailure: true, blockNumber: head,
    contracts: fsyms.flatMap((s) => { const a = feedBySym.get(s).proxyAddress as Address; return [
      { address: a, abi: feedAbi, functionName: "description" }, { address: a, abi: feedAbi, functionName: "decimals" },
      { address: a, abi: feedAbi, functionName: "latestRoundData" }, { address: a, abi: feedAbi, functionName: "aggregator" },
    ] as const; }),
  });
  const feedInfo = new Map<string, any>();
  fsyms.forEach((s, i) => {
    const [d, dec, rd, agg] = fres.slice(i * 4, i * 4 + 4);
    const ok = d.status === "success" && dec.status === "success" && rd.status === "success" && (rd.result as any)[1] > 0n;
    feedInfo.set(s, {
      proxy: feedBySym.get(s).proxyAddress, aggregator: agg.status === "success" ? agg.result : null, name: feedBySym.get(s).name,
      description: d.status === "success" ? d.result : null, decimals: dec.status === "success" ? Number(dec.result) : null,
      usd: ok ? Number((rd.result as any)[1]) / 10 ** Number(dec.result) : null, updatedAt: ok ? Number((rd.result as any)[3]) : null,
      ageS: ok ? headTs - Number((rd.result as any)[3]) : null, ok,
    });
  });
  log("feeds", { directory: dir.length, matched: fsyms.length, readable: [...feedInfo.values()].filter((f) => f.ok).length });

  // 4. assemble pools per token
  const fromBlock = await blockAtTime(headTs - VOL_DAYS * 86400, head);
  log("volume_window", { fromBlock, head, days: VOL_DAYS });
  const pools = poolList.map((p, k) => {
    const [liq, s0, t0, ts, ub, sb] = stat.slice(k * 6, k * 6 + 6);
    if (liq.status !== "success" || s0.status !== "success" || t0.status !== "success") return null;
    const tok = tokens[p.ti];
    const stockIsToken0 = (t0.result as string).toLowerCase() === sym(tok.address);
    const poolUsd = priceFromSqrt((s0.result as any)[0], stockIsToken0);
    const L = liq.result as bigint;
    return {
      ti: p.ti, fee: p.fee, pool: p.pool, stockIsToken0, tickSpacing: ts.status === "success" ? Number(ts.result) : null,
      liquidityRaw: L.toString(), poolUsd, tick: Number((s0.result as any)[1]),
      usdgBalance: ub.status === "success" ? Number(ub.result) / 1e6 : 0, stockBalance: sb.status === "success" ? Number(sb.result) / 1e18 : 0,
      depthUsd: poolUsd > 0 && L > 0n ? bandDepthUsd(L, poolUsd) : 0,
      volume7dUsd: null as number | null, swaps7d: null as number | null,
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  // 5. 7-day volume for every pool holding USDG
  const scan = pools.filter((p) => p.depthUsd > 0 && p.usdgBalance >= MIN_USDG_FOR_VOLUME);
  log("volume_scan", { pools: scan.length });
  await mapLimit(scan, 4, async (p) => {
    const r = await swapVolume(p.pool, !p.stockIsToken0, fromBlock, head);
    p.volume7dUsd = r.usd; p.swaps7d = r.swaps;
    log("volume", { symbol: tokens[p.ti].symbol, fee: p.fee, usd7d: Math.round(r.usd), swaps: r.swaps });
  });

  // 6. verdict per token
  const out = tokens.map((t, ti) => {
    const mine = pools.filter((p) => p.ti === ti).sort((a, b) => b.depthUsd - a.depthUsd);
    const best = mine[0] && mine[0].depthUsd > 0 ? mine[0] : null;
    const f = feedInfo.get(t.symbol);
    const vol = best && best.volume7dUsd !== null ? best.volume7dUsd / VOL_DAYS : null;
    const share = best ? vaultShare(best.depthUsd) : null;
    const dev = best && f?.usd ? ((best.poolUsd - f.usd) / f.usd) * 1e4 : null;
    const v = eligibility({
      hasCode: (codes[ti] ?? "0x") !== "0x", hasFeed: !!f, feedOk: !!f?.ok, feedAgeS: f?.ageS ?? null, poolFound: !!best,
      volume7dUsdPerDay: vol, vaultShare: share, feedDeviationBps: dev,
    });
    const onchainSymbol = ident[ti * 2].status === "success" ? (ident[ti * 2].result as string) : null;
    return {
      symbol: t.symbol, name: `${t.company} Stock Token`, token: t.address, decimals: ident[ti * 2 + 1].status === "success" ? Number(ident[ti * 2 + 1].result) : t.decimals,
      onchain_symbol: onchainSymbol, multiplier: t.multiplier, has_code: (codes[ti] ?? "0x") !== "0x",
      feed: f ? { address: f.proxy, aggregator: f.aggregator, description: f.description, decimals: f.decimals, usd: f.usd, updated_at: f.updatedAt, age_s: f.ageS } : null,
      pool: best && {
        address: best.pool, fee_tier: best.fee, tick_spacing: best.tickSpacing, stock_is_token0: best.stockIsToken0, price_usd: best.poolUsd, tick: best.tick,
        liquidity_raw: best.liquidityRaw, depth_usd_5pct: best.depthUsd, usdg_balance: best.usdgBalance, stock_balance: best.stockBalance,
        volume_7d_usd: best.volume7dUsd, volume_usd_per_day: vol, swaps_7d: best.swaps7d,
        vault_share_100k: share, feed_deviation_bps: dev,
      },
      other_pools: mine.slice(best ? 1 : 0).map((p) => ({ address: p.pool, fee_tier: p.fee, depth_usd_5pct: p.depthUsd, usdg_balance: p.usdgBalance, volume_7d_usd: p.volume7dUsd })),
      eligible: v.eligible, reason: v.reason,
    };
  });
  const doc = {
    chain_id: 4663, generated_at: new Date().toISOString(), block: Number(head), block_ts: headTs,
    sources: { tokens: "docs/research/rhj-assets.json + docs/research/founder-house/nightmarket/raw/rhj-assets.json (Robinhood RHJ registry)", feeds: FEEDS_URL, pools: `Uniswap v3 factory ${FACTORY}, fee tiers ${FEE_TIERS.join("/")}, USDG ${USDG}` },
    rule: { ...RULE, vault_capital_usd: VAULT_CAPITAL_USD, volume_window_days: VOL_DAYS, volume_from_block: Number(fromBlock) },
    counts: { tokens: out.length, with_code: out.filter((x) => x.has_code).length, with_feed: out.filter((x) => x.feed).length, with_pool: out.filter((x) => x.pool).length, eligible: out.filter((x) => x.eligible).length },
    tokens: out,
  };
  writeFileSync(new URL("../data/universe.json", import.meta.url), JSON.stringify(doc, null, 1) + "\n");
  log("done", doc.counts);
}

main().catch((e) => { log("fatal", { error: String(e.message ?? e).slice(0, 400) }); process.exit(1); });
