# Uptick integrations

Eleven targets from `DIRECTORY-SWEEP.md` and `BEST-IN-CLASS.md`. Every row is `not contacted` until a real reply arrives. A sent DM is not a conversation; the status changes only when a reply URL is logged. Counts live in `EVIDENCE.md`.

Handles and named owners checked on 2026-10-21 are in `TARGETS.md`, with a drafted message per project in `OUTREACH-BATCH-2026-10-21.md`. Where the two differ, `TARGETS.md` is current: StonkBrokers is reached through @ClutchMarkets and its founder @OxSimpleFarmer, and Saffron is @saffron.

| Project | URL | Integration ask that benefits them | Contact channel | Status |
|---|---|---|---|---|
| Lit Hub | https://github.com/techcobain/lit_hub_ecosystem | List Uptick under Data and Yield as a product that uses Lighter RH weekend marks | GitHub PR | not contacted |
| Lighter Robinhood | https://robinhoodchain.lighter.xyz/ | Cite Lighter RH mark and index as the 24/7 weekend cross-check, with attribution on every vault page | find | not contacted |
| StonkBrokers | https://stonkbrokers.io/api/locker/smartlp-activity?chain=robinhood | Add a net-of-markout comparator row to the SmartLp activity feed | site: stonkbrokers.io (X @stonkbrokers unverified, 23 followers) | not contacted |
| AutoRange | https://api.llama.fi/protocol/autorange | Benchmark their 32 vaults on the same replay and publish one comparison page | X @AutoRangexyz | not contacted |
| HedgeHood and TickerSpring | https://tickerspring.com | Add Uptick kept APR as a comparator column in the vault dashboard | X @0xHedgehood, @tickerspring | not contacted |
| Saffron | https://saffron.finance | Replay vaults 47 and 90 at their ticks and publish an outside net-of-markout check | find | not contacted |
| Steakhouse and Morpho | https://www.steakhouse.financial/ | Quote Steakhouse USDG as the hurdle and list the Uptick share as Morpho collateral | X @SteakhouseFi | not contacted |
| Chainlink | https://chain.link | Cite the equity feed IDs and staleness behavior on every vault page | X @chainlink | not contacted |
| HawkFi | https://www.hawkfi.ag | Add kept APR as a second column beside Fee/TVL in the screener | X @HawkFi_ | not contacted |
| Arrow Finance | https://arrowfinance.io | List a Stock Tokens source on Arrow Earn and later accept Uptick shares as CDP collateral | X @ArrowFinanceio | not contacted |
| Metric | https://www.metric.xyz/ | Show Uptick as the passive weekend fallback beside the NVDA pool page | find | not contacted |

## Draft messages

One per row. Under 600 characters. Founder voice, one concrete ask, no pitch deck.

### Lit Hub

Hi, I am building Uptick, stock-token vaults on Robinhood Chain. We use Lighter RH weekend mark and index prices as a 24/7 cross-check while Chainlink is stale, with attribution. I would like to list Uptick on Lit Hub under Data and Yield. Can you confirm the fields for ecosystem/uptick.json and whether the build script rejects a listing without an instance? I will open the PR. If a short call is easier, I can work around your timezone.

### Lighter Robinhood

Hi, I am building Uptick, stock-token vaults on Robinhood Chain. Chainlink equity feeds go stale outside market hours, so we read Lighter's RH mark and index prices as a weekend cross-check and show the source on every vault page. That is a live use of your data, not a fork. I would like your technical review of the fields we plan to cite, and a listing on Lit Hub once it ships. Who owns the RH market data surface?

### StonkBrokers

Hi, I am building Uptick, an evidence-ranked stock-token vault on Robinhood Chain. We replay every USDG pool swap and publish kept APR net of one hour markout. You already publish SmartLp activity. I would like to add a comparator row fed by our public MCP tools list_vaults and get_vault_evidence, so your users see net-of-markout beside gross fees. No fee, no exclusivity. Who owns the SmartLp dashboard, and can I send a read-only spec this week?

### AutoRange

Hi, I am building Uptick, a stock-token vault on Robinhood Chain. We pick the pool and tier from a replay of 5.1M swaps and show kept APR after markout. AutoRange runs 32 vaults. I would like to benchmark them on the same replay and publish one comparison page with links to your vaults, then link your vaults from ours. You get an independent net-of-markout read, we get a fair comparison. Who handles partnerships, and would you share a read-only list of active vaults?

### HedgeHood and TickerSpring

Hi, I am building Uptick, a stock-token vault on Robinhood Chain. We publish kept APR net of one hour markout for NVDA and GOOGL. Your dashboard already shows vault performance. I would like to add Uptick's kept APR as a comparator column, fed by our public MCP tool get_vault_evidence, with a link to the vault page. No fee. Who owns the dashboard, and can I send the row format? If the drawdown latch data is public, we will show it beside ours.

### Saffron

Hi, I am building Uptick, a stock-token vault on Robinhood Chain. We replay USDG pool swaps at a fixed band and rank pools on out-of-sample kept APR. I want to replay Saffron vaults 47 and 90 at their published ticks and publish the result beside our own, with links to your vaults. You get an outside net-of-markout check on your fee streams. Can you confirm the tick ranges and whether adapter.getEarnings is the right comparison? I can share the script.

### Steakhouse and Morpho

Hi, I am building Uptick, ERC-4626 stock-token vaults on Robinhood Chain. Steakhouse USDG is the hurdle we show users, and I want it quoted correctly. Two asks: confirm the base yield feed you want shown net of rewards, and point me to the Morpho curator process for listing a vault share as collateral. We will ship an AggregatorV3 share price feed and a Morpho-shaped stats row. Who owns the USDG yield page?

### Chainlink

Hi, I am building Uptick, stock-token vaults on Robinhood Chain. Every deposit, withdraw and rebalance is gated on your equity feeds. Two technical questions and one ask. Which feed IDs and heartbeat should we cite for NVDA, GOOGL, SPCX and CRCL on chain 4663, and what should we expect outside market hours? The ask is a feed ops contact for staleness questions. We will publish the feed ID and last update on every vault page.

### HawkFi

Hi, I am building Uptick, a stock-token vault on Robinhood Chain. Your screener ranks by Fee/TVL; our replay of 5.1M swaps shows the ranking can invert once markout is counted, for example CRCL and SPCX. I would like to feed kept APR into your screener as a second column using our public MCP tool get_vault_evidence, with a link back. No fee. Who owns the ranking, and can I send the endpoint spec?

### Arrow Finance

Hi, I am building Uptick, ERC-4626 stock-token vaults on Robinhood Chain. Arrow Earn is a Morpho front end, and I can serve the same row shape from our stats API: address, name, asset, netApy net of markout, totalAssetsUsd, liquidityUsd. The ask is a Stock Tokens source on Earn and, after mainnet, Uptick shares as CDP collateral via a share price feed. Who owns the Earn listing, and can I send a sample row?

### Metric

Hi, I am building Uptick, a passive stock-token vault on Robinhood Chain. Your NVDA pool is oracle-priced, and when the feed stalls on weekends flow has nowhere obvious to go. I would like to show Uptick's kept APR as the passive fallback beside your pool page, fed by our public evidence API, and route weekend USDG deposits to the Uptick vault. No fee. Who owns the pool page, and can I send the integration spec?
