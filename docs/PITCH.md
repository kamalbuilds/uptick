# Uptick: 3 minute demo

One line: every Stock Token pool charges one fee all week. Uptick charges for the risk, and pays NVDA holders the difference.

## 0:00 to 0:25 The problem, with a number

Screen: NVDA / USDG pool on Robinhood Chain.
Say: "189,012 people hold NVDA on this chain. Their tokens earn nothing. And the pools that trade them charge the same fee at 11 am Tuesday and 3 am Sunday. We replayed 5.1 million swaps over 54 days. During NYSE hours a pool earns about one dollar of fees for each dollar it loses to informed traders. On weekends it earns four to nineteen."

Show the session table (README): 0.78 to 1.21, 1.23 to 3.02, 3.83 to 19.53.

## 0:25 to 1:15 Killer moment 1: the same swap, two fees

Screen: swap panel on a fork, one NVDA to USDG swap of fixed size, run twice with the clock set to Tuesday 10:30 ET, then Saturday 14:00 ET.
Say: "Same pool, same size, same router. Open market, the hook prices the fee for informed flow. Saturday, it prices for benign flow." Point at the two fee lines side by side.
Then push the pool away from the Chainlink price and swap again: "A trade that drags the pool off the oracle pays more. A trade that closes the gap does not."

## 1:15 to 1:55 Killer moment 2: the hook that cannot overcharge

Screen: terminal, the capped-hook test.
Say: "On this chain 74.5 percent of v4 trades go through hooks, and 0x labels 80 percent of 84 thousand hooks malicious. About 1.2 million dollars left traders in 49 hours to hooks keeping 5 to 11 percent while the pool quotes under 1. Uptick declares its maximum and the pool enforces it in the swap."
Run the over-cap swap: it reverts with `TakeExceedsCap`. Show 200 of 200.
Then the nested self-swap attempt: `NestedStateChange`.

## 1:55 to 2:40 Killer moment 3: a holder deposits and sees fees accrue

Screen: web app, NVDA vault.
Say: "One deposit." Connect, deposit NVDA, show shares minted and the position range around the Chainlink price. Open the stats panel: fees lifetime, 24 h, 7 d, share price. "The NVDA vault replays at 40.6 percent fee APR over 30 days, recentred every morning at the NYSE open."
Show keeper log: `simulate_ok`, then `rebalanced`. Show share price after the harvest tick.
Show `redeemInKind`: "Exit always works, paid in both tokens."

## 2:40 to 3:00 Close

Say: "Raydium already runs 30.6 million dollars of stock-token LP pools. Robinhood Chain has the holders, the pools and the Chainlink feeds. Uptick is the layer that prices the risk and pays the holder. NVDA first, SPCX next."

## Checklist before recording

- Fork pinned to a recent block of `https://rpc.mainnet.chain.robinhood.com`.
- Clock control on for the two-session swap.
- Keeper in `--dry-run --assume-due` for the log segment.
- Stats API on :8790, web on :3000.
