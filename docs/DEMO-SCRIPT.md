# Uptick: 90 second Founder House demo

Live app: https://uptick-fi.pages.dev.

One line: deposit a Stock Token, earn the fees that survive, borrow USDG against the same vault share, exit in kind. Uptick shows what you keep after losses to fast traders, and opens a vault only where 3,059,881 replayed swaps say it holds up.

Setup: one browser window, four tabs in order: `/check`, `/vault/pltr`, `/docs/collateral`, `/docs/exit-in-kind`, and a terminal with the output of `scripts/fork-demo.sh` already on screen (the run writes `docs/FORK-DEMO.md`). No wallet is connected. The address to paste is a real holder of AAPL, GOOGL and PLTR on Robinhood Chain, 0x92d4...F765 (full address in the sources note at the end); the demo wallet stays off screen.

## 0:00 to 0:20 Paste a real holder address, `/check`

Screen: the page "Find your idle Stock Tokens". Paste the holder address and press Find idle tokens. The headline reads "0x92d4...F765 holds $102,325 of Stock Tokens doing nothing. Uptick would put $86,791 of it to work."
Say: "On 22 October Robinhood made Stock Tokens collateral on Morpho and said any app can tap into those markets. Paste any wallet. This one holds a hundred thousand dollars of Stock Tokens that earn nothing. Uptick reads the balances from the chain, prices them with Chainlink, and shows which of the 17 can earn. Twelve can. Five are closed, and the page says why."

## 0:20 to 0:40 The PLTR vault page

Screen: `/vault/pltr`, state chip Open, the "Where a year of fees goes" strip and "Why it is open".
Say: "PLTR kept 7.9% a year in its weaker half on its Uniswap v4 pool. The pool paid 127% in fees. Fees are not yield. We replayed 3,059,881 swaps to see what an LP keeps, and we open a vault only where that number is above break-even."

## 0:40 to 1:00 Earn and borrow

Screen: scroll to the Earn and borrow panel: "Earn the pool fees on your PLTR, and borrow USDG against the same position."
Say: "One confirmation deposits the token, posts the share to Morpho Blue and sends USDG to the wallet. The share keeps earning while it is collateral. Borrowing USDG against AAPL on Morpho costs 24.7% a year today. An Uptick AAPL share earns 2.7% to 3.9% on top, which pays back 5.4 to 7.8 points of that at a 50% loan to value. That is an estimate from one read, and it moves with the rate."

## 1:00 to 1:10 Your loan

Screen: `/docs/collateral`, the Your loan and Make it safer paragraph.
Say: "Once there is a loan, Your loan shows collateral, debt, health factor and the liquidation price in stock terms, and Make it safer repays or exits in kind in one batch. The next screen is that loan being built, pushed and broken."

## 1:10 to 1:30 The fork run

Screen: the terminal with the `scripts/fork-demo.sh` output: the PASS lines for steps 16, 17 and 19.
Say: "This is one command on a fork of Robinhood Chain against the real Morpho Blue. The borrower deposits 42.6 AAPL and borrows 8,693 USDG at the 62.5% limit. A 3% push on the pool moves the share's price 0.2 basis points, where a spot-priced oracle moved 263. A 12% feed drop liquidates the loan, and the liquidator exits the seized shares in kind for 14.9% more than the USDG it repaid. Uptick shows which of your Stock Tokens earn, and lets the deposit keep working."

<!--
Sources, repo files regenerated 2026-10-23, live reads in .progress/research/win-2026-10-24/LIVE.md.
/check: web/app/check, web/components/idle-finder.tsx; address 0x92d435c96e63c43e12d6d0ab28f6b0b04072f765 read at block 96099041 on 2026-10-23: $102,325 held across 17 tokens, $86,791 put to work across 12 tokens, $15,533 refused across 5 closed tokens (rpc.mainnet.chain.robinhood.com). The 22 October post: x.com/RobinhoodCrypto/status/2113270580472381515 ("Any eligible wallet can plug in and any app can tap into these markets").
PLTR: web/lib/vault-universe.json gate and keep, keeper/data/replay.json PLTR pools (v4 1% pool: fees 126.8, weaker half +7.9; 167.1% over the full 30 days); 3,059,881 is the sum of each vault's gate.swaps.
Borrow cost: blue-api.morpho.org, chain 4663, market 0xdeb4782d012d5fd3b24962538c2f6559049d70bda4dabd2e4212dacb96c28d45, borrowApy 0.24663 at 2026-10-23T16:56:52Z; AAPL kept +2.7% (weaker half) and +3.9% (held-out half), offset = kept / 0.5 = 5.4 and 7.8 points.
Your loan: web/components/your-loan.tsx, web/lib/loan.ts, web/app/docs/collateral/page.tsx.
Fork run: scripts/fork-demo.sh and docs/FORK-DEMO.md (fork block 96051421): step 16 42.6 AAPL deposited, 8693.074028 USDG borrowed against a limit of 9150.604241 at LLTV 6250 bp; step 17 the market oracle moved 386,493 of 19,771,327,025 raw (0.2 bp), the spot-reading control 520,913,476 (263 bp); step 19 the share price fell 1150 bp on a 1200 bp feed drop, 5,767.44 USDG repaid, seized shares exited for 6,628.24 USDG (1493 bp over the repayment).
-->
