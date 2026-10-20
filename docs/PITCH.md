# Uptick: 3 minute demo

One line: Deposit NVDA, AAPL, GOOGL and 14 more Stock Tokens and earn a share of every trade's fee. Uptick shows what you earn and what you keep after losses to fast traders, and opens a vault only where 5.1 million past trades say it holds up.

## 0:00 to 0:25 The problem, with a number

Screen: NVDA / USDG pools on Robinhood Chain.
Say: "189,012 people hold NVDA on this chain. Their tokens earn nothing, and nobody publishes which pool pays a liquidity provider best. We replayed 5.1 million swaps over 54 days on every pool. 

During NYSE hours a pool earns about 1 dollar of fees for each dollar it loses to informed traders.
On weekends it earns four to thirty-three. The pool and the fee tier move that number as much as the clock does."

Show the session table (README): 1.03 to 1.35, 1.30 to 3.90, 3.94 to 33.27.

## 0:25 to 1:25 Killer moment 1: the app shows the evidence, then a deposit

Screen: web app, NVDA vault.
Say: "This is NVDA. Every USDG pool and fee tier, measured on the chain's own swaps." Open the tier comparison: fee per dollar of 1 hour markout for each tier, out-of-sample. Open the session evidence: NYSE hours, weeknights, weekends for the selected pool.

Say: "The engine picked this pool and tier on the first half of the window and scored it on the second. That is the number the vault acts on." Connect, deposit NVDA in one click, show shares minted and the position range around the Chainlink price.
Open the stats panel: fees lifetime, 24 h, 7 d, share price. "The NVDA vault replays at 40.9 percent fee APR over 30 days, recentred at 02:00 UTC after every NYSE session."

## 1:25 to 2:15 Killer moment 2: a skim hook reverts against the cap

Screen: terminal, the capped-hook test on a mainnet fork.
Say: "On this chain 74.5 percent of v4 trades go through hooks, and 0x labels 80 percent of 84 thousand hooks malicious. About 1.2 million dollars left traders in 49 hours to hooks keeping 5 to 11 percent while the pool quotes under 1. The vault only targets pools without take-capable hooks, or hooks with a registered cap."
Run the skim hook: a 3 percent take against a cap of 250 reverts with `TakeExceedsCap`. Show 200 of 200. Then the nested self-swap attempt: `NestedStateChange`. Show the CapRegistry entry anyone can read.

## 2:15 to 2:40 Operations

Screen: keeper log.
Say: "Every morning the keeper refreshes the evidence and recentres." Show `simulate_ok`, then `rebalanced`, then the share price after the harvest tick. Show `redeemInKind`: "Exit always works, paid in both tokens."

## 2:40 to 3:00 Close

Say: "Session-fee hooks and hand-picked range vaults exist. None publishes a calibration. Uptick pairs the evidence engine, the cap standard and one-click vaults across Stock Tokens. NVDA first, SPCX next, every eligible token after."

Robinhood issues the Stock Tokens, Chainlink publishes the equity feeds the vault prices against, and the Uniswap pools quote each token against USDG, all on Robinhood Chain (4663). Uptick runs where that asset and its liquidity already are, and the contracts scale the feed by the ERC-8056 split multiplier and price swaps by NYSE session.

## Checklist before recording

- Fork pinned to a recent block of `https://rpc.mainnet.chain.robinhood.com`.
- Keeper in `--dry-run --assume-due` for the log segment.
- Stats API on :8790, web on :3000.
