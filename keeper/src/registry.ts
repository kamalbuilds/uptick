/** The vault registry: which Stock Tokens have a vault, on which pool, and where each deployed vault lives.
 *  Tickers come from data/universe.json (eligible tokens) and data/replay.json (the pool the replay chose).
 *  Deployed vaults come from `VAULT_ADDRESS_<SYM>` or from the VaultFactory's VaultCreated / VaultCreatedV4 logs (`VAULT_FACTORY`). */
import { readFileSync } from "node:fs";
import { parseAbi, type Address, type Hex } from "viem";
import { boundedLogs, client, retry } from "./chain.ts";
import type { Ticker } from "./config.ts";
import { DEFAULT_BAND_BPS } from "./evidence.ts";

export const factoryAbi = parseAbi([
  "event VaultCreated(address indexed stock, address indexed pool, address indexed vault, address feed, uint24 feeTier, uint256 index)",
  "function vaultCount() view returns (uint256)",
  "function vaultOf(address stock, address pool) view returns (address)",
  "event VaultCreatedV4(address indexed stock, bytes32 indexed poolId, address indexed vault, address feed, uint24 feeTier, uint256 index)",
  "function vaultCountV4() view returns (uint256)",
  "function vaultOfV4(address stock, bytes32 poolId) view returns (address)",
]);

const load = (name: string) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
export const readUniverse = () => load("universe.json");
export const readReplay = () => load("replay.json");
export const readParams = (): Record<string, { range_bps: number }> => load("params.json");

export const DEFAULT_RANGE_BPS = DEFAULT_BAND_BPS;

/** One ticker per eligible token. A token whose replay venue is "v4" (and that has a chosen_v4 pool) is a v4 ticker on that pool id; every other token is a v3 ticker on the replay's chosen v3 pool, else the universe's deepest. The band is its params.json range_bps. */
export function eligibleTickers(universe: any, replay: any, params: Record<string, { range_bps: number }> = readParams()): Ticker[] {
  const out: Ticker[] = [];
  for (const t of universe.tokens) {
    if (!t.eligible) continue;
    const rt = replay.tokens?.[t.symbol];
    const base = {
      id: t.symbol.toLowerCase(), symbol: t.symbol, name: t.name, stock: t.token as Address,
      feed: t.feed.address as Address, capUsd: t.cap_usd, rangeBps: params[t.symbol]?.range_bps ?? DEFAULT_RANGE_BPS, stockIsToken0: BigInt(t.token) < BigInt(universe.usdg),
    };
    if (rt?.venue === "v4" && rt.chosen_v4) {
      out.push({ ...base, capUsd: rt.chosen_v4.cap_usd, venue: "v4", poolId: rt.chosen_v4.id as Hex, feeTier: rt.chosen_v4.fee_tier }); // a v4 vault is sized to its own pool
      continue;
    }
    const pool = rt?.chosen ? { address: rt.chosen.id, fee_tier: rt.chosen.fee_tier } : t.pool;
    out.push({ ...base, venue: "v3", pool: pool.address, feeTier: pool.fee_tier });
  }
  return out;
}

/** Explicit `VAULT_ADDRESS_<SYM>` wins over the factory. */
export function applyEnv(tickers: Ticker[], env: Record<string, string | undefined>): Ticker[] {
  return tickers.map((t) => {
    const vault = env[`VAULT_ADDRESS_${t.symbol}`]?.trim() as Address | undefined;
    if (vault && !/^0x[0-9a-fA-F]{40}$/.test(vault)) throw new Error(`VAULT_ADDRESS_${t.symbol} is not an address`);
    const db = env[`VAULT_DEPLOY_BLOCK_${t.symbol}`]?.trim();
    if (vault && !db) throw new Error(`VAULT_DEPLOY_BLOCK_${t.symbol} is required when VAULT_ADDRESS_${t.symbol} is set (bounded getLogs start)`);
    return vault ? { ...t, vault, deployBlock: BigInt(db!) } : t;
  });
}

/** One factory creation: a v3 vault carries the pool address, a v4 vault the pool id. */
export type Created =
  | { stock: string; pool: string; poolId?: undefined; vault: Address; block: bigint }
  | { stock: string; poolId: string; pool?: undefined; vault: Address; block: bigint };

/** Fills `vault` and `deployBlock` for tickers whose (stock, pool) or (stock, poolId) the factory created and that have no explicit address. */
export function applyCreated(tickers: Ticker[], created: Created[]): Ticker[] {
  const same = (a: string | undefined, b: string | undefined) => a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
  return tickers.map((t) => {
    if (t.vault) return t;
    const c = created.find((x) => same(x.stock, t.stock) && (t.venue === "v4" ? same(x.poolId, t.poolId) : same(x.pool, t.pool)));
    return c ? { ...t, vault: c.vault, deployBlock: c.block } : t;
  });
}

/** VaultCreated (v3) and VaultCreatedV4 logs as Created rows. */
export function toCreated(v3: any[], v4: any[]): Created[] {
  return [
    ...v3.map((l): Created => ({ stock: l.args.stock, pool: l.args.pool, vault: l.args.vault, block: l.blockNumber! })),
    ...v4.map((l): Created => ({ stock: l.args.stock, poolId: l.args.poolId, vault: l.args.vault, block: l.blockNumber! })),
  ];
}

export async function factoryCreated(factory: Address, fromBlock: bigint): Promise<Created[]> {
  const head = await retry(() => client.getBlockNumber());
  const event = (name: string) => factoryAbi.find((x) => x.type === "event" && x.name === name)! as any;
  const v3 = await boundedLogs({ address: factory, event: event("VaultCreated"), from: fromBlock, to: head });
  const v4 = await boundedLogs({ address: factory, event: event("VaultCreatedV4"), from: fromBlock, to: head });
  return toCreated(v3, v4);
}

/** Sync part (data files + env); the factory lookup is `withFactory`. */
export function loadTickers(env: Record<string, string | undefined> = process.env): Ticker[] {
  return applyEnv(eligibleTickers(readUniverse(), readReplay()), env);
}

export async function withFactory(tickers: Ticker[], env: Record<string, string | undefined> = process.env): Promise<Ticker[]> {
  const f = env.VAULT_FACTORY?.trim() as Address | undefined;
  if (!f) return tickers;
  if (!/^0x[0-9a-fA-F]{40}$/.test(f)) throw new Error("VAULT_FACTORY is not an address");
  const from = env.VAULT_FACTORY_DEPLOY_BLOCK?.trim();
  if (!from) throw new Error("VAULT_FACTORY_DEPLOY_BLOCK is required when VAULT_FACTORY is set (bounded getLogs start)");
  return applyCreated(tickers, await factoryCreated(f, BigInt(from)));
}
