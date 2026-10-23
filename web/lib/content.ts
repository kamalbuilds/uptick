export type DocPage = {
  slug: string;
  title: string;
  summary: string;
};

export type DocSection = {
  section: string;
  pages: DocPage[];
};

export type ResearchEntry = {
  slug: string;
  title: string;
  category: string;
  date: string;
  author: string;
  summary: string;
};

export const DOCS: DocSection[] = [
  {
    section: "Start here",
    pages: [
      {
        slug: "overview",
        title: "Overview",
        summary: "What an Uptick vault holds, how the gate opens deposits, and where each number comes from.",
      },
      {
        slug: "how-vaults-work",
        title: "How vaults work",
        summary: "Shares, deposits, the price band, the 02:00 UTC recentre, exits and the oracle gate.",
      },
    ],
  },
  {
    section: "The evidence",
    pages: [
      {
        slug: "evidence-gate",
        title: "The evidence gate",
        summary: "The 30-day replay, the held-out half, and the three states a vault can be in.",
      },
      {
        slug: "vault-sizing",
        title: "Vault sizing",
        summary: "Why a thin pool carries a smaller vault instead of no vault, and how the cap is enforced.",
      },
      {
        slug: "recentre-schedule",
        title: "The recentre schedule",
        summary: "Why the keeper recentres at 02:00 UTC after each NYSE session rather than at the open.",
      },
    ],
  },
  {
    section: "Using a vault",
    pages: [
      {
        slug: "deposit-with-usdg",
        title: "Deposit USDG or a Stock Token",
        summary: "The two ways in, what instantDeploy changes, and when a deposit waits for the next rebalance.",
      },
      {
        slug: "exit-in-kind",
        title: "Exit in kind",
        summary: "redeemInKind pays both tokens with no oracle and no swap, including when the Stock Token is paused.",
      },
      {
        slug: "oracle-and-pricing",
        title: "The oracle and pricing",
        summary: "Chainlink freshness, the 10 minute TWAP, the deviation bounds and the prices each path trusts.",
      },
      {
        slug: "collateral",
        title: "Borrow against a share",
        summary: "Use a vault share as Morpho Blue collateral for USDG: how it is priced, how liquidation exits and what a weekend does.",
      },
    ],
  },
  {
    section: "Build on Uptick",
    pages: [
      {
        slug: "for-agents",
        title: "For agents",
        summary: "The evidence API and the MCP server that prepares unsigned deposit and withdraw transactions.",
      },
      {
        slug: "contracts",
        title: "Contracts",
        summary: "StockVault, the capped-hook standard, the deployed addresses and the test surface.",
      },
    ],
  },
];

export function docHref(slug: string): string {
  return slug === "overview" ? "/docs" : `/docs/${slug}`;
}

export const POSTS: ResearchEntry[] = [
  {
    slug: "sizing-vaults-to-pools",
    title: "Sizing vaults to pools",
    category: "Research",
    date: "2026-10-20",
    author: "Uptick Research",
    summary:
      "The ceiling is $100,000, the floor is $10,000, and the binding constraint is the pool. A vault takes the largest position that holds at most 20% of in-range liquidity, so a thin token gets a smaller vault rather than no vault, and every replay runs at that size.",
  },
  {
    slug: "why-0200-utc",
    title: "Why 02:00 UTC",
    category: "Research",
    date: "2026-10-19",
    author: "Uptick Research",
    summary:
      "The keeper waits until after the NYSE session closes and recentres at 02:00 UTC. The schedule comparison set that slot against recentring at the open, and the gate figures follow the schedule the vault actually runs.",
  },
  {
    slug: "who-lps-lose-to",
    title: "Who liquidity providers lose to",
    category: "Research",
    date: "2026-10-17",
    author: "Uptick Research",
    summary:
      "Fees earned per dollar lost to informed traders, split by NYSE hours, weeknights and weekends, from 5.1 million swaps over 54 days across the NVDA, SPCX and TSLA pools. Weekends paid 13.64 against 1.16 in NYSE hours, and the weekend ratio led in 22 of 23 pool-weeks.",
  },
];

export function postDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

