# Fork demo: seventeen Stock Vaults on a local Anvil fork of Robinhood Chain

Anvil fork of chain 4663 at http://127.0.0.1:8545. Only anvil default dev accounts are used. Deployer, owner, keeper and depositor are account 0 (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266); treasury is account 2 (0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC).

`FORK_BLOCK=90275525 scripts/fork-up.sh` forks a Friday NYSE-hours block, then runs `scripts/fork-deploy-all.sh`, which uses the same `contracts/script/DeployAll.s.sol` as mainnet: one `VaultFactory`, one `StockVault` per eligible Stock Token created through the factory (so every vault is in its registry), and one `UptickRouter` bound to that registry. Each vault is seeded with its first deposit, rebalanced once as the keeper, and checked with a deposit and `redeemInKind` round trip. The addresses land in `~/.cache/uptick-fork/fork.json`, `keeper/.env.local` and `web/.env.local`.

## Addresses

| Item | Where |
|---|---|
| VaultFactory, UptickRouter | `fork.json` keys `factory` and `router` |
| Every StockVault with its deploy block, deposit cap and rebalance result | `fork.json` key `vaults` |
| NVDA token | 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC |
| NVDA/USDG pool (0.05%) | 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 |
| Chainlink NVDA feed | 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 |

## Reproduce

1. `FORK_BLOCK=90275525 scripts/fork-up.sh` (first run deploys and records `fork.json`; later runs relaunch pinned to that block with the saved state, so vault history stays local).
2. `scripts/e2e-fork.sh` runs every user path against the NVDA vault and the router from `fork.json` between an `evm_snapshot` and an `evm_revert`: ERC-4626 deposit and the deposit cap, same-block share lock, the 24 hour owner queue, USDG zap through the router and its refusal of vaults the factory did not deploy, MCP-prepared deposits and withdrawals, swap volume and fee harvest, a large swap closing deposits and rebalance until the TWAP catches up (the keeper logs `SpotOffTwap()` and retries on its next tick), the keeper rebalance at the recentre slot, in-kind exit, and a stale feed closing deposits.

## App wiring

- keeper/.env.local: RPC_URL, VAULT_ADDRESS_<SYM> and VAULT_DEPLOY_BLOCK_<SYM> for every vault.
- web/.env.local: NEXT_PUBLIC_VAULTS (symbol to vault), NEXT_PUBLIC_ROUTER, NEXT_PUBLIC_VAULT_NVDA, NEXT_PUBLIC_RPC_URL (read by web/lib/wagmi.ts). Restart `next dev` to pick it up.
