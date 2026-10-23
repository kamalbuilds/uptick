import type { Metadata } from "next";
import { Article, DataTable, H2, P, SourceRef, Sources, TLDR, PostFooter } from "@/components/prose";
import universe from "@/lib/vault-universe.json";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const gateLabel = (state: string) => state.charAt(0).toUpperCase() + state.slice(1);

const symbolsIn = (state: string) => universe.vaults.filter((v) => v.gate.state === state).map((v) => v.symbol);
const doors = { open: symbolsIn("open"), reduced: symbolsIn("reduced"), closed: symbolsIn("closed") };
const join = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export const metadata: Metadata = {
  title: "Sizing vaults to pools | Uptick",
  description:
    "Why each Uptick vault takes a different deposit cap, how the 20% liquidity share is calculated, and the seventeen caps live at block 93099228.",
};

export default function SizingVaultsToPoolsPage() {
  return (
    <Article
      eyebrow="Research"
      title="Sizing vaults to pools"
      lede="A $100,000 vault is the ceiling, not the default. Every vault takes the largest position that stays within 20% of its pool's in-range liquidity."
      date="2026-10-20"
      author="Uptick Research"
    >
      <TLDR>
        <ul>
          <li>
            <strong>The unit is liquidity share.</strong> A fixed $100,000 is a large share of a thin
            pool and a small share of a deep one. Uptick sizes each vault to its own pool.
          </li>
          <li>
            <strong>The rule is mechanical.</strong> Take the largest position where the vault is at
            most 20% of in-range liquidity, cap it at $100,000, and require at least $10,000.
          </li>
          <li>
            <strong>Seventeen vaults qualify.</strong> Of 196 Stock Tokens, 35 have a Chainlink feed,
            95 have a USDG pool and 17 clear every condition at block 93099228.
          </li>
        </ul>
      </TLDR>

      <H2>A fixed ceiling is the wrong unit</H2>
      <P>
        A liquidity position is a claim on a pool, and its share determines what it earns and what it
        loses. A $100,000 position is small in a $1.97M pool and dominant in a $74K pool. One dollar
        cap for both would leave a deep pool underused or let a thin pool be overwhelmed.
      </P>
      <P>
        Uptick sizes downward. A thin pool gets a smaller vault, not no vault: a token that passes
        the feed, pool, volume and price checks is admitted, then capped at the size its liquidity can
        absorb. A cap below $10,000 is the exception, because fixed opening and rebalancing cost would
        dominate, so the token is not opened.
      </P>
      <P>
        The cap is not a marketing figure. The StockVault contract enforces it through depositCap, so
        a deposit above the cap reverts rather than being accepted and held outside the strategy.
      </P>

      <H2>How the cap is computed</H2>
      <P>
        The pass reads every token in the Robinhood Chain registry, confirms code, and examines the
        Chainlink feed and USDG pools. The conditions are explicit.
      </P>
      <DataTable
        columns={["Condition", "Threshold"]}
        rows={[
          ["Chainlink Stock Token feed", "Present, readable and positive"],
          ["Feed age", "At most 4 days"],
          ["Pool", "Deepest USDG v3 pool by active liquidity across the 5% band"],
          ["Pool volume", "At least $100,000 per day, 7-day average"],
          ["Vault cap", "At least $10,000 and at most $100,000"],
          ["Pool price against feed", "Within 300 bps"],
        ]}
        caption="Vault eligibility in keeper/src/universe.ts. Source: keeper/README.md."
      />
      <P>
        Depth is active liquidity within 5% of the feed price, in dollars. The vault&apos;s share is
        its position divided by its position plus depth. The rule takes the largest position where
        that share is at most 20%, capped at $100,000 and floored to whole dollars. In symbols, V
        divided by V plus depth is at most 0.20. A token is eligible only if the result is at least
        $10,000.
      </P>
      <P>
        The checks run in order: feed, pool, volume, price, cap. A token that fails one is reported
        with the reason and does not reach the vault table.
      </P>

      <H2>What the cap does to a token</H2>
      <P>
        The ceiling binds on the deepest pools; depth binds everywhere else. NVDA and USO support the
        full $100,000. MU, TSLA, GME and AMD do not, so their caps come from the pool.
      </P>
      <DataTable
        columns={["Token", "Pool depth, 5% band", "Vault cap", "Binding limit"]}
        rows={[
          ["NVDA", "$1.61M", "$100,000", "Ceiling"],
          ["USO", "$1.97M", "$100,000", "Ceiling"],
          ["MU", "$347K", "$86,710", "Pool depth"],
          ["TSLA", "$333K", "$83,206", "Pool depth"],
          ["GME", "$197K", "$49,212", "Pool depth"],
          ["AMD", "$74K", "$18,436", "Pool depth"],
        ]}
        numeric={[1, 2]}
        caption="Selected depth and cap pairs at block 93099228. Source: keeper/README.md."
      />
      <P>
        A pool can pass every market test and still receive a cap well below the ceiling. MU has a
        readable feed, a USDG pool and enough volume, and its vault is $86,710 because that is the
        largest position the pool can hold at a 20% share. AMD passes the same tests and receives
        $18,436. Neither is a smaller version of the same product; each is the size its pool supports.
      </P>

      <H2>Seventeen vaults, seventeen caps</H2>
      <P>
        At block 93099228, 196 tokens are in the registry, 35 have a usable Chainlink feed, 95 have a
        USDG v3 pool, and 17 clear every condition. The table below is generated from the same
        universe file the vault pages read, so the cap on this page is the cap in the contract.
      </P>
      <DataTable
        columns={["Token", "Gate", "Deposit cap"]}
        rows={universe.vaults.map((vault) => [
          vault.symbol,
          gateLabel(vault.gate.state),
          usd(vault.depositCapUsd),
        ])}
        numeric={[2]}
        caption="All 17 eligible Stock Tokens at block 93099228. Caps are depositCapUsd, enforced by StockVault. Gates are from the replay."
      />
      <P>
        {doors.open.length} vaults are open, {doors.reduced.length} are reduced and {doors.closed.length} are
        closed. {join(doors.open)} {doors.open.length === 1 ? "is" : "are"} open. {join(doors.reduced)} are reduced.
        The remaining {doors.closed.length} are closed. The gate and the cap are
        separate decisions: a vault can have a large cap and still be closed if its replay fails, and
        a closed vault keeps its cap published so the sizing rule can be checked.
      </P>
      <P>
        The table is written by export-web from keeper/data/universe.json and keeper/data/replay.json.
        The universe file carries depth, volume, feed deviation and cap; the replay file carries gate
        state and kept APR. The export records its block, so a cap and a gate cannot come from
        different states.
      </P>

      <H2>What this means for a holder</H2>
      <P>
        The deposit cap is visible before a holder signs, and the vault contract refuses anything
        above it. A large ticket into a deep pool can clear; the same ticket into a thin pool cannot.
        The on-chain cap on AMD is $18,436 and on GME is $49,212, not $100,000.
      </P>
      <P>
        The gate is a second check. A vault can be under its cap and still be closed because its
        held-out kept APR fell below the floor. The cap says what the pool can carry; the gate says
        whether the strategy kept enough. Both are shown on the vault page.
      </P>

      <Sources>
        <SourceRef path="keeper/README.md">
          Eligibility conditions, the 196 to 35 to 95 to 17 funnel and the depth to cap examples.
        </SourceRef>
        <SourceRef path="keeper/src/universe.ts">
          Rule thresholds, the 20% share calculation and the eligibility verdict.
        </SourceRef>
        <SourceRef path="web/lib/vault-universe.json">
          The 17 caps and gate states at block 93099228, built from the keeper universe and replay.
        </SourceRef>
      </Sources>
      <PostFooter slug="sizing-vaults-to-pools" />
    </Article>
  );
}
