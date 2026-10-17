import { useQuery } from "@tanstack/react-query";

export type SessionKey = "regular" | "night" | "weekend";
export type PoolApr = { pool: string; feeTier: number; feeAprPct: number };
export type Evidence = {
  chosenPool: string;
  chosenFeeTier: number;
  pools: PoolApr[];
  /** Fee earned per dollar lost to informed traders, chosen pool, by session. */
  feePerLoss: Record<SessionKey, number>;
  swapsReplayed: number;
  windowStart: string;
  windowEnd: string;
  origin: "api" | "replay-log";
};

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const bad = (what: string) => new Error(`keeper evidence ${what} malformed`);

/** Keeper `evidence` object: chosen_pool, chosen_fee_tier, pools[{pool, fee_tier, fee_apr_pct}], fee_per_loss{regular,night,weekend}, swaps_replayed, window{start,end}. */
export function parseEvidence(raw: unknown): Evidence {
  if (!isObj(raw)) throw bad("object");
  const { chosen_pool: cp, chosen_fee_tier: ct, pools, fee_per_loss: fpl, swaps_replayed: n, window: w } = raw;
  if (typeof cp !== "string" || !isNum(ct) || !isNum(n) || !isObj(w) || typeof w.start !== "string" || typeof w.end !== "string") throw bad("header");
  if (!Array.isArray(pools) || pools.length === 0) throw bad("pools");
  if (!isObj(fpl) || !isNum(fpl.regular) || !isNum(fpl.night) || !isNum(fpl.weekend)) throw bad("fee_per_loss");
  return {
    chosenPool: cp, chosenFeeTier: ct, swapsReplayed: n, windowStart: w.start, windowEnd: w.end, origin: "api",
    feePerLoss: { regular: fpl.regular, night: fpl.night, weekend: fpl.weekend },
    pools: pools.map((p) => {
      if (!isObj(p) || typeof p.pool !== "string" || !isNum(p.fee_tier) || !isNum(p.fee_apr_pct)) throw bad("pool row");
      return { pool: p.pool, feeTier: p.fee_tier, feeAprPct: p.fee_apr_pct };
    }),
  };
}

/** Fallback until the keeper serves `evidence`. Source: spikes/stock-vaults/logs/session_split.txt (NVDA B5 rows, fee/markout)
 *  and logs/report_tables.txt (NVDA B5, fee APR 63.1 at USD 100K), replay 2026-08-24 to 2026-10-17, 2,885,756 swaps
 *  (932,782 + 1,114,338 + 838,636). Only the 0.05% pool was replayed for NVDA. */
export const NVDA_REPLAY_LOG: Evidence = {
  chosenPool: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3",
  chosenFeeTier: 500,
  pools: [{ pool: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3", feeTier: 500, feeAprPct: 63.1 }],
  feePerLoss: { regular: 1.24, night: 1.43, weekend: 4.45 },
  swapsReplayed: 2_885_756,
  windowStart: "2026-08-24",
  windowEnd: "2026-10-17",
  origin: "replay-log",
};

/** Reads `evidence` from the keeper vault payload; null when the vault has none and no logged replay exists. */
export const useEvidence = (id: string) =>
  useQuery({
    queryKey: ["evidence", id],
    refetchInterval: 30_000,
    queryFn: async (): Promise<Evidence | null> => {
      const res = await fetch(`/keeper/vaults/${id}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`stats API /vaults/${id} answered ${res.status}`);
      const body: unknown = await res.json();
      if (isObj(body) && body.evidence !== undefined && body.evidence !== null) return parseEvidence(body.evidence);
      return id === "nvda" ? NVDA_REPLAY_LOG : null;
    },
  });
