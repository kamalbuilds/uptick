# uptick: tools that put us ahead

swept: 2026-10-18

What shipped recently (SDKs, protocol features, precompiles, papers, APIs, models) that teams on the
default stack are not using. Each entry ends adopted, spiked, rejected with a reason, or candidate.

### MCP Streamable HTTP (spec revision 2025-06-18): one endpoint agents can call
https://modelcontextprotocol.io/specification/2025-06-18
released: 2025-06-18
edge: Streamable HTTP carries JSON-RPC over a single POST and GET endpoint, so the evidence Worker doubles as an MCP server with no second SSE process to run. An agent lists vaults, pulls the replay evidence for one pool and gets an unsigned deposit or withdrawal back, from the same host that serves the browser. A stock-token vault behind plain REST makes every agent write its own glue per call.
competitors: `gh search repos "robinhood chain mcp"` returned 6 generic chain MCP servers (nirholas, adrued, GTCC777, ExpertVagabond, arambarnett, aabxtract); none serves a vault with replay evidence or returns a prepared transaction.
status: adopted api/src/mcp.ts

### llms.txt v2 (2026-09-24): a machine-readable front door
https://llmstxt.org/changes.html
released: 2026-09-24
edge: v2 defines the link relations (`rel="describedby"` points at the llms.txt that covers a page) and blesses per-path llms.txt files, so an agent resolves the markdown view and the evidence API instead of guessing at URLs. Uptick serves llms.txt with each vault gate, the fee APR and direct links to the evidence API and the MCP endpoint, so an answer is built from our numbers rather than a scraped page.
competitors: `gh search code "llms.txt" "robinhood"` returned 8 hits; `mphinance/awesome-broker-mcp` records that Robinhood itself publishes no llms.txt, and no Robinhood Chain product in the results ships one.
status: adopted web/public/llms.txt

### Cloudflare Workers free plan (page updated 2026-10-02): evidence and MCP on one Worker
https://developers.cloudflare.com/workers/platform/pricing/
released: 2026-10-02
edge: the free plan serves the vault evidence API, the llms.txt and the MCP endpoint from one Worker at 100,000 requests a day and 10 ms CPU per request, with no card and no origin server. The replay numbers and the gate rule are computed at build time and read from a data module, so the runtime only shapes JSON.
competitors: the chain's dashboards (hoodscout-data, rh-chain-board, afterhours) run cron snapshots on a host someone else maintains; `gh search repos "robinhood chain"` returned 100 repos and none ships a hosted, free-tier API built for agents.
status: adopted api/wrangler.toml

### Cardboard agent CLI (changelog 2026-10-13): the launch film is source, not a timeline
https://cardboard.ai/changelog
released: 2026-10-13
edge: `cb source apply "Uptick launch film" layout.tsx --eval` renders the film from a TSX layout, so the scenes live in the repo and rebuild from source instead of a proprietary editor file. A reviewer can read the layout, diff it and re-render it, and `cb --version` in this repo is 1.3.2.
competitors: no competitor submission ships a reproducible film source; the changelog is the release record and the only dated source for the tool.
status: adopted video/v2/layout.tsx

### Uniswap v4 hooks with a declared fee cap (v4-core v4.0.0)
https://github.com/Uniswap/v4-core/releases/tag/v4.0.0
released: 2025-01-23
edge: the hook runs inside every swap, so the pool itself enforces a maximum take. CappedTakeHook reads a per-token cap from CapRegistry and reverts with FeeAboveCap when an update would exceed it, and a take over the cap reverts with TakeExceedsCap. A v3 position has no hook layer, so that cap cannot be enforced on chain at all. Uptick ships its own cap contracts rather than a third-party hook.
competitors: `gh search code "beforeSwap take"` returned 34 hooks that take a fee, none declaring an on-chain cap; `gh search code "CappedTakeHook"` returned 1 hit, only ours.
status: adopted contracts/src/hook

### ERC-8056 Scaled UI Amount: a split that does not misprice the pool
https://eips.ethereum.org/EIPS/eip-8056
released: 2025-10-20
edge: a tokenized stock carries a `uiMultiplier()` shares-per-token ratio, so the hook scales the Chainlink answer to the raw token before deriving the pool price. Without that scale a split or any corporate action would make the hook mistrust the oracle and fall back to the session fee on every swap until a keeper reset it. Authors include Robinhood, Coinbase and Superstate.
competitors: `gh search code "uiMultiplier"` returned 20 hits, including chain SDKs and ports (Tron TIP-8056, BNB BEP-677); none is a liquidity vault that scales the oracle by the multiplier before pricing a swap.
status: adopted contracts/src/hook/UptickHook.sol

### Stale-Robust Tokenized-Stock Measurement (NEST), arXiv 2610.21491
https://arxiv.org/abs/2610.21491
released: 2026-10-15
edge: defines how a tokenized-equity mark is unreliable while the listed market is closed, the exact regime the replay engine measures. It gives a named method for the off-hours reliability question that sits behind the gate.
competitors: `arxiv all:"tokenized stocks"` returned 4 papers and this is the only one on stock-token mark reliability; none applies it to a liquidity vault.
status: candidate

### @uniswap/v3-sdk 3.31.5: off-chain position and range math
https://www.npmjs.com/package/@uniswap/v3-sdk
released: 2026-09-24
edge: computes tick bounds, liquidity and amount math off chain, so the keeper and the web size a range without a node round trip or a subgraph lookup.
competitors: the Robinhood Chain dashboards read pools through public APIs and subgraphs and do no client-side range math; `gh search repos "uniswap v4 hooks" --sort updated` returned 100 repos, launchpads and hook forks, none with an off-chain range calculator.
status: candidate

### x402 Foundation (Linux Foundation, 2026-07-14): paid requests for agents
https://x402.org/linux-foundation-announces-operational-launch-of-x402-foundation-to-standardize-internet-native-payments-for-ai-agents-and-applications/
released: 2026-07-14
edge: x402 revives HTTP 402 as a paid-request standard under vendor-neutral governance (Adyen, AWS, Amex, Circle, Cloudflare, Coinbase, Google, Mastercard, Visa), so the evidence API or the MCP endpoint could meter a call per agent. Uptick charges nothing today, so this is a candidate for a paid tier rather than a current adoption.
competitors: `treg catalog "agent payments"` returned 0 platforms; the chain's products are free read APIs and none meters an agent endpoint.
status: candidate

### Chainlink Robinhood Tokenized Equity Feeds: oraclePaused() and a staged multiplier
https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood
released: 2026-10-16
edge: the Robinhood stock feeds are a Total Return mark (underlying price times the token's `uiMultiplier()`), and the source also exposes `oraclePaused()` for a corporate-action halt and a staged path (`newUIMultiplier()` plus `effectiveAt()`) that pre-announces a split. Uptick's gate reads `latestRoundData()` and `uiMultiplier()` only and compares `updatedAt` against a flat wall-clock `maxStaleness` with no market-hours term and no `oraclePaused()` read (`contracts/src/StockVault.sol` `_read`, `contracts/src/hook/UptickHook.sol` `_reference`), so a closed market reads as a dead oracle and a staged split is invisible. Measured on 4663 for AAPL `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9`: `oraclePaused()` = false, `uiMultiplier()` = 1.000566, `newUIMultiplier()` = 1.000566, `effectiveAt()` = 1786720366; on Sunday 2026-10-18 the feed's `updatedAt` was Friday 19:17 UTC, 39h 52m old, so the flat gate would block every deposit and every hook swap for the weekend while the keeper's own NYSE calendar (`keeper/src/calendar.ts`) knew the market was shut. Reading the pause flag and making `maxStaleness` session-aware closes the gap.
competitors: the quotum desk states publicly that its contracts "read chainlink RHNVDA/USD, which holds friday's print all weekend" and asks the Robinhood CEO whether weekend trading will change it; `useverdex` sells weekend pricing as its product, patching the same hole off chain. `gh search code "oraclePaused"` returned Chainlink's own docs and external-adapters only, no chain-side vault.
status: spike spikes/chainlink-equity-gate/verify.py

### Chainlink 24/7 Extended-Hours Data Feeds (2026-10-16): an hours-aware mark for the gate
https://docs.chain.link/data-feeds/24-7-extended-hours-data-feeds
released: 2026-10-16
edge: a blended mark that keeps publishing across pre-market, post-market and overnight, plus L2 sequencer-uptime feeds for the deposit path. It is the second source a session-aware `maxStaleness` can consult when the regular equity feed stops at the close, so the vault distinguishes "market closed" from "oracle dead" with a number instead of a calendar guess.
competitors: the same quotum and Verdex desks treat the regular feed as weekend-dead and work around it; none reads an hours-aware blend, and `gh search code "24/7 extended hours"` returned no chain-side consumer.
status: candidate

### ERC-8056 reference implementation and npm package (erc8056)
https://github.com/nirholas/robinhood-chain-erc8056
released: 2026-10-11
edge: a canonical explainer plus a published `erc8056` npm package for the `uiMultiplier()` corporate-actions standard behind Robinhood's Stock Tokens, useful to cross-check Uptick's own scaling and to speak the standard in the docs. It is a reference, not a dependency: our hook stays self-contained.
competitors: `gh search code "uiMultiplier"` returned this repo and `fskroes/wallie-prestocks` for the standard, the rest unrelated arbitrary-precision libraries; no vault scales the oracle through it.
status: candidate

### Robinhood Chain sequencer feed decoder
https://github.com/chainstacklabs/robinhood-chain-sequencer-feed
released: 2026-10-12
edge: decodes the Arbitrum Nitro sequencer feed for chain 4663, so the keeper can time an inclusion against the sequencer rather than guessing. Robinhood Chain orders by arrival with no priority fee, so knowing the feed position is the lever for a swap landing in the intended block, which the rebalance path cares about.
competitors: `gh search repos "robinhood chain"` returned this and read-only dashboards; no vault measures its own inclusion against the feed.
status: candidate

### permissionless 0.5.0: ERC-4337 gasless deposits on 4663
https://www.npmjs.com/package/permissionless
released: 2026-10-15
edge: a bundler/paymaster client so a deposit is a userOperation a sponsor pays for. The EntryPoint contracts are live on Robinhood Chain (v0.8 `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` and v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032` both carry bytecode at block 91719088) and Alchemy Gasless is a named chain partner, so a Robinhood app user with no ETH can deposit into a vault. The default path today makes the depositor hold and spend ETH.
competitors: the chain's own vault-frontends and the games surface a wallet and an ETH balance; none of the Robinhood Chain products in `gh search repos` routes a deposit through a paymaster.
status: candidate

### @morpho-org/blue-sdk 8.0.0: read the borrow market a vault lends into
https://www.npmjs.com/package/@morpho-org/blue-sdk
released: 2026-10-14
edge: typed reads of Morpho Blue markets (utilization, LLTV, rate) so a vault that parks idle USDG in the borrow market sizes and watches the position in typed code. Flagged weaker: Morpho is the default lending leg on this chain (Morpho is a named Robinhood partner and the `pichifi-yieldy` vault already lends through it), so this is table stakes, not a differentiator.
competitors: `gh search code "@morpho-org/blue-sdk"` returned base/docs and morpho-org/sdks; `zzzbedream/pichifi-yieldy` already integrates Morpho, so adopting it does not separate us.
status: candidate

### Mitigating Adverse Selection in CL AMMs with Dynamic Fees, arXiv 2606.23070
https://arxiv.org/abs/2606.23070
released: 2026-06-22
edge: an agent-based model of the dynamic-fee response to adverse selection, the same regime Uptick's replay engine measures as fee per dollar of markout. It gives a named method for the fee schedule the hook applies by session, so the take is argued from a model rather than tuned by hand.
competitors: `arxiv all:"adverse selection AMM fee"` returned 0; the closest is this and the LVR line the competitors cite; none ties the schedule to a measured markout split on stock tokens.
status: candidate

### Active Liquidity On Chain: Evidence from PropAMMs Across Chains, arXiv 2609.38056
https://arxiv.org/abs/2609.38056
released: 2026-09-29
edge: cross-chain evidence on how professional AMM liquidity behaves, relevant because Rialto PropAMM is a named Robinhood Chain partner and the vault competes for the same fills. It frames what a passive vault is up against, which sharpens the "why a vault beats self-managing a v4 position" argument.
competitors: `arxiv all:"propAMM"` returned this paper; no Robinhood Chain product cites cross-chain PropAMM evidence.
status: candidate

### Optimal Block Time for AMM Liquidity Providers under Jump-Diffusion, arXiv 2608.30321
https://arxiv.org/abs/2608.30321
released: 2026-08-31
edge: ties block cadence to LP adverse selection, which speaks directly to Robinhood Chain's FCFS arrival ordering and the sequencer-feed timing the keeper can exploit. It is the framing for why the rebalance lands in the intended block.
competitors: `arxiv all:"block time AMM"` returned this paper; no chain product reasons about its own inclusion cadence.
status: candidate

## Sweep log

- twitter search "tokenized stocks yield" -> 20 hits, Superform Earn Stocks on Aave V4 and Kraken x Veda on tokenized stocks, both off our chain
- arxiv all:"tokenized stocks" -> 4 papers, NEST 2610.21491 the only one on stock-token mark reliability
- curl https://r.jina.ai/eips.ethereum.org/EIPS/eip-8056 -> 1 hit, ERC-8056 created 2025-10-20, Robinhood and Coinbase among the authors
- gh search repos "robinhood chain" -> 100 hits, read-only dashboards, launchpads and hook forks, none with replay evidence
- gh search code "uiMultiplier" -> 20 hits, chain SDKs plus Tron TIP-8056 and BNB BEP-677 ports
- gh search repos "robinhood chain mcp" -> 6 hits, generic chain MCP servers, none vault-aware
- npm view @uniswap/v3-sdk -> 1 package, latest 3.31.5 published 2026-09-24
- treg catalog "stocks" -> 1 platform, Stock Market Data with splits and dividends endpoints for corporate actions
- treg catalog "agent payments" -> 0 platforms, nothing to adopt for metered agent calls yet
- twitter search "Robinhood Chain tokenized stocks" -> 10 hits, chain launch chatter, nothing using the oracle pause flag
- twitter search "uniswap v4 hook Robinhood" -> 10 hits, a Game Mode v4 hook launching on Robinhood, no vault or oracle gate
- twitter search "tokenized equity yield vault" -> 10 hits, EQX Labs and other off-chain-yield posts
- twitter search "Robinhood Chain " -> 8 hits, a chain meme coin, imdLend IMD-seat market, a Metric AMM launchpad, a chain launchpad, none reading oraclePaused()
- twitter search "rhNVDA" -> 6 hits, a sealed-price markout game reading Chainlink RHNVDA/USD at the 20:00 UTC bell
- twitter search "robinhood chain yield" -> 8 hits, PARE yield layer for tokenized stocks, Aerodrome/Arbitrum stablecoin posts
- twitter search "Pare tokenized stocks yield" -> 8 hits, PARE (ERC-8056 principal and yield tokens, under Pashov audit) and IPOR Fusion Earn on Stocks at $2.5M on Base
- twitter search "chainlink RHNVDA weekend" -> 8 hits, quotum tells the Robinhood CEO its contracts "read chainlink RHNVDA/USD, which holds friday's print all weekend"; useverdex sells weekend pricing
- twitter search "robinhood chain vault deposit" -> 8 hits, Vault Street idle bank tycoon, no oracle-aware vault
- arxiv all:"ERC-4626 vault" -> 1 hit, all:"loss-versus-rebalancing" -> 32, all:"oracle manipulation" -> 10, all:"tokenized equity" -> 2, all:"MARKOUT" -> 4, all:"Uniswap v4 hook" -> 0
- gh search repos "robinhood chain" -> 10 recent, robinhood-cli, rh-swap, robinhoodpools, a sequencer-feed decoder, an awesome list, none a vault
- gh search code "oraclePaused" -> Chainlink documentation and external-adapters-js only, no chain-side vault
- gh search code "uiMultiplier" -> nirholas/robinhood-chain-erc8056 and fskroes/wallie-prestocks on point, the rest unrelated big-int libraries
- cast on chain 4663 (block 91719088) -> EntryPoint v0.8 and v0.7 deployed; ArbSys 0x64 arbOSVersion() = 116, an Arbitrum Nitro orbit chain
- python3 spikes/chainlink-equity-gate/verify.py -> all 10 checks pass on live AAPL; the freshness check fails when the market-hours term is removed, so it can fail
