# Token marks

Every token renders on one tile (`components/token-logo.tsx`): a light rounded square, the mark centred at 68% of the tile. Marks are logomarks, never wordmarks, cropped to their own bounding box and fitted into a transparent 192px square. A company with no symbol mark gets its ticker as a monogram on the same tile; `lib/token-marks.ts` lists which symbols ship a file and `lib/token-marks.test.ts` fails if the list and the folder disagree. Fetched 2026-10-24.

| Token | Mark | Source |
|---|---|---|
| AAPL | Apple logo | Wikimedia Commons `File:Apple_logo_black.svg` |
| AMD | the arrow, cropped from the AMD logo | Wikimedia Commons `File:AMD_Logo.svg` |
| AMZN | Amazon "a" with smile | Wikimedia Commons `File:Amazon_icon.svg` |
| CRCL | Circle mark | circle.com's own apple-touch-icon: https://cdn.prod.website-files.com/668c08d1b8a9330bd1d786ad/669a20df8ac2810a6dd50e67_favicon-256.svg |
| GOOGL | Google "G", the Alphabet group's mark (Alphabet itself has only a wordmark) | Wikimedia Commons `File:Google_"G"_logo.svg` |
| META | Meta infinity mark | Wikimedia Commons `File:Meta_Platforms_Inc._logo_(cropped).svg` |
| MU | Micron "m" | micron.com's own icon: https://www.micron.com/content/dam/micron/global/favicon/apple-icon-180x180.png |
| NVDA | the eye, cropped from the NVIDIA logo | Wikimedia Commons `File:NVIDIA_logo.svg` |
| PLTR | the ring mark, cropped from the Palantir logo | Wikimedia Commons `File:Palantir_Technologies_logo.svg` |
| TSLA | Tesla "T" | Wikimedia Commons `File:Tesla_T_symbol.svg` |
| USDG | Global Dollar token icon | `icon_url` in Blockscout's metadata for USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`: https://assets.coingecko.com/coins/images/51281/large/GDN_USDG_Token_200x200.png?1730484111 |

GME, INTC, MSTR, QQQ, SPCX, SPY and USO draw a monogram. Intel and GameStop publish only wordmarks, and the ETFs, MSTR and SPCX have no official symbol file that serves a clean vector. Robinhood's own token metadata (`GET https://api.robinhood.com/rhj/assets`, `logoUrl`) returns one shared Robinhood feather for all 17 Stock Tokens, so it does not identify the stock.

Monograms are the full ticker from 36px up and its first two letters below that, set in Hanken Grotesk 600 in canvas ink on the tile.
