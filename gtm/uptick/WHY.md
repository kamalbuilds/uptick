# uptick: why we are building it, and why a user picks it

## The one sentence

Uptick turns idle Robinhood Stock Tokens into fee-earning liquidity, and opens a vault for a token
only where five million past swaps say the pool and fee tier keeps paying.

## Who it is for

- Stock Token holders on Robinhood Chain 4663 who hold NVDA, GOOGL or SPCX and want yield on the
  same asset. The chain lists 189,012 NVDA holders and 114,550 SPCX holders, and their tokens sit
  idle (`docs/research/founder-house/PLATFORM-TRUTH.md`, Blockscout 2026-10-16).
- On-chain LPs who want the calibration instead of a guess, the people asking for it on
  r/solana and X.
- DeFi traders who want a deep, capped pool to trade a stock token against USDG.

## What they do today, and what breaks

A holder keeps the token in a wallet and earns nothing. Yield products on the chain (AutoRange,
HedgeHood, Saffron) choose ranges by hand. Nobody publishing the numbers tells a holder which of the
NVDA pools, or which fee tier, actually pays liquidity providers best, so the choice is a guess. In
the words of the people asking:

> Clients holding SPYx, QQQx or NVDAx can deposit them and earn yield in the same asset while keeping market exposure.

r/solana, 2026-09-14 (`gtm/uptick/DEMAND.md`)

> tokenized equities like xStocks need to plug directly into defi lending markets so users can earn yield on SPYx or NVDAx while holding them

@JackNomadsGOD, 2026-10-13

What breaks next is the pool choice itself. Hooks carry 74.5% of v4 trades on the chain, 0x labels
80% of 84K hooks malicious, and about $1.2M left traders in 49 hours to hooks keeping 5 to 11% while
their pools quoted 0 to 1%. A quoted fee no longer tells anyone the price they get.

## Why uptick and not the others

Session-fee and oracle-gap hooks (Fables, SessionFeeHook, Bellswap, ClosingBell) price swaps.
Vault products (AutoRange, HedgeHood, Saffron) pick ranges by hand. Raydium runs $30.6M of
stock-token LP with no published calibration. Each does one part. Uptick publishes the measurement,
opens a vault only where it holds, and runs the pool under an on-chain take cap.

## What makes it ours

- The calibration. 5.1M swaps over 54 days across the chain's NVDA, SPCX and TSLA pools, ranked by
  fee earned per dollar lost to informed flow (1 hour markout) by session: NYSE hours 1.03 to 1.35,
  weeknights 1.30 to 3.90, weekends 3.94 to 33.27. Pooled, weekends pay 13.64 and NYSE hours 1.16,
  and the weekend ratio beats NYSE in 22 of 23 pool-weeks (`spikes/stock-vaults/FINDINGS.md`).
- The open rule. A vault opens when the lower of its two replayed halves is at least -20% kept APR
  (`KEEP_FLOOR_APR`). Any floor between -7.8 and -98.2 gives the same open set, so the gate does not
  turn on the exact line.
- The cap standard. `CappedTakeHook` plus `CapRegistry` lets a hook declare its maximum take and
  enforces it inside every swap on every router. On a mainnet fork the cap stops 200 of 200 over-cap
  swaps, accounting matches to the wei, and it holds against a nested self-swap
  (`spikes/capped-hooks/FINDINGS.md`).
- `redeemInKind` always returns both tokens, and every value-in and value-out path passes an oracle
  gate (Chainlink freshness, TWAP and spot within bounds).

## The bar for "it works"

- NVDA and GOOGL vaults open and SPCX and CRCL stay closed, matching the replay in the keeper
  `/vaults` payload. Any floor from -7.8 to -98.2 gives the same set.
- A deposit of NVDA mints shares that rise as fees accrue, and a redeem returns both tokens.
- Every `rebalance()` simulates on chain with `eth_call` and only a passing simulation is signed.
- A pool with a registered take cap above the vault's threshold is rejected, and one at or below it
  is accepted, on a fork against the real pool and tokens.
