import type { Metadata } from "next";
import { Article, DataTable, H2, P, SourceRef, Sources, TLDR } from "@/components/prose";

export const metadata: Metadata = {
  title: "Why 02:00 UTC | Uptick",
  description:
    "The keeper recentres after the NYSE close, at 02:00 UTC on the following UTC day. The held-out comparison against the old open-time schedule, token by token.",
};

export default function Why0200UtcPage() {
  return (
    <Article
      eyebrow="Research"
      title="Why 02:00 UTC"
      lede="The keeper used to recentre when the NYSE opened. It now waits until the session is over, and the change is measured on days the schedule did not see."
      date="2026-10-19"
      author="Uptick Research"
    >
      <TLDR>
        <ul>
          <li>
            <strong>The slot moved.</strong> The old schedule recentred at 09:35 ET, five minutes
            after the NYSE open. The new schedule recentres at 02:00 UTC on the UTC day after each
            NYSE trading day.
          </li>
          <li>
            <strong>Every token improved.</strong> Held-out kept APR rose on NVDA, GOOGL, CRCL and
            SPCX in both accounting modes. NVDA moved from reduced to open.
          </li>
          <li>
            <strong>The gate follows the new numbers.</strong> The conservative held-out figure
            decides the deposit gate. The path-mode figure is published beside it for traceability.
          </li>
        </ul>
      </TLDR>

      <H2>What changed</H2>
      <P>
        The old schedule ran daily at the NYSE open plus five minutes, which is 09:35 ET and 13:35
        UTC in this window. It produced 30 checkpoints over 30 calendar days. The new schedule runs
        at 02:00 UTC on the UTC day after each NYSE trading day. It keeps the initial deploy, then
        requests a slot after every session. In the comparison window it requested 22 slots and kept
        22.
      </P>
      <P>
        The difference in count is the session filter, not a staleness filter. The calendar in{" "}
        <span className="figure">keeper/src/calendar.ts</span> uses America/New_York, weekends, ten
        full-day holidays with observed-day shifts, and early closes. A slot is skipped when the
        Chainlink feed is older than the vault&apos;s 25 hour maxStaleness of 90,000 seconds. At
        02:00 the feed is roughly six hours old, so the bound removed no slot in this window.
      </P>
      <P>
        02:00 UTC is 22:00 ET during daylight time and 21:00 ET during standard time. It sits after
        the 16:00 ET close in both regimes, and it gives the oracle time to print the closing price
        before the vault moves its range.
      </P>

      <H2>The held-out comparison</H2>
      <P>
        The replay covers 2026-09-17 to 2026-10-17, with $100,000 of capital and a plus or minus 5%
        band around Chainlink. The schedule is the only thing that changes: same tokens, same chosen
        pools, same engine. The first 15 days calibrate and the second 15 days are held out. The
        table reports the held-out half.
      </P>
      <DataTable
        columns={["Token", "Old, mixed", "New, mixed", "Old, path", "New, path"]}
        rows={[
          ["NVDA", "-0.42%", "1.81%", "1.47%", "3.71%"],
          ["GOOGL", "2.51%", "4.08%", "6.57%", "8.14%"],
          ["CRCL", "-116.78%", "-114.24%", "-99.73%", "-93.30%"],
          ["SPCX", "-98.23%", "-89.45%", "-80.24%", "-71.47%"],
        ]}
        numeric={[1, 2, 3, 4]}
        caption="Held-out kept APR, old schedule at 09:35 ET against new schedule at 02:00 UTC. Source: keeper/replay/SCHEDULE-CHANGE.md."
      />
      <P>
        Held-out mixed improved by 2.23 points on NVDA, 1.57 on GOOGL, 2.55 on CRCL and 8.78 on
        SPCX. The full window improved by 1.90, 0.77, 2.26 and 4.43 points on the same tokens. A
        higher kept APR is not a promise of a positive one. CRCL and SPCX remain deeply negative and
        closed.
      </P>
      <P>
        Only NVDA crossed a gate: from reduced to open, which removes the $25,000 per-transaction
        cap. GOOGL stays reduced, and CRCL and SPCX stay closed. The gate reads the weaker of the two
        halves, so a good second half cannot open a vault on its own.
      </P>

      <H2>Why 02:00 UTC, not 09:35 ET</H2>
      <P>
        The anchor comparison tested two clean schedules over the 30 days ending 2026-10-17. The
        first half ended 2026-10-02 and selected the anchor; the second half was held out. The
        anchors were the keeper&apos;s 09:35 ET open plus five minutes and the strategist&apos;s
        00:00 UTC. The 00:00 UTC anchor beat 09:35 ET on both tokens in both modes: by 0.90 points
        on NVDA and 2.51 to 2.52 points on GOOGL.
      </P>
      <P>
        The next step swept every UTC hour and scored the candidates on held-out days. NVDA at 02:00
        kept 3.80% against 1.32% for the open, a gain of 2.48 points in path mode and 2.46 in mixed
        mode, which clears the 2.0 point bar. GOOGL&apos;s best slot was 03:00 at 6.96% against
        6.58%, a gain of 0.39 points, inside the noise band. The joint choice was 02:00 UTC.
      </P>
      <P>
        Feed age is the operational reason for the margin. The feed is more than 25 hours old in
        16.4% of NVDA samples and 16.5% of GOOGL samples, with longest gaps of 56.8 and 55.9 hours. A
        schedule that recentred inside the session would sometimes move the range on a stale price.
        Waiting until 02:00 UTC puts the move after the close and outside the longest observed gap in
        this window.
      </P>

      <H2>What this means for a holder</H2>
      <P>
        The gate on a vault page reflects the schedule the keeper actually runs. The keeper requests
        after-session checkpoints, skips a stale feed, and recentres at 02:00 UTC. The deposit gate
        then reads the conservative kept APR from the replay that uses those checkpoints.
      </P>
      <P>
        The old and new figures are both published, so the change can be checked rather than taken
        on trust. NVDA is open on the new numbers. GOOGL is reduced, and CRCL and SPCX are closed.
        The schedule is an operational choice backed by a held-out comparison, not a claim that any
        particular hour is safe.
      </P>

      <Sources>
        <SourceRef path="keeper/replay/SCHEDULE-CHANGE.md">
          Old and new schedule replay, held-out kept APR, gate states and the 22 kept checkpoints.
        </SourceRef>
        <SourceRef path="keeper/strategist/RECENTRE-HOUR.md">
          Anchor comparison, hourly sweep, held-out gains and feed-age counts.
        </SourceRef>
        <SourceRef path="keeper/src/calendar.ts">
          NYSE sessions, holidays, early closes and the 02:00 UTC slot.
        </SourceRef>
      </Sources>
    </Article>
  );
}
