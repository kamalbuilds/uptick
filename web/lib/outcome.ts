import type { Keep } from "./evidence";

export type OutcomeTone = "earn" | "lose" | "total";

/** One row of the "what you keep" waterfall: the signed figure and the bar width it earns against the largest bar. */
export type OutcomeRow = { key: string; label: string; value: number; widthPct: number; tone: OutcomeTone };

/** Builds the waterfall from the keeper's replay: fees earned, losses to informed traders, rebalancing cost, then what is kept.
 *  `markoutAprPct` and `costAprPct` are losses as signed by the replay (kept = fee - markout - cost), so they are negated here. Bar width is `|value| / max |value|`. */
export function buildOutcomeRows(keep: Keep): OutcomeRow[] {
  const rows: Omit<OutcomeRow, "widthPct">[] = [
    { key: "fees", label: "Trading fees earned", value: keep.feeAprPct, tone: "earn" },
    { key: "markout", label: "Lost to informed traders, 1 hour markout", value: -keep.markoutAprPct, tone: "lose" },
    { key: "cost", label: "Rebalancing cost", value: -keep.costAprPct, tone: "lose" },
    { key: "kept", label: "Kept", value: keep.keptAprPct, tone: "total" },
  ];
  const max = rows.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0);
  return rows.map((r) => ({ ...r, tone: r.tone === "total" ? "total" : r.value < 0 ? "lose" : "earn", widthPct: max > 0 ? (Math.abs(r.value) / max) * 100 : 0 }));
}
