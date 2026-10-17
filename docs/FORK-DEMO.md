# Fork demo: NVDA vault on a local Anvil fork of Robinhood Chain

Anvil fork of chain 4663 at http://127.0.0.1:8545. Only anvil default dev accounts are used. Deployer, owner, keeper and depositor are account 0 (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266); treasury is account 2 (0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC).

## Addresses

| Item | Value |
|---|---|
| StockVault (svNVDA) | 0xB8357F7f41125d4b24AD052c1b7288BeF5C43446 |
| Deploy block | 90902388 |
| NVDA token | 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC |
| NVDA/USDG pool (0.05%) | 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 |
| Chainlink NVDA feed | 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 |

## Transactions

| Step | Hash |
|---|---|
| Deploy StockVault | 0xd99de35fd391c4ffeb1acfbfbe875d0d425d8256eb969ce8f2ebda6413c2e976 |
| setInstantDeploy(true) | 0x8443f5f7fd0dee6a34bf2e3f56cd7a2de10e071d8f54b3e815c8e8da26ce1cb1 |
| NVDA approve | 0x88c2341c7b076255465aca6f83c213c40c9d5c60e95c90b77ed64d4a721f7ea0 |
| deposit 233 NVDA | 0x6e14a7d395dbdb7c0aab279bd8e9ca8f07189a0e962d5c426de1c1640d560f41 |
| rebalance() as keeper | 0xae2543c68c71e1b7e399573e860aaa305ad67ef45a3faa0174d569d6ad956a5c |

## Reproduce

1. Fund account 0 with NVDA on the fork: set the balanceOf slot found with forge-std `stdstore` (`anvil_setStorageAt` on the NVDA proxy, slot 0x03b401b7b39ad5148aeb9ef28bef316a982c01bdaadee32abc45fed3bc7f4746) to 235e18, then `anvil_mine 1` so forge forks the new head.
2. `ANVIL_KEY=<anvil account 0 dev key> forge script script/DeployFork.s.sol --rpc-url http://127.0.0.1:8545 --broadcast`
3. rebalance() is keeper-gated for `minRebalanceInterval` (6 h) after deploy: `evm_increaseTime 21700`, `anvil_mine 1`, then `cast send <vault> "rebalance()" --unlocked --from <account 0>`. The advance keeps the real Chainlink round inside `maxStaleness` (90000 s).

## Read-back

- totalAssets: 233045833757492660535 (233.05 NVDA)
- totalSupply: 233000000000000000000000000
- Strategy band: $205.73 to $227.39 around center $216.56, Chainlink $214.59, in band
- Stats API `GET localhost:8790/vaults/nvda`: source "onchain", tvl_usd 50008.42, in_band true

## App wiring

- keeper/.env.local: RPC_URL, VAULT_ADDRESS_NVDA, VAULT_DEPLOY_BLOCK_NVDA (stats server on 8790 restarted).
- web/.env.local: NEXT_PUBLIC_VAULT_NVDA, NEXT_PUBLIC_RPC_URL (read by web/lib/wagmi.ts). Restart `next dev` to pick it up.
