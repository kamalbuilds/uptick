# Architecture

Uptick has three layers on Robinhood Chain (4663): an evidence engine that measures what Stock Token liquidity earns and what it keeps after informed traders, a vault layer that opens deposits in one click only where the kept figure holds in both replay halves, and a cap standard that bounds what the pools under the vault can take.

```
 chain swap history --> Evidence engine --> pool/tier pick per token --> keeper (daily refresh)
 (every USDG pool,      (fee per $ of 1h        + session evidence                |
  every fee tier)        markout, out-of-sample)                                  v
 holder --deposit--> StockVault (ERC-4626) --mint/burn--> selected pool position
                          ^                                        |
                 Chainlink USD feed (band centre, oracle gate)     +-- pools without take-capable hooks,
                                                                       or hooks registered in CapRegistry
```

## Components

| Component | Role |
|---|---|
| Evidence engine | Replays every swap on every USDG pool and fee tier of each eligible Stock Token (5.1M swaps over 54 days so far; `spikes/stock-vaults/scripts/engine.py`, `keeper/replay/build_replay.py`). Measures fee per dollar of 1 hour markout by session and selects the pool and tier with the best out-of-sample result. |
| StockVault | ERC-4626 vault, one per Stock Token. Deposits into the selected pool and tier, values everything in the Stock Token, mints shares. |
| Keeper | Refreshes the evidence and calls `rebalance()` daily at the NYSE open. Simulates with `eth_call` first and signs only a passing simulation. Eligibility rule in `keeper/src/universe.ts`. |
| CappedTakeHook + CapRegistry | The fee cap standard. A hook declares its maximum take, the pool enforces it inside every swap, and CapRegistry records the declared maximum write-once so anyone can read it. |
| UptickHook | Reference implementation of the cap standard (session fee and oracle gap under a declared cap). |
| Stats API | Serves TVL, fees (lifetime, 24 h, 7 d), fee APR, tier comparison, current range and share price history per vault. |
| Web app | Vault list, per-token tier comparison and session evidence, deposit and redeem, portfolio. |

## Data flow: evidence engine

1. Eligibility: a Stock Token enters the universe when it has a Chainlink feed and a deep, busy USDG pool whose price sits within bounds of the feed (`keeper/src/universe.ts`).
2. Pull: every `Swap` event on every USDG pool and fee tier of the token, from the PoolManager and the v3 pools, cached per pool.
3. Replay: the engine walks the swaps against a vault-shaped position (daily recentre on Chainlink, fixed band) and books, per swap, the fee earned and the 1 hour markout, with a price-impact cost model.
4. Split: results are grouped by session (NYSE regular hours, weeknights, weekends) so the same pool reads differently at different hours.
5. Select: the window is split into a calibration half and a test half. Pool and tier are chosen on the first half and scored on the second. The pick is the best out-of-sample edge (fee minus markout minus cost).
6. Publish: the keeper writes the result to `keeper/data/replay.json`; the stats API serves it and the web app shows the tier comparison and the session evidence for each token.
7. Refresh: the keeper repeats the run daily so the pick follows the chain's current flow.

The engine is covered by hand-computed tests and mutation checks run red then green (`spikes/stock-vaults/FINDINGS.md`).

## Data flow per swap on a capped pool

1. A trader calls any router. The router calls the v4 PoolManager (`0x8366a39CC670B4001A1121B8F6A443A643e40951`).
2. A capped hook sets its fee in `beforeSwap`. UptickHook, the reference implementation, reads the market session and the Chainlink reference.
3. `afterSwap` measures the take the trader paid against the declared maximum. Above the cap the swap reverts with `TakeExceedsCap`. The check runs inside the PoolManager call, so it binds every router and every caller.
4. A state fingerprint of pool slot0 and liquidity before and after any builder callback blocks a nested self-swap (`NestedStateChange`). A lock flag cannot do this job, because v4-core skips hook callbacks when the hook itself is the caller.
5. The vault targets only pools without take-capable hooks, or pools whose hook has a registered cap.

Measured on a mainnet fork: 200 of 200 swaps over the cap revert and 200 of 200 at or under pass, take accounting matches the no-hook pool to 0 wei per leg, and the cap adds about 25,000 gas per swap (`spikes/capped-hooks/FINDINGS.md`).

## Data flow per deposit

1. `deposit(assets, receiver)` reads one oracle `Status`: Chainlink answer valid and fresh (default 90,000 s against an 86,400 s heartbeat), pool TWAP over at least 600 s available, TWAP and spot within `maxDeviationBps` (default 100) of Chainlink. Anything but `Ok` reverts.
2. The Stock Token is pulled in and shares are minted at NAV. Shares carry 24 decimals; a 6-digit virtual-share offset makes a first-depositor donation attack cost more than it takes.
3. With `instantDeploy` the vault swaps to the ratio the range needs and adds liquidity in the same transaction, with a Chainlink-based `minOut` on the swap. Otherwise the deposit is counted at face value until the next rebalance.
4. At the next rebalance the vault collects fees, mints the treasury its performance share out of uncollected fees before NAV is computed, so the share price is the same one second before and after, removes the position, snaps `price * (1 +- rangeBps)` to the tick spacing, and mints the new position.
5. `redeem` and `withdraw` pass the same gate and swap the USDG leg back under a Chainlink `minOut`. `redeemInKind` pays both tokens with no oracle, no swap and no pause.

## Session and DST logic

The session labels the evidence and sets the recentre slot in the keeper (`keeper/src/calendar.ts`).

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
| Hook fee ceiling is declared and checked | The maximum is immutable, recorded in CapRegistry, and enforced in the swap. The vault targets only pools without take-capable hooks or with a registered cap. |

Full guard table: `contracts/SECURITY.md`.
