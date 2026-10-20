/** Contract reverts a depositor can act on, by 4-byte selector (`cast sig "<Error>(<args>)"`), with the sentence shown for each. */
export const REVERTS = [
  { name: "Unhealthy", selector: "0x08a4d6fa", copy: "The price feed is not fresh. Deposits pause until it updates." },
  { name: "InsufficientShares", selector: "0xcb1d8bba", copy: "The price moved past your quote. Try again." },
  { name: "SpotOffTwap", selector: "0xe16ad561", copy: "The pool price is moving. Deposits reopen when it settles, usually within minutes." },
  { name: "SharesLocked", selector: "0x7a1cb75d", copy: "Shares minted in this block can be withdrawn from the next block." },
  { name: "ExitBelowMinimum", selector: "0x3b751a36", copy: "The pool cannot fill this exit right now. Exit in kind always works." },
] as const;

/** The known revert behind an error, or null. Reverts carry their data inside the viem error cause chain; the error name in the
 *  message is the fallback for a wallet that only relays text. */
export function knownRevert(err: unknown): (typeof REVERTS)[number] | null {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const data = (cur as { data?: unknown }).data;
    if (typeof data === "string") {
      const hit = REVERTS.find((r) => data.toLowerCase().startsWith(r.selector));
      if (hit) return hit;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  const message = err && typeof err === "object" && "shortMessage" in err && typeof err.shortMessage === "string" ? err.shortMessage : err instanceof Error ? err.message : String(err);
  const named = REVERTS.find((r) => new RegExp(`\\b${r.name}\\b`).test(message));
  return named ?? null;
}

/** The sentence for a known revert, or null. */
export const revertCopy = (err: unknown): string | null => knownRevert(err)?.copy ?? null;
