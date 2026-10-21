import type { Metadata } from "next";
import Link from "next/link";
import {
  Article,
  Callout,
  CodeBlock,
  DataTable,
  H2,
  P,
  SourceRef,
  Sources,
  TLDR,
} from "@/components/prose";
import { DOCS, docHref } from "@/lib/content";
import { REPLAYED_SWAPS, VAULTS, type GateState } from "@/lib/vaults";

const symbolsIn = (state: GateState) => VAULTS.filter((v) => v.gate.state === state).map((v) => v.symbol).join(", ");

export const metadata: Metadata = {
  title: "Docs | Uptick",
  description:
    "How Uptick vaults hold Stock Tokens, earn Uniswap v3 and v4 fees, and use a 30-day replay to decide which vaults take deposits.",
};

export default function DocsPage() {
  const groups = DOCS.map((group) => ({
    ...group,
    pages: group.pages.filter((page) => page.slug !== "overview"),
  })).filter((group) => group.pages.length > 0);

  return (
    <Article
      eyebrow="Docs"
      title="Put stock tokens to work"
      lede="Uptick turns a Robinhood Stock Token into a share of a Uniswap v3 or v4 pool against USDG. Each vault is one ERC-4626 contract, one managed position, and one published gate."
    >
      <TLDR>
        <ul>
          <li>Deposit a Stock Token, receive shares. Swap fees lift the share price.</li>
          <li>The vault holds a band around Chainlink, chosen per token, and recentres at 02:00 UTC after each NYSE session.</li>
          <li>A vault opens deposits only when both halves of a 30-day replay keep at least break-even.</li>
        </ul>
      </TLDR>

      <P>
        The product is deliberately narrow. Uptick does not pick stocks, lend them out, or take a
        directional position. It provides liquidity in one pair, holds the range it was given, and
        reports the result of a replay that anyone can inspect.
      </P>

      <H2>The three parts</H2>
      <P>
        A vault is the visible part of three systems. The evidence engine decides whether the pool
        is worth a vault and how large it can be. The contract holds the position and prices every
        entry and exit. The keeper moves the band and serves the evidence that the app and agents
        read.
      </P>
      <DataTable
        columns={["Part", "What it does"]}
        rows={[
          [
            "Evidence engine",
            "Replays 30 days of swaps for each eligible pool, sizes the vault to at most 20% of in-range liquidity, and assigns the gate state.",
          ],
          [
            "StockVault",
            "Holds one Uniswap v3 position (StockVaultV4: one Uniswap v4 position) in a band around Chainlink chosen per token. Fees accrue to the share price.",
          ],
          [
            "Keeper and evidence API",
            "Recentres each vault at 02:00 UTC after each NYSE session, simulates every rebalance before sending it, and serves the JSON evidence and MCP tools.",
          ],
        ]}
        caption="The 17 eligible Stock Tokens share this pipeline; each has its own vault, pool and gate."
      />

      <H2>What a vault holds</H2>
      <P>
        Every vault holds the same three things: idle balances of the Stock Token and USDG, both
        legs of a Uniswap v3 or v4 position, and fees earned but uncollected. Shares are priced in
        the Stock Token, so the share price rises as fees accumulate and falls when the position
        loses to informed flow.
      </P>
      <DataTable
        columns={["Holding", "How it is valued"]}
        rows={[
          ["Idle Stock Token and USDG", "Face value, expressed in the Stock Token."],
          ["Both legs of the Uniswap v3 or v4 position", "Pool TWAP over at least 10 minutes (a v4 vault keeps its own observation ring)."],
          ["Fees earned but not collected", "Chainlink for USDG at $1, then the Stock Token."],
        ]}
        caption="Share price = totalAssets / totalSupply, with shares denominated in 24 decimals."
      />
      <Callout label="Why the split matters">
        A vault is not valued at the last traded price of the Stock Token alone. The position is
        marked with a time-weighted pool price, while idle balances and uncollected fees use
        Chainlink. Both paths are gated before a deposit or withdrawal can rely on them.
      </Callout>

      <H2>How the gate decides</H2>
      <P>
        The gate is a replay measurement, not an opinion about the token. A 30-day window of swaps
        runs in two halves: the first 15 days select the pool, and the second 15 days are held out.
        The weaker half decides the state. A vault needs net fees at or above break-even in both halves to open.
      </P>
      <DataTable
        columns={["State", "When the replay puts the vault there", "What deposits can do"]}
        rows={[
          ["Open", "Both halves keep at least break-even.", "Full vault cap."],
          [
            "Reduced",
            "The weaker half sits between -20% a year and break-even.",
            "Up to $25,000 per transaction.",
          ],
          ["Closed", "The weaker half is below -20% a year.", "Deposits are refused."],
        ]}
        caption="Net fees are fees earned minus losses to informed traders and rebalancing cost, measured in the Stock Token."
      />
      <DataTable
        columns={["State", "Vaults today"]}
        rows={[
          ["Open", symbolsIn("open")],
          ["Reduced", symbolsIn("reduced")],
          ["Closed", symbolsIn("closed")],
        ]}
        caption="Current gate states for the 17-vault universe."
      />

      <H2>Where the numbers come from</H2>
      <P>
        The universe starts from {REPLAYED_SWAPS.toLocaleString("en-US")} replayed swaps over 30 days. Each vault gets the largest
        position that stays at or below 20% of in-range liquidity, under a $100,000 ceiling. A pool
        whose depth would carry less than $10,000 is left out; a pool between that floor and the
        ceiling gets the largest size it can carry. The fee APR and kept APR you see on a vault page
        are the replay outputs for that size.
      </P>
      <CodeBlock
        label="Read the gate"
        code={`const base = "https://uptick-evidence.earn-shield-alerts.workers.dev";
const vaults = await (await fetch(\`\${base}/vaults\`)).json();

for (const vault of vaults) {
  console.log(vault.id, vault.open, vault.deposit_cap_usd);
}

const nvda = await (await fetch(\`\${base}/vaults/nvda\`)).json();
console.log(nvda.open, nvda.kept_apr_pct, nvda.pools.length);`}
      />
      <P>
        The list carries each vault&apos;s open flag, deposit cap, fee APR and kept APR. The
        per-vault response adds the name, token, feed and the pool table the choice came from. The
        open flag is the gate&apos;s verdict; kept APR is the held-out half it was measured on.
      </P>
      <Callout tone="key" label="Fee APR is a measurement">
        Replay figures describe past swaps at a fixed size. They are not a forecast, a target, or a
        guarantee. The evidence gate exists so a vault with a weak half stays closed instead of
        being marketed through it.
      </Callout>

      <H2>All docs</H2>
      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.section}>
            <h3 className="text-[15px] font-semibold">
              {group.section}
            </h3>
            <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
              {group.pages.map((page) => (
                <li key={page.slug}>
                  <Link
                    href={docHref(page.slug)}
                    className="row flex flex-col gap-1 py-3 text-mute transition-colors hover:text-fg"
                  >
                    <span className="text-[17px] font-semibold leading-6 text-fg">{page.title}</span>
                    <span className="text-[14px] leading-6">{page.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Sources>
        <SourceRef path="README.md">Uptick repository. Vault universe, replay window and fee figures.</SourceRef>
        <SourceRef path="web/public/llms.txt">Canonical gate states, caps and evidence API.</SourceRef>
        <SourceRef path="contracts/README.md">StockVault mechanics and the oracle gate.</SourceRef>
      </Sources>
    </Article>
  );
}
