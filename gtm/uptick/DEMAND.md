# uptick: what users said they want

One block per piece of evidence. The quote is verbatim from the URL; `gtm verify` fetches it.
Minimums: 3 X authors, 2 Reddit/HN/forum threads, 2 blogs or newsletters, 1 paper.

### They want borrow/lend markets on tokenized stocks so holders earn yield without selling
https://x.com/Nibel_eth/status/2109362739504435283
> borrow/lend markets, where users can get yield by lending stock or pay yield by shorting stock
who: @Nibel_eth
date: 2026-10-11
means: The top missing primitive, stated first, is a stock holder earning yield while keeping the position. That is the deposit-and-keep-exposure flow the vault implements.

### They are LP'ing tokenized stocks on Robinhood Chain by hand and getting real yield
https://x.com/WazzCrypto/status/2110798586254344623
> I'd have been massively profitable on RH chain if I had stuck to LP'ing tokenized stocks
who: @WazzCrypto
date: 2026-10-15
means: Users already provide liquidity on stock tokens for yield and report near-triple-digit returns in size. The rebalancing and in-range management they do manually is exactly the work a managed vault should absorb.

### They want tokenized equities to plug into DeFi lending markets to earn yield while held
https://x.com/JackNomadsGOD/status/2110043007349370881
> tokenized equities like xStocks need to plug directly into defi lending markets so users can earn yield on SPYx or NVDAx while holding them
who: @JackNomadsGOD
date: 2026-10-13
means: An explicit ask for yield infrastructure on stock tokens, ending in "who is building the best yield infrastructure for this?". The open question is the wedge.

### They deposit stock tokens to earn yield in the same asset while keeping market exposure
https://www.reddit.com/r/solana/comments/1wg6c93/kraken_and_kamino_launch_yield_vaults_for/
> Clients holding SPYx, QQQx or NVDAx can deposit them and earn yield in the same asset while keeping market exposure.
who: u/SolBrothers_
date: 2026-09-14
means: The exact deposit-and-keep-exposure flow is already a live product on another chain, so the demand is proven and the same trade on Robinhood Chain is the gap.

### Tokenized-stock listings and volume on Robinhood Chain are ramping
https://www.reddit.com/r/Superstonk/comments/1w8hy7h/tokenized_stocks_how_they_impact_gamestop_and_why/
> Recently, Robinhood released a bunch of new tokenized stocks backed 1:1 by the underlying stocks.
who: u/TheUltimator5
date: 2026-09-17
means: The asset class is listed and trading in size, so a yield product has a market to draw collateral from.

### Tokenized stocks have no borrow demand, and a stock vault is the fix
https://www.kiln.fi/post/tokenized-stocks-have-a-demand-problem-stock-vaults-fix-it
> Stock holders earn yield on assets that would otherwise just sit.
who: Kiln
date: 2026-03-11
means: A competitor names the same mechanism, borrow USDC against deposited stocks and pass a stablecoin-yield spread to holders, which validates the design and sets the bar the vault is measured against.

### Stock Token liquidity is paired against USDG on the chain
https://lex.substack.com/p/fintech-robinhoods-bet-to-bring-on
> Liquidity for Stock Tokens in Uniswap is against USDG
who: Lex (lex.substack.com)
means: Confirms the pair the vault targets, a stock token against USDG, is the one Robinhood itself routes its Stock Token liquidity through.

### Tokenized equities trade off-hours, so their marks and measurement deserve care
https://arxiv.org/abs/2610.21491
> Tokenized equities trade while listed markets are closed, so their marks could improve off-hours measurement
who: NEST (arXiv 2610.21491)
date: 2026-10-15
means: The off-hours and weekend trading that makes stock-token liquidity valuable also makes price marks unreliable, which is the reason the vault gates on a replay-verified engine rather than raw marks.
