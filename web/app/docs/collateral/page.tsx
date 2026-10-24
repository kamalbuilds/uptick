import type { Metadata } from "next";
import Link from "next/link";
import {
  Article,
  Callout,
  Code,
  DataTable,
  H2,
  P,
  SourceRef,
  Sources,
  TLDR,
} from "@/components/prose";

export const metadata: Metadata = {
  title: "Borrow against a vault share | Uptick",
  description:
    "An Uptick share keeps earning pool fees while it backs a USDG loan on Morpho Blue. How the share is priced, how liquidation exits, and what the oracle does over a weekend.",
};

export default function CollateralPage() {
  return (
    <Article
      eyebrow="Using a vault"
      title="Borrow against a vault share"
      lede="Your Stock Token earns fees in Uptick and still works as collateral. The share goes into Morpho Blue, USDG comes out, and the position keeps earning. The market is launching on Robinhood Chain."
    >
      <TLDR>
        <ul>
          <li>Deposit a Stock Token in a vault, supply the share to Morpho Blue, borrow USDG against it.</li>
          <li>The share is priced from the Chainlink answer alone. The pool&apos;s spot price never enters the oracle.</li>
          <li>Liquidators receive shares and leave with both tokens through <Code>redeemInKind</Code>, which needs no oracle and no swap.</li>
          <li>Over a weekend the oracle keeps the last Chainlink print for up to 97 hours, so a position stays liquidatable and repayable.</li>
        </ul>
      </TLDR>

      <H2>Deposit, supply, borrow</H2>
      <P>
        Morpho Blue is the lending market on Robinhood Chain, and it already lends USDG against NVDA,
        SPCX, GOOGL and AAPL. An Uptick share is a second kind of collateral for the same loan: the
        Stock Token, plus the fees its Uniswap position earns while you borrow. The loan-to-value
        limit, the most you can borrow as a share of what the collateral is worth, is 62.5%.
      </P>
      <DataTable
        columns={["Step", "Where", "What happens"]}
        rows={[
          ["Deposit", "Uptick vault", "The Stock Token goes in, ERC-4626 shares come out and the position starts earning pool fees."],
          ["Supply collateral", "Morpho Blue market", "The shares move to Morpho from the block after the deposit, about 12 seconds later. The vault holds shares minted in a block until the chain's next block, and the app waits for it between the two batches."],
          ["Borrow", "Morpho Blue market", "USDG up to a 62.5% loan-to-value limit, the limit the live NVDA/USDG market uses."],
          ["Repay and withdraw", "Morpho Blue market", "Repay needs no oracle. Withdraw the shares and redeem in the vault."],
        ]}
        caption="One market per vault: loan token USDG, collateral token the vault share, the share oracle, and the interest rate model the chain's markets use."
      />

      <H2>How the share is priced</H2>
      <P>
        Morpho asks the oracle for the value of one raw unit of the share in raw USDG, scaled by
        1e36. Shares carry 24 decimals and USDG 6, so a share worth 200 USD prices at about 2e20.
        The oracle takes the ratio in raw units on both sides, so no decimals constant appears in it.
      </P>
      <DataTable
        columns={["Holding", "How the oracle values it"]}
        rows={[
          ["Idle Stock Token", "The Chainlink answer."],
          ["Idle USDG", "1 USD."],
          ["Both legs of the Uniswap position", "The amounts its liquidity holds when the pool sits at the Chainlink price."],
          ["Fees earned and not yet collected", "Chainlink for the Stock Token, 1 USD for USDG, less the treasury's performance cut."],
        ]}
        caption="The total is divided by the share supply plus the vault's virtual shares, the same division convertToAssets uses, and capped by the vault's own totalAssets at the same Chainlink answer."
      />
      <Callout tone="key" label="A swap cannot move the price">
        The vault fixes the position&apos;s liquidity and range, so a swap in the pool changes where
        the pool sits and nothing the oracle reads. In fork tests against the live NVDA pool, a 3%
        buy and a 4% sell move the price by under 1 bp once the fees the swap pays the position are
        counted, and a 10% crash of the pool cannot liquidate a borrower at the limit.
      </Callout>
      <P>
        An AMM position&apos;s value is concave in price, so the oracle&apos;s figure sits at or below
        what a share redeems for in kind at the Chainlink price.
      </P>

      <H2>Liquidation</H2>
      <P>
        A liquidator repays USDG and receives shares at the Morpho incentive. The shares are
        redeemable at once with <Code>redeemInKind</Code>, which pays the pro-rata slice of both
        tokens from balances the vault already holds. It reads no oracle, takes no swap and is open
        in every state of the vault, so a liquidation always ends in the underlying tokens.
      </P>

      <H2>For liquidators</H2>
      <P>
        Redeem exactly the seized share amount in your liquidation callback:{" "}
        <Code>redeemInKind(seized, receiver, owner)</Code>, never your whole share balance. A deposit
        of dust made for your address in the liquidation block locks those dust shares until the next
        block, so a callback that redeems everything it holds reverts with <Code>SharesLocked</Code>{" "}
        and takes the liquidation down with it. The lock covers only the dust, so the exact seized
        amount always passes and the liquidation completes in the same block.
      </P>

      <H2>Watching the loan</H2>
      <P>
        Your loan section on the vault page and on Portfolio shows the collateral and its value, the debt with
        interest counted to the latest block the way Morpho counts it, the health factor (the
        collateral&apos;s borrowing limit divided by what you owe, safe above 1), the
        liquidation price in stock terms and how far the stock can fall before it. Make it safer takes the
        loan to a health factor you choose, 1.6 by default, with the least action. A wallet holding USDG
        repays; a wallet without it takes shares out of Morpho, exits them in kind, repays with the USDG leg
        and receives the stock leg, in as many rounds as Morpho&apos;s health check needs. Wallets that batch
        send it as one confirmation; shares leaving Morpho were minted earlier, so no wait is needed. Agents get the same two views as the <Code>check_loan_health</Code> and{" "}
        <Code>prepare_make_safer</Code> tools, and a webhook subscription at{" "}
        <Code>POST /alerts/subscribe</Code> posts once when the health factor falls below your threshold and
        again only after it has recovered.
      </P>

      <H2>Weekends and corporate actions</H2>
      <P>
        Chainlink equity feeds publish on market days. Between the Friday close and the Monday
        print the oracle keeps answering with the last Chainlink answer, so a borrower stays
        liquidatable and the market keeps working. The longest silence measured on the equity feeds
        is 80.8 hours, a Labor Day weekend; the oracle answers for up to 97 hours, the same bound the
        live NVDA/USDG market&apos;s own oracle applies to its feed.
      </P>
      <P>
        The same holds through a Stock Token corporate-action window. Inside it the vault&apos;s
        deposit and swap-based exit pause, as described in{" "}
        <Link href="/docs/oracle-and-pricing" className="text-fg underline underline-offset-4">
          The oracle and pricing
        </Link>,
        while the share keeps its price and <Code>redeemInKind</Code> stays open.
      </P>
      <DataTable
        columns={["State", "Borrow and liquidate", "Repay and supply", "Exit from the vault"]}
        rows={[
          ["Feed fresh", "Priced at the Chainlink answer.", "Open.", "redeem and redeemInKind."],
          ["Weekend or corporate action, feed under 97 hours old", "Priced at the last Chainlink answer.", "Open.", "redeemInKind."],
          ["Feed over 97 hours old", "Waits for the next print.", "Open.", "redeemInKind."],
        ]}
        caption="Repay never reads the oracle, so a borrower can always close the loan."
      />

      <H2>What the market is built for</H2>
      <P>
        The share is a concentrated position around the Chainlink price. Inside that range it holds
        both tokens and moves less than the stock; past the range it holds the Stock Token and moves
        with it. The market therefore launches at the loan-to-value limit of the Stock Token&apos;s
        own market, 62.5%, rather than a higher one.
      </P>

      <Sources>
        <SourceRef path="contracts/src/UptickShareOracle.sol">
          The Morpho Blue oracle: Chainlink-only valuation, the totalAssets cap and the 97 hour bound.
        </SourceRef>
        <SourceRef path="contracts/test/ShareCollateral.t.sol">
          Fork tests: borrow to the limit, liquidation, spot-push resistance, weekend behaviour.
        </SourceRef>
        <SourceRef path="contracts/SECURITY.md">
          The share oracle section: guards, measured quantities and mutation evidence.
        </SourceRef>
      </Sources>
    </Article>
  );
}
