# StockVault

An ERC-4626 vault over a single Stock Token on Robinhood Chain (chain id 4663). Depositors hold the Stock Token; the vault turns it into one managed Uniswap v3 position on the Stock Token / USDG pool, recentres that position every day at plus or minus 5% around the Chainlink price, and returns the trading fees to share holders as a rising share price.

One contract per Stock Token. The NVDA vault is the reference deployment target.

## What a share is

A share is a pro-rata claim on three things the vault holds: idle balances of both tokens, both legs of the v3 position, and the trading fees the position has earned but not yet collected. Everything is valued in the Stock Token.

- Price of the USDG leg and of fees: Chainlink, USDG at 1 USD.
- Composition of the position: the pool TWAP over at least 10 minutes.
- Treasury cut: the performance fee on uncollected fees is deducted from `totalAssets()` before it is minted, so the share price is the same one second before and one second after a harvest.

## Flow

| Step | What happens |
|---|---|
| `deposit` / `mint` | Oracle gate, then the Stock Token is pulled in and shares are minted against the assets net of the entry fee. The fee (default: 35 bp, or the pool's fee tier where that is higher) stays in the vault, so it lifts the share price for everyone holding. `previewDeposit`, `previewMint` and `maxMint` include it to the wei. With `instantDeploy` the vault also swaps to the ratio the range needs and adds liquidity in the same transaction. Refused while spot sits more than `maxSpotTwapBps` (default 10 bp) below the TWAP; a spot above the TWAP cannot make shares cheaper, because deposits are priced at the lowest of Chainlink, TWAP and spot, so `UptickRouter.depositUsdg` can buy in the pool and deposit in one transaction at any size the pool and the Chainlink gate allow. Without `instantDeploy` the Stock Token sits idle, counted at face value, until the next rebalance. Shares minted in a block cannot be burned or transferred in that block, which includes the shares `withdraw` mints back for the unspent part of the exit buffer: a whole-balance `redeem` right after a `withdraw` goes through in the next block. |
| `rebalance()` | Keeper every `minRebalanceInterval`; anyone once 26 hours have passed since the last one. Collects fees and mints the treasury its cut, removes the position, snaps `price * (1 +- rangeBps)` to the tick spacing, swaps to the target ratio with a `minOut` set by the higher of the TWAP value and the Chainlink value of the input (less the pool fee and `slippageBps`), mints the new position with minimums derived from the same ratio. Refused while spot sits more than `maxSpotTwapBps` (default 10 bp) from the TWAP on either side, and while the TWAP sits more than `maxTwapOracleBps` (default 30 bp) from Chainlink, so a TWAP walked away from the feed is never traded against and a swap into a pool dragged below the feed reverts instead of filling. |
| `redeem` / `withdraw` | Oracle gate, harvest, then a pro-rata slice of idle balances and liquidity. The USDG leg is swapped back to the Stock Token with a Chainlink-based `minOut`. Every swap floor is the reference value less the pool fee less `slippageBps`, so a 1% pool and a 0.05% pool each keep the full `slippageBps` for price impact. `withdraw` sends exactly the requested assets; `redeem` sends the actual proceeds, between `previewRedeem` and the shares' NAV. `previewRedeem` is the NAV less `exitBufferBps` less the pool's fee tier, so a normal exit on a 1% pool clears it. |
| `redeemInKind` | The same pro-rata slice, paid out as both tokens. No oracle, no swap, no pause. If the Stock Token transfer reverts for the receiver (issuer pause or blocklist) the Stock Token leg is credited to the receiver and claimed later with `claimStockOwed(to)`. |

## Oracle gate

Every value-in and value-out path (`deposit`, `mint`, `withdraw`, `redeem`, `rebalance`) reads one `Status` and proceeds only on `Ok`:

1. Chainlink answer positive, timestamp not in the future, `answeredInRound >= roundId`.
2. Chainlink age at most `maxStaleness` (default 90,000 s; the feed heartbeat is 86,400 s).
3. Pool TWAP available over `twapWindow` (default and minimum 600 s).
4. TWAP within `maxDeviationBps` of Chainlink (default 100).
5. Spot within `maxDeviationBps` of Chainlink.

`rebalance` adds a sixth check: TWAP within `maxTwapOracleBps` of Chainlink (default 30 bp, 10 to 500 bp). A walk inside the bound can take at most the bound times the one swap the rebalance makes, so the default is the narrowest the feeds' own lag allows: the 10-minute TWAP sat within 30 bp of the feed in 76% to 91% of NYSE-hours samples on the twelve vaulted pools (2-minute samples over 96 hours) and within 60 bp in 96% to 100%. The keeper retries every minute until the gap closes.

`health()` returns the status and the three prices without reverting, for keepers and the app.

## Roles

| Role | Can | Cannot |
|---|---|---|
| Owner (multisig, two-step transfer) | pause deposits, set deposit cap and treasury; bounded parameters, keeper, `instantDeploy`, the spot-to-TWAP band, the TWAP-to-Chainlink band and the entry fee through a 24-hour queue (a queued change expires 7 days after its eta) | move user funds, block withdrawals or `redeemInKind`, renounce |
| Keeper | call `rebalance()` | anything else |
| Anyone | `rebalance()` after 26 h, `redeemInKind`, all views | |

## Parameters

| Parameter | Default | Bound |
|---|---|---|
| `rangeBps` | 500 | 50 to 2000 |
| `perfFeeBps` | 1000 | 0 to 2000 |
| `maxDeviationBps` | 100 | 10 to 500 |
| `slippageBps` | 100 | 1 to 500 |
| `exitBufferBps` | 30 | 0 to 200 |
| `maxStaleness` | 90,000 s | 1 h to 7 d |
| `twapWindow` | 600 s | 600 s to 1,800 s, and shorter than the pool's observation cardinality |
| `minRebalanceInterval` | 6 h | 1 h to 24 h |
| `maxSpotTwapBps` (own setter) | 10 | 1 to 50 |
| `maxTwapOracleBps` (own setter) | 30 | 10 to 500 |
| `entryFee` (own setter, in pool-fee pips: 500 = 0.05%) | the larger of the pool's fee tier (500, 3000 or 10000) and 3,500 (35 bp) | pool fee tier to 20,000 (2%) |

Shares carry 24 decimals: the Stock Token's 18 plus a 6-digit virtual-share offset that makes first-depositor donation attacks cost more than they take.

## Views for the app

`positionInfo()`, `totalValueInUSDG()`, `feesEarnedLifetime()`, `currentRange()`, `pricePerShare()`, `health()`, plus the ERC-4626 set. Events: the standard `Deposit` / `Withdraw`, `RedeemedInKind`, `Rebalanced(tickLower, tickUpper, fees0, fees1)` and `FeesCollected`.

## Addresses (chain 4663)

| Contract | Address |
|---|---|
| Uniswap v3 NonfungiblePositionManager | `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` |
| Uniswap v3 Factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` |
| SwapRouter02 | `0xCaf681a66D020601342297493863E78C959E5cb2` |
| QuoterV2 | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` |
| NVDA / USDG 0.05% pool | `0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3` |
| Chainlink NVDA / USD proxy | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` |
| SPCX | `0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa` |
| SPCX / USDG 0.05% pool | `0xc61284332117c3FB23A2A56cceFFD07F7aF60029` |
| Chainlink SPCX / USD proxy | `0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb` |

The constructor checks that the pool's tokens are the Stock Token and USDG and that the position manager's factory resolves the same pool for that pair and fee.

## StockVaultV4: the Uniswap v4 venue

`StockVaultV4` is the same vault over a Uniswap v4 pool: the shares, the entry fee, the 24-hour owner queue, the same-block share lock, the corporate-action gate, the Chainlink-floored swaps and `redeemInKind` (always open) are the StockVault ones, with the position held by the vault itself in the Uniswap v4 PoolManager. It opens the pools where a token's depth sits in v4: a hookless pool, or one whose hook is on the factory's allow-list and carries no remove-liquidity callback and no return-delta flag. A dynamic-fee pool, or any fee above 2%, is refused at construction.

| Piece | What it does |
|---|---|
| `src/v4/StockVaultV4.sol` | The vault. One `unlockCallback` runs a swap or a liquidity change and settles both currencies before it returns; no position NFT, no Permit2, no approvals to anyone. v4 pays a position's accrued fees to the caller on every liquidity change, so the vault harvests first (performance fee minted) whenever it can read the oracle. The swap floors use the pool's live swap fee, protocol fee included. |
| `src/v4/TickOracleV4.sol` | The vault's TWAP. v4 pools keep no observations, so each vault keeps a ring of them, written by `poke()` (anyone, the keeper every 45 s). An observation is the pool's own tick, taken at least 20 s after the last, within `maxDeviationBps` ticks of the Chainlink tick and within 50 ticks of the previous observation, so one sandwiched observation moves a 10-minute average by at most 5 ticks. The average is served only from a gap-free record. |
| `src/v4/VaultMathV4.sol` | Position and fee reads straight from PoolManager storage, and the liquidity fit that never asks for more than the idle balances. |
| `src/v4/StockVaultV4Lens.sol` | `totalValueInUSDG` and `currentRange` for the app, one deployment for every v4 vault. |
| `VaultFactory.createVaultV4` | Deploys the pinned StockVaultV4 build for (Stock Token, v4 pool, feed), checks the hook allow-list and registers it in the same `isVault` registry the router reads. |
| `UptickRouter.depositUsdgV4` | The USDG zap for a registered v4 vault: registry check, health gate and a Chainlink swap floor, the swap made in the vault's own pool. `redeemInKindMin` serves both vault types. |

Deploy lists carry `"venue": "v4"` with the pool's `poolId`, `feeTier`, `tickSpacing` and `hooks` for a token whose chosen pool is a v4 pool (`scripts/deploy-list.mjs`); `script/DeployAll.s.sol` creates it through `createVaultV4` and checks the pool id against the key.

## Layout

```
src/StockVault.sol            the v3 vault
src/v4/                       StockVaultV4, TickOracleV4, VaultMathV4, StockVaultV4Lens
src/interfaces/IUniswapV3.sol minimal interfaces for pool, position manager, router, Chainlink
script/Deploy.s.sol           env-driven deployment (simulates without --broadcast)
test/                         fork tests against the real pool, router, position manager and tokens
test/v4/                      fork tests against real v4 pools (PLTR and TSLA), oracle ring and liquidity-fit properties, factory and router
test/security/                review regressions: sandwiches, TWAP drag, entry fee, fee-aware floors on every tier
```

## Dependencies

Installed with `forge install --no-git <repo>@<tag>`:

| Library | Tag | Commit |
|---|---|---|
| OpenZeppelin/openzeppelin-contracts | v5.7.0 | `cab19933c33c2ad1d4c7a84864a3601dddfd16f3` |
| Uniswap/v4-core | v4.0.0 | `e50237c43811bd9b526eff40f26772152a42daba` |
| foundry-rs/forge-std | v1.17.0 | `f3dae6e6ee381f25eb6a246f7da9b85c91a68219` |

Solidity 0.8.26, EVM cancun, `via_ir`, `optimizer_runs = 1`. StockVault's runtime code is 24,479 bytes, under the 24,576 byte limit; the pure tick and liquidity maths sit in `VaultMath`, deployed by each vault's constructor.

## Test

The tests fork Robinhood Chain and trade against the real pools, routers, PoolManager and tokens. `test/ForkPin.sol` decides the state every suite sees: with `FORK_URL` set to a node that serves history (an archive RPC, or a local Anvil forking one) every suite forks the same block, `FORK_BLOCK` or the pinned 93,694,185 (2026-10-20 19:30 UTC, inside NYSE hours); without it the suite forks the public RPC at head, which keeps no history.

```
anvil --fork-url <archive rpc> --fork-block-number 93694185 --port 8546 --retries 20 --fork-retry-backoff 500 --no-rate-limit
FORK_URL=http://127.0.0.1:8546 forge test --threads 2
```

```
forge build
forge test --threads 2                       # full suite
forge test --match-contract StockVaultTest   # deposits, rebalance, fees
forge test --match-contract StockVaultSafetyTest
forge test --match-contract StockVaultFuzzTest
forge test --match-contract StockVaultInvariantTest
forge test --match-path 'test/security/*' --threads 1  # review regressions on the thin PLTR, GME and MSTR pools
forge test --match-path 'test/v4/*'          # the v4 venue
```

What is exercised against the real contracts: deposit and withdraw round trips with real NVDA; rebalance after the pool is pushed through the router; fee accrual checked against the pool's own fee growth; the performance-fee share mint checked against its closed form; a 3% pool push that must block deposits (same block, via the spot check; after the TWAP window, via the TWAP check); a stale feed that must block `rebalance`; permissionless `rebalance` at 26 hours; `redeemInKind` with the vault paused and the feed down; a Stock Token transfer that reverts; the first-depositor donation attack; fuzzed deposits and withdrawals with the invariant that the sum of share values never exceeds total assets; a stateful invariant run over deposits, redeems, in-kind redeems and rebalances; and a second vault on the SPCX pool, where the Stock Token is token0, so both token orderings are covered.

## Deploy

```
OWNER=<multisig> KEEPER=<keeper> TREASURY=<treasury> \
  forge script script/Deploy.s.sol --rpc-url robinhood            # simulation
OWNER=... KEEPER=... TREASURY=... \
  forge script script/Deploy.s.sol --rpc-url robinhood --broadcast --account <keystore>
```

`STOCK`, `POOL` and `FEED` select another Stock Token (defaults are NVDA). `DEPOSIT_CAP` sizes the vault to its pool in Stock Token wei.
