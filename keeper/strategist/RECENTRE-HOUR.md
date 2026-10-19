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
