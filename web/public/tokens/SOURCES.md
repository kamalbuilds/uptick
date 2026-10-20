# Token icons

Each file is the token's own published icon, fetched on 2026-10-20 from the URL below. No file was redrawn or recoloured.

## Stock Tokens (17)

Source: Robinhood's public asset API, `GET https://api.robinhood.com/rhj/assets` (documented at https://docs.robinhood.com/chain/stock-token-apis/). Each asset's `logoUrl` is the "Public CDN logo, derived from the representative deployment's address (lowercased)": `https://cdn.robinhood.com/ncw_assets/logos/<address>.png`. Blockscout (`GET https://robinhoodchain.blockscout.com/api/v2/tokens/<address>`) returns the same URL as `icon_url`. The address is the Stock Token on Robinhood Chain 4663 from `web/lib/vault-universe.json`.

Robinhood publishes one icon for every Stock Token, so the 17 files are byte-identical (md5 7458db13b24a41c319027376a852b0f0). The vault list tells the rows apart by ticker. If Robinhood ships a per-company icon, replacing a file here changes that row with no code change.

| Symbol | URL |
|---|---|
| AAPL | https://cdn.robinhood.com/ncw_assets/logos/0xaf3d76f1834a1d425780943c99ea8a608f8a93f9.png |
| AMD | https://cdn.robinhood.com/ncw_assets/logos/0x86923f96303d656e4aa86d9d42d1e57ad2023fdc.png |
| AMZN | https://cdn.robinhood.com/ncw_assets/logos/0x12f190a9f9d7d37a250758b26824b97ce941bf54.png |
| CRCL | https://cdn.robinhood.com/ncw_assets/logos/0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5.png |
| GME | https://cdn.robinhood.com/ncw_assets/logos/0x1b0e319c6a659f002271b69db8a7df2f911c153e.png |
| GOOGL | https://cdn.robinhood.com/ncw_assets/logos/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3.png |
| INTC | https://cdn.robinhood.com/ncw_assets/logos/0xc72b96e0e48ecd4dc75e1e45396e26300bc39681.png |
| META | https://cdn.robinhood.com/ncw_assets/logos/0xc0d6457c16cc70d6790dd43521c899c87ce02f35.png |
| MSTR | https://cdn.robinhood.com/ncw_assets/logos/0xec262a75e413fafd0df80480274532c79d42da09.png |
| MU | https://cdn.robinhood.com/ncw_assets/logos/0xff080c8ce2e5feadaca0da81314ae59d232d4afd.png |
| NVDA | https://cdn.robinhood.com/ncw_assets/logos/0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec.png |
| PLTR | https://cdn.robinhood.com/ncw_assets/logos/0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a.png |
| QQQ | https://cdn.robinhood.com/ncw_assets/logos/0xd5f3879160bc7c32ebb4dc785f8a4f505888de68.png |
| SPCX | https://cdn.robinhood.com/ncw_assets/logos/0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea.png |
| SPY | https://cdn.robinhood.com/ncw_assets/logos/0x117cc2133c37b721f49de2a7a74833232b3b4c0c.png |
| TSLA | https://cdn.robinhood.com/ncw_assets/logos/0x322f0929c4625ed5bad873c95208d54e1c003b2d.png |
| USO | https://cdn.robinhood.com/ncw_assets/logos/0xa30fa36db767ad9ed3f7a60fc79526fb4d56d344.png |

## USDG

Source: the `icon_url` in Blockscout's token metadata for USDG (Global Dollar) `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`: https://assets.coingecko.com/coins/images/51281/standard/GDN_USDG_Token_200x200.png?1730484111 (64x64).

## Fallback

`components/token-logo.tsx` swaps a missing or undecodable file for a monogram chip of the ticker's first two letters.
