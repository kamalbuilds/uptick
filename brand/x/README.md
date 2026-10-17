# Uptick X kit

Profile assets, post images and post copy for the Uptick account on X. Nothing here has been posted; the founder uploads and posts every item by hand. Post text, the bio and the reply plan live in `copy.md`.

## Assets

| File | Size | What it shows | Where it goes on X |
|---|---|---|---|
| `avatar-400.png` | 400x400 | The step mark: lime on ink, the stepped band from the vault chart. Reads at 32px in X's circle crop. | Profile photo |
| `banner.png` | 1500x500 | Headline "Stock Token yield, chosen by the chain's own data." beside a trading week of fees per $1 lost: NYSE hours $0.78 to $1.21, weekends $3.83 to $19.53 | Header photo; also the Day 1 post image |
| `post-1-sessions.png` | 1600x900 | NVDA, SPCX and TSLA by session, with the weekend vs NYSE multiple (3.2x, 9.1x, 24.4x) | Pinned post; thread 1/; Day 6; founder post |
| `post-2-hooks.png` | 1600x900 | About $1.2M through v4 hooks in 49 hours; quoted fee 0 to 1% against 5 to 11% taken on single swaps | Thread 6/; Day 8 |
| `post-3-cap.png` | 1600x900 | One 3% hook under a 2.50% cap (`TakeExceedsCap(300, 250)`, 200 of 200 revert) and a 3.00% cap (200 of 200 settle) | Thread 7/; Day 3 |
| `post-4-app.png` | 1600x900 | The NVDA vault's band card from the running app: price, band, Chainlink price, room to the edge | Thread 5/; Day 2 |
| `og.png` | 1200x630 | Link card: headline plus both session ranges | `og:image` and `twitter:image` on the web app's public page. Not a post image. |

All PNGs are sRGB with no embedded colour profile, so lime reads `#9fe870` and red `#d03238` wherever X re-encodes them. Type sits at or above 20px everywhere and 36px for the claim on each post, so it survives the phone feed (a 1600px image shows at about 0.19x).

## Posting order

| When (UTC) | Post | Image |
|---|---|---|
| Before Day 0 | Avatar, header, bio, location | `avatar-400.png`, `banner.png` |
| Day 0, Sun Oct 18 14:00 | Launch thread 1/ to 7/, then pin a separate pinned post | 1/ `post-1-sessions.png`, 5/ `post-4-app.png`, 6/ `post-2-hooks.png`, 7/ `post-3-cap.png`; pinned `post-1-sessions.png` |
| Day 0, same day | Founder post from @kamalbuilds, quoting 1/ | `post-1-sessions.png` |
| Day 1, Mon Oct 19 13:30 | NYSE open | `banner.png` |
| Day 2, Tue Oct 20 13:00 | Product shot | `post-4-app.png` |
| Day 3, Wed Oct 21 14:00 | Cap mechanism | `post-3-cap.png` |
| Day 4, Thu Oct 22 14:00 | Edge over APR | none |
| Day 5, Fri Oct 23 02:00 | Founder House day 1 | none |
| Day 6, Sat Oct 24 03:00 | Weekends | `post-1-sessions.png` |
| Day 7, Sun Oct 25 03:00 | Founder House day 3 | none |
| Day 8, Mon Oct 26 14:00 | Hooks | `post-2-hooks.png` |
| Days 9 to 14, Oct 27 to Nov 1 | Nested swap guard, exits, shuffled labels, mutation tests, fork read-back, keeper clock | none |

## Before you post

- [ ] Claim the handle. If it isn't `@uptickfi`, change it in the founder post.
- [ ] Leave the website field empty until the web app has a public URL; then point it there and set `og.png` as that page's `og:image`.
- [ ] After uploading the avatar and header, look at the profile on desktop and on a phone. The avatar covers the header's lower-left corner; nothing in the header sits below y 280 on the left.
- [ ] Fix the cap sentence on the pages these posts send people to. These say the vault takes pools "with a registered cap" or "a declared on-chain cap", and no keeper or vault code reads `CapRegistry`; the vault holds one v3 position: `README.md:27`, `docs/ARCHITECTURE.md:45` and `:78`, `docs/PITCH.md:22`, `web/app/page.tsx:13`, `web/components/why-this-pool.tsx:57` (shown on the vault page). `docs/PITCH.md:22` also carries the 74.5% figure and "0x labels 80 percent malicious"; use the thread 6 wording.
- [ ] Day 13: re-read `GET localhost:8790/vaults/nvda` that morning. The post quotes the read-back at deploy (`docs/FORK-DEMO.md`); `post-4-app.png` shows a later band ($205.73 to $227.39).
- [ ] Days 5 and 7 assume the team is in the room at Founder House. Rewrite them as remote posts if that changes.
- [ ] Keep the research split (static ±2% position, three pools) and the vault page's own NVDA figures out of the same post.
- [ ] After any copy edit: `python3 src/count.py` exits 0 (every block within 280 by X's count, no dashes or curly quotes).
- [ ] After any image or app change: `python3 src/capture_app.py` (band card from the running app), then `src/make.sh`, which re-renders every PNG and runs the size, font-floor, overlap and colour checks.
- [ ] After the first upload, sample a lime pixel from X's copy of the header; it should still read close to `#9fe870`.

## Sources

`src/build.py` writes the SVGs and names the file behind every number. `src/render.py` renders one SVG through a background Brave tab on CDP port 9396 and converts the capture to sRGB. `src/check.py` holds the pixel probes. `src/evidence/cap250-trace-summary.txt` is the forge trace summary behind `TakeExceedsCap(300, 250)`.
