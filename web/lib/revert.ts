/** Contract reverts a depositor can act on, by 4-byte selector (`cast sig "<Error>(<args>)"`), with the sentence shown for each. */
export const REVERTS = [
  { name: "Unhealthy", selector: "0x08a4d6fa", copy: "The price feed is not fresh. Deposits pause until it updates." },
  { name: "InsufficientShares", selector: "0xcb1d8bba", copy: "The price moved past your quote. Try again." },
  { name: "SpotOffTwap", selector: "0xe16ad561", copy: "The pool price is moving. Deposits reopen when it settles, usually within minutes." },
  { name: "SharesLocked", selector: "0x7a1cb75d", copy: "Shares minted in this block can be withdrawn from the next block." },
] as const;

/** The sentence for a known revert, or null. Reverts carry their data inside the viem error cause chain; the error name in the
 *  message is the fallback for a wallet that only relays text. */
export function revertCopy(err: unknown): string | null {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const data = (cur as { data?: unknown }).data;
    if (typeof data === "string") {
      const hit = REVERTS.find((r) => data.toLowerCase().startsWith(r.selector));
      if (hit) return hit.copy;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  const message = err && typeof err === "object" && "shortMessage" in err && typeof err.shortMessage === "string" ? err.shortMessage : err instanceof Error ? err.message : String(err);
  const named = REVERTS.find((r) => new RegExp(`\\b${r.name}\\b`).test(message));
  return named ? named.copy : null;
}
