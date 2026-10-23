# Uptick vault shares as Morpho Blue collateral

Prepared for a curator considering a USDG market on Robinhood Chain (4663) with an Uptick vault share as collateral.

## 1. What the collateral is

One share of a StockVault or StockVaultV4 is an ERC-4626 claim on a vault whose only asset is a single Uniswap position (v3, or v4 for PLTR, SPY and USO) holding a Stock Token and USDG, inside a range the vault sets (`contracts/SECURITY.md`). It is not a receipt for a token balance. Its value is the position's two legs plus idle balances, net of fees owed.

Redemption in kind is always open: no oracle, no swap, no pause (`contracts/SECURITY.md`). That is the property a lender relies on. Collateral can always be converted to the underlying tokens even when every priced path in the vault is closed.

Seventeen Stock Tokens are tracked and twelve vaults are launching: three open (PLTR, AAPL, GOOGL) and nine reduced, while five stay closed (`docs/facts.json`). Range differs per vault: 350 bps for PLTR, 750 bps for AAPL, 2,000 bps for GOOGL (`docs/facts.json`). The share is a concentrated position: past its range the position holds only the Stock Token, with the USDG it sold into sitting idle, so an out-of-range share prices like the stock (`contracts/SECURITY.md`).

## 2. How the oracle prices it

Price is the vault's USDG value times 1e36 divided by `totalSupply` plus 1e6 virtual shares, rounded down (`contracts/SECURITY.md`). Value marks the Stock Token at the Chainlink answer, marks USDG at 1, recomputes the position's legs at the Chainlink price, subtracts the treasury's cut of uncollected fees, and takes the lower of that and `totalAssets()` valued at the same answer (`contracts/SECURITY.md`). Pool spot is never read.

That last point is measured, not asserted. A 3% buy push in the pool moves the oracle price 0.97 bp; a 4% sell push moves it 1.35 bp; both are fully explained by fee income the position actually earned (`contracts/SECURITY.md`). A max borrower survives a 10% one-block pool crash, and Morpho refuses the liquidation as healthy (`contracts/SECURITY.md`). An AMM position is concave in price, so the oracle figure is a lower bound of what in-kind redemption pays at the feed price (`contracts/SECURITY.md`).

## 3. Weekend and stale-feed behaviour

The bound is 349,200 s, or 97 h (`contracts/SECURITY.md`). It is the same bound the live NVDA/USDG market oracle uses on its base feed. That oracle, at `0xED29D310cfa91778A5850538DA28ed42234Cb78c`, also applies 90,000 s to its USDG/USD quote feed and applies no corporate-action gate (`contracts/SECURITY.md`). Below 97 h this oracle answers with the last Chainlink print, so liquidations keep working; the vault's own priced paths close instead (`contracts/SECURITY.md`). Exactly 349,200 s still prices (`contracts/SECURITY.md`).

The record is 43,198 rounds over 123 days. Longest silences are 91.5 h for QQQ, 81.6 h for GOOGL and 80.8 h for SPY, so every silence stays under the 97 h bound, the closest being QQQ at 5.5 h under (`contracts/SECURITY.md`). Worst adverse close-to-open moves are 7.75% USO, 3.95% INTC, 3.88% MU, 2.83% AMD, 1.18% PLTR, 1.12% NVDA, 0.70% GOOGL, 0.68% AAPL (`contracts/SECURITY.md`). The share moves less than the feed: a 1.12% NVDA gap took the share down 0.59%, and a 7.75% USO gap took it down 6.32% (`contracts/SECURITY.md`). The keeper dataset applies a 0.9475 elasticity when deriving an LLTV per feed (`keeper/data/weekend-gaps.json`).

## 4. Recommended LLTV: 62.5%

The derivation in the dataset is one minus the worst adverse gap minus a 5 point buffer (`keeper/data/weekend-gaps.json`). Every launching feed supports at least 87.25% on that basis, and the tightest, USO, supports 87.25% (`keeper/data/weekend-gaps.json`). The 62.5% used by the live NVDA/USDG market therefore sits 25 to 32 points under every row (`contracts/SECURITY.md`). That market carries 728,682 USDG of supply, and 62.5% is enabled on the Morpho Blue singleton (`contracts/SECURITY.md`). The largest USDG markets for SPCX, GOOGL and AAPL also use 62.5% (`contracts/SECURITY.md`).

The bad-debt geometry matters more than the gap table. Morpho's incentive at 62.5% is 1 divided by (0.3 times 0.625 plus 0.7), which is 1.1268, so a position borrowed to the limit leaves bad debt after a further 29.6% share fall, or 37.5% to plain insolvency (`contracts/SECURITY-REVIEW-ORACLE-2026-10-23.md`). Because the share falls no more than the stock, this is the NVDA market's gap tolerance or slightly better (`contracts/SECURITY-REVIEW-ORACLE-2026-10-23.md`). Do not raise it. At 77% the bad-debt gap falls to 17.3%, inside the range of single-weekend equity gaps (`contracts/SECURITY-REVIEW-ORACLE-2026-10-23.md`).

## 5. The liquidation path

At 62.5% Morpho pays the liquidator 1.1268, a 12.68% bonus (`contracts/SECURITY-REVIEW-ORACLE-2026-10-23.md`). The liquidator repays the debt, receives the shares, and exits through `redeemInKind`, which needs no oracle and no swap (`contracts/SECURITY.md`). In-kind redemption pays the pool's actual composition, so the liquidator bears the pool's real inventory rather than a notional basket (`contracts/SECURITY.md`).

Exit depth was measured by selling NVDA into the live 0.05% NVDA/USDG pool with no Uptick liquidity in it. A $25,000 sale costs 14 bp, $62,500 costs 29 bp, and $100,000 costs 44 bp (`contracts/SECURITY-REVIEW-ORACLE-2026-10-23.md`). At the largest debt a $100,000 vault can carry, 29 bp is under one fortieth of the 12.68% bonus, so liquidation stays profitable (`contracts/SECURITY-REVIEW-ORACLE-2026-10-23.md`).

One operational rule for liquidators: redeem exactly the seized share amount, not the contract's whole balance. A dust mint to the liquidator in the liquidation block can revert a sweep-the-balance callback (`contracts/SECURITY-REVIEW-ORACLE-2026-10-23.md`). Morpho itself cannot be locked this way (`contracts/SECURITY-REVIEW-ORACLE-2026-10-23.md`).

## 6. Known residuals and how each is bounded

Stale feed. The price follows the last print for up to 97 h, identical to the NVDA market's base feed (`contracts/SECURITY.md`). The bound is the LLTV in section 4, not the feed age.

v4 pending-fee leak. When Chainlink sits above the TWAP, the treasury's cut of pending fees can reach the price: 13.2 bp of overvaluation, $132 of collateral value on a $100,000 cap, and $82 of extra borrow capacity at 62.5% (`contracts/SECURITY-REVIEW-ORACLE-2026-10-23.md`). It persists until the next harvest and adds 0.13 points to a bad-debt gap that starts at 29.6% (`contracts/SECURITY-REVIEW-ORACLE-2026-10-23.md`).

Issuer controls. A blocklist on the vault or Morpho, or a paused Stock Token, makes share transfers or in-kind redemption revert (`contracts/SECURITY.md`). This is the same trust a Stock Token market already carries.

Same-block share lock. Shares minted in a block cannot leave it, so supplying freshly minted shares as collateral needs the next block (`contracts/SECURITY.md`).

Donation. Tokens sent to the vault raise every holder's value, and the 1e6 virtual shares stop an empty vault from jumping (`contracts/SECURITY.md`).

Gas. `price()` costs about 323K with cold slots (`contracts/SECURITY.md`).

## 7. How a curator verifies an oracle is genuine

Every Uptick share oracle is deployed by `UptickShareOracleFactory`, and only for a vault registered in the production `VaultFactory`. The oracle factory records each oracle it deploys, one per vault, and each oracle exposes the factory and the vault it prices as immutables. A curator checks four things on chain before creating a market:

1. `oracleFactory.isOracle(oracle)` returns true.
2. `oracle.factory()` returns the production VaultFactory, and `VaultFactory.isVault(oracle.vault())` returns true.
3. `oracleFactory.oracleOf(vault)` returns the same oracle address.
4. The market's collateral token is `oracle.vault()` and its loan token is USDG.

A source-identical contract deployed by anyone else fails check 1, so the address of the oracle, not its bytecode, is what a market trusts.

## 8. The ask

List one market per open vault, so three markets: PLTR, AAPL and GOOGL. Use 62.5% LLTV on each, after the registry fix in section 7. Do not list a higher LLTV and do not open a second market on the same share. Publish the oracle address and each market id so depositors can check them against section 7.
