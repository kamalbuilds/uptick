import { dollars } from "./format.ts";
import type { ScanRow, WalletScan } from "./scan.ts";

export const money = dollars;

/** Below this many dollars, or this share of what the wallet holds, a live holding is not what the screen leads with. */
export const TINY_USD = 100;
export const TINY_SHARE = 0.01;

/** "AAPL", "AAPL and PLTR", "NVDA, GOOGL and MU", and past four "NVDA, GOOGL, MU, AMZN and 3 more". */
export function names(symbols: readonly string[], shown = 4): string {
  const list = symbols.length > shown ? [...symbols.slice(0, shown), `${symbols.length - shown} more`] : [...symbols];
  return list.length < 2 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

type Source = Pick<WalletScan, "rows" | "totals">;

/** What a /check result says it can do, worked out once. The headline, the ticket and the primary button all read this and nothing else, so a figure
 *  that appears twice is the same figure. `live` is what the deployed vaults take today (each vault's own room), `launching` what vaults not yet
 *  deployed will take. `lead` is the live vault to open; it is `undefined` when no live vault takes anything, and `tiny` when what the live vaults
 *  take is too small to lead the screen (under $100 or under 1% of the wallet), in which case the primary action is the live vault list. */
export type Plan = {
  idleUsd: number;
  live: { usd: number; symbols: string[] };
  launching: { usd: number; symbols: string[] };
  full: string[];
  lead: ScanRow | undefined;
  tiny: boolean;
};

export function plan(s: Source): Plan {
  const { idleUsd, putToWork } = s.totals;
  const { live, launching, full } = putToWork;
  // Open before reduced, then the one that takes the most.
  const lead = s.rows
    .filter((r) => r.vault !== null && r.state !== "closed" && (r.putToWorkUsd ?? 0) > 0)
    .sort((a, b) => Number(b.state === "open") - Number(a.state === "open") || (b.putToWorkUsd as number) - (a.putToWorkUsd as number))[0];
  return { idleUsd, live, launching, full, lead, tiny: lead !== undefined && (live.usd < TINY_USD || live.usd < idleUsd * TINY_SHARE) };
}

/** The sentence at the top of a /check result and the line under it. No address and no loss figure; the weaker half is the ticket's, scoped to the vault it opens. */
export function verdict(s: Source): { main: string; more: string | null } {
  const p = plan(s);
  const { unpriced, refused } = s.totals;
  if (p.idleUsd === 0 && unpriced.length > 0) return { main: "Chainlink gave no usable price for the Stock Tokens in this wallet.", more: null };
  const idle = `${money(p.idleUsd)} of Stock Tokens sit idle.`;
  const first = p.live.usd > 0 || p.full.length > 0;
  const rest = `${money(p.launching.usd)}${first ? " more" : ""} (${names(p.launching.symbols)})`;
  const later = p.launching.usd > 0 ? (first ? `${rest} when their vaults launch.` : `${rest} can go to work when their vaults launch.`) : null;
  if (p.tiny && p.launching.usd > 0)
    return { main: `${idle} ${money(p.launching.usd)} of ${names(p.launching.symbols)} can go to work when their vaults launch.`, more: `${money(p.live.usd)} of ${names(p.live.symbols)} can go in today.` };
  if (p.live.usd > 0) return { main: `${idle} ${money(p.live.usd)} of ${names(p.live.symbols)} can go to work today.`, more: later };
  if (p.full.length > 0) return { main: `${idle} ${names(p.full)} ${p.full.length === 1 ? "is" : "are"} full or paused right now, so none of it can go to work today.`, more: later };
  if (later) return { main: `${idle} None of it can go to work today.`, more: later };
  return { main: `${idle} ${refused.tokens === 1 ? "Its vault is" : "Every vault is"} closed, so none of it can go to work.`, more: null };
}
