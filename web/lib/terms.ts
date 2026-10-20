import { REDUCED_CAP_STOCK_USD } from "./evidence.ts";
import { usdWhole } from "./format.ts";

export type TermId = "taking" | "kept" | "worstHalf" | "open" | "reduced" | "closed" | "entryFee";

/** One plain sentence or two for each word the list leans on. Every number is the gate's own: the -20% floor and the per-deposit cap. */
export const TERMS: Record<TermId, { label: string; text: string }> = {
  taking: {
    label: "Taking deposits",
    text: "Open and reduced vaults both take deposits. A closed vault does not.",
  },
  kept: {
    label: "Kept",
    text: "What a holder keeps over a year: the pool's fees, less what informed traders take back after their swaps and what each recentre costs. The stock's own price moves come on top and are not counted.",
  },
  worstHalf: {
    label: "Worst half",
    text: "The replay covers 30 days, split into two halves of 15. The worst half is the lower of the two kept figures. The gate reads it, so one good fortnight cannot carry a vault.",
  },
  open: {
    label: "Open",
    text: "The worst half kept zero or more. The vault takes deposits with no per-deposit limit.",
  },
  reduced: {
    label: "Reduced",
    text: `The worst half kept between the -20% floor and zero. The vault still takes deposits, but one deposit adds at most ${usdWhole(REDUCED_CAP_STOCK_USD)} of the stock, or the vault's size if that is smaller.`,
  },
  closed: {
    label: "Closed",
    text: "The worst half kept less than the -20% floor, so the vault takes no deposits. Exit in kind is never closed.",
  },
  entryFee: {
    label: "Entry fee",
    text: "Taken from each deposit and kept in the vault, so it accrues to the holders who stay. It is the larger of the pool's fee tier and 0.35%. Shares are minted against the deposit net of it.",
  },
};
