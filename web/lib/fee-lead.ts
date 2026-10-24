import { netOfEntryFee, pct, signed } from "./format.ts";
import { yearlyUsd } from "./leak.ts";

/** The two labels every fee-led yield figure carries. The fee line leads; the kept line sits directly under it, on every surface. */
export const FEES_EARNED = "Fees earned";
export const KEPT_AFTER = "Kept after fast traders";

/** "Fees earned 18.7% a year": what the pool paid liquidity providers over the replay window. */
export const feesLine = (feeApr: number): string => `${FEES_EARNED} ${pct(feeApr)} a year`;

/** "Kept after fast traders +2.7% a year": the weaker-half figure the gate reads. */
export const keptLine = (keptApr: number): string => `${KEPT_AFTER} ${signed(keptApr)} a year`;

/** Both lines in the order a surface prints them. */
export const yieldLines = (feeApr: number, keptApr: number): [string, string] => [feesLine(feeApr), keptLine(keptApr)];

/** Dollars a year the pool's fees pay on `amountUsd`, earned on the deposit net of the entry fee (the base the kept dollars use). */
export const feesPerYearUsd = (amountUsd: number, entryFeeBps: number, feeApr: number): number => yearlyUsd(netOfEntryFee(amountUsd, entryFeeBps), feeApr);
