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
  title: "The evidence gate | Uptick",
  description:
    "How the 30-day replay decides whether a vault takes deposits, caps a single ticket or closes, and the gate state of every vault today.",
};

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const { vaults } = universe;
const stateOf = (state: string): "open" | "reduced" | "closed" =>
  state === "open" || state === "reduced" ? state : "closed";
const states = { open: 0, reduced: 0, closed: 0 };
for (const vault of vaults) states[stateOf(vault.gate.state)] += 1;

export default function EvidenceGatePage() {
  return (
    <Article
      eyebrow="The evidence"
      title="The evidence gate"
      lede="Deposits open, shrink to a single capped ticket, or close because of what a replay of real swaps says a vault would have kept."
    >
      <TLDR>
        <ul>
          <li>
            The gate reads the weaker of two 15-day halves of a 30-day replay, so one good month
            cannot carry the decision.
          </li>
          <li>
            At or above break-even a vault is open. Between -20% and break-even a single ticket is
            capped at $25,000. Below -20% deposits close.
          </li>
          <li>
            {states.open} vaults are open, {states.reduced} reduced and {states.closed} closed at
            universe block {universe.universeBlock.toLocaleString("en-US")}.
          </li>
        </ul>
      </TLDR>

      <H2>Three numbers and a sign</H2>
      <P>
        A vault earns the pool fee on every swap that trades through its liquidity. It loses to
        informed flow that buys just before a price move and sells back after it, and it pays gas
        and swap impact each time the band moves. The replay tracks those three in annualised
        percentage terms and adds them up.
      </P>
      <DataTable
        columns={["Component", "What it counts", "Sign in the total"]}
        rows={[
          [
            "Fees",
            "The pool fee on every replayed swap, at the share of liquidity the vault would have held.",
            "Added",
          ],
          [
            "Markout",
            "The value informed traders take back after their swaps, measured against the price a short time later.",
            "Subtracted",
          ],
          [
            "Cost",
            "Gas and swap impact for each recentre, spread over the year at the vault's size.",
            "Subtracted",
          ],
          [
            "Kept APR",
            "Fees plus markout minus cost. This is the number the gate reads.",
            "The result",
          ],
        ]}
        caption="The replay reports each term separately so a high fee APR never hides a larger markout."
      />

      <H2>The weaker half decides</H2>
      <P>
        The window is 30 days, split into two halves of 15. The first half selects the pool: among
        the token's v3 USDG pools carrying at least $1,000,000 of volume, the one with the best
        result wins. The best static-fee v4 pool (net of the PoolManager's protocol fee) is judged the same way, and the token deploys on the venue whose pool keeps more in its weaker half, among those at or above the floor; a tie stays on v3. The second half is untouched during selection and reports the out-of-sample
        figure. The gate takes the lower of the two kept APRs.
      </P>
      <P>
        This is deliberately asymmetric. A vault that kept 30% in a quiet fortnight and lost 4% in a
        busy one is recorded at -4%, not at the average. The state describes the weaker half because
        that is the half a new depositor has not seen yet.
      </P>
      <Callout label="Selection and reporting use different pools and different windows">
        Pool choice was made on the calibration half under the earlier 13:35 UTC schedule, so the
        chosen pools did not change when the replay moved to the 02:00 UTC recentre. The gate
        figures on this page follow the schedule the vault actually runs.
      </Callout>

      <H2>The three states</H2>
      <P>
        The thresholds are set in the keeper's evidence layer and mirrored in the web app. They are
        plain constants, not a score: the weaker half lands in one of three bands.
      </P>
      <CodeBlock
        label="keeper/src/evidence.ts"
        code={`worst >= 0            open      no cap
-20 <= worst < 0      reduced   $25,000 per ticket
worst < -20           closed    deposits refused`}
      />
      <DataTable
        columns={["State", "What it means", "Where it is enforced"]}
        rows={[
          [
            "open",
            "The weaker half cleared break-even, so both halves kept money for liquidity providers.",
            "The vault's own deposit cap is the only limit.",
          ],
          [
            "reduced",
            "One half lost money but stayed above the -20% floor. The vault keeps taking deposits with a smaller ticket.",
            "App deposit form and prepare_deposit cap one transaction at $25,000 of Stock Token.",
          ],
          [
            "closed",
            "The weaker half fell below the floor. A vault at this size did not keep money in the conditions the replay measured.",
            "App deposit form and prepare_deposit refuse the deposit. The contract is untouched.",
          ],
        ]}
        caption="The floor is -20% a year. Any floor between -5.6% and -89.4% produces the same open set on the current replay."
      />
      <Callout label="Capped means capped per transaction">
        The $25,000 figure applies to a single deposit, not to the vault's total deposits. The
        contract itself enforces the vault deposit cap, which is sized to pool depth and is a
        separate number. A reduced vault can receive many tickets; each one is limited.
      </Callout>

      <H3>What is held constant</H3>
      <P>
        The replay runs one strategy per vault at that vault's own size: a band around
        Chainlink chosen per token, recentred at 02:00 UTC on the day after each NYSE session, with slots skipped
        when the feed is older than 90,000 seconds. The window is 2026-09-17 to 2026-10-17, and 22
        after-session slots were requested and kept.
      </P>
      <P>
        Fees move with flow, so an open gate is a statement about the evidence, not a forecast. It
        says the strategy kept money on both halves of a real 30-day sample at this size. The
        <Code>kept</Code> figures beside each vault on the vaults page are those same half-window
        results.
      </P>

      <H2>The gate today</H2>
      <P>
        Every vault the eligibility rule admits appears below with the state and sentence written by
        the evidence builder. Order follows the file, which sorts by 30-day fee APR.
      </P>
      <DataTable
        columns={["Vault", "Gate", "Weaker half", "What the gate says"]}
        rows={vaults.map((v) => [
          v.symbol,
          v.gate.state,
          pct(v.gate.worst_half_apr),
          v.gate.reason,
        ])}
        numeric={[2]}
        caption={`Read from web/lib/vault-universe.json at block ${universe.universeBlock.toLocaleString("en-US")}.`}
      />
      <P>
        A closed vault still has a contract, a feed and a price. It simply does not take deposits
        while the gate says closed. When a later replay clears the floor, the same vault can reopen
        without a migration.
      </P>

      <Sources>
        <SourceRef path="keeper/src/evidence.ts">
          Floor, break-even, the $25,000 reduced ticket and the sentence the gate writes.
        </SourceRef>
        <SourceRef path="keeper/src/universe.ts">
          The eligibility rule that decides which tokens reach the replay at all.
        </SourceRef>
        <SourceRef path="keeper/replay/replay.py">
          The 30-day run, the two halves, the $1,000,000 pool-choice floor and the 90,000 second
          staleness skip.
        </SourceRef>
        <SourceRef path="keeper/replay/SCHEDULE-CHANGE.md">
          The 2026-09-17 to 2026-10-17 window and the 22 kept after-session slots.
        </SourceRef>
        <SourceRef path="web/lib/vault-universe.json">
          The live gate state, reason and weaker-half figure for each vault.
        </SourceRef>
      </Sources>
    </Article>
  );
}
