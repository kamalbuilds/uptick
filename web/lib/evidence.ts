import { useQuery } from "@tanstack/react-query";

export type SessionKey = "regular" | "night" | "weekend";
export type PoolApr = { pool: string; feeTier: number; feeAprPct: number; label: string };
export type Keep = { feeAprPct: number; markoutAprPct: number; costAprPct: number; keptAprPct: number; keptFirstHalf: number; keptSecondHalf: number };
export type Evidence = {
  chosenPool: string;
  chosenFeeTier: number;
  pools: PoolApr[];
  /** Fee earned per dollar lost to informed traders, chosen pool, by session. */
  feePerLoss: Record<SessionKey, number>;
  /** What LPs keep in the chosen pool: fees less losses to informed traders and rebalancing cost. */
  keep: Keep;
  open: boolean;
  swapsReplayed: number;
  windowStart: string;
  windowEnd: string;
};

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const bad = (what: string) => new Error(`keeper evidence ${what} malformed`);

/** Keeper `evidence` object: chosen_pool, chosen_fee_tier, pools[{pool, fee_tier, fee_apr_pct, label}], keep{...}, open, fee_per_loss{regular,night,weekend}, swaps_replayed, window{start,end}. */
export function parseEvidence(raw: unknown): Evidence {
  if (!isObj(raw)) throw bad("object");
  const { keep: k, open, chosen_pool: cp, chosen_fee_tier: ct, pools, fee_per_loss: fpl, swaps_replayed: n, window: w } = raw;
  if (typeof cp !== "string" || !isNum(ct) || !isNum(n) || !isObj(w) || typeof w.start !== "string" || typeof w.end !== "string") throw bad("header");
  if (typeof open !== "boolean") throw bad("open");
  if (!isObj(k) || ![k.fee_apr_pct, k.markout_apr_pct, k.cost_apr_pct, k.kept_apr_pct, k.kept_first_half, k.kept_second_half].every(isNum)) throw bad("keep");
  if (!Array.isArray(pools) || pools.length === 0) throw bad("pools");
  if (!isObj(fpl) || !isNum(fpl.regular) || !isNum(fpl.night) || !isNum(fpl.weekend)) throw bad("fee_per_loss");
  return {
    chosenPool: cp, chosenFeeTier: ct, swapsReplayed: n, windowStart: w.start, windowEnd: w.end,
    open,
    keep: { feeAprPct: k.fee_apr_pct as number, markoutAprPct: k.markout_apr_pct as number, costAprPct: k.cost_apr_pct as number, keptAprPct: k.kept_apr_pct as number, keptFirstHalf: k.kept_first_half as number, keptSecondHalf: k.kept_second_half as number },
    feePerLoss: { regular: fpl.regular, night: fpl.night, weekend: fpl.weekend },
    pools: pools.map((p) => {
      if (!isObj(p) || typeof p.pool !== "string" || !isNum(p.fee_tier) || !isNum(p.fee_apr_pct) || typeof p.label !== "string") throw bad("pool row");
      return { pool: p.pool, feeTier: p.fee_tier, feeAprPct: p.fee_apr_pct, label: p.label };
    }),
  };
}

/** Reads `evidence` from the keeper vault payload; null when the vault has none. */
export const useEvidence = (id: string) =>
  useQuery({
    queryKey: ["evidence", id],
    refetchInterval: 30_000,
    queryFn: async (): Promise<Evidence | null> => {
      const res = await fetch(`/keeper/vaults/${id}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`stats API /vaults/${id} answered ${res.status}`);
      const body: unknown = await res.json();
      if (isObj(body) && body.evidence !== undefined && body.evidence !== null) return parseEvidence(body.evidence);
      return null;
    },
  });
