import type { Metadata } from "next";
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
import universe from "@/lib/vault-universe.json";

export const metadata: Metadata = {
  title: "Vault sizing | Uptick",
  description:
    "How the $100,000 ceiling, the 20% share rule and the $10,000 minimum size set each live vault.",
};

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

const { vaults } = universe;
const atCeiling = vaults.filter((v) => v.depositCapUsd >= 100_000).length;

export default function VaultSizingPage() {
  return (
    <Article
      eyebrow="The evidence"
      title="Vault sizing"
      lede="Every vault is sized to the pool it trades in. The ceiling is $100,000, a pool must carry at least $10,000 at the share limit, and the binding constraint is usually the pool."
    >
      <TLDR>
        <ul>
          <li>
            A vault may hold at most 20% of the in-range liquidity of its pool, measured within plus or
            minus 5% of the price.
          </li>
          <li>
            That gives a cap of <Code>min($100,000, depth / 4)</Code>. A pool whose depth cannot
            carry $10,000 is left out; above that it gets the largest vault it can carry.
          </li>
          <li>
            {atCeiling} of {vaults.length} live vaults sit at the $100,000 ceiling. The rest are
            sized by depth.
          </li>
        </ul>
      </TLDR>

      <H2>The ceiling</H2>
      <P>
        $100,000 is the largest position the strategy is tested at and the largest any vault can
        take. It is a product decision as much as a risk one: below $10,000, the daily recentre, gas
        and swap impact cost more than the fees a vault that small can earn. The ceiling keeps the
        replay and the live vault in the same size range, so the gate figures describe the vault a
        depositor actually uses.
      </P>

      <H2>The share constraint</H2>
      <P>
        A vault that owns most of a pool's active liquidity is no longer a price taker. Its own
        recentre moves the price, its deposits change the fee share of everyone else, and an exit
        has to trade against a book the vault itself dominates. The rule is a hard share limit
        instead of a judgment call.
      </P>
      <P>
        Let <Code>depth</Code> be the dollar value of active liquidity in the deepest USDG pool,
        within plus or minus 5% of the price. After a deposit of <Code>V</Code>, the
        vault's share is <Code>V / (depth + V)</Code>. Holding that at or below 20% gives the cap.
      </P>
      <CodeBlock
        label="keeper/src/universe.ts"
        code={`V / (depth + V) <= 0.20
V <= depth * 0.20 / 0.80
V <= depth / 4

capUsd = min(100_000, floor(depth / 4))`}
      />
      <P>
        Depth is not the pool's total value locked. It is the liquidity that can actually fill
        swaps inside the band the vault holds, valued at the current price. A pool with a large
        balance parked outside the band does not get credit for it.
      </P>

      <H2>The floor</H2>
      <P>
        A pool that would carry less than $10,000 at the 20% share is left out. At that size the
        fixed costs of a daily recentre dominate. Tokens that pass the feed and pool checks but fail
        this one, or the volume floor, are recorded in the universe with the check that stopped
        them.
      </P>

      <H2>What a token must clear</H2>
      <P>
        Sizing is the last of several checks. A token reaches the replay only when every row below
        passes. The first failure wins and is written into the universe as the reason.
      </P>
      <DataTable
        columns={["Check", "Threshold", "Why"]}
        rows={[
          [
            "Contract code",
            "Bytecode at the registry address",
            "A Stock Token address with no code cannot be transferred or priced.",
          ],
          [
            "Chainlink feed",
            "Present, readable and positive",
            "The vault values its USDG leg and its fees from the feed.",
          ],
          [
            "Feed age",
            "At most 346,200 seconds",
            "A 24 hour heartbeat plus a ten minute grace and a long weekend. A feed silent longer than that is broken, not closed.",
          ],
          [
            "Pool volume",
            "At least $100,000 per day, 7-day average",
            "A pool with no flow earns no fees, whatever its depth.",
          ],
          [
            "Pool depth",
            "Cap of at least $10,000 at a 20% share",
            "Below this the recentre costs more than the fees.",
          ],
          [
            "Price agreement",
            "Pool within 300 bps of Chainlink at read time",
            "A pool priced away from the feed is not a market the vault should join.",
          ],
        ]}
        caption="The deepest USDG v3 pool by in-range depth is the one sized and replayed. v4 pools are replayed for comparison but do not enter eligibility, because StockVault holds a v3 position."
      />
      <P>
        The checks are strict about the feed and looser about the pool. A token whose deepest pool
        cannot carry a full vault still gets one at the size the pool supports, provided that size is
        at least $10,000. That is how AMD trades with an $18,436 cap while NVDA carries the full
        $100,000.
      </P>

      <H2>Worked examples</H2>
      <P>
        The figures below come from the universe build that produced the current vault list. Depth
        is rounded in the table; the cap is floored to whole dollars.
      </P>
      <DataTable
        columns={["Vault", "Pool depth, plus or minus 5%", "Deposit cap", "Binding limit"]}
        rows={[
          ["NVDA", "$1.61M", "$100,000", "The ceiling"],
          ["GME", "$197K", "$49,212", "Pool depth"],
          ["MSTR", "$89K", "$22,206", "Pool depth"],
          ["AMD", "$74K", "$18,436", "Pool depth"],
        ]}
        numeric={[2]}
        caption="Depth carries the largest whole-dollar vault at a 20% share. NVDA clears the ceiling, so its cap is the ceiling."
      />
      <Callout label="The cap is the whole vault, not one ticket">
        <Code>depositCap</Code> is a total. Once deposits reach it, <Code>maxDeposit</Code> returns
        zero for everyone. The $25,000 reduced-ticket rule is a second, smaller limit that applies
        on top of it when the replay gate says reduced.
      </Callout>

      <H2>The cap on each vault</H2>
      <P>
        The live list below is the same file the vault pages read. A cap at $100,000 means the pool
        carries more than the ceiling; anything lower is the pool's depth divided by four.
      </P>
      <DataTable
        columns={["Vault", "Deposit cap", "Set by"]}
        rows={vaults.map((v) => [
          v.symbol,
          usd(v.depositCapUsd),
          v.depositCapUsd >= 100_000 ? "The $100,000 ceiling" : "In-range pool depth",
        ])}
        numeric={[1]}
        caption={`Read from web/lib/vault-universe.json at block ${universe.universeBlock.toLocaleString("en-US")}.`}
      />

      <H3>How the contract enforces it</H3>
      <P>
        The cap is written into the vault at deployment and changed only by the owner through{" "}
        <Code>setDepositCap</Code>. Deposits and mints ask <Code>maxDeposit</Code> for the remaining
        room and revert with <Code>ExceedsMax</Code> beyond it. There is no path that adds assets
        without passing that check.
      </P>
      <P>
        A cap can rise or fall as the pool changes, but it is not recomputed on chain. The keeper
        rebuilds the universe from live pool state, and an operator applies a new cap when the pool
        has moved enough to matter.
      </P>

      <Sources>
        <SourceRef path="keeper/src/universe.ts">
          The ceiling, floor, 20% share rule, cap formula and eligibility checks.
        </SourceRef>
        <SourceRef path="keeper/README.md">
          The universe table with 7-day volume, band depth and cap for each eligible token.
        </SourceRef>
        <SourceRef path="contracts/src/StockVault.sol">
          depositCap, maxDeposit and setDepositCap.
        </SourceRef>
        <SourceRef path="web/lib/vault-universe.json">
          The live cap and gate state for each vault.
        </SourceRef>
      </Sources>
    </Article>
  );
}
