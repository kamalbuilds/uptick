import type { Metadata } from "next";
import { Article, DataTable, H2, P, SourceRef, Sources, TLDR, PostFooter } from "@/components/prose";

export const metadata: Metadata = {
  title: "Who liquidity providers lose to | Uptick",
  description:
    "Fees earned per dollar lost to informed flow, split by NYSE hours, weeknights and weekends across the NVDA, SPCX and TSLA pools.",
};

export default function WhoLpsLoseToPage() {
  return (
    <Article
      eyebrow="Research"
      title="Who liquidity providers lose to"
      lede="A vault earns the fee on every swap and pays for the trades that arrive before the price moves. The ratio between the two is not constant across the week."
      date="2026-10-17"
      author="Uptick Research"
    >
      <TLDR>
        <ul>
          <li>
            <strong>The session matters.</strong> On NVDA at the plus or minus 2% band, a dollar of
            markout loss came with $1.21 of fees in NYSE hours, $1.23 at night and $3.83 on weekends.
          </li>
          <li>
            <strong>The clock is not a strategy.</strong> Across 5.1 million swaps over 54 days,
            session-timed schedules produced 0 wins out of 3 tokens against the best static band, at
            both $100,000 and $1,000,000.
          </li>
          <li>
            <strong>Measure the pool.</strong> The fee to markout ratio ranges from 0.78 to 7.07 on
            SPCX alone. Uptick publishes that ratio and gates each vault on kept APR, not fee APR.
          </li>
        </ul>
      </TLDR>

      <H2>The fee is not the return</H2>
      <P>
        Every swap pays the provider a fee. Some come from traders who know the price is about to
        move. The vault buys the other side, the price moves, and the position
        is worth less one hour later. That loss is the markout. The useful number is the fee earned
        per dollar of markout loss, because a vault can quote a high fee APR and still lose money to
        informed flow.
      </P>
      <P>
        The split comes from the NVDA, SPCX and TSLA pools. B2 is a plus or minus 2% band, B5 is
        plus or minus 5%, and each cell is the fee earned per dollar lost over a one hour markout. A
        ratio below 1 means it pays informed traders more than it collects in fees.
      </P>
      <DataTable
        columns={["Band", "Session", "NVDA", "SPCX", "TSLA"]}
        rows={[
          ["B2", "NYSE regular hours", "1.21", "0.78", "0.19"],
          ["B2", "Weeknights", "1.23", "3.02", "0.21"],
          ["B2", "Weekends", "3.83", "7.07", "1.69"],
          ["B5", "NYSE regular hours", "1.24", "0.95", "0.33"],
          ["B5", "Weeknights", "1.43", "2.71", "0.34"],
          ["B5", "Weekends", "4.45", "6.92", "3.09"],
        ]}
        numeric={[2, 3, 4]}
        caption="Fee earned per dollar lost to informed flow over a 1 hour markout, by band and session. Source: keeper/replay/SESSION-SPLIT.txt."
      />
      <P>
        Two patterns survive the noise. NYSE regular hours are the most toxic session for every pool:
        SPCX collects $0.78 per dollar lost and TSLA collects $0.19 at the B2 band. Weekends are the
        least toxic: SPCX reaches $7.07 and TSLA reaches $1.69. The second pattern is that the pool
        matters as much as the session. SPCX swings from 0.78 in NYSE hours to 7.07 on weekends at the
        same band, while TSLA never clears 1 in regular hours or weeknights at either band.
      </P>

      <H2>The session signal was tested, and it failed</H2>
      <P>
        A ratio that looks good by session is not enough to build a schedule. The replay tested the
        obvious version: run a tight band during NYSE hours and a wide band outside them. It used
        5.1 million swaps from 2026-08-24 to 2026-10-17 on NVDA, SPCX and TSLA, with $1,058M,
        $697M and $35.8M of volume. Each strategy ran at $100,000 and at $1,000,000, with a fee-only
        cost model and a pool-impact cost model.
      </P>
      <DataTable
        columns={["Strategy", "NVDA", "TSLA", "SPCX"]}
        rows={[
          ["A: full range", "8.8", "15.1", "-20.8"],
          ["B2: daily plus or minus 2%", "1.7", "17.7", "33.7"],
          ["B5: daily plus or minus 5%", "12.4", "42.0", "24.7"],
          ["B10: daily plus or minus 10%", "12.1", "36.4", "4.5"],
          ["C: hours-aware", "11.4", "-13.9", "-35.9"],
          ["D: C plus guardian", "9.2", "-48.3", "-44.2"],
        ]}
        numeric={[1, 2, 3]}
        caption="Net APR against holding, $100,000, fee-only. Negative means the vault trails holding the token. Source: keeper/replay/SPIKE-FINDINGS.md."
      />
      <P>
        The hours-aware strategy won 0 of 3 tokens at both sizes. It lost to the best static band on
        every token. The result is not a small miss: on TSLA, strategy C returns -13.9% against
        holding while a static B5 band returns 42.0% at the same size. The wide static bands mostly
        won because the vault held half its capital in USDG while the tokens fell, so the comparison
        is against a falling asset, not proof of a fee edge.
      </P>
      <P>
        The control is the part that closes the case. The replay shuffled the session labels,
        assigning the real schedule to random times, and the shuffled schedule beat the real one in
        64 of 64 cells. A pattern that wins after its labels are destroyed is not a timing signal.
        An inverse schedule did win 12 of 12 cells after the fact, then faded to 8.4% on NVDA and
        -11.7% on SPCX. That is a warning about post-hoc selection, not a strategy.
      </P>

      <H2>What the data did support</H2>
      <P>
        The fee to markout ratio separated pools and bands even when the session clock did not. The
        replay chose a different best static band for each token: B5 on NVDA and TSLA, B2 on SPCX.
        That is why Uptick does not sell a weekend vault or an hours-aware vault. It measures the
        ratio per pool, chooses the band per token, and publishes fee APR beside kept APR.
      </P>
      <P>
        The 5.1 million swaps set the size of the effect. SPCX at B2 pays $0.78 in NYSE hours and
        $7.07 on weekends; TSLA pays $0.19 and $1.69. A schedule that moved capital between those
        sessions would have to beat the loss it takes in the bad one. The test says it does not.
      </P>

      <H2>What this means for a holder</H2>
      <P>
        A vault page shows fee APR next to the APR the vault actually kept after markout and
        rebalancing cost. The deposit gate reads the kept figure, so a pool with a high fee APR and a
        weak kept APR stays closed. The session split is published because it explains why the design
        uses a wide band and a fixed recentre time instead of a market-timing rule.
      </P>
      <P>
        When a vault quotes a return, the number is the result of a replay on that pool at that
        vault&apos;s own cap. It is not an annualised fee rate, and it is not a claim that weekends
        always pay. The 54 day window contains the evidence, and the holder can check the same
        fee-to-markout figures before depositing.
      </P>

      <Sources>
        <SourceRef path="keeper/replay/SESSION-SPLIT.txt">
          Fee and 1 hour markout by session, band and token, from 5.1M swaps over 54 days.
        </SourceRef>
        <SourceRef path="keeper/replay/SPIKE-FINDINGS.md">
          Strategy comparison, net versus hold at $100,000 and $1,000,000, shuffled-time control and
          post-hoc checks.
        </SourceRef>
      </Sources>
      <PostFooter slug="who-lps-lose-to" />
    </Article>
  );
}
