# Fork demo: NVDA vault on a local Anvil fork of Robinhood Chain

Anvil fork of chain 4663 at http://127.0.0.1:8545. Only anvil default dev accounts are used. Deployer, owner, keeper and depositor are account 0 (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266); treasury is account 2 (0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC).

## Addresses

| Item | Value |
|---|---|
| StockVault (svNVDA) | 0x74156A1F9736307b7AD34e3691f3A5B54A0B3Eb8 |
| Deploy block | 90694013 |
| NVDA token | 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC |
| NVDA/USDG pool (0.05%) | 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 |
| Chainlink NVDA feed | 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 |

## Transactions

| Step | Hash |
|---|---|
| Deploy StockVault | 0x27ea07a4ec536e2ea2389e3e294c57aadf24987262f426cf279f8815bf72febd |
| setInstantDeploy(true) | 0x7c883562f02b45c8e05f1b9abd42e936b965b9875686cf022ce8a574129aa82d |
| NVDA approve | 0xd00c1477de35b8fc5d10759cfdbab0340f7bd3103ef60887df101cfe17759dec |
| deposit 233 NVDA | 0xc283446f59ec736221f1de8ef0f6ccd70b11dd5c45be7b233d57c4a7f5b5e9b8 |
| rebalance() as keeper | 0x79e8a18d1b115f5e46c5f00184ab02e72668596a440f970831315fce070fa066 |

## Reproduce

1. Fund account 0 with NVDA on the fork: set the balanceOf slot found with forge-std `stdstore` (`anvil_setStorageAt` on the NVDA proxy, slot 0x03b401b7b39ad5148aeb9ef28bef316a982c01bdaadee32abc45fed3bc7f4746) to 235e18, then `anvil_mine 1` so forge forks the new head.
2. `ANVIL_KEY=<anvil account 0 dev key> forge script script/DeployFork.s.sol --rpc-url http://127.0.0.1:8545 --broadcast`
3. rebalance() is keeper-gated for `minRebalanceInterval` (6 h) after deploy: `evm_increaseTime 21700`, `anvil_mine 1`, then `cast send <vault> "rebalance()" --unlocked --from <account 0>`. The advance keeps the real Chainlink round inside `maxStaleness` (90000 s).

## Read-back

- totalAssets: 232862021130775724690 (232.86 NVDA)
- totalSupply: 233000000000000000000000000
- currentRange: ticks 222140 to 223150, $203.80 to $225.46 around Chainlink $214.59
- Stats API `GET localhost:8790/vaults/nvda`: source "onchain", tvl_usd 49968.98, in_range true

## App wiring

- keeper/.env.local: RPC_URL, VAULT_ADDRESS_NVDA, VAULT_DEPLOY_BLOCK_NVDA (stats server on 8790 restarted).
- web/.env.local: NEXT_PUBLIC_VAULT_NVDA, NEXT_PUBLIC_RPC_URL (read by web/lib/wagmi.ts). Restart `next dev` to pick it up.
