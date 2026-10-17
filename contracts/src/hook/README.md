# UptickHook

Uniswap v4 dynamic-fee hook for a Stock Token / USD stablecoin pool on Robinhood Chain (4663). Every swap pays a fee that follows the NYSE session and rises when the swap pushes the pool away from the Chainlink price of the stock.

## What it does

1. Session fee. `beforeSwap` reads `block.timestamp` and returns one of three immutable fees (pips) with the override flag:
   - `regularHoursFee`: Mon-Fri 13:30-20:00 UTC during US daylight time, 14:30-21:00 UTC in standard time. The US rule is implemented in the bytecode (second Sunday of March 07:00 UTC to first Sunday of November 06:00 UTC).
   - `weekendFee`: Friday at the close through Sunday 24:00 UTC.
   - `offHoursFee`: every other time, and every NYSE full-day holiday of 2026 and 2027 (20 observed dates compiled in, no owner, no setter).
2. Oracle-gap surcharge. The hook reads the Chainlink feed (immutable address), scales it by the token's `uiMultiplier()` (ERC-8056), derives the pool price from `slot0` with both token decimals, and measures the gap in bps. A swap that moves the pool price further from the reference adds `min(gapBps * surchargePipsPerBp, maxSurcharge)`. A swap that moves it toward the reference pays the session fee only. A feed older than `maxStaleness`, a non-positive answer, a future timestamp or a reverting feed or multiplier read gives the session fee only.
3. Capped take. `UptickHook` inherits `CappedTakeHook` and registers `maxFeeBps` in `CapRegistry` from its constructor. The constructor rejects any schedule whose worst case (largest session fee plus `maxSurcharge`) exceeds the cap, `beforeSwap` reverts with `FeeAboveCap` if a computed fee ever did, and `afterSwap` re-checks the fee in bps and reverts with `TakeExceedsCap`. The nested-swap guard from the capped-hooks spike is on. Each swap emits `FeeQuoted(poolId, session, gapBps, fee)`.

The hook address needs the flag bits `0xCC` (before/after swap plus both return-delta flags, required by `CappedTakeHook`). Mine the salt with `HookMiner`.

Why session pricing: measured fee per dollar of 1-hour markout on the NVDA, SPCX and TSLA pools is 1.03 to 1.35 in NYSE hours and 3.94 to 33.27 on weekends (pooled 1.16 and 13.64), so the schedule is a deploy parameter and not a hard-coded order. See `spikes/stock-vaults/FINDINGS.md`.

## Files

- `UptickHook.sol`: the hook, session calendar, price and surcharge logic.
- `CappedTakeHook.sol`, `CapRegistry.sol`: cap enforcement, copied from `spikes/capped-hooks` (proven there: in-swap cap, nested-swap guard, 1 wei accounting).

## Test

The tests run against the shared local Anvil fork of Robinhood Chain (chain id 4663) at `http://127.0.0.1:8545`. They use the real PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`, real NVDA `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC`, real USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` and the real NVDA feed `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`. A new NVDA/USDG pool is created with the hook, liquidity is added with `deal`, and swaps run through `PoolSwapTest`. Only the feed's `latestRoundData` is mocked, to set price and age.

```bash
cd stock-vaults-app/contracts
forge test --match-path 'test/hook/*' -vv
```

Coverage: session fee at a Tuesday 15:00 UTC, Tuesday 02:00 and a Saturday; Thanksgiving as off-hours; all 20 holidays; DST boundaries in March and November 2026 and March 2027 with independently generated timestamps; away versus toward swaps in both pool directions and both token orderings; stale, zero, negative, future and reverting feed; fee cap under fuzz; gas per swap against a hookless pool on the same pair.
