# Uptick explainer: script

One sentence the viewer repeats afterwards: **Uptick checks every pool and fee tier of a Stock Token against the chain's own swap history, and deposits only where liquidity actually pays and nothing hidden is taking a cut.**

Closing line (spoken and on screen): **Stock Token yield, chosen by the chain's own data.**

Jargon budget (two terms, each defined on first use): liquidity provider, hook. One word for the limit throughout: maximum.

Art direction: `web/DESIGN.md` (Wise-inspired). Off-white `#e8ebe6`, ink `#0e0f0c`, lime `#9fe870`. Archivo 900 for display, Figtree for text, Geist Mono for figures. The same fonts the app ships. One camera moves left through every scene.

Source for every figure on screen:
- 5.1M swaps, 54 days, session table 0.78 to 1.21 / 1.23 to 3.02 / 3.83 to 19.53: `spikes/stock-vaults/FINDINGS.md` and `stock-vaults-app/README.md`
- NYSE regular session 6.5 hours (09:30 to 16:00 ET): the brief for this film
- 0.05% NVDA and SPCX pool fee tier, 0.3% TSLA: `spikes/stock-vaults/FINDINGS.md`; per-pool session numbers (NVDA 1.21/1.23/3.83, SPCX 0.78/3.02/7.07, TSLA 0.80/2.07/19.53): same file
- 80% of 84K hooks flagged malicious (0x), 5 to 11% kept while pools quote 0 to 1%: `stock-vaults-app/README.md` evidence table
- cap 250 bps vs a 3% take (300 bps), 200 of 200 revert with `TakeExceedsCap`, 0 reverted for another reason: `spikes/capped-hooks/FINDINGS.md`, `spikes/capped-hooks/evidence/claim2-enforce.txt`
- app footage: the running app at `http://localhost:3000` and `/vault/nvda`, captured over CDP (port 9396) in a background tab as real full-page screenshots; Remotion moves the camera and cursor over them

## Beats

| # | ON SCREEN | VO |
|---|---|---|
| 1 | Small "Uptick" wordmark top left for the whole film, with the subtitle "Yield on Stock Tokens". Off-white. A week ribbon, Monday to Sunday, labelled "Robinhood Stock Token". Lime floods the whole ribbon left to right, "24/7". | Robinhood's Stock Tokens, stocks on a blockchain, trade around the clock. |
| 2 | A second ribbon, "Stock price". Five small ink blocks drop onto the weekdays: "NYSE open 6.5 h". The rest of that ribbon hatches out: "no stock price". | But the stock price exists only six and a half hours a day. |
| 3 | A pool: NVDA and USDG stacks. A trader swaps lime coins in, ink coins out. | Every trade needs a pool of tokens on the other side. |
| 4 | Fee coins drip from the pool to a figure marked "LP". Label: "Liquidity provider: fills the pool, earns a fee on each trade". | Liquidity providers fill the pool, and earn a fee on each trade. |
| 5 | The real price tag jumps up on the stock-market side. A second trader buys NVDA at the pool's old price. The pool's NVDA stack shrinks, a red "LP loss" tag appears. | Their danger: a trader who knows the price just moved. |
| 6 | Counter 0 to 5.1M while swap dots stream. Source card: FINDINGS.md, "54 days, NVDA, SPCX, TSLA pools on Robinhood Chain". | We replayed five point one million real trades from the chain's own pools. |
| 7 | Week chart, bars = fees earned per $1 lost to informed traders. $1 break-even line. Weekday NYSE bars span 0.78 to 1.21 and straddle it. | While the stock market is open, a provider earns about a dollar of fees per dollar lost. |
| 8 | Weeknight bars rise to 1.23 to 3.02. Saturday and Sunday bars climb in lime: 3.83 to 19.53, tagged "stock market closed". | At night, up to three dollars. On weekends, three point eight to nineteen point five. |
| 9 | Three pool cards, NVDA 0.05%, SPCX 0.05%, TSLA 0.3%, each with its three session numbers from the FINDINGS table and a subtitle "fee tier" on the 0.05% / 0.3%. Then a frosted veil with "?" slides over the numbers: "what a holder sees: a name and a fee tier". | Pools charge different trade fees, called fee tiers, and holders cannot see which pays. |
| 10 | A cursor hops from card to card, "Guesswork". | Picking a pool by hand is guesswork. |
| 11 | A generic pool with a "hook" chip skims coins into a "hidden cut" pocket: "keeps 5 to 11% while the pool quotes 0 to 1%". Big "80%": "of 84K hooks flagged malicious (0x)". | Some pools carry hooks, small programs that can keep a hidden cut, and eighty percent of hooks are flagged malicious. |
| 12 | Lime "Uptick" pill sweeps across the cards. | Uptick does the picking. |
| 13 | A lime scan line sweeps the three cards and lifts each veil, numbers revealed. The NVDA card takes a lime border: "vault pool". | For each Stock Token, it replays every pool and fee tier, and chooses where liquidity pays. |
| 14 | The word "vault" labels the pick: "NVDA vault". A badge locks onto the NVDA card: "No fee-taking hook". Beside it: "or a maximum declared on-chain". | It only enters pools with no hidden cut, or a maximum fee declared on chain and enforced in every trade. |
| 15 | A swap puck with a "3% take" hits a gate with a "2.5% maximum" slot and bounces: `TakeExceedsCap`. Then a stream of pucks, counter to 200, real forge output lines beside it. "mainnet fork". | We sent two hundred trades over the maximum, on a copy of the real chain. |
| 16 | Counter lands: "200 of 200 rejected. 0 for any other reason." | All two hundred were rejected. |
| 17 | Real app footage: home hero "Hold NVDA. Collect the fees.", the pointer clicks into the NVDA vault. | For a holder, it is one deposit into a vault. |
| 18 | Real app footage: /vault/nvda, "Why this pool", the cap line, the deposit panel with an amount typed. | Deposit NVDA, and the vault earns the fees for you. |
| 19 | Ink screen, lime wordmark "Uptick". | Uptick. |
| 20 | The closing line sets in under the wordmark. | Stock Token yield, chosen by the chain's own data. |
