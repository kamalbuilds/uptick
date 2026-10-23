import type { Metadata } from "next";
import Link from "next/link";
import {
  Article,
  Callout,
  Code,
  CodeBlock,
  DataTable,
  H2,
  H3,
  P,
  SourceRef,
  Sources,
  TLDR,
} from "@/components/prose";
import { entryFeePct } from "@/lib/format";
import { VAULTS } from "@/lib/vaults";

const DEFAULT_ENTRY_BPS = Math.min(...VAULTS.map((v) => v.entryFeeBps));
const HIGHER_ENTRY = VAULTS.filter((v) => v.entryFeeBps > DEFAULT_ENTRY_BPS);

export const metadata: Metadata = {
  title: "How vaults work | Uptick",
  description:
    "Shares, deposits, the per-token band, the 02:00 UTC recentre, exit paths and the oracle gate behind every Uptick vault.",
};

export default function HowVaultsWorkPage() {
  return (
    <Article
      eyebrow="Start here"
      title="How vaults work"
      lede="One Stock Token, one Uniswap v3 or v4 position against USDG, and a share price that rises as fees accrue."
    >
      <TLDR>
        <ul>
          <li>A share is a claim on idle balances, both legs of the position, and uncollected fees.</li>
          <li>The vault holds a band chosen per token and recentres at 02:00 UTC after each NYSE session.</li>
          <li>Deposits keep an entry fee of {entryFeePct(DEFAULT_ENTRY_BPS)} in the vault for the holders who stay.</li>
          <li>Deposits and withdrawals pass the oracle gate. redeemInKind does not.</li>
        </ul>
      </TLDR>

      <H2>A share is a claim on the vault</H2>
      <P>
        Each vault is an ERC-4626 contract for one Stock Token. A share is not a receipt for a
        fixed number of tokens. It is a claim on everything the vault holds, divided by the share
        supply. As swaps pay fees, total assets rise and each share is worth more of the Stock
        Token.
      </P>
      <DataTable
        columns={["Component", "What it is", "How it is priced"]}
        rows={[
          [
            "Idle balances",
            "Stock Token and USDG waiting to be deployed.",
            "Face value, expressed in the Stock Token.",
          ],
          [
            "Position",
            "A single Uniswap v3 or v4 position, both legs, inside the band.",
            "Pool TWAP over at least 10 minutes.",
          ],
          [
            "Uncollected fees",
            "Fees the position has earned and that remain unharvested.",
            "Chainlink, with USDG at $1.",
          ],
        ]}
        caption="totalAssets() sums these components before dividing by totalSupply()."
      />
      <Callout label="The share price is in the Stock Token">
        A vault does not report a dollar share price. It reports assets per share in the Stock
        Token, because the Stock Token is the unit of account. USD prices on the site are a display
        conversion, not the contract&apos;s accounting unit.
      </Callout>

      <H2>Deposit and mint</H2>
      <P>
        The vault has two entry functions. <Code>deposit</Code> takes an asset amount.{" "}
        <Code>mint</Code> takes a share amount. Both use the current share price, both require an{" "}
        <Code>Ok</Code> oracle status, and both stop when the vault is paused.
      </P>
      <P>
        The asset is always the Stock Token. A USDG holder goes through{" "}
        <Code>UptickRouter.depositUsdg</Code>, which swaps USDG to the Stock Token at the
        Chainlink-implied value less a slippage bound, then calls <Code>deposit</Code>. The router
        refuses the swap when the oracle status is not <Code>Ok</Code>.
      </P>
      <P>
        After a deposit, <Code>instantDeploy</Code> decides whether the vault acts immediately. When
        it is on, the vault balances its idle inventory toward the ratio the range needs, swapping
        stock to USDG where necessary, and adds both legs to the position. When it is off, the
        deposit sits idle until the next rebalance. The deposit cap is a ceiling on total assets:{" "}
        <Code>maxDeposit</Code> returns the remaining room, not a per-ticket limit.
      </P>
      <DataTable
        columns={["Path", "What happens", "When it is available"]}
        rows={[
          [
            "Stock Token, instantDeploy",
            "Deposit, balance idle inventory, add both legs to the position, mint shares.",
            "Oracle status Ok, not paused, and room under depositCap.",
          ],
          [
            "Stock Token, no instantDeploy",
            "Hold the Stock Token idle, mint shares, deploy at the next rebalance.",
            "Oracle status Ok, not paused, and room under depositCap.",
          ],
          [
            "USDG via router",
            "Swap USDG to the Stock Token at the Chainlink value less slippage, then deposit.",
            "Router requires oracle status Ok.",
          ],
          [
            "Reduced replay state",
            "Same contract paths. The app and prepare_deposit cap a single ticket at $25,000.",
            "The weaker replay half is between -20% a year and break-even.",
          ],
        ]}
        caption="The keeper's rebalance is the path that turns idle balances into a position outside a deposit transaction."
      />

      <H2>The entry fee</H2>
      <P>
        Each deposit and mint leaves a fee in the vault. The fee is <Code>entryFee</Code>, set in
        pool-fee pips: the larger of the pool&apos;s own fee tier and 3,500 pips, so it is{" "}
        {entryFeePct(DEFAULT_ENTRY_BPS)} on most vaults
        {HIGHER_ENTRY.length > 0 &&
          ` and ${entryFeePct(HIGHER_ENTRY[0].entryFeeBps)} on ${HIGHER_ENTRY.map((v) => v.symbol).join(" and ")}, whose pools charge ${HIGHER_ENTRY[0].feeTier}`}
        . Shares are minted against the assets net of the fee, so the fee is not paid to anyone: it stays
        in the vault and raises the share price for every existing holder.{" "}
        <Code>previewDeposit</Code> and <Code>previewMint</Code> include it exactly, and the
        deposit panel quotes shares and the yearly figure on the net amount.
      </P>
      <P>
        The fee prices the vault against a trade on a move the Chainlink feed has not printed yet.
        Entering the vault costs at least what selling the same stock into the pool costs, so a
        deposit made just before a price update does not pay. At the {entryFeePct(DEFAULT_ENTRY_BPS)} default the
        break-even is a 70 bp move, and 97.2% of the round-to-round changes of the NVDA, AAPL,
        GOOGL, SPY and QQQ feeds stay under it. The fee changes only through the owner&apos;s
        24-hour queue, is capped at 2%, and never falls below the pool&apos;s fee tier. Exit in kind
        charges nothing.
      </P>

      <H2>The band and the recentre</H2>
      <P>
        The position sits inside a band around the Chainlink price, expressed as{" "}
        <Code>rangeBps</Code> and chosen per token (table below), snapped to the pool&apos;s tick spacing. The band is the
        product: it earns fees while the stock trades inside it, and it defines when the position
        has to move.
      </P>
      <DataTable
        columns={["Vault", "rangeBps", "Band"]}
        rows={VAULTS.map((v) => [v.symbol, `${v.bandBps} bps`, `plus or minus ${v.bandBps / 100}%`])}
        numeric={[1]}
        caption="Each vault's band as the deploy list carries it, from keeper/data/params.json."
      />
      <P>
        A recentre collects fees, withdraws both legs, and redeploys around the new Chainlink price.
        The keeper runs a 60 second loop and treats three cases differently.
      </P>
      <DataTable
        columns={["Case", "What the keeper does"]}
        rows={[
          [
            "out_of_range",
            "Ticks outside the band for 30 minutes, at least 2 hours after the last rebalance, and only during an NYSE trading day.",
          ],
          [
            "Opening recentre",
            "Rebalances at 02:00 UTC after each NYSE session, before the next session opens.",
          ],
          [
            "Weekend or holiday",
            "Never triggers an out-of-range recentre, even if the tick leaves the band.",
          ],
          [
            "26 hours without a rebalance",
            "Anyone may call rebalance(). The permissionless path is the backstop.",
          ],
        ]}
        caption="The keeper simulates the transaction before sending it and logs the result as a JSON line."
      />
      <Callout label="Why 02:00 UTC">
        The stock market is closed, the Chainlink feed has settled, and the next session is hours
        away. Recentring there avoids moving the band in the middle of a session. The full
        comparison is in{" "}
        <Link
          href="/research"
          className="font-semibold text-fg underline decoration-line underline-offset-4 hover:decoration-fg"
        >
          the research notes
        </Link>
        .
      </Callout>

      <H2>Exit paths</H2>
      <P>
        Exits are not symmetrical. The standard ERC-4626 paths pay the Stock Token and need a
        healthy oracle. The in-kind path pays both tokens and does not.
      </P>
      <DataTable
        columns={["Path", "What you receive", "Oracle gate"]}
        rows={[
          [
            "withdraw",
            "A specific asset amount, in the Stock Token.",
            "Required.",
          ],
          [
            "redeem",
            "The asset value of a specific share amount, in the Stock Token.",
            "Required.",
          ],
          [
            "redeemInKind",
            "Your proportional share of both the Stock Token and USDG, with no swap.",
            "Not required.",
          ],
          [
            "maxWithdraw",
            "The largest withdrawal the vault will allow for an owner.",
            "None. It is a view of share value at the current mark.",
          ],
        ]}
        caption="redeemInKind settles when Chainlink is stale or the vault is paused. If the Stock Token transfer reverts, the stock leg is credited and claimStockOwed pays it later."
      />
      <P>
        An in-kind exit can hand you more of one token than you expect because the vault holds both
        legs of the position and idle balances in both. It does not route through a swap, so it does
        not depend on pool liquidity at the moment you exit. When the Stock Token holds a transfer, the
        vault records the Stock Token leg against the receiver and{" "}
        <Code>claimStockOwed</Code> pays it out, so the exit always completes.
      </P>

      <H2>The oracle gate</H2>
      <P>
        Every priced path reads the same gate. If any check fails, the path refuses rather than
        pricing on a bad market. The read has five ways to fail, and each one maps to a status code.
      </P>
      <DataTable
        columns={["Check", "Rule"]}
        rows={[
          [
            "FeedInvalid",
            "The feed reverts, the answer is zero or negative, the timestamp is zero or in the future, or answeredInRound is behind roundId.",
          ],
          ["FeedStale", "block.timestamp - updatedAt is greater than maxStaleness."],
          ["TwapUnavailable", "pool.observe reverts because history is shorter than twapWindow."],
          ["TwapDeviates", "The TWAP differs from Chainlink by more than maxDeviationBps."],
          ["SpotDeviates", "The spot price differs from Chainlink by more than maxDeviationBps."],
        ]}
        caption="Defaults are maxStaleness 90,000 seconds, maxDeviationBps 100 and twapWindow 600 seconds. The first failing check wins."
      />

      <H2>Fees, shares and the treasury cut</H2>
      <P>
        Vaults launch with no performance fee, so the kept figure on every vault page is what a depositor keeps.
        The owner can switch on a share of up to 20% per vault through the 24-hour queue. When it is on, a harvest collects
        uncollected fees, values them, and mints the treasury its cut as shares. The mint is priced against assets net of the cut,
        so the share price is the same one second before and one second after a harvest.
      </P>
      <P>
        Shares use 24 decimals, six more than the 18-decimal Stock Token. The extra precision is an
        ERC-4626 inflation guard. It does not change the value of a share, only the number of
        decimal places used to express it.
      </P>
      <Callout tone="key" label="A harvest is not a payout">
        Fees are already reflected in the share price as they accrue. A harvest converts uncollected
        fees into realised assets and takes the treasury cut. It does not create a separate
        dividend, and it does not change the value of your shares on its own.
      </Callout>

      <H3>Parameters</H3>
      <DataTable
        columns={["Parameter", "Value", "What it controls"]}
        rows={[
          ["maxStaleness", "90,000 seconds", "How old a Chainlink answer may be. Allowed range 1 hour to 7 days."],
          ["maxDeviationBps", "100 bps", "How far the TWAP and the spot price may sit from Chainlink. Allowed range 10 to 500 bps."],
          ["twapWindow", "600 seconds", "The TWAP observation window. Minimum 600 seconds."],
          ["rangeBps", "Per token, 150 to 2,000 bps", "The half-width of the band around Chainlink."],
          ["perfFeeBps", "1,000 bps", "The treasury cut on uncollected fees."],
          ["Share decimals", "24", "The ERC-4626 inflation guard."],
          ["minRebalanceInterval", "6 hours", "The shortest gap between keeper rebalances."],
          ["Permissionless rebalance", "26 hours", "When anyone may call rebalance()."],
          ["Deposit ceiling", "Up to $100,000", "The vault-sized cap; the largest is $100,000."],
        ]}
        caption="Defaults per vault. Per-token deposit caps and gate states live on each vault page."
      />

      <H2>Read the oracle gate</H2>
      <P>
        The app already exports the vault list and ABI, so the gate is one contract read away. This
        is the same call the deposit and withdraw paths make.
      </P>
      <CodeBlock
        label="TypeScript, viem"
        code={`import { createPublicClient, http } from "viem";
import { robinhoodChain } from "@/lib/chain";
import { vaultAbi } from "@/lib/abis";
import { getVault } from "@/lib/vaults";

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(),
});

const vault = getVault("nvda");
if (!vault?.vault) throw new Error("Set NEXT_PUBLIC_VAULTS to the vault address map");

const [status, price, updatedAt, sqrtOracle, sqrtTwap, sqrtSpot] =
  await client.readContract({
    address: vault.vault,
    abi: vaultAbi,
    functionName: "health",
  });`}
      />
      <P>
        A non-zero status means the gate is refusing. The price and timestamps are returned with the
        status so a caller can show why, rather than reporting a generic failure.
      </P>

      <Sources>
        <SourceRef path="contracts/README.md">Share definition, deposit, rebalance, redeem, fees and the oracle gate.</SourceRef>
        <SourceRef path="keeper/README.md">The 60 second loop, triggers, guards and event lines.</SourceRef>
        <SourceRef path="contracts/SECURITY.md">The entry fee rule, its break-even and the feed measurement behind the default.</SourceRef>
        <SourceRef path="web/public/llms.txt">Canonical gate states, caps and current values.</SourceRef>
      </Sources>
    </Article>
  );
}
