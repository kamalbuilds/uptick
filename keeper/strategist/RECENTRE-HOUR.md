# Recentre hour: does the time of the daily re-mint explain the kept-APR gap?

Window 30 days ending 2026-10-17T00:00:00+00:00, first half calibration to 2026-10-02T00:00:00+00:00, second half held out. Capital $100,000, rangeBps 500, band half-width 5%, recentre every 24h. Kept APR = fee APR + markout APR - cost APR. Benchmark 7.0%.

Two daily anchors are compared in the SAME engine run: the product keeper's NYSE open plus 5 min (09:35 ET, DST-aware) and the strategist's window-start anchor (00:00 UTC).

## Step 1. Reproduction

Held-out kept APR, both anchors, both engine share modes:

| token | mode | 00:00 UTC held | NYSE open held | NYSE minus 00:00 |
| --- | --- | ---: | ---: | ---: |
| NVDA | path | 2.37 | 1.47 | -0.90 |
| NVDA | mixed | 0.48 | -0.42 | -0.90 |
| GOOGL | path | 9.09 | 6.57 | -2.52 |
| GOOGL | mixed | 5.02 | 2.51 | -2.51 |

The quoted pair does not sit in one engine path. Under the legacy share mode `mixed`, which wrote `keeper/data/replay.json`, the NYSE-open anchor is -0.42 APR on NVDA and 2.51 on GOOGL, matching the quoted -0.42 and +2.51. Under the current default `path`, which wrote OFFHOURS.md, the same anchor is 1.47 on NVDA and 6.57 on GOOGL, and the 00:00 anchor reproduces the quoted 2.37 and 9.09.

What reproduces in a single path is the difference between the two anchors: the 00:00 anchor beats the NYSE-open anchor by 0.90 APR points on NVDA and 2.52 on GOOGL under `path`, and by 0.90 and 2.51 under `mixed`. The anchor gap is a property of the schedule, not of the share mode; the absolute level is not.

### Calibration halves (same runs)

| token | mode | 00:00 cal | NYSE open cal |
| --- | --- | ---: | ---: |
| NVDA | path | 12.70 | 11.56 |
| NVDA | mixed | 12.04 | 10.91 |
| GOOGL | path | 0.02 | -2.79 |
| GOOGL | mixed | -5.08 | -7.83 |

## Step 2. Recentre-hour sweep

Every UTC hour 0..23, first scored on calibration, then looked at on held out. The hour picked for the verdict is the single best calibration hour, chosen without ever reading held-out.

### NVDA (share mode `path`, pool 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3, fee 500 ppm)

| UTC hour | calibration kept APR | held-out kept APR | rebalances (held) |
| --- | ---: | ---: | ---: |
| 00:00 | 12.70 | 2.37 | 14 |
| 01:00 | 12.68 | 3.12 | 15 |
| 02:00 | 12.87 | 3.80 | 15 |
| 03:00 | 12.87 | 3.93 | 15 |
| 04:00 | 12.61 | 3.22 | 15 |
| 05:00 | 12.62 | 3.99 | 15 |
| 06:00 | 12.52 | 3.93 | 15 |
| 07:00 | 12.26 | 3.41 | 15 |
| 08:00 | 12.15 | 3.73 | 15 |
| 09:00 | 11.72 | 3.52 | 15 |
| 10:00 | 12.00 | 3.74 | 15 |
| 11:00 | 12.01 | 1.94 | 15 |
| 12:00 | 12.51 | 3.88 | 15 |
| 13:00 | 12.49 | 2.55 | 15 |
| 14:00 | 12.17 | 0.16 | 15 |
| 15:00 | 12.45 | 3.63 | 15 |
| 16:00 | 12.33 | 4.55 | 15 |
| 17:00 | 12.43 | 4.67 | 15 |
| 18:00 | 12.29 | 4.82 | 15 |
| 19:00 | 12.24 | 3.92 | 15 |
| 20:00 | 12.54 | 4.13 | 15 |
| 21:00 | 12.61 | 4.26 | 15 |
| 22:00 | 12.59 | 4.20 | 15 |
| 23:00 | 12.57 | 3.17 | 15 |

Best calibration hour: 02:00 UTC (calibration 12.87). Held-out 3.80, versus NYSE open 1.47 and 00:00 anchor 2.37. Held-out spread across all 24 hours: 4.67 APR points.

### GOOGL (share mode `path`, pool 0x34D0dC122CF9A8Eb296fC5e0D3A233625D7d19b7, fee 500 ppm)

| UTC hour | calibration kept APR | held-out kept APR | rebalances (held) |
| --- | ---: | ---: | ---: |
| 00:00 | 0.02 | 9.09 | 14 |
| 01:00 | 0.24 | 8.34 | 15 |
| 02:00 | -0.49 | 8.14 | 15 |
| 03:00 | 0.38 | 6.96 | 15 |
| 04:00 | 0.30 | 6.02 | 15 |
| 05:00 | -0.78 | 5.23 | 15 |
| 06:00 | -2.28 | 5.39 | 15 |
| 07:00 | -1.83 | 5.41 | 15 |
| 08:00 | -1.34 | 5.98 | 15 |
| 09:00 | -2.91 | 5.81 | 15 |
| 10:00 | -2.93 | 5.28 | 15 |
| 11:00 | -3.06 | 6.86 | 15 |
| 12:00 | -2.52 | 7.16 | 15 |
| 13:00 | -2.10 | 7.02 | 15 |
| 14:00 | -5.16 | 8.14 | 15 |
| 15:00 | -5.05 | 8.26 | 15 |
| 16:00 | -5.66 | 9.16 | 15 |
| 17:00 | -6.77 | 8.36 | 15 |
| 18:00 | -3.79 | 7.68 | 15 |
| 19:00 | -1.50 | 7.33 | 15 |
| 20:00 | -0.79 | 7.35 | 15 |
| 21:00 | -1.55 | 8.01 | 15 |
| 22:00 | -1.48 | 8.07 | 15 |
| 23:00 | -1.61 | 7.71 | 15 |

Best calibration hour: 03:00 UTC (calibration 0.38). Held-out 6.96, versus NYSE open 6.57 and 00:00 anchor 9.09. Held-out spread across all 24 hours: 3.93 APR points.

## Step 3. Verdict

Per token under the current default engine path (`path`): does the calibration-chosen recentre hour beat the NYSE-open anchor on held-out, by how much, and does it clear the 7.0% benchmark?

| token | best cal hour | held out | NYSE open held | gain vs NYSE | clears 7.0% |
| --- | --- | ---: | ---: | ---: | --- |
| NVDA | 02:00 | 3.80 | 1.47 | 2.33 | no |
| GOOGL | 03:00 | 6.96 | 6.57 | 0.39 | no |

### Cross-check under the legacy share mode `mixed`

| token | best cal hour | held out | NYSE open held | gain vs NYSE | clears 7.0% |
| --- | --- | ---: | ---: | ---: | --- |
| NVDA | 02:00 | 1.90 | -0.42 | 2.32 | no |
| GOOGL | 03:00 | 2.90 | 2.51 | 0.39 | no |

## Reading the result

- The anchor gap is real and reproduces: a daily recentre at 00:00 UTC keeps clearly more than the NYSE-open anchor on both tokens, in both engine share modes, by roughly the same margin.
- The two headline numbers quoted for the finding were taken from two different engine share modes. Holding the engine fixed, either both anchors move together (so the NYSE anchor is not at -0.42 on `path`) or both sink together (so the 00:00 anchor is not at +2.37 on `mixed`). The comparison in the finding is not drawn from one code path.
- Selecting a recentre hour on 15 calibration days and testing on 15 held-out days is one sample of one 30-day window. The held-out spread over the 24 hours is reported above so the size of the hour choice relative to that spread is visible; a single 30-day window cannot separate a durable hour effect from window-specific noise.

## Step 4. Feasible schedules


Step 2 picks the recentre hour from the schedule alone, ignoring whether the vault could actually re-mint at that moment. On-chain `StockVault.rebalance()` reverts when the newest Chainlink answer is older than the vault's `maxStaleness`, checked as `block.timestamp - s.updatedAt > p.maxStaleness` (`contracts/src/StockVault.sol`, status `FeedStale`). The deployed default is 90,000 seconds, 25 hours (`contracts/script/Deploy.s.sol`).

This step scores only schedules whose slots the vault can execute. A slot whose feed age exceeds the bound is skipped: the band stays where it was, it keeps earning or losing at the old range, and no gas is spent. Feed age is `strategies.Ref.age(t)`, the replay mirror of `block.timestamp - updatedAt`. The initial deploy at the window start is not a recentre and is always kept; only scheduled slots are filtered. Window, capital, rangeBps, band, halves and benchmark are those of Steps 1 to 3.

Feed staleness is common in this window. Share of hourly samples older than 25 hours, and the longest single gap:

| token | samples over 25h | longest gap (h) |
| --- | ---: | ---: |
| NVDA | 16.4% | 56.8 |
| GOOGL | 16.5% | 55.9 |

Skipped slots past the bound are exactly the recentres the bare schedules of Steps 2 and 3 assumed but the vault would revert on. The bound turns them into hold periods, which is what the feasible numbers below measure.

### (a) NYSE open plus 5 min, trading days only

`09:35 ET`, DST-aware, weekdays that are not exchange holidays. Slots older than 25 hours are skipped. The calendar-day version of this schedule in Step 2 runs every day, weekends included; this one runs trading days only. In this window every stale slot in the calendar-day set is a Sunday (age 41 to 46 hours), and Saturday at 09:35 ET is fresh at 17 to 22 hours, so the trading-day filter removes exactly the stale slots. Both halves keep 11 of 11 slots and skip none.

| token | mode | half | kept APR % | fee APR % | markout APR % | cost APR % | rebalances | slots |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| NVDA | path | cal | 11.74 | 41.72 | -27.41 | 2.58 | 11 | 11/11 kept, 0 stale |
| NVDA | path | held | 1.32 | 41.34 | -33.86 | 6.16 | 11 | 11/11 kept, 0 stale |
| NVDA | mixed | cal | 11.09 | 41.08 | -27.41 | 2.58 | 11 | 11/11 kept, 0 stale |
| NVDA | mixed | held | -0.56 | 39.45 | -33.86 | 6.16 | 11 | 11/11 kept, 0 stale |
| GOOGL | path | cal | -2.78 | 51.52 | -47.11 | 7.18 | 11 | 11/11 kept, 0 stale |
| GOOGL | path | held | 6.58 | 36.09 | -24.54 | 4.98 | 11 | 11/11 kept, 0 stale |
| GOOGL | mixed | cal | -7.82 | 46.47 | -47.11 | 7.18 | 11 | 11/11 kept, 0 stale |
| GOOGL | mixed | held | 2.52 | 32.04 | -24.54 | 4.98 | 11 | 11/11 kept, 0 stale |

### (b) Daily at a fixed UTC hour, infeasible slots skipped

Every hour 0..23, scored on calibration first, then looked at on held out. The hour is chosen on calibration under the current default share mode `path` only, then that single hour is read on held out in both modes. `kept` is the kept APR after stale slots are dropped; `stale` is how many of the 15 requested daily slots were past the bound. Skipped slots are weekend slots. An hour that falls inside the Friday-close to Monday-open feed gap carries four of them (both weekend days), the rest carry two; hence hours 00, 01 and 21 to 23 skip four and the middle of the day skips two.

#### NVDA (share mode `path`, pool `0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3`, fee 500 ppm)

| UTC hour | cal kept APR % | cal stale | held kept APR % | held stale |
| --- | ---: | ---: | ---: | ---: |
| 00:00 | 12.70 | 4 | 2.38 | 4 |
| 01:00 | 12.69 | 2 | 3.12 | 2 |
| 02:00 | 12.88 | 2 | 3.80 | 2 |
| 03:00 | 12.87 | 2 | 3.93 | 2 |
| 04:00 | 12.61 | 2 | 3.22 | 2 |
| 05:00 | 12.62 | 2 | 3.99 | 2 |
| 06:00 | 12.52 | 2 | 3.93 | 2 |
| 07:00 | 12.26 | 2 | 3.41 | 2 |
| 08:00 | 12.15 | 2 | 3.73 | 2 |
| 09:00 | 11.72 | 2 | 3.52 | 2 |
| 10:00 | 12.00 | 2 | 3.74 | 2 |
| 11:00 | 12.01 | 2 | 1.94 | 2 |
| 12:00 | 12.51 | 2 | 3.88 | 2 |
| 13:00 | 12.50 | 2 | 2.55 | 2 |
| 14:00 | 12.17 | 2 | 0.16 | 2 |
| 15:00 | 12.45 | 2 | 3.63 | 2 |
| 16:00 | 12.33 | 2 | 4.55 | 2 |
| 17:00 | 12.43 | 2 | 4.67 | 3 |
| 18:00 | 12.29 | 2 | 4.83 | 3 |
| 19:00 | 12.24 | 2 | 3.92 | 4 |
| 20:00 | 12.54 | 2 | 4.14 | 4 |
| 21:00 | 12.62 | 4 | 4.26 | 4 |
| 22:00 | 12.59 | 4 | 4.20 | 4 |
| 23:00 | 12.57 | 4 | 3.17 | 4 |

Best calibration hour: 02:00 UTC (calibration 12.88%, 2 stale). Held out 3.80% (2 stale), versus the feasible NYSE-open schedule 1.32% (0 stale). Under `mixed` the same hour on held out is 1.90%.

#### GOOGL (share mode `path`, pool `0x34D0dC122CF9A8Eb296fC5e0D3A233625D7d19b7`, fee 500 ppm)

| UTC hour | cal kept APR % | cal stale | held kept APR % | held stale |
| --- | ---: | ---: | ---: | ---: |
| 00:00 | 0.02 | 4 | 9.09 | 4 |
| 01:00 | 0.24 | 2 | 8.34 | 2 |
| 02:00 | -0.48 | 2 | 8.14 | 2 |
| 03:00 | 0.39 | 2 | 6.96 | 2 |
| 04:00 | 0.30 | 2 | 6.03 | 2 |
| 05:00 | -0.78 | 2 | 5.23 | 2 |
| 06:00 | -2.28 | 2 | 5.40 | 2 |
| 07:00 | -1.83 | 2 | 5.41 | 2 |
| 08:00 | -1.34 | 2 | 5.98 | 2 |
| 09:00 | -2.91 | 2 | 5.81 | 2 |
| 10:00 | -2.93 | 2 | 5.28 | 2 |
| 11:00 | -3.06 | 2 | 6.86 | 2 |
| 12:00 | -2.51 | 2 | 7.17 | 2 |
| 13:00 | -2.09 | 2 | 7.02 | 2 |
| 14:00 | -5.16 | 2 | 8.15 | 2 |
| 15:00 | -5.05 | 2 | 8.26 | 2 |
| 16:00 | -5.66 | 2 | 9.16 | 2 |
| 17:00 | -6.77 | 2 | 8.36 | 2 |
| 18:00 | -3.79 | 3 | 7.68 | 3 |
| 19:00 | -1.50 | 3 | 7.33 | 4 |
| 20:00 | -0.79 | 3 | 7.35 | 4 |
| 21:00 | -1.55 | 3 | 8.01 | 4 |
| 22:00 | -1.47 | 4 | 8.08 | 4 |
| 23:00 | -1.60 | 4 | 7.72 | 4 |

Best calibration hour: 03:00 UTC (calibration 0.39%, 2 stale). Held out 6.96% (2 stale), versus the feasible NYSE-open schedule 6.58% (0 stale). Under `mixed` the same hour on held out is 2.91%.

### (c) Fixed hour 02:00 UTC

Schedule (b) at H=02, the hour Step 2 picked for NVDA, for both tokens and both modes.

| token | mode | half | kept APR % | rebalances | slots |
| --- | --- | --- | ---: | ---: | --- |
| NVDA | path | cal | 12.88 | 13 | 13/15 kept, 2 stale |
| NVDA | path | held | 3.80 | 13 | 13/15 kept, 2 stale |
| NVDA | mixed | cal | 12.22 | 13 | 13/15 kept, 2 stale |
| NVDA | mixed | held | 1.90 | 13 | 13/15 kept, 2 stale |
| GOOGL | path | cal | -0.48 | 13 | 13/15 kept, 2 stale |
| GOOGL | path | held | 8.14 | 13 | 13/15 kept, 2 stale |
| GOOGL | mixed | cal | -5.58 | 13 | 13/15 kept, 2 stale |
| GOOGL | mixed | held | 4.08 | 13 | 13/15 kept, 2 stale |

### Verdict on feasible schedules

Per token, the calibration-chosen feasible hour (picked under `path`) against the feasible NYSE-open schedule on held out. The bar is 2.0 APR points; the mixed-mode column asks only whether the sign agrees, since the share mode moves the level and not the schedule difference.

| token | best cal hour | path held | path NYSE held | path gain | >= 2.0 | mixed gain | sign agrees |
| --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| NVDA | 02:00 | 3.80 | 1.32 | 2.48 | yes | 2.46 | yes |
| GOOGL | 03:00 | 6.96 | 6.58 | 0.39 | no | 0.38 | yes |

## Reading Step 4

- NVDA: the feasible NYSE-open schedule keeps 1.32% on held out and the calibration-chosen feasible hour 02:00 keeps 3.80%, a gain of 2.48 APR points. Under `mixed` the same pairing moves by 2.46 APR points, so the sign agrees.
- GOOGL: the feasible NYSE-open schedule keeps 6.58% on held out and the calibration-chosen feasible hour 03:00 keeps 6.96%, a gain of 0.39 APR points. Under `mixed` the same pairing moves by 0.38 APR points, so the sign agrees.
- The staleness bound barely moves any single schedule. A stale slot is a slot where the reference price has not moved, so the recentre the bare schedule asked for would have reproduced the same band and only spent gas; skipping it removes that gas and nothing else, which is why the feasible numbers sit within about a tenth of a point of Steps 2 and 3. Measured directly, the 00:00 anchor on held out is 2.37% unfiltered and 2.38% filtered for NVDA, and 9.09% both ways for GOOGL, while the rebalance count drops by the number of skipped slots.
- What changes is when the bound lands on a schedule that already had no better band to move to. The bound is a revert guard, not a strategy: it removes the trades the vault could not have sent.
- Sample is one 30-day window, 15 calibration days and 15 held-out days, capital $100,000 on the same pools as Steps 1 to 3 (`0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3` for NVDA). It is a replay estimate, not a live execution record.

Decision (2026-10-19): the keeper recentres at 02:00 UTC on the evening after each NYSE session (keeper/src/calendar.ts RECENTRE_UTC_HOUR), skipped automatically when the feed is stale. NVDA held-out gain +2.48 (path) and +2.46 (mixed) over the feasible NYSE-open schedule; GOOGL +0.38 / +0.39, within noise. One 30-day window, 15 days per half.
