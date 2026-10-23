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

`scripts/fork-demo.sh` runs the product end to end on an Anvil fork of Robinhood Chain 4663 taken at block 96043223: a fresh VaultFactory and UptickRouter, the PLTR (Uniswap v4) and AAPL (Uniswap v3) vaults, an UptickShareOracle on the AAPL share, a market on the real Morpho Blue singleton `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010`, a lender, a borrower using the app's own call encoding, a 3% pool push, a stale feed, a feed drop and a liquidation. The hashes below exist on that fork only (label FORK), in the order sent, with the block that mined each.

| Network | Step | Block | Hash |
|---|---|---|---|
| FORK | deploy: VaultFactory | 96043226 | `0x959adde0881b73893ca9d33b2d8eb5dd1a9f50ff3d7341d905e03c55a81e8cfd` |
| FORK | VaultFactory.setDefaults | 96043226 | `0xd9ff59f4051c13edc42088c3e4764cddeaff492e02b3127cf1ded1e66e95be8d` |
| FORK | VaultFactory.createVault | 96043226 | `0x1ed53287c0fd7388c0a5ebe49862fa1692383c6ec2304b05ff3bf98d32bf4fe1` |
| FORK | VaultFactory.setDefaults | 96043226 | `0x601d4a9982389d4d4197288031d078e705771d0553fef99760ea66a67871a340` |
| FORK | VaultFactory.createVaultV4 | 96043226 | `0x07da2a1751df88d1d4dd8e2c7fc9f418c8a818f1950b1af534b1484403348825` |
| FORK | VaultFactory.setDefaults | 96043226 | `0xf56476458a8752deb6e2c3507ce2c41e3abd42f545524fa6e984ecbe39b0dc6e` |
| FORK | deploy: UptickRouter | 96043226 | `0x4ea79c1b8ed5dd8f26cd67f345ccb49cbf857f13140a237f10c0a8892144bb9c` |
| FORK | deploy: V4Swapper (trader helper for the PLTR v4 pool) | 96043227 | `0x1a4dde552e229f6cab50fba3b34d473eed0ffb9f89e095a7648e9de362d98677` |
| FORK | trader approve USDG to the v3 router | 96043228 | `0xdae07953a64b11fbf309db8889233f5ed855f7c8e34bab947e43d8c7ac4d86c0` |
| FORK | trader approve AAPL to the v3 router | 96043229 | `0xd90c46f98516518904c332f847addcc3ba265c5080ebfd560f6b121f1459e368` |
| FORK | trader approve USDG to the v4 swapper | 96043230 | `0xa10a833a6ff35f899f7f2b1f277109c037f31975c12cf9ea96f222ff5595ca58` |
| FORK | trader approve PLTR to the v4 swapper | 96043231 | `0xdad18d8faa88e671317e51f7d926823b7776600e7bccfbea9308cf33254c5370` |
| FORK | AAPL pool: trader sells AAPL (walks the pool onto the feed) | 96043233 | `0x4f729d3ab2fb4f505ca298c6f5fd0a07d1979a324b4c99f0b7fd368a39739070` |
| FORK | AAPL pool: trader sells AAPL (walks the pool onto the feed) | 96043234 | `0xbcade12785a2b236ce2d14a3c3f924b5f608edb267102e637db40589e124f561` |
| FORK | AAPL pool: trader sells AAPL (walks the pool onto the feed) | 96043235 | `0x880cf4aa0faef5507ee03c894e95b71e1fb3e16301b1d6e2b6ba167a4fb6a515` |
| FORK | PLTR pool: trader buys PLTR (walks the pool onto the feed) | 96043237 | `0xe47e43fb19254daeed1d9c53e99054b8e9fa368bff94149eaa939571b90bbe53` |
| FORK | PLTR pool: trader buys PLTR (walks the pool onto the feed) | 96043238 | `0x5391ffd22ed6091e422092aa8586f58dffca8cece5a506d5d924284e154f353c` |
| FORK | PLTR: keeper poke 1 of 11 (TWAP observation) | 96043240 | `0x719fb56eb14ea7d4c63babec586cb5dc5a78c67b8a44d3d259e74eebb7ea7061` |
| FORK | PLTR: keeper poke 2 of 11 (TWAP observation) | 96043242 | `0x1f6b17467207e0da0443225a87368aee597f3bf5a130ef6fa6d2f31387e88993` |
| FORK | PLTR: keeper poke 3 of 11 (TWAP observation) | 96043244 | `0x4f9bc5f22509447eee87006555b5a326788a5efb46a91dc6d5462333806c76db` |
| FORK | PLTR: keeper poke 4 of 11 (TWAP observation) | 96043246 | `0x12c8bfe5e7d1018208f7c98134c3b832419954b7a2bfd8bbbda2b7f1f10c7931` |
| FORK | PLTR: keeper poke 5 of 11 (TWAP observation) | 96043248 | `0x4dd646d5e62d40a8b201494611fba258b52bc24143bebfe7869a414ca848d2c8` |
| FORK | PLTR: keeper poke 6 of 11 (TWAP observation) | 96043250 | `0x03dd9a25ae97032b55d9920fcdb14e1f4829b76f46e49c927c24c47d6d406518` |
| FORK | PLTR: keeper poke 7 of 11 (TWAP observation) | 96043252 | `0x8561abd71dc3146f501b596150b4ab88b1d173a5d86015129fd39005e6ff107f` |
| FORK | PLTR: keeper poke 8 of 11 (TWAP observation) | 96043254 | `0xaaebf91d51044b316056ecd984e77cb652da6f344440d8317b3d1d005b31d09a` |
| FORK | PLTR: keeper poke 9 of 11 (TWAP observation) | 96043256 | `0x2b1ed3a1941facfe50b87d5e95478f22cc76af6f8d2e476ae7babf1e98781c09` |
| FORK | PLTR: keeper poke 10 of 11 (TWAP observation) | 96043258 | `0x149554ec64c351fc5c2f33cd94a25428e87d1e2d074a76489d0f031ef95c1d96` |
| FORK | PLTR: keeper poke 11 of 11 (TWAP observation) | 96043260 | `0xe4e22918456d1fe7aee245aa97bbcedf629925d4c1f6ad5320bbd40aa02b46e1` |
| FORK | AAPL: approve seed | 96043261 | `0x6486d5fe466e507c095fbe0fae5df1332f8e8f04c4d5ff8eca66334074c5401d` |
| FORK | AAPL: seed deposit (5,000 USD of AAPL) | 96043262 | `0x2a504af6d939f4b518ce5071e135b570e35f03223bdc06584c8c8cc3b82f9cbd` |
| FORK | PLTR: approve seed | 96043263 | `0x67aead824d604e977d253f24ddb454e05933c92c5b15f22a3158307a4ae0d1eb` |
| FORK | PLTR: seed deposit (5,000 USD of PLTR) | 96043264 | `0x8690fd6cf75b1b666bff237b04afa1b0a206c0bcecb46baba1a54e29ee7a0063` |
| FORK | AAPL: keeper rebalance (mints the position) | 96043265 | `0xc0a277660e44e5773fa54a53f7a207477213f88455b3f8ca0024fd758924b1f1` |
| FORK | PLTR: keeper rebalance (mints the position) | 96043266 | `0xd70f956ed4139b72ff8943ffe9b46d807cb9ac944d25d136eed4a05cbbd84366` |
| FORK | PLTR: user approve | 96043267 | `0x5bef7b7790c1ead630b91a7b5cc879979dc7676abb47c4914dfdffa0546904b5` |
| FORK | PLTR: user deposit 20 PLTR into the v4 vault | 96043268 | `0x1c7b53426a13fe962fd97ff832f685c524f159dc1f4dde28e4b1fa120959afd5` |
| FORK | PLTR: user redeemInKind of a quarter of the shares | 96043269 | `0x7a4d24ad16cc19900adee722e6a6138dd6d9e2dc1c9ccb952c0358cffa440b1e` |
| FORK | deploy: UptickShareOracle for the AAPL vault | 96043270 | `0xb431d6a30d14a1b42e0475c022350badb989cdc45f7d6cc086c1b253bd88c0ef` |
| FORK | deploy: UptickShareOracle for the PLTR vault | 96043271 | `0xb668ff0ede07baffac1fe6e5b06f439f39ef0cbc7d0218d8da3eb6d6f34ed382` |
| FORK | deploy: SpotShareOracle (the control: an oracle that reads pool spot) | 96043272 | `0xe94dbc7e36c14fb2652f9bcf8c30eeddbee393818b4dd4559561bc19801edc33` |
| FORK | Morpho: createMarket USDG / AAPL share, UptickShareOracle, LLTV 91.5% | 96043273 | `0xe75bebd75c69aef8b554dd60765edf9dd81907c1b5f19282b03afbca4da72d03` |
| FORK | Morpho: lender approve USDG | 96043274 | `0xf8068ca9445ae8d7014e8cc62bf25a9652981176e8abafc378d763b63c6836c8` |
| FORK | Morpho: lender supply 300,000 USDG | 96043275 | `0x9587ce1f2cfcb22e39048e8f8ad4e907563820e9e9c72d98e77e587f2ad9383e` |
| FORK | AAPL flow 1/5: approve-token | 96043277 | `0xa865702f86725ae169917bb427d815b912f1f727dbae3020bd04586eabe795a0` |
| FORK | AAPL flow 2/5: deposit | 96043278 | `0x3eeb1e2c9735db35e3ecb19a9026caa5c8b8baecaa46effc4e56b9cf0a024aeb` |
| FORK | AAPL flow 3/5: approve-shares | 96043279 | `0x4894849230a9ec580cad70cc4331634033a1272db22585c697bbe26e9c67fb19` |
| FORK | AAPL flow 4/5: supply-collateral | 96043280 | `0x5d0bd5fcaa99ff6cde4161c401f473e730a3fc8e561744ef7736a840edca66f9` |
| FORK | AAPL flow 5/5: borrow | 96043281 | `0x27ebe4e4bf601efc7cefff34f55abb89f4bca3b1ed6761afaef71b8fc3c99195` |
| FORK | AAPL pool: 3% push, buy 1 of 1,000 USDG | 96043282 | `0x2b4903021aafb52664fd6d78d2f3cd011b1f64b27db4dee630b771f253350c41` |
| FORK | AAPL pool: 3% push, buy 2 of 1,000 USDG | 96043283 | `0xc96b2b9dd62f62d65d38afb264cf3f51e227a6c5a4aa2c6baa27cd9fa1cff459` |
| FORK | AAPL pool: 3% push, buy 3 of 1,000 USDG | 96043284 | `0x72c0c5a11c0efa011f3198c0762df0750a9ecee555d7bc84cc6b4ed9794a68bf` |
| FORK | AAPL pool: 3% push, buy 4 of 1,000 USDG | 96043285 | `0xc97a93e831bb9c7b95c4e0d471ac85bcef6bd4f75aaa1ff0d3bec8ed3dee93b5` |
| FORK | AAPL pool: 3% push, buy 5 of 1,000 USDG | 96043286 | `0x90f38e27830f93b2f68bb774eb9b1a7f486bb4746eaf26d7f9210d026dbf8546` |
| FORK | AAPL pool: 3% push, buy 6 of 1,000 USDG | 96043287 | `0x940756dd8118bf6fd4da27b3c86392fc1a1010338d55eed38837a90d5e36006c` |
| FORK | AAPL pool: 3% push, buy 7 of 1,000 USDG | 96043288 | `0xd92858072dfff30d31c497a13048a4e67f00b29fecd57e3f33ba05710628b651` |
| FORK | AAPL pool: 3% push, buy 8 of 1,000 USDG | 96043289 | `0x4a87bb526b2b05a37066c55ba4de0217fe31a413462967d80be8aa70034bd752` |
| FORK | AAPL pool: 3% push, buy 9 of 1,000 USDG | 96043290 | `0x83eb7deefd3fdb45c748a6b8f853bbfd1e386d5739c837ecfb6c6ddc8a7595f3` |
| FORK | AAPL pool: 3% push, buy 10 of 1,000 USDG | 96043291 | `0xc74ff4bd7029835542df3a91893d8d12f6bc76b3f13243dc8b8bd356294df957` |
| FORK | AAPL pool: 3% push, buy 11 of 1,000 USDG | 96043292 | `0x342401503a3ae61a664241a39b34276d2910e554c8cfd116ab2adaa0a964db12` |
| FORK | AAPL pool: 3% push, buy 12 of 1,000 USDG | 96043293 | `0xdb18df9ce64e42e4b559387b73839762f846db8788ee293734f44835db730ec2` |
| FORK | AAPL pool: 3% push, buy 13 of 1,000 USDG | 96043294 | `0x4e7bc892dfce7421c7490b688fb183019b722328861803111fa46ebd4e220b6b` |
| FORK | AAPL pool: 3% push, buy 14 of 1,000 USDG | 96043295 | `0x7b7d16d4af98c1ddfd29fa44cdd6df8b8a5e63aa39c39fda53021b167df884d7` |
| FORK | AAPL pool: 3% push, buy 15 of 1,000 USDG | 96043296 | `0x3b98c2c83d2676b57711c8102833eb31474fe86b22127ed6ad586e74355de1f4` |
| FORK | AAPL pool: 3% push, buy 16 of 1,000 USDG | 96043297 | `0xebaddcef7d86c19965db8b5a705863cb57e46590af6695803e02c80525ee59dd` |
| FORK | AAPL pool: 3% push, buy 17 of 1,000 USDG | 96043298 | `0x2c3e1cd2a1a02e28e70077e5219f2127060cb4f1fbfca7c8c8dee6d8ee523627` |
| FORK | AAPL pool: 3% push, buy 18 of 1,000 USDG | 96043299 | `0x3c4086a80dd5b7bde5e33c33504d2a73862932a77af991a27185db7a75c27f60` |
| FORK | AAPL pool: 3% push, buy 19 of 1,000 USDG | 96043300 | `0x66107f4c70d9c3806190cc0595e998a423e24be70e39180fd91e4be90274b830` |
| FORK | AAPL pool: 3% push, buy 20 of 1,000 USDG | 96043301 | `0xfb02c0462c68c7b7a0ef07237c3cde11739ae559d079b154bd5a114f5068599a` |
| FORK | AAPL pool: 3% push, buy 21 of 1,000 USDG | 96043302 | `0xab7ffaf57b219a33e6d26b1002b674cd2ee44f3182e0e0cc927509bb89ac82bf` |
| FORK | AAPL pool: 3% push, buy 22 of 1,000 USDG | 96043303 | `0xc95b2c03eb008399f5968e5f587fc0dc4d6832716d77b73440b0489f52cd5b96` |
| FORK | AAPL pool: 3% push, buy 23 of 1,000 USDG | 96043304 | `0x850e5ab4754360f590a5462b22062e15cff140a643400dd0d5f608b51a108a4f` |
| FORK | AAPL pool: 3% push, buy 24 of 1,000 USDG | 96043305 | `0x125381f59227d6f66849f12d6cf4a35890a0582a787f30381e4191d2c4d8b272` |
| FORK | AAPL pool: 3% push, buy 25 of 1,000 USDG | 96043306 | `0xde740b540d751db1bc99edda67b9d01dd05529ba743c5110b835a40ad79bea34` |
| FORK | AAPL pool: 3% push, buy 26 of 1,000 USDG | 96043307 | `0x85bdcb8b8c6d144339d67db712ea17edd2f42cd3676694281bca5c74fa9a8675` |
| FORK | AAPL pool: 3% push, buy 27 of 1,000 USDG | 96043308 | `0x5a3cfc5547d0281f981a00707e294e0d38226ef7cbf89b25e8ceeaf68fefdf1a` |
| FORK | AAPL pool: 3% push, buy 28 of 1,000 USDG | 96043309 | `0xc39c7910ddcfbca13ca6300fabec6aa9f6934f29d8848c54b1c610d307837fa5` |
| FORK | AAPL pool: 3% push, buy 29 of 1,000 USDG | 96043310 | `0x054e1fa8d51583f2055e3622f796ad9e52dc4720ee208328ea76f8c79e06527f` |
| FORK | AAPL: user approve (stale-feed deposit attempt) | 96043311 | `0xdf86d4b1408c605335337c4adb10980b9e097216cfa76448a18b4797cef7c2e3` |
| FORK | USDG: user approve to the router (stale-feed zap attempt) | 96043312 | `0x5f55b3a21ed4b55df209c8bdcd48ace96787c303ffc86a8e37757b1188cf9322` |
| FORK | AAPL: deposit on a stale feed (reverts) | 96043314 | `0x8d91ee2a6170e01b0a30e25dd6ad6dee9bd61456ba3627fe6a075ada7ec305f2` |
| FORK | AAPL: redeemInKind on a stale feed | 96043315 | `0x9b331a965b523c8612106da5c3bb8ed4d7684f530b5be5e3041f0c8f7b5a73e1` |
| FORK | USDG: liquidator approve to Morpho | 96043316 | `0xee695cf28da3de374af93ab16acae94b553cc9afbac2800c6a7c2ad161ee2a1d` |
| FORK | deploy: SettableFeed (the code anvil_setCode copies over the AAPL feed) | 96043317 | `0xfda557d604f56d5c1ec1bb71c277757308c10b783d94d673d74e7e7d01a96237` |
| FORK | Morpho: accrueInterest | 96043319 | `0xf0908d6aa6c595a803a8dfef39de40d914c3cfcdc6b792bbcbdc27cc48c2e795` |
| FORK | Morpho: liquidate half of the AAPL-share collateral | 96043320 | `0xebc69552b1a86249029a200eae33e7e77234e894be441b022d345baea062326d` |
| FORK | AAPL: liquidator exits the seized shares with redeemInKind | 96043321 | `0xd264319ee81f719e516110433587afc32d3790749ebc24a34d9c12918716ef99` |

What the run measured:

```
  info: forked at block 96043223; factory 0x82Ab68099eed0b1276bcacdBbf31B3Cc7563960A router 0x87005c148b79110c21C39B06823da3c6CaF7866e AAPL vault 0x7F8D2D7D6BcC372e634238D844720eced17C62A4 PLTR vault 0xf4eD70A21d17De3DbBAc5497ebdF27566C2B442a
PASS 10-deploy-factory-router-and-two-vaults
  info: at the fork AAPL spot is 47 bp (sell side) from Chainlink and PLTR 66 bp (buy side)
  info: v3 pool walked onto the feed in 3 trades (210.18632 USD per bp)
  info: v4 pool walked onto the feed in 2 trades (326.793103 USD per bp)
  info: after the rebalance AAPL spot is 9 bp from Chainlink, PLTR 10 bp
PASS 11-seed-and-rebalance
PASS 12-user-deposits-pltr-v4
  info: constructor with a non-vault answered: Error: server returned an error response: error code 3: execution reverted: custom error 0xecbf070c, data: "0xecbf070c"
  info: AAPL share: oracle price 347857934882069424720 (1e36 scale) = 347857934.8820694 USDG raw per whole share; vault NAV at Chainlink 347858017
  info: PLTR share: oracle price 198586278246131242917 (1e36 scale) = 198586278.24613124 USDG raw per whole share; vault NAV at Chainlink 198600676
PASS 13-share-oracles
  info: market 0x5dc78753592d6306a839e76910cde2dfb40a70bc4eabc7711552d09b22de23b9, LLTV 9150 bp (ceiling 9432 bp)
PASS 14-morpho-market
PASS 15-lender-supplies-usdg
  info: 100 AAPL deposited, 98800198387122429836199130 share units posted, 29874.760364 USDG borrowed against a limit of 31447.116173 at LLTV 9150 bp
PASS 16-borrower-earn-and-borrow
  info: market oracle (0x6397866132887b206EEA19f910730443E71a8CfB) moved 386326 USDG raw on a vault of 39677524337 (bound: +14500000 of fee income, -7935504 of rounding and TWAP drift); the spot-reading control moved 1142639006 (288 bp)
PASS 17-pool-push-oracle-holds
PASS 18-stale-feed
  info: share price fell 1175 bp on a 1200 bp feed drop; debt 29875729151 against collateral worth 30437357544 at LLTV 9150 bp (LTV 9815 bp)
  info: repaid 14830.602466 USDG, seized shares exit for 15370.452826 USDG at the new Chainlink price (364 bp over the repayment)
PASS 19-feed-drop-and-liquidation
PASS 20-feed-older-than-97h
```
<!-- fork-demo-txs:end -->
