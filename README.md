# Uptick

Uptick replays every Robinhood Chain swap to show what Stock Token liquidity earns and what it keeps after informed traders, and opens deposits only where it holds its own. 

Every vault page shows fee APR next to what LPs keep.

Robinhood Chain (chain 4663) lists 189,012 NVDA holders and 114,550 SPCX holders. Their tokens sit idle, and holders cannot see which pool or fee tier pays liquidity providers best.[^1] Uptick publishes that calibration and routes the deposit by it.

## The insight

Liquidity economics on a stock token differ by session and by pool and tier. Fees earned per dollar lost to informed traders (1 hour markout), from 5.1M swaps on the chain's own NVDA, SPCX and TSLA pools over 54 days:[^2]

| Session | Fee earned per $1 lost to informed flow |
|---|---|
| NYSE regular hours | 1.03 to 1.35 |
| Weeknights | 1.30 to 3.90 |
| Weekends | 3.94 to 33.27 |

Pooled across the three pools, weekends pay 13.64 and NYSE hours 1.16, and the weekend ratio beats the NYSE ratio in 22 of 23 pool-weeks.

The spread between pools and tiers is as large as the spread between sessions. The evidence engine measures it per token and selects the pool and tier with the best out-of-sample result.

## How it works

**1. Evidence engine** (`spikes/stock-vaults/scripts/engine.py`, `keeper/replay/build_replay.py`). For every eligible Stock Token (Chainlink feed, deep and busy USDG pool; `keeper/src/universe.ts`) it replays every swap on every USDG pool and fee tier, computes fee per dollar of 1 hour markout by session, and ranks pool and tier on a held-out half of the window.[^2]

**2. StockVault** is an ERC-4626 vault per Stock Token. It deposits into the pool and tier the evidence selects, in one click. Shares rise in price as fees accrue. Every value-in and value-out path passes an oracle gate (Chainlink freshness, TWAP and spot within bounds), and `redeemInKind` always pays out both tokens. 46 fork tests run against the real pool, router and tokens, and 14 guards are mutation-tested.[^3]

**3. Keeper and stats API** refresh the evidence and recentre each vault daily on the NYSE calendar (13:35 UTC in EDT, 14:35 UTC in EST). Every `rebalance()` is simulated with `eth_call` first and only a passing simulation is signed. The stats API serves TVL, fee APR, tier comparison and share price per vault.

**4. Pools under a declared cap.** The cap standard (`CappedTakeHook` + `CapRegistry`) lets a hook declare its maximum take and enforces it inside every swap on every router. The vault targets pools without take-capable hooks, or hooks with a registered cap. On a mainnet fork the cap stops 200 of 200 over-cap swaps, accounting matches to the wei, and the cap holds against a nested self-swap.[^4] `UptickHook` is one reference implementation of the standard.

**5. Web app** shows each token's tier comparison and session evidence, then deposits, redeems and tracks the portfolio.

## How vaults open

Kept APR is fees earned less losses to informed traders (1 hour markout) and rebalancing cost, annualised. The replay splits its 30 days into a 15 day calibration half and a 15 day held-out half. A vault opens for deposits when the lower of its two halves is at least -20% kept APR (`KEEP_FLOOR_APR` in `keeper/src/evidence.ts`). Any floor between -7.8 and -98.2 gives the same open set, so the gate does not depend on the exact line.

| Vault | First half kept | Second half kept | Status |
|---|---|---|---|
| NVDA | +10.9% | -0.4% | Open |
| GOOGL | -7.8% | +2.5% | Open |
| SPCX | +43.5% | -98.2% | Closed |
| CRCL | -47.3% | -116.8% | Closed |

Source: keeper `/vaults` (`evidence.keep`, `evidence.open`), read from `keeper/data/replay.json`.

## Why the chain needs it

Hooks carry 74.5% of v4 trades on Robinhood Chain, 0x labels 80% of 84K hooks malicious, and about $1.2M left traders in 49 hours to hooks keeping 5 to 11% while their pools quote 0 to 1%.[^5] Quoted fees no longer tell the price a liquidity provider or trader gets. Uptick's pick is measured, and its pools sit under a cap the chain enforces.

Session-fee and oracle-gap hooks (Fables, SessionFeeHook, Bellswap, ClosingBell) price swaps. Vault products (AutoRange, HedgeHood, Saffron) choose ranges by hand. Uptick adds the published calibration, the cap standard and one-click vaults across many Stock Tokens.[^6]

## Evidence

| Claim | Number | Source |
|---|---|---|
| Swaps replayed | 5.1M over 54 days on NVDA, SPCX, TSLA pools | `spikes/stock-vaults/FINDINGS.md` |
| NVDA vault fee APR, 30 day replay, daily recentre, 5% band | 40.6% | keeper `/vaults` |
| Hook share of v4 trades on Robinhood Chain | 74.5% | Bitquery |
| Hooks labelled malicious by 0x | 80% of 84K | 0x |
| Taken in 49 hours by hooks keeping 5 to 11% while pools quote 0 to 1% | about $1.2M | `docs/research/founder-house/OUTREACH-fomo-gmgn.md` |
| Stock-token LP demand elsewhere | Raydium $30.6M stock-token LP pools; @WazzCrypto | `docs/research/founder-house/vaults/DEMAND.md` |

## Chain components in use (Robinhood Chain 4663)

Each address returns bytecode from `cast code` against `https://rpc.mainnet.chain.robinhood.com` (`docs/research/founder-house/vaults/INFRA.md`).

| Component | Address |
|---|---|
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| Uniswap v3 NonfungiblePositionManager | `0x73991a25c818bf1f1128deaab1492d45638de0d3` |
| NVDA / USDG 0.05% pool | `0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3` |
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` |
| SPCX | `0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |

## Run locally

```
# contracts: fork tests against the real pool, router and tokens
cd contracts && forge test

# keeper: dry run reads mainnet, sends nothing
cd keeper && bun install && bun src/keeper.ts --dry-run
bun src/stats.ts            # stats API on :8790

# web
cd web && pnpm install && pnpm dev     # http://localhost:3000

# local mainnet fork
anvil --fork-url https://rpc.mainnet.chain.robinhood.com
```

## Repo layout

```
contracts/   StockVault (ERC-4626), CappedTakeHook, CapRegistry, UptickHook (reference
             implementation), fork tests, invariants, SECURITY.md
keeper/      evidence refresh, rebalance keeper, NYSE calendar, eligibility rule, stats API
web/         Next.js app: vaults, tier comparison and session evidence, portfolio
docs/        ARCHITECTURE.md, PITCH.md, architecture.html
deck/        investor deck (index.html, uptick-deck.pdf)
```

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/architecture.html](docs/architecture.html). Demo: [docs/PITCH.md](docs/PITCH.md).

[^1]: Holder counts: `docs/research/founder-house/PLATFORM-TRUTH.md`, Stock Tokens table (Blockscout, 2026-10-16).
[^2]: `spikes/stock-vaults/FINDINGS.md`, `spikes/stock-vaults/logs/session_split.txt`, engine `spikes/stock-vaults/scripts/engine.py`. Window 2026-08-24 to 2026-10-17.
[^3]: `contracts/SECURITY.md`, `contracts/test/`.
[^4]: `spikes/capped-hooks/FINDINGS.md`.
[^5]: 74.5%: Bitquery. 80% of 84K: 0x. $1.2M in 49 hours: `docs/research/founder-house/OUTREACH-fomo-gmgn.md`.
[^6]: `docs/research/founder-house/vaults/HOOK-DESIGN.md` section A and `docs/research/founder-house/vaults/COMPETITORS.md`.
