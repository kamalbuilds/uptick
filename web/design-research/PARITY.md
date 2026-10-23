# Parity table: vault list and deposit screen (2026-10-20)

One row per interactive element or information unit a direct competitor shows on the equivalent screen. Z Zona Lend, H HedgeHood (Stock Yield list and vault page), S Saffron (explore), A AutoRange (dashboard and create), K Kamino (Liquidity), M Morpho (not readable, behind a Terms of Use and sanctions attestation only the user can accept). Y means shown. Last column is Uptick: have, build (shipped in this pass), or skip with the reason.

| Unit | Z | H | S | A | K | M | Uptick |
|---|---|---|---|---|---|---|---|
| Summary metrics row (3 or more facts) | Y | Y | - | Y | Y | | build: 4 real facts on /vaults and home |
| Metric names its window and origin | - | Y | - | Y | - | | build: each figure carries window and source |
| Token logo per row | Y | Y | Y | - | Y | | build |
| Pair logo on vault identity | - | Y | Y | - | Y | | build: header and panel |
| Live price per asset in row | Y | Y | - | Y | - | | build: Chainlink, 30 s |
| Bottom live price ticker | Y | - | - | - | - | | build: reduced-motion static |
| Live dot or "updated" stamp | - | - | - | Y | - | | build: "Chainlink, Ns ago" in ticker |
| Row select loads a panel | Y | - | - | - | - | | build on /vaults at 1024px and up; below that rows open the vault page |
| Chevron or Open button to detail page | Y | Y | - | - | - | | build |
| Docked panel tabs Supply / Withdraw | Y | - | - | - | - | | have: Deposit / Withdraw, now also in the side panel |
| Borrow / Repay tabs | Y | - | - | - | - | | have: Earn and borrow on the vault page, one confirmation deposits, posts the shares and borrows USDG against them |
| Amount input with token selector | Y | Y | - | - | - | | have: stock / USDG switch |
| Amount in USD under the input | Y | - | - | - | - | | build |
| Wallet balance line | Y | Y | - | - | - | | have |
| 25/50/75/Max chips | Y | Y | - | - | - | | build |
| Yield or APY row in the panel | Y | Y | - | - | - | | have: worst-half rate row |
| Health factor row | Y | - | - | - | - | | have: health factor and the stock-terms liquidation price in an outlined risk box beside the borrow slider |
| Primary Connect Wallet button | Y | Y | Y | Y | Y | | have |
| "Trade stock tokens" card | Y | - | - | - | - | | skip: USDG pay-with swaps inside the deposit, so the user does not leave |
| Isolated tag | Y | - | - | - | - | | skip: every vault is its own contract, nothing is pooled |
| Definition tooltips on domain words | Y | Y | - | - | Y | | build: Kept, Worst half, Open, Reduced, Closed |
| State filter pills with counts | - | Y | - | Y | Y | | build: "Taking deposits 7" and "Closed 10" group headings with counts |
| Closed items collapsed | - | - | - | - | - | | build (Uptick's own framing) |
| Status chip | Y | Y | Y | Y | Y | | have |
| Search | - | Y | Y | - | Y | | have |
| Search shortcut hint | - | Y | - | - | - | | build: "/" focuses search |
| Fee tier or category filter chips | - | Y | Y | - | Y | | have: fee tier chips |
| Sort carets on columns | - | - | Y | - | Y | | skip: the order is the argument, best kept first |
| Featured cards by APY | - | - | Y | - | Y | | skip: would lead with the gross number Uptick corrects |
| Size or capacity column | - | Y | Y | - | - | | build: vault size in the panel; cap-filled ring skipped until vaults are on mainnet |
| TVL | Y | Y | Y | Y | Y | | skip: no vault on mainnet, so any figure would be invented |
| Fees generated headline | - | - | - | - | Y | | build: LP fees paid on these pools, 30 days, from the replay |
| Basis caption under yield ("backtest") | - | Y | - | - | Y | | have: "weaker half", "30d" labels, now with tooltips |
| Contract address with copy | - | Y | - | - | - | | have on the vault page |
| Help links beside the form | - | Y | - | - | - | | build: How vaults work, Exit in kind |
| List / details view toggle | - | Y | Y | - | - | | skip: the vault page is the details view |
| Left sidebar nav | - | Y | - | - | - | | skip: four top-level routes fit the header |
| Network tabs | - | - | - | Y | - | | skip: one chain |
| Request-a-pair banner | - | - | Y | - | - | | skip: the universe is every eligible Stock Token, no request needed |
| Next recentre / epoch schedule | - | Y | - | - | - | | build: fact row "Recentres 02:00 UTC after each NYSE session" |
| Mobile: stacked cards with a primary button per card | Y | - | - | - | - | | skip: rows open the vault page, which docks the same deposit bar |

## Checked against the build (2026-10-20)

Screens: design-research/build2/f-vaults-1440.png, f-vaults-390.png, f-home-1440.png, f-home-390.png, f-vault-nvda-1440.png, f-vault-nvda-390.png (wallet button masked before capture). Every "build" row above is visible in those screens or was exercised in the browser: row click moved the panel from AAPL to GOOGL, the Kept tooltip opened on keyboard focus and closed on Escape, a broken token image became a monogram chip, and under prefers-reduced-motion the ticker animation is none with the duplicate list hidden and the strip scrolling by hand. Not exercised: the 25/50/75/Max fill against a real balance (needs a funded wallet; the share arithmetic is covered by lib/format.test.ts).
