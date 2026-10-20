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

export const metadata: Metadata = {
  title: "The recentre schedule | Uptick",
  description:
    "Why the keeper recentres at 02:00 UTC after each NYSE session, how the session calendar is built, and the guards that stop a bad rebalance.",
};

export default function RecentreSchedulePage() {
  return (
    <Article
      eyebrow="The evidence"
      title="The recentre schedule"
      lede="One recentre per NYSE session, at 02:00 UTC, when the stock is shut, the feed has settled and the next open is hours away."
    >
      <TLDR>
        <ul>
          <li>
            The keeper recentres at 02:00 UTC on the day after each NYSE session, inside a six hour
            window, once per session.
          </li>
          <li>
            On held-out data at 02:00 UTC, NVDA kept 2.48 APR points more than on a recentre at the
            NYSE open. GOOGL moved 0.39 points, inside the noise.
          </li>
          <li>
            A stale feed or a wide pool-to-feed gap blocks the send. The keeper retries each minute
            and never trades through a guard.
          </li>
        </ul>
      </TLDR>

      <H2>Why 02:00 UTC</H2>
      <P>
        A recentre is a trade against the pool. Doing it while the stock is trading means the band
        moves in the middle of the flow the vault is trying to earn from, and the swap that
        rebalances the legs pays the spread at its widest. Doing it after the close and before the
        next open avoids both.
      </P>
      <P>
        02:00 UTC is 22:00 in New York during daylight saving and 21:00 during standard time. The
        session has ended at 16:00 ET, the Chainlink answer has settled, and the next session is
        more than eleven hours away. The keeper does not need a clock change: it computes the next
        slot from the exchange calendar and compares UTC timestamps.
      </P>

      <H2>What the hour is worth</H2>
      <P>
        The hour was chosen on one half of a 30-day window and read on the other. All 24 UTC hours
        were scored on the calibration half, the best hour was picked without looking at the second
        half, and that single hour was then measured out of sample. The comparison schedule is a
        recentre at 09:35 ET on trading days only, with slots the vault could not execute dropped.
      </P>
      <DataTable
        columns={["Token", "Best calibration hour", "Held-out kept APR", "NYSE open, held out", "Gain"]}
        rows={[
          ["NVDA", "02:00 UTC", "+3.80%", "+1.32%", "+2.48 points"],
          ["GOOGL", "03:00 UTC", "+6.96%", "+6.58%", "+0.39 points"],
        ]}
        numeric={[2, 3, 4]}
        caption="Feasible schedules, 15 calibration days and 15 held-out days ending 2026-10-17, capital $100,000, plus or minus 5% band. Under the legacy conservative share mode the same pairing moves NVDA by 2.46 points and GOOGL by 0.38."
      />
      <P>
        NVDA is the reason for the change. Under the conservative share mode the old schedule put
        its weaker half at -0.42% a year, which is below break-even and caps each deposit at $25,000;
        at 02:00 UTC the same half keeps 1.81% and the vault opens with no deposit cap. GOOGL stays
        reduced either way, because its weaker half is negative under both schedules.
      </P>
      <Callout label="One window, not a law">
        The study is 30 days with two halves, on two tokens, in one engine. The hour effect is
        measured, not proven to persist. The decision was taken on the held-out half, and the gate
        re-tests it every time the replay is rebuilt.
      </Callout>

      <H2>What changed in the replay</H2>
      <P>
        Re-running the same 30 days under the new schedule moves every token in the same direction.
        The figures below are full-window, in both engine share modes, with the gate taken from the
        weaker half in the conservative mode.
      </P>
      <DataTable
        columns={["Token", "Old, conservative", "New, conservative", "Old, current engine", "New, current engine", "Gate"]}
        rows={[
          ["NVDA", "+5.04%", "+6.94%", "+6.33%", "+8.26%", "reduced to open"],
          ["GOOGL", "-2.57%", "-1.80%", "+1.85%", "+2.65%", "reduced, unchanged"],
          ["CRCL", "-78.49%", "-76.23%", "-51.54%", "-48.43%", "closed, unchanged"],
          ["SPCX", "-25.07%", "-20.64%", "-14.60%", "-10.14%", "closed, unchanged"],
        ]}
        numeric={[1, 2, 3, 4]}
        caption="Window 2026-09-17 to 2026-10-17, 30 calendar-day checkpoints replaced by 22 after-session slots, all 22 kept."
      />
      <P>
        The count changes because the schedule changes, not because slots were dropped: 30
        calendar-day checkpoints, weekends included, became 22 after-session slots. No slot at 02:00
        was skipped for staleness in this window, since the feed is roughly six hours old at that
        hour.
      </P>

      <H2>The session calendar</H2>
      <P>
        The keeper carries a rule-based NYSE calendar rather than a downloaded file. Given a year it
        derives weekends, the ten full-day holidays with their observed shifts, and the early
        closes.
      </P>
      <DataTable
        columns={["Case", "Rule", "Effect on the keeper"]}
        rows={[
          [
            "Weekend",
            "Saturday and Sunday",
            "No scheduled slot and no out-of-range recentre.",
          ],
          [
            "Holiday on a Saturday",
            "Observed on the Friday before",
            "That Friday is closed. A Saturday January 1 is the exception: the NYSE does not close the prior Friday.",
          ],
          [
            "Holiday on a Sunday",
            "Observed on the Monday after",
            "That Monday is closed.",
          ],
          [
            "Good Friday",
            "Two days before Easter Sunday, from the anonymous Gregorian algorithm",
            "Closed.",
          ],
          [
            "Early close",
            "13:00 ET",
            "The session ends earlier; the after-session slot is unchanged.",
          ],
        ]}
        caption="Holiday sets are memoised per year. The calendar is a pure function of the year, so it can be tested without a network call."
      />

      <H2>Two triggers</H2>
      <P>
        Each pass of the 60 second loop reads the pool's current tick, the Chainlink answer and the
        vault's stored range, then asks whether either trigger fires. They are separate on purpose:
        one keeps the schedule, the other handles a stock that has run away from the band.
      </P>
      <DataTable
        columns={["Trigger", "Condition", "Window"]}
        rows={[
          [
            "scheduled",
            "The 02:00 UTC slot for the last completed NYSE session has arrived and nothing has been sent since that slot.",
            "Six hours from 02:00 UTC.",
          ],
          [
            "out_of_range",
            "The tick is outside the stored range and has been for 30 minutes, at least 2 hours after the last rebalance.",
            "NYSE trading days only.",
          ],
        ]}
        caption="A weekend or holiday tick outside the band never triggers a rebalance. The stored range holds until the next session slot."
      />
      <P>
        The out-of-range path exists because a band can be left behind by an overnight gap. It
        stays inside NYSE hours so the keeper is trading while the stock is liquid, and its two hour
        gap stops a band edge from producing a burst of rebalances.
      </P>

      <H2>Guards before a send</H2>
      <P>
        A due rebalance is still only a candidate. Two guards run first, and either one stops the
        send; the keeper retries each minute until the window closes.
      </P>
      <DataTable
        columns={["Guard", "Limit", "On failure"]}
        rows={[
          [
            "Feed age",
            "At most 87,000 seconds",
            "Blocked. The keeper retries each minute until the window closes.",
          ],
          [
            "Pool against feed",
            "At most 200 bps",
            "Blocked. A pool priced 2% away from Chainlink is not a market to rebalance into.",
          ],
        ]}
        caption="The keeper's deviation guard is looser than the contract's. It catches a pool that is clearly away from the feed; the vault's own gate decides whether the trade is allowed."
      />
      <P>
        The contract runs its own gate on every send, and it is the binding one: it measures the 10
        minute TWAP and the spot price against Chainlink at <Code>maxDeviationBps</Code>, 100 bps by
        default, so a pool that is 150 bps away from the feed passes the keeper's guard and still
        reverts with <Code>TwapDeviates</Code> or <Code>SpotDeviates</Code>. The keeper's 200 bps is
        the outer check, not a replacement.
      </P>
      <P>
        After the guards pass, the keeper simulates the exact <Code>rebalance()</Code> call with{" "}
        <Code>eth_call</Code> against the current block. Only a successful simulation is signed.
        Every pass appends one JSON line, so a blocked day is visible in the log rather than silent.
      </P>
      <CodeBlock
        label="keeper log events"
        code={`start              one line at boot: mode, chain, tickers, guards
tick               action: none | blocked_by_guard | skipped | dry_run_would_send
simulate_failed    action: not_sent, with the first line of the revert
simulate_ok
sent               hash
reverted           hash, block
rebalanced         hash, block, gas_used`}
      />
      <P>
        Each line also carries the ticker, block, pool price, Chainlink price and age, deviation in
        bps, the guard verdict and reasons, the current band, the trigger and the next scheduled
        slot. A guard failure is a line with <Code>blocked_by_guard</Code> and the reason that
        fired.
      </P>

      <H3>The backstop</H3>
      <P>
        The keeper is a convenience, not a single point of failure. <Code>rebalance()</Code> is open
        to anyone once 26 hours have passed since the last one, and the vault's own
        <Code>minRebalanceInterval</Code> is six hours. A vault keeps earning at its old band if the
        keeper stops, and anyone can move it.
      </P>

      <Sources>
        <SourceRef path="keeper/src/calendar.ts">
          The rule-based NYSE calendar, the 02:00 UTC slot and the six hour window.
        </SourceRef>
        <SourceRef path="keeper/src/keeper.ts">
          The 60 second loop, both triggers, the guards, the simulation and the log lines.
        </SourceRef>
        <SourceRef path="keeper/src/config.ts">
          Feed age and deviation limits, out-of-range minutes and the minimum gap.
        </SourceRef>
        <SourceRef path="keeper/strategist/RECENTRE-HOUR.md">
          The 24 hour sweep, the held-out gains, the staleness bound and the 2026-10-19 decision.
        </SourceRef>
        <SourceRef path="keeper/replay/SCHEDULE-CHANGE.md">
          Old against new schedule across the full window, in both engine share modes.
        </SourceRef>
      </Sources>
    </Article>
  );
}
