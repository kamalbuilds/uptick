import { createPublicClient, http, isAddress, parseAbi } from "viem";
import { buildEvidence, replayFeeApr } from "../../keeper/src/evidence";
import { parseVaults, type Env } from "./mcp";

const vaultAbi = parseAbi([
  "function totalValueInUSDG() view returns (uint256)",
  "function pricePerShare() view returns (uint256)",
  "function feesEarnedLifetime() view returns (uint256)",
]);

interface UniverseVault {
  id: string;
  symbol: string;
  name: string;
  pool: string;
  feeTierPips: number;
}

interface Replay {
  strategy: string;
  capital_usd: number;
  window: unknown;
  tokens: Record<string, { capital_usd?: number }>;
}

/** Live vault figures, read from the chain only when VAULTS names this id and CHAIN_RPC_URL says where to read. */
async function readChain(env: Env, id: string) {
  const address = parseVaults(env.VAULTS)[id];
  if (!address || !env.CHAIN_RPC_URL) return { vault: null, tvl_usd: null, price_per_share_raw: null, fees_lifetime_view_raw: null };
  if (!isAddress(address)) throw new Error(`VAULTS entry for ${id} is not an address`);
  const client = createPublicClient({ transport: http(env.CHAIN_RPC_URL) });
  const read = (functionName: "totalValueInUSDG" | "pricePerShare" | "feesEarnedLifetime") =>
    client.readContract({ address, abi: vaultAbi, functionName });
  const [tvl, pps, life] = await Promise.all([read("totalValueInUSDG"), read("pricePerShare"), read("feesEarnedLifetime")]);
  return {
    vault: address,
    tvl_usd: Number(tvl) / 1e6, // totalValueInUSDG is USDG, 6 decimals
    price_per_share_raw: pps.toString(),
    fees_lifetime_view_raw: life.toString(),
  };
}

/** The payload web/lib/keeper.ts and web/lib/evidence.ts parse, same shape as keeper/src/stats.ts replayVault(), with the on-chain
 *  fields filled only when the chain read is configured. Realized fee APR needs a log scan the Worker does not run, so it is null
 *  and the web leads with the replay figure; `chart` needs a live pool and feed read, so it is null. */
export async function keeperVault(env: Env, vault: UniverseVault, replay: Replay, tok: { capital_usd?: number }) {
  const evidence = buildEvidence(tok, replay);
  const chain: Awaited<ReturnType<typeof readChain>> & { onchain_error?: string } = await readChain(env, vault.id).catch((e: Error) => ({
    vault: null, tvl_usd: null, price_per_share_raw: null, fees_lifetime_view_raw: null,
    onchain_error: String(e.message).split("\n")[0].slice(0, 200),
  }));
  return {
    id: vault.id, ticker: vault.symbol, name: vault.name, pool: vault.pool, fee_tier: vault.feeTierPips,
    source: chain.vault ? "onchain" : "replay",
    ...chain,
    fee_apr_pct: { replay_30d: replayFeeApr(tok), "24h": null, "7d": null, lifetime: null },
    replay: { strategy: replay.strategy, capital_usd: tok.capital_usd ?? replay.capital_usd, window: replay.window },
    evidence,
    open: evidence?.open ?? false,
    chart: null,
  };
}
