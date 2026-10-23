/** Builds data/fables-pools.json: the Fables dynamic-fee pools (USDG against a Stock Token we track) among every dynamic-fee pool in data/swaps/v4-pools.json.
 *  A hook counts as Fables when it answers the FablesBaseHook ABI (MAX_POKE_TTL, ABSOLUTE_MAX_FEE, authority, maxFee(poolId)) AND its Sourcify source is a Fables contract
 *  (compilation path src/Fables*.sol). Per pool: hook, hook contract name, AccessManager, fee cap, poke floor, live poke, current fee both ways, protocol fee, liquidity
 *  and the live liquidity. `swapsPulled` marks the pools replay/pull.py fetched Swap rows for (liquidity at pull time); a Fables pool without them is listed but not replayed. The 30-day swap count and USD volume come from replay/fables.py. Read-only eth_calls and Sourcify reads, public RPC only. Run: bun scripts/build-fables-pools.ts */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { getAddress, keccak256, parseAbi, type Address, type Hex } from "viem";
import { client, retry } from "../src/chain.ts";
import { log } from "../src/log.ts";
import { priceFromSqrt } from "../src/price.ts";
import { bandDepthUsd } from "../src/universe.ts";
import { DYNAMIC_FEE, STATE_VIEW, stateViewAbi } from "../src/v4.ts";

const DATA = new URL("../data/", import.meta.url);
const OUT = new URL("fables-pools.json", DATA);

const hookAbi = parseAbi([
  "function MAX_POKE_TTL() view returns (uint40)",
  "function ABSOLUTE_MAX_FEE() view returns (uint24)",
  "function authority() view returns (address)",
  "function maxFee(bytes32) view returns (uint24)",
  "function pokeFloor(bytes32) view returns (uint24)",
  "function pokeOf(bytes32) view returns (uint24 fee, uint40 expiry)",
  "function currentFee(bytes32, bool) view returns (uint24)",
]);

interface Live { id: Hex; currency0: Address; currency1: Address; fee: number; tick_spacing: number; hooks: Address; init_block: number; usdg_is_currency0: boolean }

async function sourcify(hook: Address): Promise<{ name: string | null; paths: string[] }> {
  const res = await fetch(`https://sourcify.dev/server/v2/contract/4663/${getAddress(hook)}?fields=compilation,sources`);
  if (res.status === 404) return { name: null, paths: [] };
  if (!res.ok) throw new Error(`sourcify ${hook}: ${res.status}`);
  const j = (await res.json()) as { compilation: { name: string }; sources: Record<string, unknown> };
  return { name: j.compilation.name, paths: Object.keys(j.sources).filter((p) => p.startsWith("src/")) };
}

async function main() {
  const all: (Live & { symbol: string })[] = [];
  for (const [symbol, list] of Object.entries(JSON.parse(readFileSync(new URL("swaps/v4-pools.json", DATA), "utf8")) as Record<string, Live[]>)) for (const p of list) if ((p.fee & DYNAMIC_FEE) !== 0) all.push({ ...p, symbol });
  if (!all.length) throw new Error("no dynamic-fee pools: run replay/pull.py first");
  const pulled = new Set<string>();   // pools whose Swap rows replay/pull.py fetched: the ones with liquidity at pull time
  for (const f of readdirSync(new URL("swaps/", DATA)).filter((f) => /^v4-live-.+\.json$/.test(f))) for (const p of JSON.parse(readFileSync(new URL(`swaps/${f}`, DATA), "utf8")) as Live[]) pulled.add(p.id.toLowerCase());
  const hooks = [...new Set(all.map((p) => p.hooks.toLowerCase()))] as Address[];
  const block = await retry(() => client.getBlockNumber());
  const fablesHooks: Record<string, { name: string; authority: Address; absoluteMaxFee: number; runtimeCodeHash: Hex; sourcePaths: string[] }> = {};
  const scanned: Record<string, string> = {};
  for (const h of hooks) {
    let ttl: number, cap: number, authority: Address;
    try {
      ttl = await client.readContract({ address: h, abi: hookAbi, functionName: "MAX_POKE_TTL", blockNumber: block });
      cap = await client.readContract({ address: h, abi: hookAbi, functionName: "ABSOLUTE_MAX_FEE", blockNumber: block });
      authority = await client.readContract({ address: h, abi: hookAbi, functionName: "authority", blockNumber: block });
    } catch { scanned[h] = "not a FablesBaseHook (ABI probe reverts)"; continue; }
    const src = await sourcify(h);
    if (!src.name || !src.paths.some((p) => /^src\/Fables[A-Za-z]*\.sol$/.test(p))) { scanned[h] = `answers the ABI but Sourcify source is ${src.name ?? "unverified"}, not Fables`; continue; }
    const code = await client.getCode({ address: h, blockNumber: block });
    fablesHooks[h] = { name: src.name, authority, absoluteMaxFee: cap, runtimeCodeHash: keccak256(code as Hex), sourcePaths: src.paths };
    scanned[h] = `Fables ${src.name}, MAX_POKE_TTL ${ttl}`;
  }
  const pools: Record<string, unknown>[] = [];
  for (const p of all.filter((p) => p.hooks.toLowerCase() in fablesHooks)) {
    const h = p.hooks.toLowerCase() as Address;
    const read = <T,>(functionName: any, args: any[]) => retry(() => client.readContract({ address: h, abi: hookAbi, functionName, args, blockNumber: block } as any)) as Promise<T>;
    const cap = await read<number>("maxFee", [p.id]);
    const floor = await read<number>("pokeFloor", [p.id]);
    const poke = await read<readonly [number, bigint]>("pokeOf", [p.id]);
    const feeZ = await read<number>("currentFee", [p.id, true]), feeO = await read<number>("currentFee", [p.id, false]);
    const slot0 = await retry(() => client.readContract({ address: STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [p.id], blockNumber: block }));
    const liq = await retry(() => client.readContract({ address: STATE_VIEW, abi: stateViewAbi, functionName: "getLiquidity", args: [p.id], blockNumber: block }));
    const priceUsd = slot0[0] === 0n ? null : priceFromSqrt(slot0[0], !p.usdg_is_currency0);
    pools.push({
      symbol: p.symbol, poolId: p.id, hook: h, hookName: fablesHooks[h].name, currency0: p.currency0, currency1: p.currency1, usdgIsCurrency0: p.usdg_is_currency0, tickSpacing: p.tick_spacing,
      initBlock: p.init_block, maxFeePips: cap, pokeFloorPips: floor, pokeFeePips: poke[0], pokeExpiry: Number(poke[1]), currentFeePips: { zeroForOne: feeZ, oneForZero: feeO },
      swapsPulled: pulled.has(p.id.toLowerCase()), protocolFee: slot0[2], tick: slot0[1], liquidityRaw: liq.toString(), priceUsd, depthUsd5pct: priceUsd !== null && priceUsd > 0 && liq > 0n ? bandDepthUsd(liq, priceUsd) : 0,
    });
  }
  writeFileSync(OUT, JSON.stringify({ block: Number(block), source: "every dynamic-fee pool in data/swaps/v4-pools.json; hook ABI probe + Sourcify + hook and StateView reads at the pinned block; swap counts and volume filled by replay/fables.py", scanned, hooks: fablesHooks, pools }, null, 1) + "\n");
  log("done", { dynamicHooks: hooks.length, fablesHooks: Object.keys(fablesHooks).length, pools: pools.length, block: Number(block) });
}

main().catch((e) => { log("fatal", { error: String(e.message ?? e).slice(0, 400) }); process.exit(1); });
