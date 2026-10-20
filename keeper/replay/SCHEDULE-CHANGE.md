# Replay schedule change: 02:00 UTC after each NYSE session

Source: `python3 replay/replay.py NVDA GOOGL CRCL SPCX`, window 2026-09-17 00:00 UTC to 2026-10-17 00:00 UTC, capital USD 100,000, band +-5% around Chainlink. Old schedule: daily at NYSE open + 5 min (13:35 UTC in this window), 30 checkpoints. New schedule: 02:00 UTC on the UTC day after each NYSE trading day, initial deploy kept, slots with feed age over the vault's 25 h `maxStaleness` (90,000 s) skipped, 22 requested and 22 kept in this window.

Two engine share modes are reported. `mixed` is the legacy conservative mode whose field names carry the gate. `path` is the current engine default (`engine.SHARE`). The pool choice is still made on the conservative calibration half, so the chosen pools did not change.

## Chosen pool, conservative mode (`mixed`) and path mode

| token | schedule | full mixed | full path | first half mixed | first half path | second half mixed | second half path | gate (conservative) | gate (path, informational) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| NVDA | old | 5.0365 | 6.3321 | 10.9090 | 11.5559 | -0.4161 | 1.4715 | reduced | open |
| NVDA | new | 6.9369 | 8.2590 | 12.2347 | 12.8877 | 1.8139 | 3.7094 | open | open |
| GOOGL | old | -2.5732 | 1.8527 | -7.8286 | -2.7944 | 2.5132 | 6.5654 | reduced | reduced |
| GOOGL | new | -1.8036 | 2.6547 | -5.6238 | -0.5329 | 4.0795 | 8.1389 | reduced | reduced |
| CRCL | old | -78.4879 | -51.5396 | -47.3212 | -8.0920 | -116.7826 | -99.7293 | closed | closed |
| CRCL | new | -76.2325 | -48.4279 | -46.5844 | -9.4586 | -114.2371 | -93.2981 | closed | closed |
| SPCX | old | -25.0738 | -14.5951 | 43.5145 | 47.3884 | -98.2330 | -80.2426 | closed | closed |
| SPCX | new | -20.6398 | -10.1416 | 45.0611 | 48.9465 | -89.4489 | -71.4666 | closed | closed |

Gate states use the weaker of the two half-window APRs. The path column is shown for traceability only; `depositGate` and the table keep reading the conservative fields.

## What moved

| token | first half, mixed | second half, mixed | full, mixed | gate change |
| --- | ---: | ---: | ---: | --- |
| NVDA | +1.3257 | +2.2300 | +1.9004 | reduced to open, no cap |
| GOOGL | +2.2048 | +1.5663 | +0.7696 | none |
| CRCL | +0.7368 | +2.5455 | +2.2554 | none |
| SPCX | +1.5466 | +8.7840 | +4.4340 | none |

The schedule change is what moves the numbers. The staleness bound removed no slot at 02:00 in this window because the feed is roughly six hours old then. The count difference is the session filter: 22 after-session slots replace 30 calendar-day slots.

`replay.json` now carries `edge_apr_pct_upper` beside `edge_apr_pct` in `full`, `calibration` and `test`. `keeper/src/evidence.ts` exposes the path-mode weaker half as `keep.kept_apr_upper`, with `keep.kept_first_half_upper` and `keep.kept_second_half_upper` beside it.
