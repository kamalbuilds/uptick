import type { Metadata } from "next";
import {
  Article,
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

export const metadata: Metadata = {
  title: "The oracle and pricing | Uptick",
  description:
    "Chainlink freshness, the 10 minute TWAP, the deviation bounds, and the price each vault path trusts.",
};

export default function OracleAndPricingPage() {
  return (
    <Article
      eyebrow="Using a vault"
      title="The oracle and pricing"
      lede="Three prices feed every decision: the Chainlink feed, a 10 minute pool TWAP, and the pool's spot price. Each one has a job."
    >
      <TLDR>
        <ul>
          <li>
            Deposits, mints, withdrawals, redemptions and rebalances need the gate to return{" "}
            <Code>Ok</Code>. <Code>redeemInKind</Code> needs nothing.
          </li>
          <li>
            The gate compares the TWAP and the spot price to Chainlink within 100 bps by default,
            and rejects an answer older than 90,000 seconds.
          </li>
          <li>
            NAV values the USDG leg at the lower of Chainlink and the TWAP, so a lagging feed cannot
            misprice a deposit or a redemption.
          </li>
        </ul>
      </TLDR>

      <H2>Three prices</H2>
      <P>
        Chainlink reports the stock's USD price from off-chain venues. It sets the band and the
        minimum output of every swap the vault makes, and it is one of the two prices that value a
        share. It is also the slowest of the three, with a 24 hour heartbeat, so it can lag a fast
        move.
      </P>
      <P>
        The pool TWAP is the average tick of the Stock Token / USDG pool over at least 10 minutes.
        It says what the pool itself believes the price is, and it cannot be moved by a single
        block. The spot price is the pool's current tick. It is the most current and the least
        trustworthy, which is why it is checked but never used alone.
      </P>
      <DataTable
        columns={["Source", "What it is", "Used for"]}
        rows={[
          [
            "Chainlink",
            "AggregatorV3 answer in feed decimals, 24 hour heartbeat",
            "Share value, swap minimums, the centre of the band, and one side of every deviation check.",
          ],
          [
            "Pool TWAP",
            "Average tick over twapWindow, at least 600 seconds",
            "The composition of the position and the USDG leg's NAV price.",
          ],
          [
            "Pool spot",
            "slot0 sqrtPriceX96",
            "A gate input only. It never sets a price on its own.",
          ],
        ]}
        caption="All three are read in the same call, so a decision cannot mix prices from different blocks."
      />

      <H2>The gate&apos;s five checks</H2>
      <P>
        A single read produces one status. The checks run in order and the first failure is
        returned, while everything readable is still returned alongside it. A caller that only needs
        to know whether it may proceed reads the status.
      </P>
      <DataTable
        columns={["Status", "Check", "What it means"]}
        rows={[
          [
            "FeedInvalid",
            "The call reverted, the answer is zero or negative, the timestamp is zero or in the future, or answeredInRound is behind roundId.",
            "The feed is broken or mid-update. This is the only status that makes the view functions revert.",
          ],
          [
            "FeedStale",
            "block.timestamp minus updatedAt exceeds maxStaleness.",
            "The answer is readable but too old to price a trade. Deployed limit is 90,000 seconds.",
          ],
          [
            "TwapUnavailable",
            "pool.observe reverted for the window, usually because the pool's history is shorter than twapWindow.",
            "The pool cannot supply the average. A newly created pool starts here.",
          ],
          [
            "TwapDeviates",
            "The TWAP is more than maxDeviationBps away from Chainlink.",
            "The pool and the feed disagree beyond tolerance. One of them is wrong, and the vault will not guess which.",
          ],
          [
            "SpotDeviates",
            "The spot price is more than maxDeviationBps away from Chainlink.",
            "The pool has been pushed away from the feed. Blocked even if the 10 minute average still agrees.",
          ],
          [
            "Ok",
            "Every check passed.",
            "Deposits, withdrawals and rebalances may proceed.",
          ],
        ]}
        caption="Status is an enum on the vault. health() returns it as the first of six values and never reverts for a bad feed."
      />

      <H2>What each path trusts</H2>
      <P>
        The gate is not applied uniformly. The paths that hand the vault a price need it; the path
        that hands back the actual tokens does not.
      </P>
      <DataTable
        columns={["Path", "Gate", "Price used"]}
        rows={[
          [
            "deposit, mint",
            "Required",
            "Chainlink sets the swap minimum and the target ratio. NAV uses the lower of Chainlink and the TWAP.",
          ],
          [
            "withdraw, redeem",
            "Required",
            "Position composition at the TWAP. The preview applies the exit buffer.",
          ],
          [
            "rebalance",
            "Required",
            "The band is Chainlink plus or minus rangeBps. The swap minimum comes from Chainlink.",
          ],
          [
            "redeemInKind",
            "Not read",
            "A pro-rata slice of the actual balances and both legs. No swap, so no price.",
          ],
          [
            "totalAssets, pricePerShare, previews",
            "Not enforced",
            "Whatever is readable. Only FeedInvalid makes these revert.",
          ],
        ]}
        caption="The in-kind path is the escape hatch: it works while the gate is failing because it never converts anything."
      />

      <H2>Why NAV takes the lower price</H2>
      <P>
        The vault holds Stock Token and USDG. The Stock Token side is already in the unit of account.
        The USDG side has to be converted, and the choice of price changes what a share is worth.
      </P>
      <P>
        If the feed says $200 and the pool says $190, valuing USDG at $200 credits each USDG with
        fewer Stock Tokens than the pool would give for it. A depositor would buy shares below their
        redeemable value, and the difference would accrue to existing holders. Taking the minimum of
        the two closes that gap.
      </P>
      <CodeBlock
        label="contracts/src/StockVault.sol"
        code={`function _navPrice(Snapshot memory s) private view returns (uint256) {
    return Math.min(s.price, _sqrtToUsd(s.sqrtTwap));
}`}
      />
      <P>
        The TWAP, not spot, is the pool side of that comparison, so a same-block push cannot move
        NAV. The same price converts fee value before the treasury cut is taken.
      </P>

      <H2>The 10 minute TWAP</H2>
      <P>
        The window is stored as <Code>twapWindow</Code>, at least 600 seconds and at most one day.
        The vault calls <Code>pool.observe</Code> for the window and divides the tick accumulator
        difference by the elapsed seconds, rounding towards negative infinity so the average is
        never above the true one.
      </P>
      <P>
        A long enough window is what makes the average expensive to manipulate. It also means a
        pool that has just launched cannot serve it: the observe call reverts and the status is{" "}
        <Code>TwapUnavailable</Code> until the pool has the history.
      </P>
      <H2>Staleness and deviation</H2>
      <P>
        The feed's heartbeat is 24 hours. The deployed staleness limit is 25 hours, which leaves an
        hour of grace for a late update and still catches a feed that has stopped. The keeper runs a
        tighter guard at 87,000 seconds, so it stops building transactions before the contract would
        reject them.
      </P>
      <P>
        Deviation is bounded at 100 bps on both the TWAP and spot comparisons. That is tight on
        purpose: the vault only needs to know that the pool is trading near the feed at the moment
        it prices a deposit or a rebalance. A wider gap is not a better price, it is a broken market.
      </P>
      <DataTable
        columns={["Bound", "Deployed value", "Allowed range"]}
        rows={[
          ["maxDeviationBps", "100 bps", "10 to 500 bps"],
          ["maxStaleness", "90,000 seconds", "1 hour to 7 days"],
          ["twapWindow", "600 seconds", "600 seconds to 1 day"],
          ["rangeBps", "500 bps", "50 to 2,000 bps"],
          ["exitBufferBps", "30 bps", "0 to 200 bps"],
          ["perfFeeBps", "1,000 bps", "0 to 2,000 bps"],
        ]}
        numeric={[1]}
        caption="Deployed values come from the deploy script. Bounds are enforced by setParams, so a configuration outside them cannot be written, and every change is an owner action that emits ParamsUpdated."
      />

      <H3>Reading health</H3>
      <P>
        <Code>health()</Code> is the one call that reports the gate without reverting. It returns the
        status, the feed price, the feed timestamp, and the three square-root prices the decision was
        made from.
      </P>
      <CodeBlock
        label="a viem read"
        code={`const [status, price, updatedAt, sqrtOracle, sqrtTwap, sqrtSpot] =
  await client.readContract({
    address: vault,
    abi: stockVaultAbi,
    functionName: "health",
  });

if (status !== 0) throw new Error(\`oracle status \${status}\`);`}
      />
      <P>
        A front end can show the status, the age of the answer and the three prices before a user
        signs anything. The transaction still runs the gate for itself; the read is a preview, not a
        permission.
      </P>

      <H3>The exit buffer</H3>
      <P>
        <Code>previewRedeem</Code> returns fair value less 30 bps, and <Code>previewWithdraw</Code>{" "}
        grosses the requested amount up by the same factor. The buffer covers the swap that turns
        the USDG leg into the Stock Token on the way out, so the preview is a floor rather than an
        optimistic estimate. The actual payout is what the swap produces.
      </P>

      <Sources>
        <SourceRef path="contracts/src/StockVault.sol">
          The Status enum, _read, _readLenient, _requireHealthy, _navPrice, _twapTick, _deviates and the parameter bounds.
        </SourceRef>
        <SourceRef path="contracts/script/Deploy.s.sol">
          The deployed parameter set.
        </SourceRef>
        <SourceRef path="contracts/README.md">
          The pricing model and the oracle gate in prose.
        </SourceRef>
        <SourceRef path="keeper/src/config.ts">
          The keeper's own feed age and deviation guards.
        </SourceRef>
      </Sources>
    </Article>
  );
}
