# Doing it yourself

Three ways to own the same Stock Token across the same 30 days, priced half by half on the same swaps with the same markout and cost model as the gate: hold it, open one Uniswap position by hand and leave it, or deposit into the Uptick vault, which recentres once a day after each NYSE session. Window 2026-09-17 to 2026-10-17, two halves of 15 days. Every range bound of the set-once position and of the vault sits on a multiple of its pool's tick spacing, rounded outward, so each is a position Uniswap can hold.

All 17 tokens are read in the half the gate reads, the vault's weaker half by kept:

- **Hold** is the token's price move at the vault's pool over the half: no fees, no position, the full inventory drift.
- **Set once** is one position in the vault's pool at the vault's band width, centred on the pool price at the start of the window and never moved. Its return is what the depositor of the token ends with against the deposit: the fees plus the position's mark at the end, less the deposit.
- **Uptick vault** is the same measure for the vault.
- **Kept** is the gate's own unit: fees less losses to informed traders and rebalancing cost, annualised, with the position's own price drift left out.

<!-- diy:start -->
| Token | Gate | Half read | Hold | Set once | Uptick vault | Set once kept a year | Vault kept a year |
|---|---|---|---|---|---|---|---|
| AAPL | Open | first 15 days | -0.8% | +0.4% | -0.1% | +4.3% | +2.7% |
| GOOGL | Open | first 15 days | -1.7% | -0.3% | -0.8% | +0.8% | +0.2% |
| QQQ | Reduced | last 15 days | -4.7% | -1.5% | -2.5% | -0.3% | -1.3% |
| AMZN | Reduced | last 15 days | +0.4% | +1.1% | +0.0% | +5.3% | -1.9% |
| INTC | Reduced | first 15 days | +17.3% | +7.0% | +6.3% | +10.4% | -2.2% |
| SPY | Reduced | last 15 days | -0.5% | +0.1% | -0.5% | -0.5% | -3.9% |
| USO | Reduced | last 15 days | +8.1% | +4.3% | +3.7% | -1.8% | -4.4% |
| AMD | Reduced | last 15 days | -14.6% | -2.6% | -7.8% | +3.8% | -4.7% |
| NVDA | Reduced | last 15 days | -7.7% | +0.4% | -6.9% | +14.1% | -6.8% |
| META | Reduced | last 15 days | -2.7% | -0.1% | -1.7% | -5.8% | -10.5% |
| MU | Reduced | last 15 days | -19.8% | -5.1% | -11.1% | -6.5% | -13.9% |
| PLTR | Reduced | last 15 days | -2.9% | +0.0% | -5.1% | +0.0% | -18.9% |
| TSLA | Closed | last 15 days | -0.6% | +1.2% | -1.1% | -13.2% | -25.8% |
| CRCL | Closed | last 15 days | -1.1% | +1.7% | -1.8% | -19.5% | -27.8% |
| MSTR | Closed | last 15 days | -14.9% | +0.0% | -10.8% | +0.0% | -43.0% |
| GME | Closed | last 15 days | +11.2% | +0.0% | +0.9% | +0.0% | -93.5% |
| SPCX | Closed | last 15 days | -2.3% | -0.8% | -8.5% | -91.3% | -195.4% |
<!-- diy:end -->

Returns are over the half's 15 days, on the deposit. A vault holds roughly half stock and half USDG while the price sits inside its range, so its return carries about half of the stock's move; the kept columns leave that move out.

## What the table shows

- The vault's return beats holding the token in 8 of 17 gate halves, because it carries only part of every move.
- In kept, a set-once range and the vault land within 2 points of each other on 3 of 17 tokens.
- The vault is a position nobody has to watch. It recentres itself, its share is an ERC-4626 token, `redeemInKind` pays out both tokens, and a share is collateral a lender can price: a set-once Uniswap position cannot be posted as Morpho collateral; an Uptick share can, through `UptickShareOracle` in a Morpho Blue market.

Source: `keeper/data/diy-baseline.json`, written by `keeper/replay/diy_baseline.py` over `keeper/data/replay.json`; this page is written by `scripts/diy-table.mjs`.
