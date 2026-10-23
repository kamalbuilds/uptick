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

<!-- fork-demo-txs:start -->
## Morpho demo run: every transaction

`scripts/fork-demo.sh` runs the product end to end on an Anvil fork of Robinhood Chain 4663 taken at block 96051421: a fresh VaultFactory and UptickRouter, the PLTR (Uniswap v4) and AAPL (Uniswap v3) vaults, an UptickShareOracle on the AAPL share, a market on the real Morpho Blue singleton `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010`, a lender, a borrower using the app's own call encoding, a 3% pool push, a stale feed, a feed drop and a liquidation. The hashes below exist on that fork only (label FORK), in the order sent, with the block that mined each.

| Network | Step | Block | Hash |
|---|---|---|---|
| FORK | deploy: VaultFactory | 96051424 | `0xc852ae75633121045a38492d538ff6cec511ca23b9ce556c8d0374377410cae2` |
| FORK | VaultFactory.setDefaults | 96051425 | `0x440aadf9f2112495b89227db1b4850e47eb3c9a68dcf2b4d3f89f78aceefdea7` |
| FORK | VaultFactory.createVault | 96051426 | `0x2f949e48ac8f65a43b90a8c5001473aa278c4a9f2d00e1ab38ab3042ce197e25` |
| FORK | VaultFactory.setDefaults | 96051427 | `0x24ea59f97ac118112fe9e8ffc54032b771f26484964e247bfe04eb202e64d766` |
| FORK | VaultFactory.createVaultV4 | 96051426 | `0x91456b95910c1461e944b3aaed6ddcd98ee0e9f2d30977be664e679745f3b0c6` |
| FORK | VaultFactory.setDefaults | 96051427 | `0x40ed60f8a6883a3d73b3e7da56ad7e567fef324add7d2f78a6e3ce5f91cbebb7` |
| FORK | deploy: UptickRouter | 96051427 | `0xe53c7351c8c0fc6267c3d4c04d3b0bb63e1528ace4e43312d1995b94c5263792` |
| FORK | deploy: V4Swapper (trader helper for the PLTR v4 pool) | 96051428 | `0x943f5dca83100f22fac05f98df021ca99fd2bd761f8151a3cedfd786a2cd902a` |
| FORK | trader approve USDG to the v3 router | 96051429 | `0x0e1e3565439985d39b10796711d45b012044cba50bb6f15095a28a7d8f2108b5` |
| FORK | trader approve AAPL to the v3 router | 96051430 | `0xeb6813747c126e9e47cae5b6f9d30e311595838e725eb0d5b149163d0f4de41d` |
| FORK | trader approve USDG to the v4 swapper | 96051431 | `0xfe528946bfc54ca2596cf3efe2980abe0d7553e29637ff77140f98eaf202b8ac` |
| FORK | trader approve PLTR to the v4 swapper | 96051432 | `0x2edbcbad3512be78513da225a862748740f147f8bfa3e111254ce333aac72de1` |
| FORK | AAPL pool: trader sells AAPL (walks the pool onto the feed) | 96051434 | `0xd6165d0aef3938b70e042bc6cdc399dc4db73ffe22428f99a442f889f1410890` |
| FORK | AAPL pool: trader sells AAPL (walks the pool onto the feed) | 96051435 | `0x2033b7f2e1f2238e0ae6cb09657a8cfe0702132a0ff000a9448226133160c680` |
| FORK | AAPL pool: trader sells AAPL (walks the pool onto the feed) | 96051436 | `0x54114df09da610d511b8b67136df89752b2cdee1db0c096682356c413f8cccd5` |
| FORK | PLTR pool: trader buys PLTR (walks the pool onto the feed) | 96051438 | `0xd1ee46d6afe1dac3b158398b45043b3f28cb8303a810b09473dadf1970f3bf62` |
| FORK | PLTR pool: trader buys PLTR (walks the pool onto the feed) | 96051439 | `0x514da27571b0cf4008e6e5cc8a260ed8e427ec60badd83807d451ed30bc02049` |
| FORK | PLTR: keeper poke 1 of 11 (TWAP observation) | 96051441 | `0x90a2f761ffb19b9c818721a9ba128724edf72c452e683cd61d46841ec912ba7d` |
| FORK | PLTR: keeper poke 2 of 11 (TWAP observation) | 96051443 | `0x1b55a9b67846a9f0c0bad898eb07a002c108c9f01f5da835454ed86b0324b713` |
| FORK | PLTR: keeper poke 3 of 11 (TWAP observation) | 96051445 | `0x29d7c2cd6d8a7efdf689f662aadcf6e2c75574e59b9e65920070bfae5c099b34` |
| FORK | PLTR: keeper poke 4 of 11 (TWAP observation) | 96051447 | `0xb9009838d361baaa98a32ce2406774d2ae836a56908a7a29fcb1e60b9b8ca0ef` |
| FORK | PLTR: keeper poke 5 of 11 (TWAP observation) | 96051449 | `0x536af3c50c35a5e776b1ae5e0b3b1d8cb487d48f53705b6be95d6e804cad8615` |
| FORK | PLTR: keeper poke 6 of 11 (TWAP observation) | 96051451 | `0x227e612806a97482431f172cf35e7fea517b4aad81145fafb044e6460def893e` |
| FORK | PLTR: keeper poke 7 of 11 (TWAP observation) | 96051453 | `0x9bbcc85ffa32a4873fe610d5505e5ce5551d84f6635187812327165de7abf446` |
| FORK | PLTR: keeper poke 8 of 11 (TWAP observation) | 96051455 | `0x900988014112303d7c96ad828cd8e5f445c89cf48d620d2f45916cf381f4bb70` |
| FORK | PLTR: keeper poke 9 of 11 (TWAP observation) | 96051457 | `0x6871061942c25f7e4151dc98527c03d8f61680bbac6a70743cb3ba3774f1d36a` |
| FORK | PLTR: keeper poke 10 of 11 (TWAP observation) | 96051459 | `0x1d029248d53fd324d0a386c04c4443b45f33d17161297bbf949cf4eb37162a9f` |
| FORK | PLTR: keeper poke 11 of 11 (TWAP observation) | 96051461 | `0xcf5ce9a6509290574d6407b3e8155a65ee4f0d2180e54a6f7cfa999401f338ea` |
| FORK | AAPL: approve seed | 96051462 | `0xb07f71ab7479a4b6f623c35f4b8cc852fe30da5c7be9c1a19c96a3a4dfd9af87` |
| FORK | AAPL: seed deposit (5,000 USD of AAPL) | 96051463 | `0x241fd93df62c27a1ca26a393ef6808ba6eb83ac43692736a47c3f88edd7d07a7` |
| FORK | PLTR: approve seed | 96051464 | `0xa65ec572f79f63b6d7329d4ca2478145f86f61e4e8a8bbcf4466ad64f2788504` |
| FORK | PLTR: seed deposit (5,000 USD of PLTR) | 96051465 | `0x300f9f0c68f72eddb075ea5f5f28faa6f42c55c51d3cf66bc4d9968bf8ed7bf3` |
| FORK | AAPL: keeper rebalance (mints the position) | 96051466 | `0x1cbac1d40cd93493dcf3437953b5022535009cea62e96eab98f247315eb6deca` |
| FORK | PLTR: keeper rebalance (mints the position) | 96051467 | `0x33472124ac5974ebfb419f2f3b59ffc18e462375166b85de54e9c595dec9234c` |
| FORK | PLTR: user approve | 96051468 | `0x5ec81fdb864bcc5d700fe5c9e2b9e0627907322fd7238a260a790f00fa0594f2` |
| FORK | PLTR: user deposit 20 PLTR into the v4 vault | 96051469 | `0xc26487f925146f89f062626ff714861f910d888d430390c9f96a133170fa8bcd` |
| FORK | PLTR: user redeemInKind of a quarter of the shares | 96051470 | `0x8964b283a9257db6a9283fbf453b23727f43a0554306376099112b1984e0db98` |
| FORK | deploy: UptickShareOracle for the AAPL vault | 96051471 | `0xcc4a39aac713e65d4474bb94021264903c36ca4f19c1af386b3d66d1b915da7b` |
| FORK | deploy: UptickShareOracle for the PLTR vault | 96051472 | `0x842a1883a71042365686d57764a34b9feb4f36b648573cf5b32a921d47992d61` |
| FORK | deploy: SpotShareOracle (the control: an oracle that reads pool spot) | 96051473 | `0xa4bea6b99c88ebc804547160fe42ebeefbb12773575a1c68ee432094d14e3ace` |
| FORK | Morpho: createMarket USDG / AAPL share, UptickShareOracle, LLTV 62.5% | 96051474 | `0x3cecc127643f08986924565efc735f84ac82b4c4c2d82a0d642be3b7ed3ca109` |
| FORK | Morpho: lender approve USDG | 96051475 | `0x47bc539e8d868e3021b4d2f4b7a3a9bace899ecec51fb9bc34b88396f9dbf3e4` |
| FORK | Morpho: lender supply 300,000 USDG | 96051476 | `0x8d5f457d0eb6024bfa97ee64def7f1df8fd9b0d63c58e016563909ad4797b2fc` |
| FORK | AAPL flow 1/5: approve-token | 96051478 | `0x5195ca724580ad62ceb78d371ac950cdd189cb51a88ad4591139e2f8e4d803cd` |
| FORK | AAPL flow 2/5: deposit | 96051479 | `0xac8251bb39c642587ecfadf1eece72e34f3eed061eeceb1158202762b8b4fd51` |
| FORK | AAPL flow 3/5: approve-shares | 96051480 | `0x2108d6a93d146189b95d13e3a5a405c4c5048dfa010dfb547d36bd0b813801da` |
| FORK | AAPL flow 4/5: supply-collateral | 96051481 | `0xf56112240229995c415bafe42c301203a11dbd9f895f1c32c06fd537247fca28` |
| FORK | AAPL flow 5/5: borrow | 96051482 | `0xa8447790189c4e8b070abda20dc0542863010fef1e37f8590d88689c62cad212` |
| FORK | AAPL pool: 3% push, buy 1 of 1,000 USDG | 96051483 | `0x28cba06cae0e842a4f21da582c1b74ec8dbfbe11c109f6d333ef990339cbf8d1` |
| FORK | AAPL pool: 3% push, buy 2 of 1,000 USDG | 96051484 | `0x6c0ac6f1aa59d1e281e93ef361b0c142eb4c3d283a056a3481c8986c1035b29f` |
| FORK | AAPL pool: 3% push, buy 3 of 1,000 USDG | 96051485 | `0x3cf3ee3e39953d82b1900a0d62fde58bb530bf9ab1d84c3d2db5b50e98e33a14` |
| FORK | AAPL pool: 3% push, buy 4 of 1,000 USDG | 96051486 | `0x69c6f0afb1e0f2b4234424f07ef1f6cac8991dd125300a31c4e3e0e5cdd230aa` |
| FORK | AAPL pool: 3% push, buy 5 of 1,000 USDG | 96051487 | `0x365602a8f41dc49d95266b6148d9d07bfc02715360eba0489259eba565a7feb8` |
| FORK | AAPL pool: 3% push, buy 6 of 1,000 USDG | 96051488 | `0x6a2be797dd2d115ed66b51eb622f99baee66233b61cf55992fd100838ea096d2` |
| FORK | AAPL pool: 3% push, buy 7 of 1,000 USDG | 96051489 | `0x539477514c362857b18d5c87ec3f60b3f1fae7d6df22649cd7e668b2e368e2ec` |
| FORK | AAPL pool: 3% push, buy 8 of 1,000 USDG | 96051490 | `0xba4fd61728ace879a6204c3a2879c2c7b7273d71efcc8a34b521908d94e04f80` |
| FORK | AAPL pool: 3% push, buy 9 of 1,000 USDG | 96051491 | `0xd891b301939abed4ba1aa8fa324457c7ce5c8086a0fa0d2f1c3eea83a22c46ea` |
| FORK | AAPL pool: 3% push, buy 10 of 1,000 USDG | 96051492 | `0x0812bc0f7f0ec380499297fec8a655d0033cb85c54d673da3bb2e8fc13600139` |
| FORK | AAPL pool: 3% push, buy 11 of 1,000 USDG | 96051493 | `0xb7f1276ee37f8eaae35245be43703c5a1a4be470d7dec8b9ee34e051dcbc1aee` |
| FORK | AAPL pool: 3% push, buy 12 of 1,000 USDG | 96051494 | `0xcb8b1abc3f7a4bc196b79506f139f72cd4e3029b2d8469554cece8db27e21c34` |
| FORK | AAPL pool: 3% push, buy 13 of 1,000 USDG | 96051495 | `0x4b0f779254d35a20218a1b2d40423266607a30b6e332be1195268c7471d51913` |
| FORK | AAPL pool: 3% push, buy 14 of 1,000 USDG | 96051496 | `0xba37b2973cce48236591c828427cb356b0860f6ea6e9563e2f25b3a814d1bb1a` |
| FORK | AAPL pool: 3% push, buy 15 of 1,000 USDG | 96051497 | `0xf48e6d948d31b88a05a0b034d83d9c331238f87120159e4e2a55e3ea73f6f295` |
| FORK | AAPL pool: 3% push, buy 16 of 1,000 USDG | 96051498 | `0x3124aa94f84c1e85a67f5abfaba2c95af9fea3e18832f869fb0ea87b1b93ba30` |
| FORK | AAPL pool: 3% push, buy 17 of 1,000 USDG | 96051499 | `0xb18c3dd92097ec02f411aba9a92c8b6edc5774723aaba3e0683fd5826cfd427e` |
| FORK | AAPL pool: 3% push, buy 18 of 1,000 USDG | 96051500 | `0x3cde432c66cd6a8977d6247f97a2e7e9de812d7d2470cfce3fbda8d4c635b902` |
| FORK | AAPL pool: 3% push, buy 19 of 1,000 USDG | 96051501 | `0x1f3530e26b2c772cb65e0cb241a04f38e2000a5a8137ee4346943182c996945b` |
| FORK | AAPL pool: 3% push, buy 20 of 1,000 USDG | 96051502 | `0x52de6b6f615ad6e962e403bf97820b909563989e62d3f41aa2ae1b05149ac971` |
| FORK | AAPL pool: 3% push, buy 21 of 1,000 USDG | 96051503 | `0xd1b94c93460b188b3af0e53b9093f346a57213ada799de071e6d5e630ab5403c` |
| FORK | AAPL pool: 3% push, buy 22 of 1,000 USDG | 96051504 | `0x20a5f814503485e5c7fa06b6f8cc9d2a8da09316e70b6ce7d63b1bd785394491` |
| FORK | AAPL pool: 3% push, buy 23 of 1,000 USDG | 96051505 | `0x0c7e1b44a43353bc29c7ad1d2635d9d888dd4989a8b8fb054f16eb9cee582a38` |
| FORK | AAPL pool: 3% push, buy 24 of 1,000 USDG | 96051506 | `0x7eec143dacaeddc6d6b54c3fcbef5349e0ea4c4fe0937143ab754dd057e2642a` |
| FORK | AAPL pool: 3% push, buy 25 of 1,000 USDG | 96051507 | `0x336beee3d132b4b336320b09e54b8e48ad2349cba5d597d386558ad78b5ebdac` |
| FORK | AAPL pool: 3% push, buy 26 of 1,000 USDG | 96051508 | `0xf31f1e321f84efbb015f6054f310202033f9ec0ba65af3e41c93b59b237bcac4` |
| FORK | AAPL pool: 3% push, buy 27 of 1,000 USDG | 96051509 | `0x19513cf25dc60a69d7970ca83292c8f6008f756d278f1aeeb6b26f1504600355` |
| FORK | AAPL pool: 3% push, buy 28 of 1,000 USDG | 96051510 | `0xd34df6f85c1ac7d3687ab37b0edc93b755bc892160c154adee4f2053582abfa6` |
| FORK | AAPL pool: 3% push, buy 29 of 1,000 USDG | 96051511 | `0x8712ec851817c50ca47e136f1d40ffb7d16668cdabb1c3b0b07f4037c676a661` |
| FORK | AAPL: user approve (stale-feed deposit attempt) | 96051512 | `0x0914410196bfa908570b1d61d20787915d882226dabb4686810179f905a51187` |
| FORK | USDG: user approve to the router (stale-feed zap attempt) | 96051513 | `0x314fd61fd82f977a5b1050179c3981e823a994a07ff67f9992417a7a5d56cf42` |
| FORK | AAPL: deposit on a stale feed (reverts) | 96051515 | `0xdc23ea45940c1c7da8465ff1c195914fe8d5cf655f2a799d827611a80c0c9534` |
| FORK | AAPL: redeemInKind on a stale feed | 96051516 | `0x388f9b22517bbcc23b4e45547523eba1eaf2e43f1c7e07be56aa847d814dc019` |
| FORK | USDG: liquidator approve to Morpho | 96051517 | `0xb41f89eaa3f1a58457b453386e7c4c841b2cf97f5bb92c1d487c164b8da7b14e` |
| FORK | deploy: SettableFeed (the code anvil_setCode copies over the AAPL feed) | 96051518 | `0x71d33260c10e421e3c397184d92892b3d466f352545ffd0c71871a1a30b1771c` |
| FORK | Morpho: accrueInterest | 96051520 | `0xf306d0e04e28323388e86eeca8bd76d729f7448cc7d71003dcf61a667b4c8414` |
| FORK | Morpho: liquidate half of the AAPL-share collateral | 96051521 | `0xc9c8507041b8873be31d97f9654eb88b1b45a3792419e53fd5379c43e2e2023b` |
| FORK | AAPL: liquidator exits the seized shares with redeemInKind | 96051522 | `0x56afae7f1f8daf016c00eb6c76a69a91f80df5f3f65de4d5bb5f9a89082a6e64` |

What the run measured:

```
  info: forked at block 96051421; factory 0x82Ab68099eed0b1276bcacdBbf31B3Cc7563960A router 0x87005c148b79110c21C39B06823da3c6CaF7866e AAPL vault 0x200c592BfD65FDA11Cac3c2E29C681AD30823fcE PLTR vault 0xf4eD70A21d17De3DbBAc5497ebdF27566C2B442a
PASS 10-deploy-factory-router-and-two-vaults
  info: at the fork AAPL spot is 44 bp (sell side) from Chainlink and PLTR 66 bp (buy side)
  info: v3 pool walked onto the feed in 3 trades (224.484967 USD per bp)
  info: v4 pool walked onto the feed in 2 trades (326.793103 USD per bp)
  info: after the rebalance AAPL spot is 9 bp from Chainlink, PLTR 10 bp
PASS 11-seed-and-rebalance
PASS 12-user-deposits-pltr-v4
  info: constructor with a non-vault answered: Error: server returned an error response: error code 3: execution reverted: custom error 0xecbf070c, data: "0xecbf070c"
  info: AAPL share: oracle price 347858301482134744562 (1e36 scale) = 347858301.48213476 USDG raw per whole share; vault NAV at Chainlink 347858384
  info: PLTR share: oracle price 198586468726990178217 (1e36 scale) = 198586468.72699016 USDG raw per whole share; vault NAV at Chainlink 198600866
PASS 13-share-oracles
  info: market 0x615e90ebe63c39dc02d8d93bb10b811fdacacb3c88ceb9430e8c4be8fd3ed715, LLTV 6250 bp (ceiling 9432 bp)
PASS 14-morpho-market
PASS 15-lender-supplies-usdg
  info: 42.6 AAPL deposited, 42088881378920228590817100 share units posted, 8693.074028 USDG borrowed against a limit of 9150.604241 at LLTV 6250 bp
PASS 16-borrower-earn-and-borrow
  info: market oracle (0x6397866132887b206EEA19f910730443E71a8CfB) moved 386493 USDG raw on a vault of 19771327025 (bound: +14500000 of fee income, -3954265 of rounding and TWAP drift); the spot-reading control moved 520913476 (263 bp)
PASS 17-pool-push-oracle-holds
PASS 18-stale-feed
  info: share price fell 1150 bp on a 1200 bp feed drop; debt 8693302847 against collateral worth 12997055235 at LLTV 6250 bp (LTV 6689 bp after the drop, 5920 bp when borrowed; liquidation threshold 6250 bp)
  info: repaid 5767.443262 USDG, seized shares exit for 6628.24018 USDG at the new Chainlink price (1493 bp over the repayment)
PASS 19-feed-drop-and-liquidation
PASS 20-feed-older-than-97h
```
<!-- fork-demo-txs:end -->
