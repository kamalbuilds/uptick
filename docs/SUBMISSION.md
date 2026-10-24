# Uptick: Founder House Singapore submission

Put your Stock Tokens to work. Deposit AAPL, GOOGL, PLTR and 9 more Stock Tokens (12 of 17 vaults open first, AAPL and PLTR live on Robinhood Chain now), earn the fees that survive losses to fast traders, and borrow USDG against the same vault share on Morpho Blue. Uptick shows what you keep before you sign, and opens a vault only where 3,059,881 replayed swaps say it holds up.

App https://uptick-fi.pages.dev. Launch film https://x.com/uptickfi/status/2112531006792360167. Code https://github.com/kamalbuilds. Deck: `deck/index.html`, 12 slides and an appendix, PDF at `deck/uptick-deck.pdf`. Demo: `docs/DEMO-SCRIPT.md`, 90 seconds.

## 1. Robinhood made Stock Tokens collateral, and posted collateral earns nothing

On 22 October 2026 @RobinhoodCrypto announced that Stock Tokens can now serve as collateral on Morpho: "Any eligible wallet can plug in and any app can tap into these markets." The post drew 55,663 views by 2026-10-23 16:55 UTC (https://x.com/RobinhoodCrypto/status/2113270580472381515). Morpho Blue holds $609.5M of Robinhood Chain's $1.14B in TVL. Morpho Blue does not lend collateral out, so a Stock Token posted there earns nothing while the loan accrues interest. 189,012 wallets hold NVDA on the chain and 114,222 hold SPCX. Holders say what they want, verbatim and dated in `gtm/uptick/DEMAND.md`: "I'd have been massively profitable on RH chain if I had stuck to LP'ing tokenized stocks" (@WazzCrypto, X, 2026-10-15), and "tokenized equities like xStocks need to plug directly into defi lending markets so users can earn yield on SPYx or NVDAx while holding them" (@JackNomadsGOD, X, 2026-10-13).

## 2. Fees are not yield, and the replay decides which pools deserve capital

Uptick runs on Robinhood Chain (4663). It tracks 17 Stock Tokens with a Chainlink feed and a USDG pool, replays 3,059,881 swaps over the 30 days to 2026-10-17, and places every vault behind one of three doors. The pools behind the 17 vaults paid liquidity providers $979.3K in fees over the same 30 days, and what an LP keeps after informed traders is a different number. PLTR's Uniswap v4 1% pool paid 126.8% a year in fees in the held-out half and kept +7.9%; its v3 0.3% pool kept -18.9%; SPCX's pool paid 116.7% and kept -195.4%. The venue for each token is the pool that keeps more in its weaker half: PLTR, SPY and USO sit on Uniswap v4, the other 14 on v3.

Open vaults take any amount: PLTR, AAPL and GOOGL kept money in both halves of the replay. Reduced vaults take up to $25,000 a deposit: NVDA, INTC, MU, AMD, META, USO, AMZN, SPY and QQQ, where the weaker half sits between -20% and break-even. Closed vaults take none: GME, MSTR, SPCX, CRCL and TSLA, where the weaker half kept less than the -20% floor. Exit in kind is always open. Both tokens come back, with no oracle, no swap and no pause in the way. AAPL and PLTR are live on Robinhood Chain, each with a $5,000 deposit cap read back from its contract; the other ten launch at their sized caps, and sized launch caps total $592,359 across the 12 vaults. The performance fee is 0% at launch, so the kept figure on every vault page is what a depositor keeps.

## 3. Deposit the token, earn what survives, borrow against the same share

The vault takes the Stock Token itself, not USDG and not a pair, and its ERC-4626 share is an ERC-20 that Morpho Blue takes as collateral. UptickShareOracle prices the share from Chainlink alone. A holder deposits, earns the fees that survive, and posts the share to borrow USDG while it keeps earning. Johann Kerbrat of Robinhood Chain wrote about the Morpho launch on 22 October: "Excited to see what gets built on top." Uptick is what gets built on top.

## 4. The borrow cost, read live

Morpho Blue API, chain 4663, 2026-10-23 16:56 UTC: the AAPL/USDG market at a 62.5% loan to value limit (market 0xdeb4782d012d5fd3b24962538c2f6559049d70bda4dabd2e4212dacb96c28d45) has $221,409 supplied, 90.5% utilization and a borrow APY of 24.7%. An Uptick AAPL share earns its kept APR while it is posted: +2.7% a year in the weaker half of the replay and +3.9% in the held-out half. At a 50% loan to value the share earns kept divided by 0.5 on every borrowed dollar, which is 5.4 to 7.8 points of the 24.7%, a net borrow cost of about 17% to 19%. This is an estimate from one read: the rate is variable, fee income varies with volume, and the share holds about half USDG inside its price range. Posted as an Uptick share, the same collateral pays back a fifth to a third of the interest.

## 5. Demo

`/check` takes any wallet address with no connection: it reads the wallet's balances of the 17 Stock Tokens from Robinhood Chain, prices them with the vaults' Chainlink feeds, and shows each holding's door, what it would have kept a year at the replay's weaker half, and where a loan opens. On 2026-10-23 the address 0x92d4...f765 held $102,325 of Stock Tokens, and Uptick would put $86,791 of it to work across 12 tokens. The Earn and borrow panel on each vault page sends the deposit, the share approval, the collateral supply and the borrow as one confirmation where the wallet batches. Your loan shows collateral, accrued debt, health factor and the liquidation price in stock terms, and Make it safer repays from the wallet or exits in kind and repays, as one batch. Loan alerts post a webhook once when a health factor crosses a threshold.

`scripts/fork-demo.sh` runs the loop end to end on a fork of Robinhood Chain against the real Morpho Blue singleton: factory, router, the PLTR v4 and AAPL v3 vaults, the share oracle, a market at a 62.5% limit, a lender, a borrower using the app's own call encoding (42.6 AAPL deposited, 8,693.07 USDG borrowed against a limit of 9,150.60), a 3% push on the pool, a stale feed, a 12% feed drop and the liquidation. Every transaction hash is in `docs/FORK-DEMO.md`.

<!-- deployed:start -->
### Deployed addresses

Live on Robinhood Chain mainnet (chain id 4663) through block 96359219. Every address returns bytecode from `cast code`; the factory pins the creation-code hash of StockVault and StockVaultV4, each vault's deposit cap, owner, keeper, pool and feed were read back from the chain after the deploy, and every share oracle is registered in the oracle factory's `isOracle`.

| Contract | Address | Deposit cap |
|---|---|---|
| VaultFactory | [`0x67AB92446f38F01Ec5a863f6C8e7b8aF39415A1a`](https://robinhoodchain.blockscout.com/address/0x67AB92446f38F01Ec5a863f6C8e7b8aF39415A1a) | |
| UptickRouter | [`0x599BE83442e02810B501fab280dC2eBD6d0D2c48`](https://robinhoodchain.blockscout.com/address/0x599BE83442e02810B501fab280dC2eBD6d0D2c48) | |
| UptickShareOracleFactory | [`0x0334c4A66d40F5c6c2891d3AFD26b4519B6715DB`](https://robinhoodchain.blockscout.com/address/0x0334c4A66d40F5c6c2891d3AFD26b4519B6715DB) | |
| AAPL vault (Uniswap v3 pool) | [`0x127eCb0e814EF0cC296910DFd5E946050d85534f`](https://robinhoodchain.blockscout.com/address/0x127eCb0e814EF0cC296910DFd5E946050d85534f) | $5,000 |
| AAPL share oracle | [`0x32518De75DFEC2cF07F8B4742cf64f9952D3A0EB`](https://robinhoodchain.blockscout.com/address/0x32518De75DFEC2cF07F8B4742cf64f9952D3A0EB) | |
| PLTR vault (Uniswap v4 pool) | [`0xD769d94E43447937Eaa85Dc6AE291468649085a3`](https://robinhoodchain.blockscout.com/address/0xD769d94E43447937Eaa85Dc6AE291468649085a3) | $5,000 |
| PLTR share oracle | [`0x613F1250fc27aD51C11C403bd9b5440181D0f9A4`](https://robinhoodchain.blockscout.com/address/0x613F1250fc27aD51C11C403bd9b5440181D0f9A4) | |
<!-- deployed:end -->

## 6. Safety

A 3% push on the AAPL pool moved the share's oracle price 0.2 basis points; the control oracle that reads pool spot moved 263, and that step goes red when the control is swapped in. At a 62.5% limit Morpho pays a 12.68% liquidation incentive, and a borrower at the limit leaves bad debt only after a further 29.6% share fall. The worst weekend gap in 123 days of Chainlink rounds on the twelve launching feeds is -7.75% on USO, and -0.68% on AAPL. In the fork liquidation the seized shares exited in kind for 14.9% more than the USDG repaid.

Six review reports sit in `contracts/`: four rounds on StockVault, each re-reading the last round's fixes, with round four closing at SHIP with no Critical, High or Medium finding; one on StockVaultV4, which closes at SHIP after its one Medium was fixed; and an independent review of the share oracle that ran before any market was announced. Round 1 closed 1 High and 3 Medium: a same-block share lock, a spot-to-TWAP band against deploy sandwiches, deposits priced at the lowest of Chainlink, TWAP and spot, a 24 hour owner queue, and a corporate-action gate on the token's oracle pause and multiplier. 141 security tests run on a fork of the real pools inside 412 contract tests, and 93 mutation checks break a guard, see red, restore and see green. Detail in `contracts/SECURITY.md`.

## 7. Competition

AutoRange vaults issue no share token, so there is nothing to post as collateral (`competitors/autorange-factory/src/STUDY.md`, DefiLlama TVL $0.6M across six chains). Stock Tokens posted as plain collateral on Morpho earn nothing. Fables runs 13 USDG pools over the tracked tokens (DefiLlama TVL $25.8M); replayed with the same engine, band, halves and cost model as the gate, a Fables pool keeps less in its weaker half than the pool Uptick chose on 11 of the 12 tokens it can be replayed on (`keeper/data/fables-replay.json` against `web/lib/vault-universe.json`). A Uniswap position is an NFT that Morpho Blue cannot take, and an Uptick share is an ERC-20 it can.

Across AutoRange, Arrakis V2, Gamma and Veda, no codebase carries a settings timelock or stock-split handling. Uptick puts every owner setting behind a 24 hour queue with the calldata emitted, void after 7 days, and gates price-checked paths around each ERC-8056 multiplier change. Deposits price from the lowest of Chainlink, TWAP and spot. Source: `competitors/*/STUDY.md` in the parent workspace.

## 8. Market

Robinhood Chain holds $1.14B, Morpho Blue holds $609.5M of it (53.6%) and Steakhouse Financial, a Morpho curator, runs $538.0M on the chain (DefiLlama, 2026-10-23 16:55 UTC). Uniswap v3 and v4 moved $488.40M of Stock Token value across the 17 tokens in 7 days and paid $623.9K in LP fees: $184.8K of that fee pot is reachable in v3 pools, held by StockVault, and $198.5K sits in v4, held by StockVaultV4. About half of the top ten tokens' supply already sits in AMM pools.

## 9. Traction

The app at uptick-fi.pages.dev serves 17 vaults, each with its door and reason, plus `/check`, Earn and borrow and Your loan. The evidence API serves JSON for every vault with the MCP endpoint and `llms.txt`. One MCP endpoint over Streamable HTTP carries ten tools: `list_vaults`, `get_vault_evidence`, `scan_wallet`, `prepare_deposit`, `prepare_withdraw`, `get_collateral_terms`, `check_loan_health`, `prepare_earn_and_borrow`, `prepare_make_safer` and `plan_weekend_hedge`, which sizes a weekend short on Lighter's Robinhood Chain exchange from the Stock Tokens a wallet holds and prices it from live Lighter reads. The user signs and sends every transaction, and a closed vault returns its gate reason, so an agent never routes a deposit past the door: `prepare_deposit` for SPCX answers "Closed: the weaker half kept -195.4% a year, below the -20% floor." The factory pins the creation-code hash of StockVault and StockVaultV4, so it registers only the reviewed builds. Outreach to 50 named holders, projects and investors is queued, and `/talk` holds five questions for holders.

## 10. Team

Kamal built StockVault, the keeper, the replay engine, the share oracle and the loan flow, the web app and the evidence API.

## 11. Ask

Uptick raises $2M pre-seed for a vault on every Stock Token the day it lists, on v3 and v4 pools, with an external audit and two engineers on the keeper and risk engine. The 12-month target is every launching vault at its cap, $592,359 across 12, with caps rising as pools deepen toward $50M of Stock Tokens earning in Uptick vaults, and a Morpho market on every open vault share so a holder borrows USDG against the token that is earning. From Founder House: holders who will size a first deposit, a curator such as Steakhouse and a lender such as Zona for the first share market, and the wallets that carry the kept APR.

## Appendix: the finding behind the engine

Fees earned per $1 lost to informed traders, 1 hour markout, from 5,113,049 swaps between 24 August and 17 October 2026 on the NVDA, SPCX and TSLA pools: NYSE hours $1.03 to $1.35, weeknights $1.30 to $3.90, weekends $3.94 to $33.27. Pooled in a fixed range on those three pools, a weekend pays $13.64 and NYSE hours $1.16. The weekend ratio beats the NYSE ratio in 22 of 23 pool-weeks. The engine drops what its own replay refutes: a schedule built on the clock met its bar on 0 of 3 tokens, random session labels beat it in 64 of 64 cells, and twelve off-chain signals failed their shuffled control. Each token chooses its price range on the first 15 days and the last 15 days decide the door, with the weaker half counting: AAPL runs a plus or minus 7.5% range and kept +2.7% a year in its weaker half, +3.9% in the held-out half, and NVDA's plus or minus 1.5% range kept +29.0% on the first half and -6.8% on the held-out half, so NVDA is reduced. Of every $100 AAPL's pool pays, $17.37 stays with depositors, $8.88 pays for recentring and $73.75 goes to informed traders. The entry fee is 0.35%, kept in the vault for the holders who stay, and exit in kind carries no fee in either token.

<!--
Sources, read 2026-10-23 (machine clock, UTC). Every section mirrors the same-numbered slide of deck/index.html (12 slides and the appendix). Live reads are recorded with command and time in .progress/research/win-2026-10-24/LIVE.md.
Section 1: x.com/RobinhoodCrypto/status/2113270580472381515 via api.fxtwitter.com 2026-10-23T16:55:38Z (55,663 views); cdata --json llama chain robinhood 2026-10-23T16:55:28Z (chain TVL $1,137,793,061, Morpho Blue on the chain $609,516,356); Blockscout holder counts 2026-10-16 (docs/research/founder-house/PLATFORM-TRUTH.md); gtm/uptick/DEMAND.md.
Section 2: web/lib/vault-universe.json (12 of 17, 3 open, 9 reduced, 5 closed, depositCapUsd of the 12 launching vaults summing to $592,359, sum of gate.swaps = 3,059,881), web/lib/pool-fees.json ($979,345.29), keeper/data/replay.json held-out half (PLTR v4 1% fees 126.8, kept +7.9; v3 0.3% kept -18.9; SPCX kept -195.4, fees 116.7).
Section 3: x.com/JohannKerbrat/status/2113272709333536936 (2026-10-22, quoting Morpho's launch post), contracts/src/UptickShareOracle.sol, web/components/earn-borrow.tsx.
Section 4: blue-api.morpho.org 2026-10-23T16:56:52Z, market 0xdeb4782d... borrowApy 0.24663, supplyAssetsUsd 221,409, utilization 0.9049; AAPL kept web/lib/vault-universe.json (weaker half +2.7, held-out +3.9). 2.7 / 0.5 = 5.4, 3.9 / 0.5 = 7.8, 24.7 - 7.8 = 16.9, 24.7 - 5.4 = 19.3.
Section 5: web/app/check, web/components/idle-finder.tsx, your-loan.tsx, earn-borrow.tsx, api/src/mcp.ts (check_loan_health, prepare_make_safer, plan_weekend_hedge in api/src/hedge-tools.ts), POST /alerts/subscribe; docs/FORK-DEMO.md (fork block 96051421, real Morpho Blue singleton 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010); address read at block 96099041.
Section 6: docs/FORK-DEMO.md steps 17 and 19 (386,493 of 19,771,327,025 raw is 0.2 bp; control 520,913,476 is 263 bp), contracts/SECURITY.md (Share oracle: weekend gaps and the LLTV they allow), keeper/data/weekend-gaps.json, contracts/SECURITY-REVIEW-ORACLE-2026-10-23.md, docs/facts.json (412 tests, 141 security, 6 reports).
Section 7: competitors/autorange-factory/src/STUDY.md, keeper/data/fables-replay.json, cdata llama tvl fables (2026-10-23T16:57:38Z) and autorange (16:57:40Z).
Section 8: cdata llama chain robinhood, docs/research/founder-house/vaults/VENUES.md (7 days, blocks 87,352,064 to 93,292,983).
Sections 9 to 11: api/src/mcp.ts, web/public/llms.txt, gtm/uptick/PIPELINE.md, TARGETS.md, deck/index.html.
-->
