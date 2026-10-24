# Weekend hedge evidence

Uptick sizes a Lighter Robinhood Chain perp short for the stock leg of a holder's Stock Tokens, prices the weekend from live Lighter reads (order book at the holder's size, funding, fees) and Morpho borrow carry, and hands the holder to `https://robinhoodchain.lighter.xyz/trade/<SYM>` with the order filled in. Every figure below is printed by a script in `economics/` from the output files beside it.

| Figure | Value | Script | Output file |
|---|---|---|---|
| NVDA weekend short at $10k, net cost, mean of 16 weekends | 1.9 bp ($1.92) | `economics/weekend_cost.py` | `book.json`, `funding_weekends.json`, `web/lib/__fixtures__/morpho-nvda-usdg-borrow.json`, `web/lib/__fixtures__/lighter-orderbookdetails.json` |
| Round trip through the book at $10k | 2.30 bp median, 1.89 to 2.60 across five snapshots | `economics/book.py` | `economics/book.json` |
| Funding a NVDA short earns over the 65 weekend hours | 3.37 bp mean, 16 weekends | `economics/funding.py` | `economics/funding_weekends.json` |
| Typical gap between pool and perp, hour by hour | NVDA 4.0 bp, AAPL 6.9 bp (median of nine weekly medians, 0.05% pools) | `economics/basis.py` | `economics/basis_out.json` |
| Unhedged weekend move of the NVDA pool, standard deviation | 135 bp over nine weekends | `economics/basis.py` | `economics/basis_out.json` |
| Pool against perp at the unwind (Monday 13:00 UTC), standard deviation | NVDA 6.4 bp, AAPL 9.5 bp, TSLA 22.0 bp | `economics/closetime.py` | `economics/closetime.json` |
| Pool against perp at the open (Monday 13:30 UTC), standard deviation | NVDA 17.8 bp, AAPL 15.0 bp, TSLA 18.5 bp | `economics/closetime.py` | `economics/closetime.json` |

`economics/evidence.py` prints every row above except the net cost from the tracked outputs, and `economics/weekend_cost.py` prints the net cost with each of its terms (slippage, fees, margin interest, funding) on its own line. The pools are the fee tiers of the Uptick vaults: NVDA and AAPL on 0.05%, TSLA on 0.3%.

The unwind sits 30 minutes before the US open because the gap between pool and perp is nearly three times tighter there for NVDA (6.4 bp against 17.8 bp).

## Prior art

Atoma (DefiLlama `atoma`) runs a pooled USDC basis-trading vault across stock, index and commodity perps. Arcus (DefiLlama `arcus-perps`, `arcus-ptokens`) lists perps and leveraged pTokens on Robinhood Chain. Uptick sizes the short for the Stock Tokens a wallet already holds, or for the stock leg of its vault shares, and prices it at that wallet's size.

## Reproduce

```
python3 spikes/stock-hedge/economics/weekend_cost.py
python3 spikes/stock-hedge/economics/evidence.py
```
