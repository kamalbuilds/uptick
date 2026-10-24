import { REDUCED_CAP_STOCK_USD } from "./evidence.ts";
import { usdWhole } from "./format.ts";

export type TermId = "taking" | "kept" | "worstHalf" | "open" | "reduced" | "closed" | "entryFee" | "lltv" | "healthFactor" | "liquidationPrice" | "borrowRoom" | "collateral" | "morpho" | "inKind" | "funding";

/** One plain sentence or two for each word the list leans on. Every number is the gate's own: the -20% floor and the per-deposit cap. */
export const TERMS: Record<TermId, { label: string; text: string }> = {
  taking: {
    label: "Vaults past the gate",
    text: "Open and reduced vaults clear the replay gate and go first, and the ones already deployed are live on Robinhood Chain. A closed vault stays shut until its numbers recover.",
  },
  kept: {
    label: "Kept",
    text: "What a holder keeps over a year: the pool's fees, less what informed traders take back after their swaps and what each recentre costs. The vault holds roughly half stock and half USDG while the price is in range, and the stock's price move on that half is not counted. A minus sign means those losses were larger than the fees.",
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
  lltv: {
    label: "Loan-to-value limit",
    text: "The most you can borrow against your collateral, as a share of what it is worth. A loan that grows past it can be liquidated. Morpho writes it LLTV.",
  },
  healthFactor: {
    label: "Health factor",
    text: "The collateral's borrowing limit divided by what you owe. Above 1 the loan is safe, and the higher the number the more the stock can fall. At 1 or below a liquidator can step in.",
  },
  liquidationPrice: {
    label: "Liquidation price",
    text: "The Stock Token price at which a liquidator can repay your USDG and take your vault shares, with a bonus. Above it nothing happens.",
  },
  borrowRoom: {
    label: "Borrow room",
    text: "The USDG this wallet could borrow against the vault shares its deposit would mint, at the market's loan-to-value limit.",
  },
  collateral: {
    label: "Collateral",
    text: "What the lender holds while a loan is open. Here it is your vault shares, which keep earning pool fees while they sit in Morpho.",
  },
  morpho: {
    label: "Morpho Blue",
    text: "A lending market on Robinhood Chain. Lenders supply USDG, and borrowers post collateral to take it out. Each market has one collateral token and one oracle.",
  },
  inKind: {
    label: "Exit in kind",
    text: "Withdraw your share of the vault as the two tokens it holds, the stock and USDG, with no swap and no price. It is open in every state, closed included.",
  },
  funding: {
    label: "Funding",
    text: "The payment between longs and shorts on a perpetual, settled every hour, that keeps its price near the stock's. When longs pay, a short earns it; when shorts pay, a short pays it. Lighter sets the rate and publishes every hour.",
  },
};
