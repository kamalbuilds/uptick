# Uptick: Founder House Singapore submission

Put your stock tokens to work. Deposit AAPL, GOOGL, NVDA and 9 more Stock Tokens (12 of 17 vaults take deposits at launch) and earn a share of every trade's fee. Uptick shows what you keep after losses to fast traders, and opens a vault only where past swaps say it holds up.

App https://uptick-fi.pages.dev. Launch film https://x.com/uptickfi/status/2112531006792360167. Code https://github.com/kamalbuilds. Deck: `deck/index.html`, 12 slides, PDF at `deck/uptick-deck.pdf`.

## 1. What Uptick does

Uptick runs on Robinhood Chain (4663). It tracks 17 Stock Tokens with a Chainlink feed and a USDG pool, replays 3,059,881 swaps over the 30 days to 2026-10-17, and places every vault behind one of three doors. 12 vaults launch first, 3 open and 9 reduced. The pools behind the 17 vaults paid liquidity providers $1.1M in fees over the same 30 days.

## 2. The holder and the ask

189,012 wallets hold NVDA on Robinhood Chain and 114,550 hold SPCX. The tokens sit in wallets and earn nothing. Holders say what they want, verbatim and dated in `gtm/uptick/DEMAND.md`: "I'd have been massively profitable on RH chain if I had stuck to LP'ing tokenized stocks" (@WazzCrypto, X, 2026-10-15), and "tokenized equities like xStocks need to plug directly into defi lending markets so users can earn yield on SPYx or NVDAx while holding them" (@JackNomadsGOD, X, 2026-10-13).

## 3. Three doors

Open vaults take any amount: AAPL, GOOGL and PLTR (on its Uniswap v4 pool) kept money in both halves of the replay. Reduced vaults take up to $25,000 a deposit: NVDA, INTC, MU, AMD, META, USO, AMZN, SPY and QQQ, where the weaker half sits between -20% and break-even. Closed vaults take none: GME, MSTR, SPCX, CRCL and TSLA, where the weaker half kept less than the -20% floor. Exit in kind is always open. Both tokens come back, with no oracle, no swap and no pause in the way.

## 4. The finding behind the engine

Fees earned per $1 lost to informed traders, 1 hour markout, from 5,113,049 swaps between 24 August and 17 October 2026 on the NVDA, SPCX and TSLA pools: NYSE hours $1.03 to $1.35, weeknights $1.30 to $3.90, weekends $3.94 to $33.27. Pooled, a weekend pays $13.64 and NYSE hours $1.16. The weekend ratio beats the NYSE ratio in 22 of 23 pool-weeks.

The engine drops what its own replay refutes. A schedule built on the clock met its bar on 0 of 3 tokens, random session labels beat it in 64 of 64 cells, and twelve off-chain signals failed their shuffled control. Uptick acts on pool and band, measured per token.

## 5. First half picks, second half decides

Each token chooses its band on the first 15 days. The last 15 days decide the door, and the weaker half counts. AAPL runs a plus or minus 7.5% band and kept +2.7% a year in its weaker half, +3.9% in the held-out half. NVDA's plus or minus 1.5% band kept +29.4% on the first half and -6.6% on the held-out half, so NVDA is reduced. The conservative figure decides, and the upper accounting bound sits beside it on every vault page.

## 6. Where a year of fees goes

AAPL's pool paid 18.8% a year and depositors kept 3.2%. Of every $100 the pool pays, $17.08 stays with depositors, $9.01 pays for recentring and $73.91 goes to informed traders. The entry fee is 0.35%, kept in the vault for the holders who stay. Uptick's performance fee launches at 0%, so the kept APR shown is what depositors keep; the contract caps it at 20% of collected fees, and a change goes through the 24 hour queue and is minted as shares so the share price never steps at harvest. Exit in kind carries no fee in either token.

## 7. Five security reviews

Five review reports sit in `contracts/`: four rounds on StockVault, each re-reading the last round's fixes, with round four closing at SHIP with no Critical, High or Medium finding, and one on StockVaultV4, which closes at SHIP after its one Medium was fixed. Round 1 closed 1 High and 3 Medium: a same-block share lock, a spot-to-TWAP band against deploy sandwiches, deposits priced at the lowest of Chainlink, TWAP and spot, a 24 hour owner queue, and a corporate-action gate on the token's oracle pause and multiplier. Round 2 confirmed the fixes and added the pool fee to swap floors. Round 3 set the TWAP bound at 30 bp and the entry fee at 35 bp. Round 4 closes at SHIP. 118 security tests run on a fork of the real pools inside 383 contract tests, and 50 mutation checks break a guard, see red, restore and see green. Detail in `contracts/SECURITY.md` and the five reports in `contracts/`.

## 8. Agents read the same evidence

One MCP endpoint over Streamable HTTP, plus a public evidence API and `llms.txt`. Tools: `list_vaults`, `get_vault_evidence`, `prepare_deposit` and `prepare_withdraw`. The user signs and sends every transaction. A closed vault returns its gate reason, so an agent never routes a deposit past the door: `prepare_deposit` for SPCX answers "Closed: the weaker half kept -199.5% a year, below the -20% floor."

## 9. Settings timelock and stock-split handling

Across AutoRange, Arrakis V2, Gamma and Veda, no codebase carries a settings timelock or stock-split handling. Uptick puts every owner setting behind a 24 hour queue with the calldata emitted, void after 7 days, and gates price-checked paths around each ERC-8056 multiplier change. Deposits price from the lowest of Chainlink, TWAP and spot. Session-fee hooks price swaps and range vaults pick bands by hand. Uptick publishes the calibration for every token and opens a door only where it holds. Source: `competitors/*/STUDY.md` in the parent workspace.

## 10. Fees across venues

Uniswap v3 and v4 moved $488.40M of Stock Token value across the 17 tokens in 7 days and paid $623.9K in LP fees. $184.8K of that fee pot is reachable in v3 pools, held by StockVault, and $198.5K sits in v4, held by StockVaultV4. The engine measures hookless v4 pools net of the PoolManager's protocol fee: PLTR's v4 1% pool kept +12.8% in its weaker half, against -20.3% for the v3 0.3% pool, so PLTR deploys as a v4 vault. Source: `docs/research/founder-house/vaults/VENUES.md`, `keeper/data/replay.json`.

## 11. Shipped

The app at uptick-fi.pages.dev serves 17 vaults, each with its gate and reason. The evidence API serves JSON for every vault with the MCP endpoint and `llms.txt`. The launch film shows the weekend finding and the three doors. The factory pins the creation-code hash of StockVault and StockVaultV4, so it registers only the reviewed builds. Every week the replay refreshes and each vault opens or closes on its new halves.

## 12. Team and raise

Kamal built StockVault, the keeper, the replay engine, the web app and the evidence API. Uptick raises $2M pre-seed for a vault on every Stock Token the day it lists, on v3 and v4 pools, with an external audit and two engineers on the keeper and risk engine. The 12-month target is $50M of Stock Tokens earning in Uptick vaults, with vault shares accepted as collateral by Robinhood Chain lenders. From Founder House: holders who will size a first deposit, and the range vaults, lenders and wallets that carry the kept APR.

<!--
Sources, read 2026-10-21. Every section mirrors the same-numbered slide of deck/index.html (12 slides).
Vault list figures (web/lib/vault-universe.json and web/lib/pool-fees.json, regenerated 2026-10-22): 12 of 17, 3 open, 9 reduced, 3.1M swaps, $1.1M, 17 tokens, door membership per vault.
web/lib/vault-universe.json: sum of gate.swaps = 3,059,881; bands and weaker halves; PLTR gated on its Uniswap v4 1% pool (open), every other gate state unchanged.
Slide 2: gtm/uptick/DEMAND.md (verbatim quotes), Blockscout holder counts 2026-10-16 (docs/research/founder-house/PLATFORM-TRUTH.md).
Slide 4: README.md, spikes/stock-vaults/FINDINGS.md, spikes/offchain-signals/FINDINGS.md.
Slide 5 and 6: web/lib/vault-universe.json, keeper/data/params.json, /vault/aapl on the live app.
Slide 7: contracts/SECURITY-REVIEW-4-2026-10-20.md (80/80), contracts/SECURITY.md (50 mutation rows).
Slide 8: live evidence API and MCP endpoint, api/src/mcp.ts, web/public/llms.txt.
Slide 9 and 10: competitors/*/STUDY.md, docs/research/founder-house/vaults/VENUES.md.
Slide 11 and 12: deck/index.html.
-->
