/** Search and fee-tier filter for the vault list. No imports, so node's test runner loads it directly. */

export type Listable = { symbol: string; name: string; feeTier: string };

const norm = (s: string) => s.trim().toLowerCase();

/** Ticker prefix, or any word of the company name starting with the query ("nvi" finds NVIDIA). The shared
 *  "Stock Token" suffix is not searchable, or "s" and "t" would match every vault. */
export function matchesQuery(v: Listable, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  const company = v.name.replace(/\s+Stock Token$/i, "");
  return v.symbol.toLowerCase().startsWith(q) || company.toLowerCase().split(/[\s.,]+/).some((w) => w.startsWith(q));
}

/** `tier` is a fee tier label such as "0.05%"; "all" keeps every tier. */
export function filterVaults<T extends Listable>(vaults: T[], query: string, tier: string): T[] {
  return vaults.filter((v) => (tier === "all" || v.feeTier === tier) && matchesQuery(v, query));
}

/** Distinct tiers in ascending fee order. */
export function tiersOf(vaults: Listable[]): string[] {
  return [...new Set(vaults.map((v) => v.feeTier))].sort((a, b) => parseFloat(a) - parseFloat(b));
}

export function countLine(shown: number, total: number): string {
  const noun = total === 1 ? "Stock Token vault" : "Stock Token vaults";
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}
