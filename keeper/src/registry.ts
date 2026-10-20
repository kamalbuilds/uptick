/** The vault registry: which Stock Tokens have a vault, on which pool, and where each deployed vault lives.
 *  Tickers come from data/universe.json (eligible tokens) and data/replay.json (the pool the replay chose).
 *  Deployed vaults come from `VAULT_ADDRESS_<SYM>` or from the VaultFactory's VaultCreated logs (`VAULT_FACTORY`). */
import { readFileSync } from "node:fs";
import { parseAbi, type Address } from "viem";
import { boundedLogs, client, retry } from "./chain.ts";
import type { Ticker } from "./config.ts";

export const factoryAbi = parseAbi([
  "event VaultCreated(address indexed stock, address indexed pool, address indexed vault, address feed, uint24 feeTier, uint256 index)",
  "function vaultCount() view returns (uint256)",
  "function vaultOf(address stock, address pool) view returns (address)",
]);

const load = (name: string) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
export const readUniverse = () => load("universe.json");
export const readReplay = () => load("replay.json");

/** One ticker per eligible token. The pool is the replay's chosen v3 pool, else the universe's deepest. */
export function eligibleTickers(universe: any, replay: any): Ticker[] {
  const out: Ticker[] = [];
  for (const t of universe.tokens) {
    if (!t.eligible) continue;
    const chosen = replay.tokens?.[t.symbol]?.chosen;
    const pool = chosen ? { address: chosen.id, fee_tier: chosen.fee_tier } : t.pool;
    out.push({
      id: t.symbol.toLowerCase(), symbol: t.symbol, name: t.name, stock: t.token, pool: pool.address, feeTier: pool.fee_tier,
      feed: t.feed.address, capUsd: t.cap_usd, stockIsToken0: BigInt(t.token) < BigInt(universe.usdg),
    });
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

export interface Created { stock: string; pool: string; vault: Address; block: bigint }

/** Fills `vault` and `deployBlock` for tickers whose (stock, pool) the factory created and that have no explicit address. */
export function applyCreated(tickers: Ticker[], created: Created[]): Ticker[] {
  return tickers.map((t) => {
    if (t.vault) return t;
    const c = created.find((x) => x.stock.toLowerCase() === t.stock.toLowerCase() && x.pool.toLowerCase() === t.pool.toLowerCase());
    return c ? { ...t, vault: c.vault, deployBlock: c.block } : t;
  });
}

export async function factoryCreated(factory: Address, fromBlock: bigint): Promise<Created[]> {
  const head = await retry(() => client.getBlockNumber());
  const ev = factoryAbi.find((x) => x.type === "event" && x.name === "VaultCreated")!;
  const logs = await boundedLogs({ address: factory, event: ev as any, from: fromBlock, to: head });
  return logs.map((l: any) => ({ stock: l.args.stock, pool: l.args.pool, vault: l.args.vault, block: l.blockNumber! }));
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
