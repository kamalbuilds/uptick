# Competitor UI patterns (2026-10-20)

Sources: refs/zona-*, refs/hh-*, refs/saffron-*, refs/autorange-*, refs/kamino-liq-2-1440.png, and the entries 11 to 16 in REFS.md. Y means the screen shows it, a dash means it does not. Morpho Steakhouse USDG sits behind a Terms of Use and sanctions attestation only the user can accept, so its column is empty.

| Pattern | Zona Lend | HedgeHood | Saffron | AutoRange | Kamino | Uptick before |
|---|---|---|---|---|---|---|
| Summary metrics row above the list | Y, 3 bare pairs | Y, 3 ruled pairs with period note | - | Y, card grid | Y, 2 header chips | - |
| Token logo on every row | Y (company marks, feather for ETFs) | Y (32px tiles) | Y (38px discs) | - | Y (pair discs) | - |
| Pair logo (stock + USDG) on vault identity | - | Y (header chip) | Y (vault rows) | - | Y (rows) | - |
| Live price per asset in the row | Y (supply value) | Y ($ per share) | - | Y (range card) | - | - |
| Bottom live price ticker | Y, 44px strip | - | - | - | - | - |
| Docked action panel beside the list, row selects | Y, 369px | - (own page) | - | - | - (modal) | bottom bar on the vault page only |
| Amount chips 25/50/75/Max | Y | Y (10/25/50/75/Max) | - | - | - | Max link only |
| Wallet balance line in the panel | Y | Y | - | - | - | Y |
| Definition tooltips on domain words | Y ("Collateral only", dotted + star) | Y (info glyphs on metrics) | - | - | Y (dotted TVL, APY) | dotted `.term` class unused |
| State grouping with counts | Y (Isolated tag) | Y (pills with counts) | - | Y (tabs) | Y (chips) | Open / Reduced / closed split on home only |
| Status chip with text | Y | Y (Epoch, Locked) | Y (ENDED) | Y (IN RANGE) | Y (verified) | Y |
| Capacity or size per row | - | Y (cap filled ring) | Y (3px bar) | - | - | - |
| Basis caption under a yield figure | - | Y ("2026 backtest", "last week's pricing") | - | - | Y ("7D") | Y (weaker half label) |
| Search with keyboard hint | - | Y ("/") | Y | - | Y | search without hint |
| Contract address with copy | - | Y | - | - | - | Y on vault page |
| Plain help links by the deposit form | - | Y (3 links) | - | - | - | - |
| Featured top cards by APY | - | - | Y | - | Y | - |

## Adopt, with why

1. Summary metrics row, bare label over value, each value naming its window and origin (Zona, HedgeHood, Kamino). Every competitor opens its list with 2 to 4 facts. Uptick opens with none, so a visitor must read 17 rows to learn what is on offer. Built only from numbers the site already holds: vaults taking deposits, swaps replayed, LP fees on these pools, Stock Tokens tracked. No TVL until vaults are on mainnet.
2. Token logo on every row and on the vault header, as a pair with USDG on the header (Zona, Saffron, Kamino). The ticker alone makes the list read as a spreadsheet. Source is Robinhood's own published token icon (the `logoUrl` of `api.robinhood.com/rhj/assets`, also the `icon_url` in Blockscout), with a monogram chip as the fallback.
3. Live Chainlink price per token in the row (Zona, HedgeHood). A holder checks the price they hold before they deposit; it also proves the feed is live. One multicall of 17 feeds, refreshed every 30 seconds.
4. A bottom ticker strip of those prices (Zona). It is the only competitor element that says "this is live" without a claim. It stops scrolling under prefers-reduced-motion and becomes a manually scrollable strip.
5. A docked action panel beside the list where a row click loads that vault's deposit form (Zona). It removes the page hop between choosing a vault and depositing. The existing deposit component is reused, so the signing path is unchanged.
6. 25/50/75/Max chips under the amount (Zona, HedgeHood). Both competitors ship them; typing a 18-decimal stock amount by hand is the slow part of a deposit.
7. "Taking deposits 7" as the primary frame, Closed collapsed (HedgeHood's counted pills, Zona's grouping). Open and Reduced both accept deposits, so the first thing a visitor should see is the count of doors that are open, not three states.
8. Definition tooltips on Kept, Weaker half, Reduced, Closed (Zona's "Collateral only", Coinbase's glossary, already in REFS.md entry 10). Uptick's vocabulary is its own; every competitor defines its own terms inline. Keyboard focusable and dismissible with Escape.

## Not adopted, with why

- Featured cards ranked by APY (Saffron up to 777%, Kamino): they lead with the gross number Uptick exists to correct.
- Cap-filled rings and TVL columns (HedgeHood, Saffron): vaults are not on mainnet, so the figure would be zero or invented.
- Borrow, health factor, Isolated tag (Zona): Uptick has no debt and every vault is its own contract.
- Coloured stat-card grids (AutoRange), sidebars (HedgeHood), tracked-caps eyebrows (HedgeHood, Saffron, AutoRange): DESIGN.md refuses all three.
