# Uptick deck design system

The deck is a presentation surface of the Uptick app and inherits `web/DESIGN.md` (Uptick-ink-and-hairline) without change: off-black canvas `#0a0b0c`, hairline rules `#2a2e31`, Literata for the one serif sentence per slide, Hanken Grotesk for everything else, tabular numerals, one accent (`#1fd16b`) used only on money the holder keeps, loss orange `#ec5e2a` for money lost, caution amber and closed grey for the vault doors.

Deck scale (1920 x 1080, about 1.33 times the 1440 app): serif sentence 66 to 72px (158px on the title slide only), figures at most 48px, body 26px, labels 22px, sources 18px. Refusals carry over: no gradients, no glow, no eyebrow caps, no ghost numbers, no card inside a card, no monospace, no italic, no em dash.

The Uptick step mark (`img/uptick-mark.svg`, from `brand/x/src/avatar.svg`) sits large on the title slide and as one 52px tile bottom right on every other slide (40px on the canvases). Token marks (`img/tokens/`, from `web/public/tokens/`) appear wherever a token is named, with a door ring on the title slide: kept green open, amber reduced, grey closed; tokens without a mark get a two letter monogram, as the app draws them. Charts are drawn from the real figures in HTML, one bar scale per chart.

Screens are real crops of https://uptick-fi.pages.dev captured with the ui-craft refshot script, wallet header cropped out.

Round 2 additions. The mark is drawn in the one accent (`#1fd16b`) on `#0e0f0c`, so the deck carries a single green; the lime of the retired system is not used. Real captures replace tables where the evidence is visual: the X posts (cropped above the quoted post), the /check verdict, the Blockscout transaction, the vault list. Terminal output and tool names are the one place a monospace face is used (system `ui-monospace`, never a loaded font), set in a panel with no window chrome. Greens mark money the holder keeps; the staircase on the ask slide and the yes mark on the competition slide are neutral white.
