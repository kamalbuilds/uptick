# uptick: design

What the user sees and does, screen by screen, and the visual system it uses.

## The core loop

Land, read what the pool pays, deposit a Stock Token, watch shares rise, redeem both tokens.
Every screen leads with a number a holder can act on: fee APR next to what LPs keep after losses to
informed traders. Evidence is not buried, it sits beside the deposit button.

## Screens

- **Home** (`/`): hero "Put your stock tokens to work", a featured vault card, and the three-step
  strip (deposit a Stock Token, uptick shows what LPs keep, fees come back to you). The featured
  vault leads with its kept APR and open state.
- **Vaults** (`/vaults`): one card per eligible Stock Token (NVDA, GOOGL, SPCX, CRCL). Each card
  shows the token, the selected pool and fee tier, fee APR, TVL and the open or closed badge.
- **Vault detail** (`/vault/[id]`): the deposit panel, the share price and portfolio, a band chart
  of the price range against the Chainlink mark, a why-this-pool block listing the session evidence
  (fee earned per dollar of 1 hour markout by session), and the tier comparison that picked this
  pool.
- **Portfolio** (`/portfolio`): connected wallet, per-vault share balance, current value, and the
  redeem path with both-token output.

## States (empty, loading, error, success)

- **Empty**: a wallet with no position shows the deposit call to action and the vault's evidence,
  never a blank table. A closed vault shows the closed badge and why, with the deposit control off.
- **Loading**: shimmer blocks in the sage palette for cards, band chart and figures, so the layout
  does not jump when data lands.
- **Error**: RPC or API failure keeps the last good numbers with a status chip, and the deposit
  button disables rather than sending an unverifiable transaction. A failed simulation blocks the
  write with the revert reason in plain language.
- **Success**: mints and redeems show a pending then confirmed state with the transaction hash and a
  link to the explorer.

## Visual system

- **Fonts**: Archivo with the width axis for display (weight 900, 86% stretch), Figtree for body,
  Geist Mono for every figure with tabular numerals. Loaded with `next/font`, `display: swap`.
- **Palette**: acid lime primary `#9fe870` on a sage canvas `#e8ebe6`, ink `#0e0f0c` and deep green
  `#163300` for text. Semantic only beyond that: positive `#2ead4b`, warning `#ffd11a`, negative
  `#d03238`. Never decorative green or red.
- **Type scale**: fluid display `clamp(3rem, 12vw, 5.5rem)`, section heads `clamp`, body 16/24.
  Figures always monospace and tabular so columns of APR line up.
- **Spacing and radius**: 4/8px rhythm, radius 8/12/16/24px. Cards are sage-on-white with a sage
  line, one primary accent, no gradient except the loading shimmer.
- **Motion**: one ease, `cubic-bezier(0.22, 1, 0.36, 1)`. Entrance rises stagger by index. Motion
  carries the argument (the band chart draws the range, the number counts to the kept APR), it does
  not decorate.
- **Semantics**: green means healthy or profit, yellow means warning, red means danger or loss, used
  only for their meaning. Irreversible actions (deposit, redeem) show a plain-language summary of
  what leaves and what returns, then a pending and confirmed state.
