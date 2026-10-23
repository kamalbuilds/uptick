import { usd, usdWhole } from "./format.ts";
import { usdSigned } from "./leak.ts";
import type { WalletScan } from "./scan.ts";

/** Whole dollars from a thousand up, cents below. */
export const money = (n: number): string => (n === 0 ? "$0" : n >= 1000 ? usdWhole(n) : usd(n, { compact: false }));

/** The one sentence at the top of a /check result. A vault whose weaker half kept less than nothing says so beside what it would take, so the line never promises a gain the figures below deny. */
export function verdict(who: string, s: Pick<WalletScan, "totals">): string {
  const { idleUsd, putToWork, refused, unpriced } = s.totals;
  if (idleUsd === 0 && unpriced.length > 0) return `${who} holds Stock Tokens whose Chainlink feeds gave no usable price in this read.`;
  if (putToWork.tokens > 0) {
    const head = `${who} holds ${money(idleUsd)} of Stock Tokens doing nothing.`;
    return putToWork.keptPerYearUsd < 0
      ? `${head} Uptick would take ${money(putToWork.usd)} of it, and the replay's weaker half kept ${usdSigned(putToWork.keptPerYearUsd)} a year on that.`
      : `${head} Uptick would put ${money(putToWork.usd)} of it to work.`;
  }
  return `${who} holds ${money(idleUsd)} of Stock Tokens, ${refused.tokens === 1 ? "and its vault is" : "and every vault is"} closed. Uptick puts none of it to work.`;
}
