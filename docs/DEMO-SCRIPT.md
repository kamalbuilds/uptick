# Uptick: 3 minute Founder House demo

Live app: https://uptick-fi.pages.dev. Launch film: https://x.com/uptickfi/status/2112531006792360167.

One line: deposit AAPL, GOOGL, NVDA and 14 more Stock Tokens into a vault and earn a share of every trade's fee. Uptick shows what you keep after losses to fast traders, and opens a vault only where 3,059,881 replayed swaps say it holds up.

Setup: one browser window, six tabs in order: `/`, `/vaults`, `/vault/aapl`, `/vault/nvda`, `/docs`, `/research`. No wallet is connected. The Chainlink ticker in the footer runs on every page.

## 0:00 to 0:20 Launch film

Screen: the launch film, 20 seconds.
Say: "Which of your stock tokens can actually earn? We replayed 3,059,881 Robinhood Chain swaps, ranked 17 Stock Tokens by what a liquidity provider kept, and 12 vaults launch first."

## 0:20 to 0:50 Home, `/`

Screen: the headline "Which of your stock tokens can earn, and how much you would keep."
Point at the four figures: Vaults at launch 12 (3 open, 9 reduced), Swaps replayed 3.1M over the 30 days to 2026-10-17, Fees paid to liquidity providers $1.1M on the 17 vault pools, Stock Tokens tracked 17.
Say: "Every vault sits behind one of three doors. Open takes any amount. Reduced takes up to $25,000 a deposit. Closed takes none. The door comes from the replay, not from us."
Point at the ticker: "Prices are Chainlink, read on Robinhood Chain 4663."

## 0:50 to 1:20 Vault list, `/vaults`

Screen: the table of 17 Stock Token vaults.
Say: "Kept is a year of the pool's fees less what leaks to informed traders, read in the worst half of the replay." Run down the Kept column: AAPL +2.7%, GOOGL +0.2%, QQQ -1.3%, INTC -2.0%, NVDA -6.6%. Click the 0.05% pool filter, then clear it.
Say: "NVDA's pool pays 94% a year in fees. The Fees column says so. What depositors keep is the number in the Kept column."

## 1:20 to 2:05 One vault, `/vault/aapl`

Screen: the AAPL vault, state chip Open, "Replay to 2026-10-17, 95,275 swaps".
Say: "AAPL kept +2.7% a year in its weaker half." Scroll to "Where a year of fees goes": the pool paid +18.8%, recentring costs 1.7%, informed traders take 13.9%, depositors keep +3.2% over the full 30 days.
Scroll to "Why it is open": worst half +2.7% on the first 15 days, +3.9% on the last 15, both above break-even, so the door is Open.
Scroll to "The band follows the price": a plus or minus 7.5% band around the Chainlink price, recentred at 02:00 UTC after each NYSE session.
Scroll to "Why this pool": the v3 0.05% pool pays 18.8%, the v3 0.3% pool 11.3%, the v4 0.3% pool 23.0%. Fees per $1 lost to informed traders: NYSE hours $1.23, weeknights $1.45, weekends $4.58.
Say: "The engine picks pool and band on the first half and scores them on the second. The vault is $29,268 in size, the largest the pool takes through the vault's own rebalance swap at a cost the Chainlink floor allows."

## 2:05 to 2:25 The other doors, `/vault/nvda`

Screen: NVDA vault, state chip Reduced, 814,927 swaps.
Say: "NVDA kept +29.4% on the first half and -6.6% on the held-out half. The gate reads the held-out number, so deposits cap at $25,000 each." Switch to the SPCX tab if open: "SPCX kept -199.5% in its weaker half, below the -20% floor. The door is closed."

## 2:25 to 2:45 Docs, `/docs`

Screen: the Docs overview.
Say: "A vault is one ERC-4626 contract, one managed position and one published gate." Point at the gate table and the "Vaults today" table: Open AAPL and GOOGL, Reduced the nine others, Closed six.
Open Exit in kind: "redeemInKind pays your share of both tokens with no oracle gate and no swap, so an exit works when the feed is stale." Open For agents: "An evidence API and an MCP endpoint with four tools. A closed vault returns its gate reason, so an agent never routes a deposit past the door."

## 2:45 to 3:00 Research, `/research`

Screen: three notes, newest first.
Say: "58% of the swaps and half the fees in these pools happen while the NYSE is shut. Weekends pay $2.76 in fees for every $1 lost to fast traders, NYSE hours $0.98. The replay refreshes and each vault opens or closes on its new halves. Uptick shows which of your Stock Tokens earn."

<!--
Sources, read 2026-10-21.
Sources (repo files regenerated 2026-10-22, vault list and vault pages as served by the web app from them): home figures (12 of 17, 3 open, 9 reduced, 3.1M swaps, 30 days to 2026-10-17, $1.1M fees, 17 tokens), /vaults Kept column and 0.05% filter, /vault/aapl (95,275 swaps, +18.8%, +3.2%, 1.7%, 13.9%, worst half +2.7%, last 15 days +3.9%, band 7.5%, pools 18.8% / 11.3% / 23.0%, $1.23 / $1.45 / $4.58, vault size $29,268), /vault/nvda (814,927 swaps, +29.4%, -6.6%, $25,000, fee APR 94.4%), /vault/spcx (-199.5%, floor -20%), /vault/pltr (open on its Uniswap v4 1% pool, +12.8% in the weaker half, vault size $24,207), /docs (tables, exit in kind, for agents), /research (13.64, 1.16, 22 of 23).
Launch film text: api.fxtwitter.com/uptickfi/status/2112531006792360167, posted 2026-10-20, 2,705,097 swaps, 17 tokens, 11 take deposits.
Repo files: web/lib/vault-universe.json (swap total 3,059,881 is the sum of each vault's gate.swaps), web/lib/pool-fees.json (fee total $1,054,235.96), README.md gate table, keeper/data/replay.json (PLTR rerun 2026-10-22 with the v4 session split).
-->
