import universe from "@/lib/vault-universe.json";
import evidence from "./lab-evidence.json";

export type LabVault = (typeof universe.vaults)[number];

/** What a holder keeps, as the gate reads it: the weaker of the two 15-day halves of the replay, per year, percent. */
export const keep = (v: LabVault): number => v.gate.worst_half_apr;

export const VAULTS: LabVault[] = [...universe.vaults].sort((a, b) => keep(b) - keep(a));
export const bySymbol = (id: string): LabVault => {
  const v = universe.vaults.find((x) => x.id === id);
  if (!v) throw new Error(`lab: vault ${id} missing from vault-universe.json`);
  return v;
};

/** Origin: GET /keeper/vaults on the stats Worker, read 2026-10-20T07:57:27Z. NVDA only, see lab-evidence.json note. */
export const NVDA_EVIDENCE = evidence.vaults.nvda;
export const EVIDENCE_WINDOW = evidence.window;

export const REPLAYED_SWAPS = universe.vaults.reduce((n, v) => n + v.gate.swaps, 0);
export const COUNTS = {
  total: universe.vaults.length,
  open: universe.vaults.filter((v) => v.gate.state === "open").length,
  reduced: universe.vaults.filter((v) => v.gate.state === "reduced").length,
  closed: universe.vaults.filter((v) => v.gate.state === "closed").length,
  keepsMoney: universe.vaults.filter((v) => v.gate.worst_half_apr > 0).length,
};

export const GATE_LABEL = { open: "Open", reduced: "Reduced", closed: "Closed" } as const;
