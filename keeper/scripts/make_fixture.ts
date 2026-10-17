// Pulls real Collect events from the NVDA/USDG 0.05% v3 pool (public RPC), keeps the most frequent
// (owner,tickLower,tickUpper) position series, writes test/fixtures/collects.json with block timestamps.
import { createPublicClient, http, parseAbiItem } from "viem";
const POOL = "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3" as const;
const c = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
const ev = parseAbiItem("event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)");
const head = await c.getBlockNumber();
const PAGE = 200_000n, PAGES = 30;
const all: any[] = [];
for (let i = 0n; i < BigInt(PAGES); i++) {
  const to = head - i * PAGE, from = to - PAGE + 1n;
  const l = await c.getLogs({ address: POOL, event: ev, fromBlock: from, toBlock: to });
  all.push(...l.filter((x) => x.args.amount0! > 0n || x.args.amount1! > 0n));
}
const g = new Map<string, any[]>();
for (const l of all) { const k = `${l.args.owner}|${l.args.tickLower}|${l.args.tickUpper}`; (g.get(k) ?? g.set(k, []).get(k)!).push(l); }
const best = [...g.entries()].sort((a, b) => b[1].length - a[1].length)[0];
console.log("collects scanned", all.length, "groups", g.size, "best", best[0], best[1].length);
const rows = [];
for (const l of best[1].sort((a, b) => Number(a.blockNumber - b.blockNumber))) {
  const b = await c.getBlock({ blockNumber: l.blockNumber });
  rows.push({ block: Number(l.blockNumber), ts: Number(b.timestamp), tx: l.transactionHash, amount0: l.args.amount0.toString(), amount1: l.args.amount1.toString() });
}
const [owner, tl, tu] = best[0].split("|");
await Bun.write("test/fixtures/collects.json", JSON.stringify({ pool: POOL, owner, tickLower: Number(tl), tickUpper: Number(tu), head: Number(head), events: rows }, null, 1));
console.log(rows.length, "events written");
