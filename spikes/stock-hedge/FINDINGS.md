# Stock Token Hedge spike (2026-10-23, read-only)

Claim (falsifiable): a third-party app can, within 2 days, let a Robinhood Chain Stock Token holder open a correctly sized NVDA/TSLA/AAPL short on Lighter RH and auto-unwind it, with weekend carry >= 0 and pool-vs-perp basis under 30 bps median.

## 1. Lighter on Robinhood Chain (read from https://api.rh.lighter.xyz/api/v1/orderBookDetails, 2026-10-23 ~16:00 UTC)

Lighter RH is a SEPARATE exchange from Lighter mainnet (zklighter). Quote, https://apidocs.lighter.xyz/docs/lighter-rh : "Lighter RH is a **separate exchange**, not another market on Lighter mainnet. Accounts, balances, API keys, nonces and account indexes don't carry over, and a transaction signed for one is rejected by the other." Base URL https://api.rh.lighter.xyz, signing chain ID 466324, contract 0x94bAB9693Ba2f6358507eFfcbd372b0660AFfF9d on Robinhood Chain (cast code: bytecode present). Market ids differ from mainnet (RH NVDA=15, TSLA=16, AAPL=10; mainnet NVDA=110): "Read market IDs and decimals from each exchange's orderBookDetails".

63 perps on RH. Stocks: NVDA, TSLA, AAPL, MSFT, META, GOOGL, AMZN, COIN, CRCL, SPY, QQQ, SPCX and more. OI = open_interest x mark_price; vol = daily_quote_token_volume.

| sym (id) | mark | OI USD | 24h vol USD | initial margin (default) |
|---|---|---|---|---|
| NVDA (15) | 212.77 | 6.69M | 18.9M | 5000 (20x) |
| TSLA (16) | 373.47 | 4.04M | 17.8M | 5000 |
| AAPL (10) | 347.63 | 5.88M | 17.3M | 5000 |
| MSFT 14 / META 13 / GOOGL 12 / AMZN 11 | | 4.8M / 3.4M / 5.9M / 4.2M | 12.7M / 12.0M / 21.8M / 11.7M | |
| SPY / QQQ | | 39.0M / 28.2M | 117.8M / 96.5M | |

Depth (orderBookOrders, 250 levels): NVDA spread 0.94 bp, within 25 bps of mid bid $587K / ask $398K; TSLA 0.27 bp, $327K / $369K; AAPL 2.0 bp, $397K / $458K. Taker/maker fee 0% on Standard tier. Funding (Lighter /fundings, 1h, 28 days, n=672, rate read as percent per hour; positive = longs pay shorts, consistent with the documented 0.01%/8h = 0.00125%/h floor): NVDA mean +0.00103%/h, TSLA +0.00089%/h, AAPL +0.00041%/h. So shorts EARN on average. NVDA weekend hours (Fri 21 UTC to Mon 13 UTC, n=260) mean +0.00073%/h vs +0.00121%/h other hours. A 65.5 h weekend short earns about 4.8 bps on NVDA. Range NVDA -0.0151% to +0.0328% per hour, so single hours can flip sign.

Programmatic access: YES. https://apidocs.lighter.xyz/docs/choose-your-integration : "B. Server-side on behalf of users ... Same as A, but the API key used for trading lives on your server. The user still registers the key with a one-time L1 signature. ... an API key can trade and can request **secure withdrawals** (which only go back to the user's own L1 address)." A: "Your app generates an API key pair locally (WASM GenerateAPIKey), then the user signs a one-time ChangePubKey with their wallet". https://apidocs.lighter.xyz/docs/wasm-signer : orders, cancels, Withdraw "Never" need an L1 signature; ChangePubKey "Always". Keys: indices 4-156/158-254 on RH (0-3 and 157 reserved). SDKs: pip lighter-sdk (elliottech/lighter-python), elliottech/lighter-go, TS+WASM. Rate: Standard 60 req/min, sendTx within 60/min. Read-only dashboards: read-only tokens up to 10 years.

Onboarding (lighter-rh page): deposit chain Robinhood Chain, collateral USDG (6 dec); "Contract deposit(_to, _assetIndex, _routeType, _amount), or an intent address: a persistent address that credits USDG on plain transfers, with no contract call"; ETH, USDC and other ERC-20s accepted; minimum 1 USDG. So: Stock Token -> swap to USDG on RHC pool -> plain transfer to the intent address -> account index appears. Withdraw: secure withdraw to own L1, fast withdraw USDG only.

Not found: whether Stock Tokens themselves are accepted as collateral on Lighter RH (docs list "other ERC-20s" without naming them).

## 2. Weekend basis (measured)

Method: GeckoTerminal 1h OHLCV for NVDA/USDG 0.05% pool 0xd4eb2120...14a3 (liq $3.0M) closes vs Lighter RH NVDA 1h candle closes (/candles, API caps at 500 bars = 2026-10-02 20:00 to 10-23 15:00 UTC, so three weekends, two complete Fri-to-Mon). Basis bps = pool/perp - 1. Script /tmp/basis.py (not kept).
- Weekend hours (n=192): median |basis| 6.9 bps, mean -0.8, max 25.0. Non-weekend (n=308): median 9.0, mean +2.6, max 163.7 (one outlier hour).
- Per weekend (Fri 19:00 bar -> Sun 16:00 -> Mon 13:00 UTC):
  - Oct 9-12: -5.5 / +6.9 / -7.6 bps; perp moved -99.3 bps, pool -101.4 bps.
  - Oct 16-19: +23.3 / +13.5 / +40.4 bps; perp +69.1 bps, pool +86.3 bps (basis widened 17 bps over the weekend).
  - Weekend max |basis| 19.5 to 25.0 bps.
- Lighter RH NVDA weekend traded volume per hour = 68% of other hours ($695K vs $1.02M): the perp is liquid on weekends.
- Verdict on NIGHT-MARKET.md "pools ~1 bp from the perp": REFUTED as a general figure for this pair. That file measured the 0.01% pool vs the Hyperliquid xyz perp (median 1 bp, p95 4 bp, hours with a swap). Against Lighter RH, the 0.05% pool is a median 7 bps off (inside its own 5 bp fee tier plus the perp's 1 bp spread, roughly), widening to 40 bps at the Monday 13:00 print on a +69 bp gap weekend. For a hedge this is the residual basis risk: about 7 bps typical, tens of bps on gap weekends. Not 1.
- Current snapshot: Chainlink RHNVDA feed 212.237 (age 1539 s); GT pool prices 212.37 to 212.41; Lighter mark 212.77, index 212.68, book 212.65/212.67.

## 3. Prior art

- Lighter itself: no "hedge my Stock Tokens" feature found in docs.lighter.xyz or apidocs llms.txt. Docs describe integration patterns A/B/C/D and a permissionless Partner Attribution (ApproveIntegrator, up to 4 partners per client, fees need Plus/Premium tier, https://apidocs.lighter.xyz/docs/partner-integration). A third party can earn integrator fees.
- Atoma (https://atoma.fi, https://docs.atoma.fi): "market-neutral yield on USDC from stock, index and commodity perpetuals"; uses Lighter among venues. DefiLlama "ATOMA", category Basis Trading, TVL $357,365. Pooled USDC vault, not a holder-sized hedge of owned Stock Tokens.
- Arcus Perps (https://arcus.xyz) TVL $63.6M; Arcus pTokens $0.69M (leveraged vault shares, directional); Meridian Perps $2.8M. DefiLlama via api.llama.fi/protocols.
- HedgeHood Stock Yield (DefiLlama hedgehood-stock-yield, Options Vault) TVL $151. Not a hedge product at scale.
- Grok (grokweb ask) claimed HoodPerp (hoodperp.com) lets Stock Tokens collateralize Lighter perps. Checked: hoodperp.com returns 404 DEPLOYMENT_NOT_FOUND, app.hoodperp.com "Deployment Paused" 402, GitHub shows one repo tradeperpex/HOODPERPS with 0 stars. Treat as dead or unverified. Grok also claimed Arcus multi-asset collateral rolling out (early access); not verified from Arcus docs.
- GitHub bots: lihanyu81/RobinHoodLighter---Lighter-Arbitrage-Tool (51 stars), a3165458/lighter-quant-bot. Arbitrage/MM bots, not holder hedges.
- @HoodL2Wiki pause window (Sat 02:00 to Mon 02:00 CET) was NOT independently verified here.
- Fees: DefiLlama lighter-robinhood-perps TVL $114.3M, fees 24h $87.3K, 7d $529.7K, 30d $2.26M (api.llama.fi/summary/fees). Matches brief.

## 4. VERDICT: PARTIAL (leaning CONFIRMED on mechanics)

Falsifiable claim tested piece by piece:
- Place/size/close programmatically for a user's own account: CONFIRMED by docs (pattern B, API key on server, trade-only, withdrawals only to the owner's L1). Needs: user deposit tx on 4663, one wallet signature (ChangePubKey), our server holding a per-user trade key. Auto-unwind by a server key is a documented pattern; I did not place an order.
- Carry >= 0: CONFIRMED on average for shorts (NVDA +4.8 bps per weekend), not guaranteed per hour.
- Basis under 30 bps median: CONFIRMED (median 6.9 bps) but max 25 bps weekend, 40 bps at Monday 13:00 on a gap weekend; the NIGHT-MARKET 1 bp figure does not transfer.
- Prior art: no direct competitor found; Atoma is the closest (pooled, USDC).
Negative case checked: mainnet zklighter lists NVDA too (id 110, OI $6.6M), but the docs state RH accounts and signatures are not interchangeable, so a hedge built against mainnet would be the wrong exchange.
Caveat: the money needs a bridge step, not just a signature. A holder with Stock Tokens must sell some to USDG to fund margin (e.g. 20% of notional), which is a sale event and slippage on a 0.05% pool, or Lighter must accept Stock Tokens as collateral (unconfirmed). A 2-day build is plausible only for the swap-to-USDG + deposit + short path.

## BLIND SPOTS
- No order placed on Lighter RH, no L1 signature flow executed; the "can" rests on docs plus read-only endpoints.
- Funding unit (percent per hour) inferred from the documented floor, not from a docs table.
- Basis uses one pool (0.05%) and 3 weekends, 2 complete; no shuffled-control run; hour-close vs hour-close alignment can add a few bps.
- Pool price assumes ERC-8056 multiplier = 1 (currentMultiplier() and multiplier() reverted on the token; median basis 7 bps suggests it is ~1 or already applied by GT).
- Funding history does not show whether Lighter pauses index updates when US equities are closed.
- Pause window, Atoma performance, Arcus collateral claims, X posts not verified (treg unauthenticated, 401; DuckDuckGo blocked).
