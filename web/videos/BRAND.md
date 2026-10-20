# Uptick video kit

The look, rules and code for every Uptick film. Each film prompt points here and only adds its story.
Sources: https://uptick-fi.pages.dev, `web/DESIGN.md` (locked design system, wins over the product-film skill), `web/app/globals.css`, `web/lib/vault-universe.json`, `README.md`, `~/.agents/tools/mktg/products/uptick/facts.yaml`. When this file and the repo disagree, the repo wins.

## The brief (interview answers supplied by the launching agent)
- Plays: Launch is an X post, muted autoplay. Fee-loop is a seamless loop. Format: Launch 16:9 1920x1080, 20 s. Fee-loop 1:1 1080x1080, 8 s.
- Music: silent, no voiceover. Both read with the sound off.
- Must show: the three doors list with to-scale bars, NVDA, the fee-split bar, the gate scale, the verdict line, the end card.
- Ingredients: UI only plus the wordmark. Words are the product's own UI text and its serif verdict. Scenes connect with camera moves and one magic move (the NVDA ticker). No cursor, no partner logos, no texture.
- Ending (Launch): the wordmark "Uptick" and `uptick-fi.pages.dev`. Fee-loop has none: it folds back to its first frame.

## Hard rules
- Casing: sentence case, no uppercase caps labels (web/DESIGN.md refusals).
- Type: Hanken Grotesk for everything, Literata once per screen for the verdict sentence, roman, never italic (web/DESIGN.md typography). Tabular figures.
- Corners: 4px (`rounded-sm`) on bars, 8px panels, pill for chips (web/DESIGN.md rounded).
- Surfaces: background `#0a0b0c` only. Hairline rules `#2a2e31`. No cards, no panels, no gradients, no glow (web/DESIGN.md).
- Accent: kept-green `#1fd16b` only on a figure the holder keeps. Loss orange `#ec5e2a` only on money lost. Closed is grey, never red.
- Copy: no em dash or en dash, no prize amounts, no line-of-code counts. Every figure comes from `vault-universe.json`.
- Claims: see Claims.

## Frame
- Framing: full bleed on `#0a0b0c`. A twin is laid out at the site's own CSS px and scaled: home 1.5x (1160 design px), vault page 1.85x (930 design px), fee-loop 2x (480 design px). Content stays 75 px or more from the edges at rest.
- No wallet button, no wallet state anywhere (owner rule).

## Color
| Token | Value | Use |
|---|---|---|
| canvas | `#0a0b0c` | background |
| fg | `#f4f5f5` | text |
| mute | `#919fa6` | labels |
| hairline | `#2a2e31` | rules, closed band |
| line | `#42494d` | the fee total before it is split (the control border token) |
| kept | `#1fd16b` | kept figures and bar |
| kept-dim | `#0f3d24` | Open band |
| loss | `#ec5e2a` | lost to informed traders |
| loss-dim | `#3a1d12` | recentring segment |
| caution / caution-dim | `#f2b84b` / `#352a12` | Reduced band |

Hex only for anything that animates (`src/tokens.ts`). Classes in twins use the same names through the site's own `@theme`.

## Type
- Fonts: the two variable woff2 files the site ships (next/font latin subsets) copied to `public/fonts/`, loaded by `src/fonts.ts`.
- Sizes: the site's own px at the film scale. At 1080p the smallest label is 13 x 1.5 = 19.5 px (home), 24 px on the vault page, 26 px in the loop.

## Components
| Need | Component | In films |
|---|---|---|
| Section title, state chip, kept figure, row axis | `components/ledger.tsx` | imported as is (pure, no clock) |
| Row bar | `ledger.tsx` RowBar | twin in `twins/home-view.tsx`: the bar grows from the zero tick |
| Home list | `components/home-view.tsx` | twin: hooks (`useHoldings`), `next/link`, wallet call to action |
| Fee-split bar | `components/leak-bar.tsx` | twin in `twins/leak-figure.tsx`: segments, labels and legend driven by 0..1 values |
| Gate scale | `components/gate-scale.tsx` | twin in `twins/gate-figure.tsx`: bands wipe in, marker and dot land |
| Geometry | `lib/leak.ts`, `lib/format.ts` | imported as is, so widths and strings match the site |
| Data | `lib/vault-universe.json` | imported as is through `src/data.ts` |

## Motion
- The site's ease `cubic-bezier(0.22, 1, 0.36, 1)` for every entrance (`src/motion.ts`). Camera on the kit's heavy spring. Ticker traveler on stiffness 150, damping 20.
- Entrances are opacity, a short blur and a small lift. No glow, no particles, no bounce.

## Claims
- The film may show: 17 vaults gated by a replay of the chain's own swaps (30 days to 2026-10-17), 2 open, 5 reduced, 10 closed; each vault's kept figure in its weaker half; NVDA fees 40.9% a year, 31.1% lost to informed traders, 2.8% recentring, kept +6.9% over 30 days and +1.8% in its weaker half.
- The film never shows: a deposit confirming, a transaction, a wallet address or state, live deposits, mainnet.
- Approved lines: "Which of your stock tokens can earn, and how much you would keep." (home h1), "NVDA kept +1.8% a year in its weaker half." (vault verdict without its door sentence).
- Words to avoid: anything promising a yield.

## Workspace
- `web/videos` is its own package (pnpm, `--ignore-workspace`), Remotion 4.0.537 and every `@remotion/*` at that exact version. `web/tsconfig.json` excludes `videos` so the app build never compiles it.
- `webpack-override.ts` enables Tailwind v4 through Remotion's bundled copy, aliases `@` to the web root and pins one React.
- `src/styles.css` imports the site's `app/globals.css`.
- Scripts: `scripts/stills.ts` (review stills, `--debug` prints `[data-target]` boxes), `scripts/sheet.sh` (contact sheet), `scripts/media.ts` (Node API render; the `remotion render` CLI hung at "Getting composition" here), `scripts/render.ts` (240 fps master, tmix motion blur, X-ready H.264), `scripts/verify.py`, `scripts/beat-sheet.ts`.
- Output: `out/<film>/vN/` (gitignored). Deliveries: `brand/x/films/`.
