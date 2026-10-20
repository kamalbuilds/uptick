import type { Metadata } from "next";
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
  title: "Exit in kind | Uptick",
  description:
    "redeemInKind pays both tokens with no oracle and no swap. A failed Stock Token transfer is credited for a later claim.",
};

export default function ExitInKindPage() {
  return (
    <Article
      eyebrow="Using a vault"
      title="Exit in kind"
      lede="redeemInKind pays your proportional share of both tokens with no oracle gate and no swap, including when the feed is stale. If the Stock Token transfer fails, the stock leg is credited for a later claim."
    >
      <TLDR>
        <ul>
          <li>redeem pays the Stock Token and needs a healthy oracle. redeemInKind pays both tokens and does not.</li>
          <li>The router's redeemInKindMin adds minimums on both legs.</li>
          <li>A failed Stock Token transfer is credited to the receiver and claimed later with claimStockOwed.</li>
        </ul>
      </TLDR>

      <H2>Three exit paths</H2>
      <DataTable
        columns={["Path", "What you receive", "Oracle gate", "Swap"]}
        rows={[
          [
            "redeem",
            "The asset value of your shares in the Stock Token, at least previewRedeem.",
            "Required.",
            "The USDG leg is swapped.",
          ],
          [
            "redeemInKind",
            "Your pro-rata share of the Stock Token and USDG the vault holds.",
            "Not required.",
            "None.",
          ],
          [
            "UptickRouter.redeemInKindMin",
            "Both legs, forwarded to your receiver and checked against your minimums.",
            "Not required.",
            "None.",
          ],
        ]}
        caption="redeemInKind settles when Chainlink is stale or the vault is paused."
      />
      <P>
        <Code>redeem</Code> burns your shares and sends the actual proceeds of their pro-rata slice in the
        Stock Token, at least <Code>previewRedeem(shares)</Code>. It harvests fees first and reverts when the
        gate is not Ok.
      </P>
      <P>
        <Code>redeemInKind</Code> burns your shares and releases their pro-rata slice of the idle balances and
        the position's liquidity in both tokens. It is not pausable and never routes through a swap, so it does
        not depend on pool liquidity at the moment you exit.
      </P>
      <P>
        The router's <Code>redeemInKindMin</Code> pulls your shares, exits in kind to itself, checks both legs
        against your minimums with MinStockOut and MinUsdgOut, and forwards stockOut and usdgOut to your
        receiver.
      </P>

      <H2>Why in-kind works on a stale feed</H2>
      <P>
        <Code>redeemInKind</Code> never calls the gate. It tries <Code>health()</Code> and harvests only when
        the status is Ok, and it swallows a failing read. The exit then settles from balances the vault already
        holds, so it works when Chainlink is stale, when the TWAP is unavailable, or when the vault is paused.
      </P>
      <Callout tone="key" label="The gate protects priced paths">
        An in-kind exit pays the vault's own inventory in both tokens. It does not price the exit against the
        feed, so a stale or deviating feed cannot block it.
      </Callout>

      <H2>What the holder receives</H2>
      <P>
        Your slice is shares divided by totalSupply of everything the vault holds in both tokens: idle
        balances, and both legs of the position taken through decreaseLiquidity and collect. Uncollected fees
        are not part of the release. They stay in the vault and are harvested later when the oracle allows it.
      </P>
      <P>
        Because the vault holds both legs of the position and idle balances in both, an in-kind exit can
        return more of one token than a stock-only exit would. The split reflects the position's composition at
        your share of the supply, not a swap at the moment you exit.
      </P>
      <P>
        If the Stock Token transfer to your receiver reverts, from an issuer pause or a blocklist, the stock leg
        is credited to your receiver and to totalStockOwed. The credited receiver calls{" "}
        <Code>claimStockOwed(to)</Code> once the transfer succeeds, and the vault pays the credit to{" "}
        <Code>to</Code>.
      </P>

      <Sources>
        <SourceRef path="contracts/src/StockVault.sol">
          redeem, redeemInKind, claimStockOwed and the pro-rata release.
        </SourceRef>
        <SourceRef path="contracts/src/UptickRouter.sol">
          redeemInKindMin and its MinStockOut and MinUsdgOut checks.
        </SourceRef>
        <SourceRef path="contracts/README.md">
          The exit paths and the pause behaviour.
        </SourceRef>
      </Sources>
    </Article>
  );
}
