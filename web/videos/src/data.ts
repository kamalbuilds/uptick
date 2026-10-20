import universe from "./vault-universe.snapshot.json";

/**
 * A frozen copy of web/lib/vault-universe.json as committed at the replay the films announce (30 days to 2026-10-17, 17 vaults: 2 open, 5 reduced, 10 closed).
 * The site file is regenerated whenever the keeper replays again; a film is a dated artifact and keeps the numbers it was approved with.
 * Only what the films draw is mapped here; lib/vaults.ts pulls in viem and env, which a film must not.
 */
export type GateState = "open" | "reduced" | "closed";

export type Vault = {
  id: string;
  symbol: string;
  name: string;
  feeTier: string;
  gate: { state: GateState; reason: string; worstHalfApr: number; floorApr: number; swaps: number };
  keep: { feeApr: number; markoutApr: number; costApr: number; keptApr: number; keptFirstHalf: number; keptSecondHalf: number };
};

export const REPLAY_WINDOW = universe.window as { start: string; end: string; days: number };
export const isoDay = (iso: string): string => iso.slice(0, 10);

export const VAULTS: Vault[] = universe.vaults.map((v) => ({
  id: v.id,
  symbol: v.symbol,
  name: v.name,
  feeTier: v.feeTier,
  gate: { state: v.gate.state as GateState, reason: v.gate.reason, worstHalfApr: v.gate.worst_half_apr, floorApr: v.gate.floor_apr, swaps: v.gate.swaps },
  keep: { feeApr: v.keep.fee_apr_pct, markoutApr: v.keep.markout_apr_pct, costApr: v.keep.cost_apr_pct, keptApr: v.keep.kept_apr_pct, keptFirstHalf: v.keep.kept_first_half, keptSecondHalf: v.keep.kept_second_half },
}));

/** Best-kept first, as every list on the site is ordered. */
export const BY_KEEP = [...VAULTS].sort((a, b) => b.gate.worstHalfApr - a.gate.worstHalfApr);

export const GATE_COUNTS = {
  open: VAULTS.filter((v) => v.gate.state === "open").length,
  reduced: VAULTS.filter((v) => v.gate.state === "reduced").length,
  closed: VAULTS.filter((v) => v.gate.state === "closed").length,
};

export const REPLAYED_SWAPS = universe.vaults.reduce((n, v) => n + (v.gate?.swaps ?? 0), 0);

export const byState = (state: GateState) => BY_KEEP.filter((v) => v.gate.state === state);

const found = VAULTS.find((v) => v.symbol === "NVDA");
if (!found) throw new Error("NVDA is missing from vault-universe.json");
export const NVDA: Vault = found;
