# Uptick design research (2026-10-20)

Capture tool: `~/.agents/skills/ui-craft/scripts/refshot.py`. It is not Playwright: it opens a background tab in the bhn `deepsurge` Brave profile (port 9396) over CDP `Target.createTarget background:true`, waits for load, network quiet and `document.fonts.ready`, writes the PNG and a `.tokens.json` of computed styles beside it. Px values below come from those tokens files or are read off the 1440 PNG and marked "PNG".

Vault page job: decide whether to deposit. What do I keep, what is the risk, is it open. Home job: see which of my stock tokens can earn, and how much I keep.

North star is Robinhood production UI. Entries 1 to 3 are Robinhood product screens.

## 1. Robinhood stock detail, NVDA (product screen, north star)

Screens: refs/rh-nvda-stock-1440.png, refs/rh-nvda-stock-390.png (both carry the region modal for Stock Tokens, the page behind it is the real product layout).
Black canvas (`rgb(0,0,0)`), white text, no cards on the left: a 1038px content column (x 24 to 1062 in the PNG) of bare content separated by 1px full-width hairlines. h1 "NVIDIA" Capsule Sans Display 32px / 500 / tracking -0.33px / leading 40px. Price sits directly under the name in the same column, then change and session ("Overnight") in 13px muted. Range tabs (1D 1W 1M 3M YTD 1Y 5Y ALL) are 16px text with a 2px underline on the active one, padding-bottom 16px. The only boxed element is the sticky order ticket: 330px wide (x 1086 to 1416), 1px border, radius about 4px, rows "Market Price / Commissions / Estimated Cost" as label left, value right at 13px.
Steal: one column of facts separated by hairlines, the action in a single sticky ticket that itself lists cost lines as label/value rows, section titles as plain 24px bold text with a rule under. Calm because nothing is boxed except the thing you act on.
Do not take: the orange-red accent on a dark button (it is asset-class coded), and the geo-block modal.

## 2. Robinhood crypto detail, ETH (product screen, north star)

Screens: refs/rh-crypto-eth.png (1440 first screen), refs/rh-crypto-eth-full-1440.png (full page), refs/rh-crypto-eth-390.png.
Same skeleton as the stock page, with the full page showing the long tail: "What is Ethereum?" 24px section title, then "Key Statistics" as a four-column row of label (13px, `rgb(145,159,166)`) over value, then prediction-market tiles, news rows, a disclaimer box with a 1px border. Tokens: h1 Capsule Sans Display 32px / 500; body copy 15px / 24px leading / -0.1px tracking; p secondary 13px / 19.89px leading / `rgb(145,159,166)`. Buy ticket: 330px, 1px border, primary button 44px tall full width, radius about 22px (pill), orange `#ec5e2a` family fill.
Steal: Key Statistics as bare label-over-value pairs with no box, a disclaimer as a single outlined row at the end of the decision area, the order ticket whose primary button is the only filled shape on the screen.
Do not take: the 300-link crypto tag cloud and the prediction-market tile grid.

## 3. Robinhood Chain and Gold (brand voice for the same company)

Screens: refs/rh-chain-1440.png, refs/rh-chain-390.png, refs/rh-gold.png.
Where Robinhood speaks as a brand it switches face: h1 "Finance, onchain" Martina Plantijn 72px / 400 / tracking -1px / leading 78px, white on black; Gold h1 Martina Plantijn 100px / 400 / tracking -0.5px / leading 100px on a pale canvas with ink `rgb(17,14,8)`. Sub-heads are Phonic 31 to 32px / 400 / tracking -0.25 to -1px. Pill buttons are lime `rgb(204,255,0)` with ink `rgb(17,14,8)` text, radius 36px, padding 0 32px, 13px label. Nav is 64px tall with a 1px bottom rule.
Steal: a serif display face used once per screen for the one sentence that matters, paired with a quiet grotesk; roman never italic; negative tracking on display only.
Do not take: the lime pill (this is exactly what the current site copied, via Wise), the 3D chrome hero art, the centered stack.

## 4. Uniswap pool page, ETH/USDC v3 0.05%

Screens: refs/uni-pool.png, refs/uni-pool-390.png.
The nearest product to Uptick: a v3 pool position page. Basel 16px / 485 weight on `rgb(19,19,19)` canvas (html `rgb(0,0,0)`). Header row: pair name 24px / 28px leading, then small badges "v3" and "0.05%" and a truncated address `0x88e6...5640` in 13px. Under it, left a chart with its own tab strip (Price, Volume, Liquidity, Depth) as 16px text tabs, right a 360px "Stats" panel (x 920 to 1280 in the PNG) on a 24px-radius `rgb(34,34,34)` surface. Inside the panel, label (16px muted) over value (about 40px Basel) with a small delta triangle: Total APR 5.76%, TVL $81.8M, 24H volume, 24H fees. Two 46px action buttons above the panel, "Swap" and "Add liquidity", tinted pink at low alpha, not solid.
Steal: pool identity as pair + tier + address in one quiet line, label-over-value stat stack, an action pair that is tinted not solid, tabs for the chart modes.
Do not take: the hot pink, the bar chart as hero, a stat stack where every value is 40px (reads as the big-metric template).

## 5. Aave reserve overview, USDC

Screens: refs/aave-market.png, refs/aave-market-390.png.
Lending risk done calmly. Inter Variable 14px body on `rgb(16,15,15)`. Title row: asset icon 56px, h2 30px / 500 / 36px leading, and to the right four header stats (Reserve size, Available liquidity, Utilization rate, Oracle price) each label 14px muted over a value of about 24px / 500. Below, a 810px-wide panel (x 99 to 909) titled "Reserve status & configuration" 18px / 500, with a two-column inner grid: section label left at 14px / 500, content right. Risk parameters are three outlined boxes (Max LTV 75.00%, Liquidation threshold 78.00%, Liquidation penalty 4.50%), each with 1px border, radius 4px, 14px text, an info glyph on the label. A circular gauge shows 79.60% supplied. Right column "Your info" panel (x 923 to 1341) with a single Connect Wallet button.
Steal: risk parameters presented as small outlined label/value boxes on one row, a title row that carries 4 header stats without making any one of them a hero, a personal panel to the right that says plainly what is needed to see your own numbers.
Do not take: Inter, the spiky APR chart, the privacy toast.

## 6. Hyperliquid vault detail, HLP

Screens: refs/hl-vault-hlp.png (detail, populated), refs/hl-vaults.png (list, rows still loading at capture, so only layout is used).
Zoned density for a vault: breadcrumb, h1 "Hyperliquidity Provider (HLP)" about 40px, address `0xdfc2...f303` with a copy glyph, Withdraw and Deposit as two outlined 8px-radius buttons top right. Four stat tiles in one row, each about 322px wide (x 64 to 1376 over 4), with a 16px label over a 32px value; "Past Month Return 4% APR" has a green value and a small APR chip. Below, a two-pane row: About/Vault Performance/Your Performance tabs on the left, PNL step chart on the right, then a full-width tabbed table (Balances, Positions (177), Open Orders...) with 12px type, right-aligned numerals, green and red PNL values with ROE in parentheses. Body font "OurFont" 12px to 16px on `rgb(4,37,31)` with a topographic line texture.
Steal: the four-tile row where "Your Deposits" and "All-time Earned" sit next to TVL and return so personal and global numbers share one grammar; "return" labelled by period ("Past Month Return"), never bare; the table's honest parentheses.
Do not take: the teal-on-green atmosphere, 12px base type, the announcement toast.

## 7. Kamino Liquidity vaults

Screens: refs/kamino-liq.png.
Automated concentrated-liquidity vaults listed as rows, the closest comparable list to Uptick's home. IBM Plex Sans 14px / 500 on `rgb(9,19,38)`. A promo modal covers the page at capture; the rows behind it show the structure: pair icons (two overlapping 24px circles) + name left, then right-aligned columns APY, volume (24h), TVL, then a 6px-radius "Deposit" button (`rgb(33,44,66)` fill, padding 9px 15px). Rows are about 58px tall with 1px separators; a lightning glyph marks boosted APY, a green `rgb(48,214,154)` marks verified.
Steal: a vault list as dense, evenly pitched rows (58px), pair identity left, numbers right, one quiet button per row; a "Formally Verified" style trust marker in plain text.
Do not take: navy glassy canvas, promo modal, APY shown alone with no loss figure (it is the gross-number problem Uptick exists to fix).

## 8. Arrakis documentation (Arrakis Pro)

Screens: refs/arrakis-docs.png.
How the closest competitor explains managed concentrated liquidity. DM Sans: h1 36px / 600 / tracking -0.9px / leading 40px in `rgb(230,227,222)` on near-black; body 16px / 24px leading in white; side nav 14px / 600 section labels over 14px links with 37px pitch; a 12px-radius search field `rgb(24,21,20)` with a keyboard hint; an orange "Launch App" button. Three-column layout: 260px nav, a 690px reading column (x 363 to 1052), and a right "On this page" rail. The text states the cost plainly: "leak value to arbitrageurs and active LPs".
Steal: a 690px reading column for the explanation, a right-rail table of contents, one warm accent used for a single button and the active TOC item, the candour about what LPs lose.
Do not take: the docs-only chrome for the vault page; the wall of body paragraphs without any numbers.

## 9. Kraken xStocks landing

Screens: refs/kraken-xstocks-1440.png.
The tokenized-stock consumer pitch Uptick's holders already know. h1 Kraken-Brand 48px / 700 / tracking -1px / leading 56px, `rgb(241,239,255)` on a 1408px-wide rounded `rgb(19,17,26)` panel (radius about 24px) inset 16px from the viewport; body 20px / 28px; the nav is 64px, 14px, on `rgb(246,245,249)`. One purple pill button, 52px tall. Content after the hero (seen in the full page) is "What are tokenized equities?" 20px / 700 h3 sections.
Steal: a hero panel inset from the viewport with its own radius so the page margin frames it; plain explanatory h3 questions in the user's vocabulary ("What are tokenized equities?"); one sentence of claim.
Do not take: 3D chrome tiles, purple.

## 10. Coinbase asset price page, ETH

Screens: refs/coinbase-eth.png.
Consumer-calm asset page on white. h1 CoinbaseDisplay 28px / 600 / 36px leading with a 40px asset mark; the price is the big element at about 40px with a green delta chip beside it; range tabs 14px / 600 in a row with the active one as a 40px-high pill. Left 360px rail (x 0 to 360) holds "About Ethereum" 28px, a 16px / 24px description, 2 outlined link chips and a full-width blue "Buy Ethereum" 56px-tall pill. Below the chart, a three-column band: Trading Insights, Market Stats, Performance, each a 24px / 600 title over dotted-underline labels (13px / 600 `rgb(91,97,110)`, uppercase) and values; dotted underlines signal a glossary tooltip.
Steal: dotted-underline labels that open a plain-language definition (glossing every domain term the first time), a rail that separates "about" from "act", three labelled bands for stats instead of one grid.
Do not take: the yellow "Keep exploring" card, AI "Happening now" block, white canvas (Uptick holders arrive from Robinhood's black).

## Round 2: competitors on Robinhood Chain (2026-10-20)

Captured with refshot in the deepsurge profile, background tabs. No wallet address was shown on any page. Screens are in refs/.

## 11. Zona Lend (app.zona.finance/lend), the user's reference

Screens: refs/zona-lend-1440.png, refs/zona-lend-390.png (+ .tokens.json).
Proxima Nova Zona 16px on `rgb(8,8,8)` with a faint green star-field. Header 64px, logo + Lend / Portfolio / Trade / More left, wallet icon and a lime-green "Connect Wallet" pill right. Summary row sits on the canvas with no boxes: three label-over-value pairs ("Total Market $38.63K", "Available liquidity $33.12K", "Total Borrowed $5.51K"), label 14px `rgb(175,175,175)`, value about 28px / 700 white, at x 80 to 532. The asset table is x 80 to 957 (877px) with a 1px `rgb(51,51,51)` border, header row 50px (y 203 to 253), then rows on a 63px pitch (y 253, 316, 379, 442 ...). Row: 36px token disc, ticker 16px, an "Isolated" outlined tag 12px (radius about 4px), total supply as amount over USD (14px / 12px muted), supply rate as a dotted-underlined value with a star glyph ("Collateral only"), and a 36px outlined chevron button at x 891 to 933. The action panel is x 990 to 1359 (369px), radius 12px, border `rgb(51,51,51)`, padding 25px: four tabs Supply / Withdraw / Borrow / Repay (active tab filled `rgb(118,245,149)`, others outlined, 38px tall), an amount well `rgb(22,24,26)` with a 24px / 700 number, USD under it and a token selector right, "Wallet Balance" line, a row of four 74x30 chips 25% / 50% / 75% / Max (disabled until a wallet connects), "Supply APY", a "Health Factor" outlined row with a heart glyph, a full-width 44px green primary, and under the panel a separate 369x70 card "Trade stock tokens, Powered by Uniswap". The bottom edge carries a 44px ticker strip (y 856 to 900) on `rgb(21,21,23)` with logo, ticker, price pairs scrolling left. At 390px the same table becomes stacked cards (metrics row first, then one card per asset with Supply and Borrow buttons 40px tall) and the panel disappears.
Steal: bare metrics row, the table plus docked panel split (877 / 369), chips under the amount, the ticker strip, a chevron button that navigates while the row itself selects, dotted-underline values that carry a definition.
Do not take: the neon-green fill, the star-field, hosted company marks (Zona serves its own aapl.svg, nvda.svg), borrow and health factor (Uptick has no debt), the second "trade" card.

## 12. HedgeHood Stock Yield list (hedgehood.app/stockyield)

Screens: refs/hh-stockyield-1440.png, refs/hh-loan-1440.png, refs/hedgehood-home-1440.png.
Geist 16px on `rgb(15,15,16)`; a 247px left sidebar (Markets / Earn / Apps groups, 14px). h1 "Stock Yield" 34px / 400 / -1.19px / 37.4px, one 14px muted sentence under it. Top right a three-metric header separated by 1px rules: "Mainnet size $99.63K", "Strategies 9", "Top mainnet premium APY 45.8%" with the sub-note "last week's pricing . 10/14", each label carrying an info glyph. Under it filter pills with counts ("All lines 9", "v1 1", "v2 option vaults 8"), a List/Details toggle, and a search field radius 10px with a "/" key hint. The table is one big rounded container; rows 67px pitch: a 32px white rounded-square company logo, a two-line name (16px / 600 over 13px muted ticker and strategy), a line chip, premium APY in green with a "target" or "last week's pricing" note, size ($ over $ per share), a cap-filled ring with %, an epoch status, and an access word.
Steal: header metrics that name their own period and origin under the number, pill filters with counts, the "/" search shortcut, a two-line name cell.
Do not take: a figure that is a gross promise ("premium APY") as the lead, eight rows of the same logo, the left sidebar (Uptick has four top-level routes).

## 13. HedgeHood vault page (hedgehood.app/stockyield/nvda-printer)

Screens: refs/hh-nvda-printer-1440.png.
Breadcrumb "Stock Yield / NVDA Printer" at 13px, a pair chip "NVDA / USDG" top right made of two overlapped 20px token discs. A rounded header card (x 271 to 1417): small tracked caps label "WEEKLY COVERED CALL" (10px / 2px tracking), h1 27px / 500, "Curator Hedgehood", "Vault contract 0xe35B...C0a9 Copy" as a dotted-underlined short address with a copy button, premium APY in green with the caption "2026 backtest" beneath it, one plain sentence ("Hold NVDA, sell a call every week, settle every Friday. Upside is capped at the strike."), three text links (How it works, Rules & contracts, Who can touch my NVDA). Below, a centered 764px deposit card: a sentence-form header "I put [..] into the NVDA Printer, and take the income [..]", a three-step progress, a USDG / NVDA token switch, a 72px amount well with a 34px / 600 number, a chip row 10% 25% 50% 75% Max, a full-width 42px Continue. A collapsed "Details" row ends the page.
Steal: the APY caption that states its basis ("2026 backtest") right under the number, the pair chip, the contract address with copy, three plain-language help links, the token switch inside the deposit card.
Do not take: the sentence-with-blanks form, the stepper, the tracked caps label.

## 14. Saffron explore (beta.saffron.finance/network/robinhood)

Screens: refs/saffron-rh-1440.png, refs/saffron-token-1440.png, refs/saffron-home-1440.png.
Host Grotesk with Roboto Mono for every figure on pure black, a 1209px column (x 115 to 1324). "FEATURED TOKENS" 13px / 0.78px tracked caps over three 396x71 cards (token disc 34px, symbol, "$8K available", APR range right in amber mono). The table is a 1px bordered box with a purple-black texture header 53px; rows on a 59px pitch: 38px round token logo, name 16px over ticker 12px mono muted, APR range in amber, a capacity bar 120px x 3px orange with a percent, TVL in mono. Sort carets on every column, "Showing 1-7 of 7" centered under the table. The token page lists vaults as pair logos (two overlapped discs) with an ENDED status chip, APR, upfront premium, capacity, term, a grid/list toggle, a search icon and a filter icon.
Steal: the capacity bar as a 3px line with a percent beside it (a quiet to-scale bar like Uptick's keep bar), the pair logo for a vault, "Showing x of y" as the footer count.
Do not take: featured cards that rank by APR range (up to 777%), amber mono for every figure, the generic lime Robinhood feather on every stock token (Saffron shows the same icon for NVDA and PLTR).

## 15. AutoRange dashboard (autorange.xyz/dashboard)

Screens: refs/autorange-dash-1440.png, refs/autorange-create-1440.png, refs/autorange-home-1440.png.
Inter on `rgb(12,12,12)`, a 1116px column (x 162 to 1278). h1 "Dashboard" 36px / 600 / -0.9px, one 14px muted sentence ("read straight from the chain, no intermediary backend"), a network tab strip (ALL, ETHEREUM, ROBINHOOD CHAIN, BASE ...) in 11px tracked caps, a green "LIVE" dot with caps label right. Then a grid of tinted cards each with its own coloured border (pink Capital Invested $661.9k, blue Volume Moved, green Active Vaults 384, amber Rebalances 11,148), tracked caps label, 40px number, a muted breakdown by chain, a small icon tile top right. The create flow is a chip set (network, vault type, pair) then one empty card "Connect your wallet to create a vault".
Steal: the sentence that says where the numbers come from ("read straight from the chain"), a per-chain breakdown line under a number, a live dot beside a timestamp.
Do not take: the coloured stat-card grid (the stat grid DESIGN.md bans), tracked caps eyebrows, pink.

## 16. Kamino Liquidity vaults, populated list (app.kamino.finance/liquidity)

Screens: refs/kamino-liq-2-1440.png (promo modal closed first; earlier kamino-liq.png sat behind it).
IBM Plex Sans 14px on `rgb(9,19,38)`, a 1010px column (x 215 to 1225). h1 "Liquidity" 28px with one muted line, two header chips "Total Deposits $76,232,743" and "Fees Generated $42,893,730" right. Three featured cards 329x105 (pair icons, name 20px, APY 32px with a dotted underline). Filter chips (All Vaults, LP Farms, Stables, JitoSOL ...) 32px tall radius 16px plus a search field. Table rows on a 58px pitch: pair of overlapped 32px token discs and a name, then right-aligned 7D Fees APY (a lightning glyph marks boosted), 7D Volume, TVL (dotted underline), a DEX glyph, a 6px-radius Deposit button `rgb(33,44,66)` 76x30.
Steal: fees generated as a header fact, pair discs on every row, right-aligned numeric columns with period-labelled headers ("7D Fees APY").
Do not take: three featured cards on top, the navy glass canvas, APY with no loss figure.

Not captured: Morpho Steakhouse USDG (refs/morpho-vault-1440.png, refs/morpho-earn-1440.png). Both sit behind "Before you continue", a Terms of Use and sanctions attestation that only the user can accept. The blurred background shows a two-column vault page (about 960px left, 370px right ticket at x 1000 to 1350), nothing readable.

Morpho (app.morpho.org robinhood-chain steakhouse-usdg vault) was captured (refs/morpho-vault-1440.png) but sits behind a Terms-of-Use consent modal that only a signed-in user acceptance clears, so the product screen is not readable and it is not counted above. Phantom and Wealthfront captures were discarded: they landed mid-scroll on marketing.

## Negative

design-research/negative/home-1440.png, home-390.png, vault-nvda-1440.png, vault-nvda-390.png, docs-1440.png, docs-390.png: the current Uptick site. See negative/NOTES.md.
