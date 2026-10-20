# Token icons

Company marks identify which stock each Stock Token tracks, the way robinhood.com shows them in its related-stock lists (`logo_url` on robinhood.com/us/en/stocks/<SYMBOL>/ points at Wikimedia Commons). Each file is the source image unchanged, placed centred on a light circular tile so dark and wide marks stay legible on the dark UI. Fetched 2026-10-20.

| Token | Source | URL |
|---|---|---|
| AAPL | Wikimedia Commons, the same file robinhood.com's `logo_url` references for this ticker | https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fa/Apple_logo_black.svg/250px-Apple_logo_black.svg.png |
| AMD | Wikimedia Commons, the same file robinhood.com's `logo_url` references for this ticker | https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7c/AMD_Logo.svg/250px-AMD_Logo.svg.png |
| AMZN | Wikimedia Commons, the same file robinhood.com's `logo_url` references for this ticker | https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a9/Amazon_logo.svg/250px-Amazon_logo.svg.png |
| GME | Wikimedia Commons, the same file robinhood.com's `logo_url` references for this ticker | https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f9/GameStop_Logo_%282000%E2%80%932012%29.svg/250px-GameStop_Logo_%282000%E2%80%932012%29.svg.png |
| GOOGL | Wikimedia Commons, the same file robinhood.com's `logo_url` references for this ticker | https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7a/Alphabet_Inc_Logo_2015.svg/250px-Alphabet_Inc_Logo_2015.svg.png |
| INTC | Wikimedia Commons, the same file robinhood.com's `logo_url` references for this ticker | https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7d/Intel_logo_%282006-2020%29.svg/250px-Intel_logo_%282006-2020%29.svg.png |
| PLTR | Wikimedia Commons, the same file robinhood.com's `logo_url` references for this ticker | https://thumb.wikimedia.org/wikipedia/commons/thumb/1/13/Palantir_Technologies_logo.svg/250px-Palantir_Technologies_logo.svg.png |
| TSLA | Wikimedia Commons, the same file robinhood.com's `logo_url` references for this ticker | https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bd/Tesla_Motors.svg/250px-Tesla_Motors.svg.png |
| NVDA | Wikimedia Commons `File:Nvidia_logo.svg` (robinhood.com references an en.wikipedia NVIDIA file that no longer serves a thumbnail) | https://thumb.wikimedia.org/wikipedia/commons/thumb/2/21/Nvidia_logo.svg/250px-Nvidia_logo.svg.png |
| META | Meta's own site icon | https://www.meta.com/apple-touch-icon.png |
| MU | Micron's own site icon | https://www.micron.com/content/dam/micron/global/favicon/apple-icon-57x57.png |

CRCL, MSTR, QQQ, SPY, USO and SPCX have no file: robinhood.com shows no mark for them (MSTR's only Commons mark predates the rename to Strategy), so the app draws a ticker monogram.

Robinhood's own token metadata (`GET https://api.robinhood.com/rhj/assets`, `logoUrl`) returns one shared Robinhood feather for all 17 Stock Tokens, so it does not identify the stock.

## USDG

Source: the `icon_url` in Blockscout's token metadata for USDG (Global Dollar) `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`: https://assets.coingecko.com/coins/images/51281/standard/GDN_USDG_Token_200x200.png?1730484111 (64x64).

## Fallback

`components/token-logo.tsx` swaps a missing or undecodable file for a monogram chip of the ticker's first two letters.
