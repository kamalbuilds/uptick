# Uptick: 3 minute Founder House demo

Live app: https://uptick-fi.pages.dev.

One line: deposit NVDA, AAPL, GOOGL and 14 more Stock Tokens into a vault, earn a share of every trade's fee, borrow USDG against the share, and exit in kind. Uptick shows what you keep after losses to fast traders, and opens a vault only where 3,059,881 replayed swaps say it holds up.

Setup: one browser window, six tabs in order: the PLTR swap on Blockscout (https://robinhoodchain.blockscout.com/tx/0x1e8e2188254a7e72dc42b22f286935b0b6b800110a8bfe0ecabb4d6039f9fd36), `/`, `/vault/nvda`, `/docs/collateral`, `/docs/exit-in-kind`, `/research`. No wallet is connected for the opening; connect the demo wallet before the deposit. The Chainlink ticker in the footer runs on every page.

## 0:00 to 0:25 The real swap

Screen: the Blockscout page for transaction 0x1e8e2188254a7e72dc42b22f286935b0b6b800110a8bfe0ecabb4d6039f9fd36, block 70,152,155, status Success.
Say: "This is a real trade on Robinhood Chain. Nasdaq was shut, it was 10:21 at night in New York, and someone sold 95.8 PLTR into the PLTR and USDG pool at $186.51 while Chainlink read $184.67. The pool earned $178.30 in fees. An hour later its price stood at $183.75, and the people providing the liquidity were $241.83 worse off. Fees alone said 74 cents earned for every dollar lost. That is the number a pool page leaves out, and the number Uptick measures for every token."

## 0:25 to 0:50 The doors, `/`

Screen: the headline "Which of your stock tokens can earn, and how much you would keep."
Point at the four figures: Vaults at launch 12 (2 open, 10 reduced), Swaps replayed 3.1M over the 30 days to 2026-10-17, Fees paid to liquidity providers $996.6K on the 17 vault pools, Stock Tokens tracked 17.
Say: "We replayed every swap on 17 tokens. Every vault sits behind one of three doors. Open takes any amount. Reduced takes up to $25,000 a deposit. Closed takes none. The door comes from the replay, not from us."

## 0:50 to 1:25 Deposit, `/vault/nvda`

Screen: the NVDA vault, state chip Reduced, "Replay to 2026-10-17, 814,927 swaps".
Say: "NVDA kept +29.0% a year on the first 15 days and -6.8% on the last 15. The gate reads the weaker half, so the door is Reduced and a deposit is up to $25,000."
Connect the demo wallet, enter an amount under the limit, deposit NVDA. The panel shows the shares minted and the 0.35% entry fee that stays in the vault for the holders who stay.
Say: "I deposit the Stock Token itself, not USDG and not a pair. The vault holds roughly half NVDA and half USDG inside a band around the Chainlink price and recentres it every night after the NYSE session. The share rises as fees accrue."

## 1:25 to 2:05 Borrow against the share, `/docs/collateral`

Screen: the table "Deposit, supply, borrow" on the Borrow against a vault share page.
Say: "The share is collateral. Morpho Blue on Robinhood Chain, singleton 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010, lends USDG against NVDA already. An Uptick share is a second kind of collateral for the same loan: the Stock Token, plus the fees its position earns while you borrow."
Point down the four rows: Deposit in the vault, supply the share to Morpho, borrow USDG up to the 62.5% limit the NVDA market uses, repay and withdraw.
Say: "UptickShareOracle prices the share from Chainlink alone, so a swap in the pool never moves the liquidation price. A set-once Uniswap position cannot be posted as Morpho collateral. An Uptick share can."

## 2:05 to 2:30 Exit in kind, `/docs/exit-in-kind`

Screen: the exit preview on the NVDA vault, then the Exit in kind page.
Say: "Repay, withdraw the share, and redeemInKind pays out my slice of both tokens with no oracle gate and no swap, so the exit works when the feed is stale. A liquidator exits the same way."

## 2:30 to 3:00 Why it holds, `/research`

Screen: three notes, newest first.
Say: "58% of the swaps and half the fees in these pools happen while the NYSE is shut. Weekends pay $2.59 in fees for every $1 lost to fast traders, NYSE hours $0.97. The replay refreshes and each vault opens or closes on its new halves. Uptick shows which of your Stock Tokens earn, and lets the deposit keep working."

<!--
Sources, repo files regenerated 2026-10-23.
Opening: web/lib/real-swap.json (tx 0x1e8e2188254a7e72dc42b22f286935b0b6b800110a8bfe0ecabb4d6039f9fd36, block 70152155, 2026-09-23T02:21:36Z, sold 95.7986 PLTR, pool price 186.5087, Chainlink 184.6724, pool price an hour later 183.7504, pool fee 178.30, loss to liquidity providers 241.83, 178.30 / 241.83 = 0.74), written by keeper/scripts/moment.py and read back from the chain over the public RPC.
Home figures: web/lib/vault-universe.json (12 of 17 launch, 2 open, 10 reduced, 5 closed, swap total 3,059,881 is the sum of each vault's gate.swaps), web/lib/pool-fees.json (fee total $996,621.05, shown as $996.6K).
NVDA: web/lib/vault-universe.json gate and keep (814,927 swaps, first half +29.03%, held-out half -6.85%, state reduced, $25,000 a deposit), contracts/SECURITY.md Entry fee row (35 bp).
Borrow: web/app/docs/collateral/page.tsx (four steps, 62.5% limit of the live NVDA/USDG market, share priced from the Chainlink answer alone), Morpho Blue singleton and the NVDA market parameters in web/lib/morpho.ts; the Morpho calls and the borrow limit run against the real singleton on a 4663 fork (keeper, scripts/e2e-fork.sh). Wedge: a set-once Uniswap position cannot be posted as Morpho collateral; an Uptick share can, through UptickShareOracle.
Exit in kind: contracts/SECURITY.md row redeemInKind (no oracle, no swap, no pause), web/app/docs/exit-in-kind/page.tsx.
Research: web/lib/moment.json (58.0% of swaps, 49.8% of LP fees outside NYSE hours; weekend $2.59, NYSE hours $0.97 per $1 lost over the vault replay).
-->
