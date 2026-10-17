# Uptick

Stock Token yield on Robinhood Chain. Deposit NVDA once, earn the trading fees of its pool, with fees priced by whether Wall Street is open.

Robinhood Chain (chain 4663) lists 189,012 NVDA holders and 114,550 SPCX holders. Their tokens sit idle while the pools they trade in pay liquidity providers a single flat fee at every hour of the week. Uptick turns that idle balance into a managed position and prices the fee to the risk behind it.

## The insight

Liquidity provider risk on a stock token depends on whether the NYSE is open. When it is open, informed traders hit the pool at the speed of the Chainlink feed. At night and on weekends the price cannot move on the underlying, so the same flow is mostly benign. Every pool charges one fee regardless.

Fees earned per dollar lost to informed traders (1 hour markout), from 5.1M swaps on the chain's own NVDA, SPCX and TSLA pools over 54 days:

| Session | Fee earned per $1 lost to informed flow |
|---|---|
| NYSE regular hours | 0.78 to 1.21 |
| Weeknights | 1.23 to 3.02 |
| Weekends | 3.83 to 19.53 |

Source: `spikes/stock-vaults/FINDINGS.md`, `spikes/stock-vaults/logs/session_split.txt`.

Weekend liquidity is the most profitable and the cheapest to underwrite. NYSE hours are where a flat fee underprices the risk. Uptick prices both ends.

## How it works

**UptickHook** is a Uniswap v4 hook for Stock Token pools.
- Session pricing: the LP fee follows the market session (NYSE regular hours, weeknights, weekends, holidays), DST-aware.
- Oracle-gap pricing: trades that push the pool away from the Chainlink reference pay more.
- Declared cap: the hook declares a maximum fee and enforces it inside every swap. It cannot charge more than it declares, on any router. The enforcement mechanism is proven on a mainnet fork: 200 of 200 over-cap swaps revert, accounting is exact to 0 wei, and a nested self-swap evasion is blocked (`spikes/capped-hooks/FINDINGS.md`).

**StockVault** is an ERC-4626 vault per Stock Token (NVDA first, SPCX next). It holds one concentrated position on the Stock Token / USDG pool and recentres it every day at the NYSE open, around the Chainlink price. Shares rise in price as fees accrue. Every value-in and value-out path passes an oracle gate (Chainlink freshness, TWAP and spot within bounds), and `redeemInKind` always pays out both tokens.

**Keeper and stats API** recentre on the NYSE calendar (13:35 UTC in EDT, 14:35 UTC in EST), simulate every `rebalance()` with `eth_call` first and sign only a simulation that succeeds. The stats API serves TVL, fee APR and share price per vault.

**Web app** shows the vaults, deposits, and portfolio.

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
contracts/   StockVault (ERC-4626), fork tests, invariants, SECURITY.md
keeper/      rebalance keeper, NYSE calendar, stats API, replay engine
web/         Next.js app: vaults, vault detail, portfolio
docs/        ARCHITECTURE.md, PITCH.md, architecture.html
```

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/architecture.html](docs/architecture.html). Demo: [docs/PITCH.md](docs/PITCH.md).
