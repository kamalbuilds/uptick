# Off-hours liquidity on StockVault pools

## Question

Does providing liquidity only outside NYSE regular hours keep more than the always-on setting and clear a 7.0% APR benchmark, for NVDA and GOOGL?

NYSE regular hours are Mon-Fri 09:30 to 16:00 America/New_York, with exchange holidays closed. The pool is in during nights, weekends and holidays, out during regular hours.

## What is measured

- Window: 30 days ending 2026-10-17 00:00 UTC. First 15 days calibrate, last 15 are held out.
- Capital: USD 100,000 per run. Engine: spikes/stock-vaults/scripts/engine.py, unchanged, data in keeper/data/engine/.
- `always_500`: rangeBps 500, recentre every 24h, in pool around the clock.
- `offhours_500`: rangeBps 500, in pool only outside NYSE regular hours, redeployed at each close centred on Chainlink.
- `offhours_tuned`: same as `offhours_500` with rangeBps chosen on the calibration half from {250, 500, 1000} by kept APR, then tested once on the held-out half.
- Kept APR is fee APR + markout APR - cost APR. Markout loss is the negative of the engine markout. The held-out numbers decide.

## Cost model for the round trip

The engine represents an idle period directly with `plan(t) = ('out',)`. At a withdrawal it charges `GAS_PULL_M * GAS_USD_PER_M` (0.30M gas, decreaseLiquidity plus collect) and holds the withdrawn token and USDG idle: no fees are earned, and the token leg keeps its price exposure. At the next redeploy it charges `GAS_REBAL_M * GAS_USD_PER_M` (0.75M gas) plus `swap_cost((x_new - x) * P, pool liquidity, P, fee tier)`, the swap needed to rebalance inventory into the new band. Each half is one continuous `simulate` call, so the withdrawal and redeploy are not double counted. The first entry is free in both the always-on and off-hours runs, matching the engine convention.

## NVDA

Pool `0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3` at fee 500 ppm, window volume $348,715,392. Calibration 2026-09-17T00:00:00+00:00 to 2026-10-02T00:00:00+00:00. Held-out 2026-10-02T00:00:00+00:00 to 2026-10-17T00:00:00+00:00.

Winning range chosen on calibration only: 250 bps. Candidate calibration kept APR: 250 bps 6.80%, 500 bps 3.65%, 1000 bps 1.91%.

| Strategy | Half | Fees USD | Markout loss USD | Rebalance / round-trip cost USD | Kept APR % | Round trips | Rebalances |
|---|---|---:|---:|---:|---:|---:|---:|
| always_500 | calibration | 1,720.40 | 1,130.35 | 68.27 | 12.70 | 0 | 14 |
| offhours_500 | calibration | 795.95 | 592.49 | 53.29 | 3.65 | 11 | 11 |
| offhours_tuned | calibration | 1,579.17 | 1,175.51 | 124.36 | 6.80 | 11 | 11 |
| always_500 | held_out | 1,702.61 | 1,393.02 | 211.99 | 2.37 | 0 | 14 |
| offhours_500 | held_out | 783.82 | 648.78 | 123.48 | 0.28 | 11 | 11 |
| offhours_tuned | held_out | 1,550.47 | 1,286.39 | 362.94 | -2.41 | 11 | 11 |

Verdict on held-out:

- `offhours_500` vs `always_500`: no (-2.09 APR points). Clears 7.0%: no (0.28%).
- `offhours_tuned` vs `always_500`: no (-4.78 APR points). Clears 7.0%: no (-2.41%).
- Held-out kept APR: always-on 2.37%, off-hours 500 0.28%, off-hours tuned -2.41%.

## GOOGL

Pool `0x34D0dC122CF9A8Eb296fC5e0D3A233625D7d19b7` at fee 500 ppm, window volume $76,942,207. Calibration 2026-09-17T00:00:00+00:00 to 2026-10-02T00:00:00+00:00. Held-out 2026-10-02T00:00:00+00:00 to 2026-10-17T00:00:00+00:00.

Winning range chosen on calibration only: 250 bps. Candidate calibration kept APR: 250 bps 13.83%, 500 bps 10.62%, 1000 bps 5.75%.

| Strategy | Half | Fees USD | Markout loss USD | Rebalance / round-trip cost USD | Kept APR % | Round trips | Rebalances |
|---|---|---:|---:|---:|---:|---:|---:|
| always_500 | calibration | 2,127.88 | 1,947.24 | 179.81 | 0.02 | 0 | 14 |
| offhours_500 | calibration | 1,103.28 | 553.70 | 113.06 | 10.62 | 11 | 11 |
| offhours_tuned | calibration | 1,964.22 | 1,059.49 | 336.49 | 13.83 | 11 | 11 |
| always_500 | held_out | 1,486.13 | 1,010.87 | 101.79 | 9.09 | 0 | 14 |
| offhours_500 | held_out | 571.00 | 261.24 | 74.20 | 5.73 | 11 | 11 |
| offhours_tuned | held_out | 1,135.30 | 519.36 | 222.73 | 9.57 | 11 | 11 |

Verdict on held-out:

- `offhours_500` vs `always_500`: no (-3.36 APR points). Clears 7.0%: no (5.73%).
- `offhours_tuned` vs `always_500`: yes (+0.48 APR points). Clears 7.0%: yes (9.57%).
- Held-out kept APR: always-on 9.09%, off-hours 500 5.73%, off-hours tuned 9.57%.

## Reading the result

- The held-out half is the verdict. Calibration is shown only to explain the range choice.
- The off-hours run still carries the token leg while idle. It earns no pool fees in NYSE hours, but it does not escape price exposure.
- The engine marks out LP inventory against the pool price path. It is a replay estimate, not a live execution record.
- The holiday calendar comes from the exchange day sets in the Nasdaq files under keeper/data/engine/. Within their date coverage, a missing weekday is treated as a holiday.
