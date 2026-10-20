---
version: alpha
name: Uptick-ink-and-hairline
description: A Robinhood-derived custom system for Uptick. Black canvas, one hairline-ruled column of facts, one sticky action ticket, a serif used once per screen for the sentence that carries the argument ("what you keep, and whether it is open"). One accent, one job: the green of money the holder keeps. Replaces the earlier Wise-derived system (lime pill, sage canvas, Archivo 900).

sources:
  robinhood-stock: https://robinhood.com/us/en/stocks/NVDA/ (refs/rh-nvda-stock-1440.png, .tokens.json)
  robinhood-crypto: https://robinhood.com/us/en/crypto/ETH/ (refs/rh-crypto-eth.png, rh-crypto-eth-full-1440.png)
  robinhood-chain: https://robinhood.com/us/en/chain/ (refs/rh-chain-1440.png)
  robinhood-gold: https://robinhood.com/us/en/gold/ (refs/rh-gold.png)
  uniswap-pool: https://app.uniswap.org/explore/pools/ethereum/0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640
  aave-reserve: https://app.aave.com/reserve-overview/?underlyingAsset=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48&marketName=proto_mainnet_v3
  hyperliquid-vault: https://app.hyperliquid.xyz/vaults/0xdfc24b077bc1425ad1dea75bcb6f8158e10df303
  coinbase-asset: https://www.coinbase.com/price/ethereum
  research: design-research/REFS.md

colors:
  canvas: "#0a0b0c"          # off-black. Robinhood canvas is #000 (robinhood-stock html bg); lifted one step so panels read as surfaces.
  panel: "#16181a"           # order-ticket surface. Robinhood measured panel rgb(31,33,36) = #1f2124 (rh-crypto-eth px 1100,300); Uptick sits one step darker.
  panel-raised: "#1f2124"    # a panel inside a panel is banned; this is for hover and the active tab only.
  hairline: "#2a2e31"        # section rule. Robinhood measured rgb(49,54,58) = #31363a (rh-crypto-eth px 500,589); Uptick slightly quieter.
  border: "#42494d"          # outlined control and ticket border. Robinhood measured rgb(66,73,77) (rh-crypto-eth px 1086,300).
  text: "#f4f5f5"
  mute: "#919fa6"            # Robinhood measured rgb(145,159,166), p / label colour on rh-crypto-eth tokens.json.
  kept: "#1fd16b"            # the one accent. Used only on a figure the holder keeps, and the Open chip text. Never on a button.
  kept-dim: "#0f3d24"        # 20% kept on canvas, for the Open chip fill and the kept bar track.
  loss: "#ec5e2a"            # Robinhood measured rgb(236,94,42) on the crypto chart line and buy button. Used here only for money lost to informed traders and costs.
  loss-dim: "#3a1d12"
  caution: "#f2b84b"         # Reduced-cap state only.
  caution-dim: "#352a12"
  closed: "#6b747a"          # Closed is protective, not danger: neutral grey, never red.
  on-action: "#0a0b0c"
  action: "#f4f5f5"          # primary action is a white pill on black (Robinhood chain page "Copy link" modal button; Uniswap Connect is pink and is not taken).

typography:
  display:
    fontFamily: Literata
    use: the single verdict sentence on a screen. Roman, never italic. Robinhood speaks its brand sentence in a serif (Martina Plantijn 72px / 400 / -1px / 78px leading, robinhood-chain tokens.json) over a grotesk UI; Literata is the free stand-in.
    load: next/font/google, axes opsz, weights 400 and 500
    scale: 44px/48px -1.1px (desktop verdict), 30px/34px -0.6px (390px verdict)
  sans:
    fontFamily: Hanken Grotesk
    use: everything else. Capsule Sans (Robinhood) is proprietary; Hanken Grotesk is the free humanist grotesk closest in proportion, has tabular numerals.
    load: next/font/google, weights 400 500 600
    scale:
      title: 32px/40px 500 -0.33px   # robinhood-stock h1 Capsule Sans Display 32px / 500 / -0.33px / 40px
      section: 24px/32px 600 -0.2px  # robinhood-stock "About NVDA" 24px bold
      body: 15px/24px 400 -0.1px     # robinhood-stock p 15px / 24px / -0.1px
      label: 13px/20px 400 -0.1px    # robinhood-crypto label 13px / 19.89px, colour mute
      figure-l: 32px/36px 500 tabular-nums
      figure-m: 20px/24px 500 tabular-nums
      figure-s: 15px/20px 500 tabular-nums
  rule: at most two typefaces. Tabular numerals on every figure. Addresses are Hanken Grotesk tabular, truncated 0x1234...abcd, never a monospace face. Display tracking negative, small labels normal (never uppercase caps with tracking).

rounded:
  panel: 8px
  control: 8px
  pill: 9999px               # action buttons, chips. Robinhood buttons radius 36px (robinhood-chain tokens.json), Coinbase 100000px.
  hairline-box: 4px          # outlined risk boxes, Aave radius 4px (aave tokens.json)

spacing: 4px base. Section gap 48px, row padding 16px, ticket padding 20px, column gap 24px. Reading column max 690px (Arrakis docs column x 363 to 1052). Page max 1280px, gutters 24px (Robinhood content starts x 24).

layout:
  page: one content column of bare content separated by 1px hairlines, plus one sticky ticket 330px wide on the right (robinhood-stock: column x 24 to 1062, ticket x 1086 to 1416, 330px).
  rule: nothing is boxed except the thing you act on and the outlined risk parameters. No card inside a card. No three equal cards. No stat grid.
  list: dense rows 56px pitch with 1px separators, name left, figures right-aligned, one quiet control per row (Kamino rows about 58px).

components:
  verdict: the first thing on the page. One serif sentence, at most two lines, that states what the holder keeps and whether the vault is open. Followed by one sentence of reason from gate.reason.
  keep-ledger: rows of label left and signed figure right: Fees earned, Lost to informed traders, Costs, Kept. Kept row is the only kept-green figure. This replaces any gross-APR hero.
  state-chip: Open (kept text on kept-dim), Reduced (caution on caution-dim), Closed (closed grey on hairline). Text always present, colour never alone.
  ticket: panel with 1px border, label/value rows, one white pill primary. Lists what you send, what you receive, where it goes, before the button.
  tabs: 16px text, 2px underline on the active one (robinhood-stock range tabs).
  term: first use of a domain word is dotted-underlined and opens a plain definition (Coinbase glossary labels). The definition is a 280px panel that opens on hover and focus, stays in the DOM for aria-describedby, and closes on Escape. Defined words: taking deposits, kept, worst half, open, reduced, closed.
  panel-beside-list: on the vaults list at 1024px and up, a row click loads that vault's deposit form in a 360px panel pinned at top-20 (Zona Lend, 877 table / 369 panel). The chevron at the row end opens the vault page. Under 1024px a row opens the page.
  token-logo: 28px disc on rows, 32px pair (stock over USDG) in the panel, 40px pair on the vault page. Files are the token's own published icon (public/tokens/SOURCES.md); a missing file becomes a two-letter monogram chip.
  summary-row: four label-over-value facts between hairlines, 24px figures, each with its window or origin under it. No TVL until a vault is on mainnet.
  amount-chips: 25%, 50%, 75% and Max under the amount, 28px tall pills, disabled until a balance is read.

motion: 120ms to 200ms ease-out on hover and tab change only. One entry: the verdict fades in 200ms. One ticker: the bottom strip of live Chainlink prices, 36px, scrolling a full loop in 80s on transform only, paused on hover and focus; no sparkline, no other moving price. Loading skeletons may shimmer. prefers-reduced-motion stops the ticker, which then scrolls by hand, and collapses the rest.

refusals:
  - no lime, no sage, no pill-shaped green CTA, nothing derived from Wise
  - no gross fee APR as a hero, no figure larger than 32px (the serif verdict is words, not a metric)
  - no eyebrow caps above headings, no status pills stacked on cards, no ghost numbers
  - no gradients, glow, glass, or 3D art
  - no Inter, Archivo, Figtree, Geist
  - no em dash or en dash in any string
  - no empty states that read "No data"

structure-stolen-from: Robinhood stock and crypto detail (column plus sticky ticket), Aave reserve (outlined risk boxes, header stats without a hero), Hyperliquid vault (personal and global numbers in one row), Kamino (dense vault rows), Coinbase (glossary labels), Arrakis docs (690px reading column).
---

# Uptick design system

Art direction. Uptick is the calm page a Robinhood Wallet user lands on before putting a stock token to work: black, ruled, quiet, one sentence in a serif that tells them what they would keep and whether the door is open. The numbers do the persuading, laid out as a ledger of what comes in and what leaks out, ending on the one green figure that is theirs.

Page skeleton. Header (64px, 1px rule): wordmark, Vaults, Portfolio, Docs, wallet. Vault page: breadcrumb, title row with state chip, verdict sentence, keep-ledger, risk boxes (weaker half, swaps replayed, floor), pool and addresses, then the ticket pinned on the right. Home: verdict about the user's tokens, then the ruled list of 17 vaults ordered by what you keep.

Colour budget 70/20/10. 70 canvas and hairlines, 20 text and mute, 10 split between kept-green, loss-orange and caution. The accent has one job.

Primary job of the vault page: decide whether to deposit (what do I keep, what is the risk, is it open). Primary job of home: see which of my stock tokens can earn and how much I keep.
