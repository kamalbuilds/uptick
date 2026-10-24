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

`scripts/fork-demo.sh` runs the product end to end on an Anvil fork of Robinhood Chain 4663 taken at block 96498157: a fresh VaultFactory and UptickRouter, the PLTR (Uniswap v4) and AAPL (Uniswap v3) vaults, an UptickShareOracle on the AAPL share, a market on the real Morpho Blue singleton `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010`, a lender, a borrower using the app's own call encoding, a 3% pool push, a stale feed, a feed drop and a liquidation. Both vaults are deployed with the mainnet launch cap of $5,000 (DEMO_CAP_USD) and a $450 seed deposit (DEMO_SEED_USD), and the borrower deposits 88% of what a vault still accepts (DEMO_DEPOSIT_PCT), under the cap a live vault carries. The hashes below exist on that fork only (label FORK), in the order sent, with the block that mined each.

| Network | Step | Block | Hash |
|---|---|---|---|
| FORK | deploy: VaultFactory | 96498160 | `0x8b18529f11c5bc09f611505a54787d48cc376b9a4914963485185bde715ebcc3` |
| FORK | deploy: UptickShareOracleFactory | 96498161 | `0x806fe3a8eb53e37d3a9730eadcbccc09be67071f618ab3e2b72a53ac4174cb69` |
| FORK | VaultFactory.setDefaults | 96498161 | `0xf021a598f76eb66c0270deec76b5b090e1533c36b41ebc8709044ecd85e635b9` |
| FORK | VaultFactory.createVault | 96498160 | `0xc87288da4d7f6be7456630b0a8a04ea86e7a9a349c88d5a1656b927f73e1716f` |
| FORK | UptickShareOracleFactory.createOracle | 96498160 | `0xe7aa06fd89627e18af78d191df38a4d2a602c176d8fd989f8c86e4e9b30349ca` |
| FORK | VaultFactory.setDefaults | 96498160 | `0x38aedb06a0764464811639db2d39679ea25a33d2330b4058f8685674605755e0` |
| FORK | VaultFactory.createVaultV4 | 96498160 | `0x1d8e97c040ecc8a04649d29aab93b467b1e09ad542734b1924892791e8fbf9d0` |
| FORK | UptickShareOracleFactory.createOracle | 96498161 | `0xa79a79c40a2d39d147fd557677b85c3656e63dc6c8e53b48421a3a3a89adf8d1` |
| FORK | VaultFactory.setDefaults | 96498160 | `0xde8e56522bfe4f95d3478a162caac5a63b37a077966183939896c75c5b6f18c0` |
| FORK | deploy: UptickRouter | 96498161 | `0xd22d2a3aa19f536f3af6a2f4910acae528f861da0ca63b920274bd4d6298f114` |
| FORK | deploy: V4Swapper (trader helper for the PLTR v4 pool) | 96498162 | `0x05d0f6f8bebc17ab5d200fa9a8a0d79cbbac74c326f4c77cdee11fb58b69eb91` |
| FORK | trader approve USDG to the v3 router | 96498163 | `0x2ed338a7b10aefa52df3ccd94baf4e3eedf74d0af7ff1101c8f899c44f3d41f9` |
| FORK | trader approve AAPL to the v3 router | 96498164 | `0x4bf675b45b2e92265c14347fd2b033930526f8f141156cf3a816708beb91f924` |
| FORK | trader approve USDG to the v4 swapper | 96498165 | `0x8fe20e150a7be49838b35857817140151d976f29ac8845ea2e7a4e5b9c06b885` |
| FORK | trader approve PLTR to the v4 swapper | 96498166 | `0xbac881894ef1071a477575862677c87050a4db04b9d43a54673e647f82afcfbf` |
| FORK | AAPL pool: trader sells AAPL (walks the pool onto the feed) | 96498168 | `0xbf66873a4738ff1f5385534b4b04c8b799012900a21e1a21919dd9034207c554` |
| FORK | AAPL pool: trader sells AAPL (walks the pool onto the feed) | 96498169 | `0xc7d7c440583f9f2b25bc9d9ef1010623fb6ea3692181b1b7f07db2220678d301` |
| FORK | PLTR pool: trader buys PLTR (walks the pool onto the feed) | 96498171 | `0x7113bfe4e235c180836fdfdce49cab1339b7a3cc1be4af6e414e7fa0e5f79420` |
| FORK | PLTR pool: trader buys PLTR (walks the pool onto the feed) | 96498172 | `0x13d2f33c60b3f7baee8e02e0b86d068b770798e0780eca5a9f7bac45aa4f6e5d` |
| FORK | PLTR: keeper poke 1 of 11 (TWAP observation) | 96498174 | `0xc46c34027482c0a811dc972a90766284f49e2d9ee27c95ba494c2aa5a31d17a6` |
| FORK | PLTR: keeper poke 2 of 11 (TWAP observation) | 96498176 | `0x7e5c27eade16c64beccbf64881035dd0ba0b8af88ac464b1d61f7994dcba95a5` |
| FORK | PLTR: keeper poke 3 of 11 (TWAP observation) | 96498178 | `0xd65ac71dfb01b03c8345c0f837c1b13d3dee9e818beb8aa0d37bf80530ee1967` |
| FORK | PLTR: keeper poke 4 of 11 (TWAP observation) | 96498180 | `0x8207f05c3de9a392793ae313ebfa2b74306ea6733b94726f9ef9d82d62c1878c` |
| FORK | PLTR: keeper poke 5 of 11 (TWAP observation) | 96498182 | `0x185c696ae1e6a5bb97556a928ea05e30a64e6e0eb72829b2169c0ad225fe9010` |
| FORK | PLTR: keeper poke 6 of 11 (TWAP observation) | 96498184 | `0x14b9e33a0f6dae03a61b2971f1ba8eac5ce03a260655eacf4c2398d3deb51018` |
| FORK | PLTR: keeper poke 7 of 11 (TWAP observation) | 96498186 | `0xc425c5383daccf2d112a1016104cdd7ad5d0981e346ef524a78cd8afee2fc028` |
| FORK | PLTR: keeper poke 8 of 11 (TWAP observation) | 96498188 | `0x5c7b0a2653517e3b8c04e3fd771c14131185ad13db77757f1b329d166c2874a8` |
| FORK | PLTR: keeper poke 9 of 11 (TWAP observation) | 96498190 | `0xd3dd4af24d8f20902ce485d2cd7d2246da94475f97e7a3b6d8ee1df71d50a539` |
| FORK | PLTR: keeper poke 10 of 11 (TWAP observation) | 96498192 | `0xa9d957c15f6e900174f4f57c22d42bb115019eb47154d5cc19a0663e4fe807d9` |
| FORK | PLTR: keeper poke 11 of 11 (TWAP observation) | 96498194 | `0x50c717a9ca9d1385da0247cceb9c5d6272a45c970bc0e1dea36c439cb1ef7934` |
| FORK | AAPL: approve seed | 96498195 | `0x807188044874513957477ed9f1b6d380844d0958b430e56e8585afdde7209655` |
| FORK | AAPL: seed deposit (450 USD of AAPL) | 96498196 | `0xaf9d3f837148e77b3979d4414cbcab5064823ff3895cb936817b6d813ab93612` |
| FORK | PLTR: approve seed | 96498197 | `0xe8a3afb809503897642825cc42f2a43cb99ae86feb9dfa467b2f6fdb8a3d8327` |
| FORK | PLTR: seed deposit (450 USD of PLTR) | 96498198 | `0xe65dea18e21f18b46e447695468e196f7502b14c85da9d9d5cba5db055f798ae` |
| FORK | AAPL: keeper rebalance (mints the position) | 96498199 | `0x9f8114343049494ad47cfa28d6502a7cfd6846fc8b4572ec721c1709d183a47f` |
| FORK | PLTR: keeper rebalance (mints the position) | 96498200 | `0xe3ce78a777839ed20ac3442324edb2533a7e2db50c79c50f514d886b0ac0c4ed` |
| FORK | PLTR: user approve | 96498201 | `0x8690e47baf3be32d190559d12da0b8095662d6e01973c3b0278d81279a6c2d11` |
| FORK | PLTR: user deposit 20 PLTR into the v4 vault | 96498202 | `0x66562e5900c3ed6de30dd49d2a683079c91c1ea0a2309f4b512baca4511877fc` |
| FORK | PLTR: user redeemInKind of a quarter of the shares | 96498203 | `0xf0635bbb5d72e17a012ff9c8c6f4c4b8b284fc155fca96d578fa1a5214f41d0b` |
| FORK | deploy: UptickShareOracleFactory (the only way to deploy a share oracle) | 96498204 | `0x798ce1b7e44fb532d8fa9731730007faca079aa276e7c3abdb5bd8ac01da0606` |
| FORK | UptickShareOracleFactory.createOracle: the AAPL vault | 96498205 | `0x4ae95296e81165fba49df099c35de0b04bf1b8359f7a0306958a2c55150b6c45` |
| FORK | UptickShareOracleFactory.createOracle: the PLTR vault | 96498206 | `0x3b3d92db1894ab8929a1452f7097fca384331516b427b995c5a304dbc5ae9882` |
| FORK | deploy: SpotShareOracle (the control: an oracle that reads pool spot) | 96498207 | `0x2562f1f60abbae10aafae0768b6659fbf8f8a11a7818edbddbe9ba56df71313a` |
| FORK | Morpho: createMarket USDG / AAPL share, UptickShareOracle, LLTV 62.5% | 96498208 | `0x68821caaea5494d4e7f12fdf0ba20dbcb3ae8e1b98e573255b88a524d724618e` |
| FORK | Morpho: lender approve USDG | 96498209 | `0x3b0541be937566aa32def19da3839d70c87a59e41735754f135b97fd2ad03b50` |
| FORK | Morpho: lender supply 300,000 USDG | 96498210 | `0x0929bc360f9734f8a2ac7bdce46a51adf6695e43a5479f59e6cec47219b70753` |
| FORK | AAPL flow 1/5: approve-token | 96498212 | `0x09736e1ab2aa9183f20b142c88d200e185ef72ed33a799a1e522b3475ce38d8c` |
| FORK | AAPL flow 2/5: deposit | 96498213 | `0xc2cf99260132f2542e6b9a76a7e51f5cdd371f08d42fe37cc0cb334af3c14738` |
| FORK | AAPL flow 3/5: approve-shares | 96498214 | `0xe26086d544d720495dcb14ca34de59dc16e6d4b2512572a397152981eddb95d7` |
| FORK | AAPL flow 4/5: supply-collateral | 96498215 | `0x667a9c3c48f92c2a23461bdff4adae78c47dffbf55fc28a385523bc01c9d56b3` |
| FORK | AAPL flow 5/5: borrow | 96498216 | `0x3e012e0b8099410b2b1f537bdebc51e67a05cd49635d83fbdb733818c0a2a602` |
| FORK | AAPL pool: 3% push, buy 1 of 1,000 USDG | 96498217 | `0xa1c600e4c442573389ccade3dc809970bad5cd0bd411ea45e61ac97ae9499acf` |
| FORK | AAPL pool: 3% push, buy 2 of 1,000 USDG | 96498218 | `0xf832fd534f77601d7f8b200f3b82f09e2bcc71a7f086e88cc90eec72128876ea` |
| FORK | AAPL pool: 3% push, buy 3 of 1,000 USDG | 96498219 | `0xc37a80861310e3784a1d5ca8691de733a4287a530d36f467f62942fdb3309d1f` |
| FORK | AAPL pool: 3% push, buy 4 of 1,000 USDG | 96498220 | `0xbb74f6d6711dc1486ded736b4be6a7b404979c6fc1915ff06abf3becac7d3c48` |
| FORK | AAPL pool: 3% push, buy 5 of 1,000 USDG | 96498221 | `0xbdb87df2d6dcffa58a64b29e3522f81164a652eea9959bae67fa2622281b27c4` |
| FORK | AAPL pool: 3% push, buy 6 of 1,000 USDG | 96498222 | `0x0547237839ae3846db091364a13ceb5eb41b14b415500e1744e3d7691a631998` |
| FORK | AAPL pool: 3% push, buy 7 of 1,000 USDG | 96498223 | `0xa3e676e484ada5648bb5307df5f0bc2752707e954e08b919f262592561beca0b` |
| FORK | AAPL pool: 3% push, buy 8 of 1,000 USDG | 96498224 | `0xc9f179b3d9d664660cf33474b894d2d7a0a3d82c5b439c2fcc819185e5f49c81` |
| FORK | AAPL pool: 3% push, buy 9 of 1,000 USDG | 96498225 | `0x8181477ba7163d5c1dc08bc9ced7d666bba4e6435e9077578a6aedbfb967cfc4` |
| FORK | AAPL pool: 3% push, buy 10 of 1,000 USDG | 96498226 | `0xb8f434bd552adbb3fefe0d9be0ee5d1907642533420cd5d7fda9bcf6ad1856de` |
| FORK | AAPL pool: 3% push, buy 11 of 1,000 USDG | 96498227 | `0x408d1d2aba4d344648e2cda2356f531af2689c99a37d45164cf88a609d99e46d` |
| FORK | AAPL pool: 3% push, buy 12 of 1,000 USDG | 96498228 | `0x7e9460ab2a8b3ed985dfac574ca469c6a3372f50a0137d93310ffc41804ab28c` |
| FORK | AAPL pool: 3% push, buy 13 of 1,000 USDG | 96498229 | `0x748b7815e6cd1713615b423eb9838ebf06583dd313652adfe9498ace367a58a4` |
| FORK | AAPL pool: 3% push, buy 14 of 1,000 USDG | 96498230 | `0x2f49b9b545f56ef8d5b8e2b66a39f4ca019dd23497ca7f6537bbbf9b7ee3aad3` |
| FORK | AAPL pool: 3% push, buy 15 of 1,000 USDG | 96498231 | `0x8ca9c9d83a940d5f292f8c7551f201e63e90857580c0394fd3c6d300e4557c47` |
| FORK | AAPL pool: 3% push, buy 16 of 1,000 USDG | 96498232 | `0x05087ae0cdc2f2f91139d3fb388b31001d91baf50c5f526449fdff6f3d791d72` |
| FORK | AAPL pool: 3% push, buy 17 of 1,000 USDG | 96498233 | `0x53a282bb0dcc2fc29517a077e19e0cd5befafcfc29a21cef03a1248b4e785536` |
| FORK | AAPL pool: 3% push, buy 18 of 1,000 USDG | 96498234 | `0x7536e3529251b1fd1527d9918561ca468547d7d29edc3da7db33c45b0fbdc074` |
| FORK | AAPL pool: 3% push, buy 19 of 1,000 USDG | 96498235 | `0x69880c6a31e4774cf6521effc1bdfdc0383f09ddbda6920cd05e9c8e2bf56786` |
| FORK | AAPL pool: 3% push, buy 20 of 1,000 USDG | 96498236 | `0xcb2b96cc52dfe7c4a0cd897305d4a91ace5f0e4856c8d5f424a2b3af448fd721` |
| FORK | AAPL pool: 3% push, buy 21 of 1,000 USDG | 96498237 | `0x1074774ef2e34c4fd6b7dbb62d23651a03bdbefad9cf074b10b40fbcb6aef232` |
| FORK | AAPL pool: 3% push, buy 22 of 1,000 USDG | 96498238 | `0xffe4b30fedfdc7b9324fa385a90cd78f8f59eced1068781c562d6b295b6d7ca3` |
| FORK | AAPL pool: 3% push, buy 23 of 1,000 USDG | 96498239 | `0xd5dc398a14fdc015d0763b7d19fed7b9548a1723195eb472d49d4b9e4e80506b` |
| FORK | AAPL pool: 3% push, buy 24 of 1,000 USDG | 96498240 | `0x263ca295461e7486fc97869b050cb4e920c20472fb50e1d364f898c8050e38a2` |
| FORK | AAPL pool: 3% push, buy 25 of 1,000 USDG | 96498241 | `0xc74e298a36e29dfd4079eb8e93844a42d934d784b529c104e6beea20fc0c9337` |
| FORK | AAPL pool: 3% push, buy 26 of 1,000 USDG | 96498242 | `0x46bf42d836ed935109895e849996cb2933ffb07c5a9f0abeea1ec07a99094d5d` |
| FORK | AAPL pool: 3% push, buy 27 of 1,000 USDG | 96498243 | `0x7bb235cc128b5fbc21e22339cd7f11d21077ef84074fd16d1ba2752a2ea94ca6` |
| FORK | AAPL pool: 3% push, buy 28 of 1,000 USDG | 96498244 | `0x954dcc544f66ff7a2a6ff00f9c76fe2a6ea7ca90cc66d3f6fb45c25d6de6f752` |
| FORK | AAPL pool: 3% push, buy 29 of 1,000 USDG | 96498245 | `0x392bdcdf89a6f5a16825eba28d5975687f14a848c951fbd7e069cdec875cd7f1` |
| FORK | AAPL pool: 3% push, buy 30 of 1,000 USDG | 96498246 | `0x10f6bd1a33083af4290e7c48c014a80d45728119d71b5ae487b783aa4e5441a3` |
| FORK | AAPL pool: 3% push, buy 31 of 1,000 USDG | 96498247 | `0xf8deca3e94f34bfcd41a61760126ae430ccbfb7008eda76215f79d34e0c22813` |
| FORK | AAPL: user approve (stale-feed deposit attempt) | 96498248 | `0x2e99ee36fb9b19517eef9d1635bc588b34a7859d5298be9e25468af1b10c9d48` |
| FORK | USDG: user approve to the router (stale-feed zap attempt) | 96498249 | `0x17ba14f5a6af6dad1aab244f06322571c15873d6c8846d23ddbd8228b02c3e98` |
| FORK | AAPL: deposit on a stale feed (reverts) | 96498251 | `0x7a4d0b287c1927c20ec15651d2671d05694e3c272b65214a6038c0dcd950dd75` |
| FORK | AAPL: redeemInKind on a stale feed | 96498252 | `0xd6188601b09fa9646efde77acf4d48b4c01c2198dcc9c1203ce84fed2ba7474a` |
| FORK | USDG: liquidator approve to Morpho | 96498253 | `0x819a7ad7190b95490a98084d22b4cb17514dd912d8666a0e4cafcf490bf99355` |
| FORK | deploy: SettableFeed (the code anvil_setCode copies over the AAPL feed) | 96498254 | `0x8f3dea623f8c66ba18e00d0b3d32acbd68782f19ab82405ed7ee5f1b035670b1` |
| FORK | Morpho: accrueInterest | 96498256 | `0x1f42c57622cab0bc4d2844274f7f0701dd0257f1e6b2672af6e4fc5c27885bf0` |
| FORK | Morpho: liquidate half of the AAPL-share collateral | 96498257 | `0xa7a497bdb029ccb50b1cacb6f350ce12599cec159d3211f4d436548378656376` |
| FORK | AAPL: liquidator exits the seized shares with redeemInKind | 96498258 | `0x6648a90fce3713e52ddca150207062439641e80be597301e883ea4123bf0c689` |

What the run measured:

```
  info: forked at block 96498157; factory 0x82Ab68099eed0b1276bcacdBbf31B3Cc7563960A router 0xb2377aAE57F2072F52FBc38696BE573af2ce5bd9 AAPL vault 0xb6A7A3368d7d6f65995791853Ef5d4Ff12673d1A PLTR vault 0xdFb02E146c23E4664d27AC4024d8531384B2Ab3D
PASS 10-deploy-factory-router-and-two-vaults
  info: at the fork AAPL spot is 14 bp (sell side) from Chainlink and PLTR 65 bp (buy side)
  info: v3 pool walked onto the feed in 2 trades (236.925 USD per bp)
  info: v4 pool walked onto the feed in 2 trades (494.1 USD per bp)
  info: after the rebalance AAPL spot is 4 bp from Chainlink, PLTR 1 bp
PASS 11-seed-and-rebalance
PASS 12-user-deposits-pltr-v4
  info: createOracle for a non-vault answered: 0xecbf070c
  info: AAPL share: oracle price 347854099397619177811 (1e36 scale) = 347854099.3976192 USDG raw per whole share; vault NAV at Chainlink 347914145
  info: PLTR share: oracle price 199832227376241500978 (1e36 scale) = 199832227.3762415 USDG raw per whole share; vault NAV at Chainlink 199832234
PASS 13-share-oracles
  info: market 0x4f92018355f597f85c1064fd9ee12619d91ee92d4202e500bdf8fec6f1915641, LLTV 6250 bp (ceiling 9432 bp)
PASS 14-morpho-market
PASS 15-lender-supplies-usdg
  info: 11.7 AAPL deposited, 11562842129748301237474072 share units posted, 2388.170582 USDG borrowed against a limit of 2513.863771 at LLTV 6250 bp
PASS 16-borrower-earn-and-borrow
  info: market oracle (0x83e9b3C88656A59BFF25287a6Fd5769DE2b92638) moved 35963 USDG raw on a vault of 4507326707 (bound: +15500000 of fee income, -901465 of rounding and TWAP drift); the spot-reading control moved 134652964 (299 bp)
PASS 17-pool-push-oracle-holds
PASS 18-stale-feed
  info: share price fell 1182 bp on a 1200 bp feed drop; debt 2388196104 against collateral worth 3558916463 at LLTV 6250 bp (LTV 6710 bp after the drop, 5918 bp when borrowed; liquidation threshold 6250 bp)
  info: repaid 1579.269182 USDG, seized shares exit for 1793.957139 USDG at the new Chainlink price (1359 bp over the repayment)
PASS 19-feed-drop-and-liquidation
PASS 20-feed-older-than-97h
```
<!-- fork-demo-txs:end -->
