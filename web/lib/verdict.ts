import { usd, usdWhole } from "./format.ts";
import type { WalletScan } from "./scan.ts";

/** Whole dollars from a thousand up, cents below. */
export const money = (n: number): string => (n === 0 ? "$0" : n >= 1000 ? usdWhole(n) : usd(n, { compact: false }));

type Totals = Pick<WalletScan, "totals">;

/** The sentence at the top of a /check result: what the wallet holds idle and what Uptick can put to work, and no address and no loss figure. A vault whose
 *  weaker half kept less than nothing "takes" the deposit, never "puts it to work", and the line under the headline (weakerHalf) says what that half did. */
export function verdict(s: Totals): string {
  const { idleUsd, putToWork, refused, unpriced } = s.totals;
  if (idleUsd === 0 && unpriced.length > 0) return "Chainlink gave no usable price for the Stock Tokens in this wallet.";
  if (putToWork.tokens > 0) {
    const head = `${money(idleUsd)} of Stock Tokens sit idle.`;
    return putToWork.keptPerYearUsd < 0
      ? `${head} Uptick can take ${money(putToWork.usd)} of it.`
      : `${head} Uptick can put ${money(putToWork.usd)} to work.`;
  }
  return `${money(idleUsd)} of Stock Tokens sit idle. ${refused.tokens === 1 ? "Its vault is" : "Every vault is"} closed, so Uptick puts none of it to work.`;
}

/** The weaker half of the replay on what the vaults would take, in dollars a year and as a gain or a loss. Null when nothing is taken. */
export function weakerHalf(s: Totals): { gain: boolean; usd: number } | null {
  const { putToWork } = s.totals;
  return putToWork.tokens > 0 ? { gain: putToWork.keptPerYearUsd >= 0, usd: Math.abs(putToWork.keptPerYearUsd) } : null;
}
