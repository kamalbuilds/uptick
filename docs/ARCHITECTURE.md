# Architecture

Uptick has two layers on Robinhood Chain (4663): a pricing layer that makes Stock Token pools charge for the risk they carry, and a vault layer that lets a holder collect those fees with one deposit.

```
 holder --deposit--> StockVault (ERC-4626) --mint/burn--> v3 NVDA/USDG position
                          ^   |                                  |
                 keeper --+   +-- Chainlink NVDA/USD ------------+ fees
                 (rebalance daily at NYSE open)

 trader --swap--> router --> PoolManager (v4) --> UptickHook (session fee + oracle gap + cap)
```

## Components

| Component | Role |
|---|---|
| UptickHook | Uniswap v4 hook on Stock Token pools. Sets the LP fee per swap from the market session and the gap to the Chainlink reference. Declares a maximum fee and enforces it inside the swap. |
| CapRegistry | Write-once record of each hook's declared maximum, readable by anyone, so integrators and routers can check what a hook may charge. |
| StockVault | ERC-4626 vault, one per Stock Token. Holds idle balances and one Uniswap v3 position, values everything in the Stock Token, mints shares. |
| Keeper | Calls `rebalance()` at the NYSE open. Simulates with `eth_call` first and signs only a passing simulation. |
| Stats API | Serves TVL, fees (lifetime, 24 h, 7 d), fee APR, current range and share price history per vault, from `FeesCollected` events and vault views. |
| Web app | Vault list, vault detail, deposit and redeem, portfolio. |

## Data flow per swap

1. A trader calls any router. The router calls the v4 PoolManager (`0x8366a39CC670B4001A1121B8F6A443A643e40951`).
2. `beforeSwap` in UptickHook reads the session for the block timestamp and the Chainlink reference.
3. The hook returns the fee: base fee for the session, plus a surcharge that grows with the gap the trade opens between pool price and the reference. Trades that close the gap pay the base.
4. `afterSwap` measures the take the trader paid against the declared maximum. Above the cap the swap reverts with `TakeExceedsCap`. The check runs inside the PoolManager call, so it binds every router and every caller.
5. A state fingerprint of pool slot0 and liquidity before and after any builder callback blocks a nested self-swap (`NestedStateChange`). A lock flag cannot do this job, because v4-core skips hook callbacks when the hook itself is the caller.

Measured on a mainnet fork: 200 of 200 swaps over the cap revert and 200 of 200 at or under pass, take accounting matches the no-hook pool to 0 wei per leg, and the cap adds about 25,000 gas per swap (`spikes/capped-hooks/FINDINGS.md`).

## Data flow per deposit

1. `deposit(assets, receiver)` reads one oracle `Status`: Chainlink answer valid and fresh (default 90,000 s against an 86,400 s heartbeat), pool TWAP over at least 600 s available, TWAP and spot within `maxDeviationBps` (default 100) of Chainlink. Anything but `Ok` reverts.
2. The Stock Token is pulled in and shares are minted at NAV. Shares carry 24 decimals; a 6-digit virtual-share offset makes a first-depositor donation attack cost more than it takes.
3. With `instantDeploy` the vault swaps to the ratio the range needs and adds liquidity in the same transaction, with a Chainlink-based `minOut` on the swap. Otherwise the deposit is counted at face value until the next rebalance.
4. At the next rebalance the vault collects fees, mints the treasury its performance share out of uncollected fees before NAV is computed, so the share price is the same one second before and after, removes the position, snaps `price * (1 +- rangeBps)` to the tick spacing, and mints the new position.
5. `redeem` and `withdraw` pass the same gate and swap the USDG leg back under a Chainlink `minOut`. `redeemInKind` pays both tokens with no oracle, no swap and no pause.

## Session and DST logic

The session decides the base fee in the hook and the recentre slot in the keeper. Both read the same calendar rules (`keeper/src/calendar.ts` for the keeper).

- Regular session: NYSE trading day, 09:30 to 16:00 America/New_York.
- The rule is expressed in New York local time and converted to UTC per date, so the open lands at 13:30 UTC in EDT and 14:30 UTC in EST. DST starts the second Sunday of March and ends the first Sunday of November.
- Weeknight: after the close and before the next open on a trading day.
- Weekend and holiday: Saturday, Sunday and NYSE holidays, taken from a holiday table.
- Recentre slot: open plus 5 minutes (13:35 UTC in EDT, 14:35 UTC in EST), on trading days only. Weekends and holidays never trigger.

## Trust assumptions

Each is a design decision with the guard that bounds it.

| Decision | Bound |
|---|---|
| Chainlink is the price reference | Staleness, round and answer checks fail closed. Equity feeds go quiet outside market hours, and the staleness window turns that into a closed gate, not a stale price. |
| USDG is a dollar | Valued at 1 USD, the same assumption the pools make. |
| Canonical Uniswap deployments are fixed immutables | The constructor checks the pool's tokens and that the position manager resolves the same pool for the pair and fee. |
| Owner is a multisig with two-step transfer | Powers are bounded parameters. No function moves user funds, withdrawals and `redeemInKind` cannot be paused, ownership cannot be renounced. |
| Keeper is replaceable | It can call `rebalance()` only. After 26 hours anyone can, behind the same gate. Every swap carries a Chainlink `minOut`, so one rebalance loses at most `slippageBps` of the swapped notional. |
| Hook fee ceiling is declared and checked | The maximum is immutable, recorded in CapRegistry, and enforced in the swap. |

Full guard table: `contracts/SECURITY.md`.
