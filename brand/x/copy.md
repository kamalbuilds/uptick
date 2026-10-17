# Uptick on X: copy kit

Sources: the feature thread, quote post, newsjack templates and milestone posts in `docs/research/founder-house/x-study/draft-chatgpt.txt`; the format study in `docs/research/founder-house/x-study/report.md` (656 posts across 34 accounts); the 88-second explainer at `video/out/uptick-explainer.mp4`. Post text sits in fenced blocks so it pastes with line breaks intact; every block is 280 characters or fewer by X's count (`src/count.py` checks). App shots and states: see `SHOTS.md`. Profile assets: see `README.md`.

## Profile

Handle options (availability unchecked):

1. `@uptickfi`
2. `@uptick_vaults`
3. `@getuptick`

Display name: `Uptick`

Bio (140 characters):

```text
Stock Token LP vaults on Robinhood Chain. Uptick replays each token's pool swaps and deploys the vault into the fee tier with the best edge.
```

Location: `Robinhood Chain · 4663`

Website: leave empty until the web app has a public URL.

Avatar: `avatar-400.png`. Header: `banner.png`.

## Launch thread

Six posts. Post 1 carries the explainer video, the strongest format in the study at 1.38x. Each post names the shot or file it ships with.

### 1/

```text
Uptick puts idle Robinhood Stock Tokens to work. Deposit NVDA or GOOGL, provide Uniswap v3 liquidity against USDG, and collect fees through your vault shares. Here's how the product works, from deposits to the data behind each market.
```

Media: video/out/uptick-explainer.mp4

### 2/

```text
The vault provides liquidity against USDG on Uniswap v3. Your position earns trading fees, which accrue to your vault shares. Start with NVDA or GOOGL.
```

Media: S1

### 3/

```text
Fee APR alone doesn't tell you what LPs keep. Uptick replays every swap across every pool for each Stock Token, then shows fee APR beside losses to informed traders.

5,113,049 swaps. 54 days.
```

Media: S3

### 4/

```text
Timing matters. LPs earn $13.64 in fees per dollar lost to informed traders on weekends, versus $1.16 during NYSE hours. Weekends lead in 22 of 23 pool-weeks.
```

Media: S2

### 5/

```text
Deposits open only when kept APR holds in both halves of the replay. NVDA and GOOGL are open. CRCL and SPCX are closed.

The data determines which vaults accept deposits.
```

Media: S5

### 6/

```text
The fee cap is enforced on-chain. On a Robinhood Chain mainnet fork, 200 of 200 swaps that exceed the declared v4 hook cap are stopped. Uptick also reads every vault page live from chain.
```

Media: post-3-cap.png

## Quote post

Quotes: @RobinhoodCrypto, "Stock Tokens put to work in new ways and markets" (2110753244205216179).

```text
Stock Tokens put to work, with the numbers to check the tradeoff.

Uptick provides Uniswap v3 liquidity against USDG and measures fees against losses to informed traders across 5,113,049 swaps over 54 days.

NVDA and GOOGL deposits are open when kept APR holds in both replay halves.
```

## Newsjack kit

Ten templates, each tied to an event and the fact behind it.

1. NVDA earnings

```text
NVDA reports. Stock Token liquidity has a different clock: Uptick's replay puts NVDA vault fee APR at 40.6% over 30 days. The question is what LPs keep after informed traders, not just what the fee APR says.
```

Cites: 40.6% NVDA vault fee APR over 30 days.

2. NVDA earnings, post-results volatility

```text
NVDA moves after earnings. Uptick replays every swap across its Stock Token pools and compares fees with losses to informed traders. The dataset covers 5,113,049 swaps over 54 days.
```

Cites: replay of 5,113,049 swaps over 54 days.

3. TSLA earnings

```text
TSLA earnings bring a new information window. Uptick measures Stock Token LP fees against losses to informed traders, then opens deposits only where kept APR holds in both halves of the replay.
```

Cites: deposit gate, kept APR holds in both halves of the replay.

4. GOOGL earnings

```text
GOOGL earnings are a reminder that liquidity has a cost. Uptick's GOOGL vault provides Uniswap v3 liquidity against USDG, with fees accruing to vault shares when deposits are open.
```

Cites: GOOGL vault, USDG pool, fees to vault shares.

5. Weekend price gaps

```text
Stock Tokens trade beyond NYSE hours. In Uptick's replay, LPs earn $13.64 in fees per dollar lost to informed traders on weekends, versus $1.16 during NYSE hours.
```

Cites: $13.64 weekend against $1.16 in NYSE hours.

6. Weekend volatility

```text
Weekend trading changes the LP equation. Uptick's pooled replay shows $13.64 in fees per dollar lost to informed traders on weekends, versus $1.16 in NYSE hours. Weekends lead in 22 of 23 pool-weeks.
```

Cites: $13.64 against $1.16, weekends ahead in 22 of 23 pool-weeks.

7. New Stock Token listing

```text
A new Stock Token listing means a new liquidity question: do fees compensate LPs for informed-trader losses? Uptick replays every swap before opening deposits. Its dataset covers 5,113,049 swaps over 54 days.
```

Cites: replay of 5,113,049 swaps over 54 days.

8. Robinhood Chain announcement

```text
Robinhood Chain infrastructure is only part of the story. Uptick reads each vault page live from chain and tests its v4 fee cap on a mainnet fork, where 200 of 200 over-cap swaps are stopped.
```

Cites: 200 of 200 over-cap swaps stopped on a mainnet fork.

9. Chainlink weekend feed pause

```text
When a Chainlink feed pauses over the weekend, stale-price risk matters. Uptick's replay shows why LPs need to measure fees against informed-trader losses: $13.64 per dollar lost on weekends versus $1.16 in NYSE hours.
```

Cites: $13.64 weekend against $1.16 in NYSE hours.

10. Stock Token market expansion

```text
More Stock Tokens mean more markets to evaluate, not automatic deposits. Uptick opens NVDA and GOOGL where kept APR holds in both halves of the replay. CRCL and SPCX remain closed.
```

Cites: deposit gate, NVDA and GOOGL open, CRCL and SPCX closed.

## After mainnet launch

Three milestone posts. Fill the [REAL NUMBER] slots from the live chain read before posting.

1. First day live

```text
Uptick is live on @arbitrum. [REAL NUMBER] deposits, with NVDA and GOOGL Stock Tokens providing Uniswap v3 liquidity against USDG. Fees accrue to vault shares.
```

2. One month in

```text
1 month on @arbitrum. [REAL NUMBER] in vault deposits. Uptick puts idle Robinhood Stock Tokens to work and measures fees against losses to informed traders.
```

3. Milestone recap

```text
Uptick on @arbitrum: [REAL NUMBER] swaps replayed, [REAL NUMBER] in vault deposits, and live on-chain vault data. The goal is simple: show LPs what they earn and what informed traders cost them.
```

## Measured patterns

From the study of 656 own posts across 34 accounts, scored against each account's median views.

- Video posts reach 1.38x the account median; text-only posts reach 0.84x.
- Quote posts reach 1.10x.
- Long posts reach 1.10x.
- Image posts reach 1.07x.
- @arbitrum amplifies "now live on @arbitrum" plus a hard number, milestones, and @RobinhoodCrypto's "Stock Tokens put to work in new ways".

## Reply list

People answer people, so the founder account (@kamalbuilds) carries most replies and the product account replies only with a chart or a test result. Three to five replies a day, inside the first 30 minutes of the target's post. Each reply carries one number, chart or test output that answers what they said; no "great post", no links, no tagging other accounts into their thread, no asks for reposts.

Each handle below was checked on 2026-10-17 with `treg call treg.x.search.posts --data '{"q":"from:<handle>"}'`; followers, latest original post and the post ID come from that response.

| # | Account | Group | Followers | Checked post | Why them | What to reply with |
|---|---|---|---|---|---|---|
| 1 | @JohannKerbrat (Johann Kerbrat) | Robinhood Chain team | 28,190 | Oct 15, "gm to everyone building something on Robinhood Chain" (2110769190676386222) | Posts the chain's milestones ($100B in 105 days, Oct 15). On Sep 11 he wrote that more than 72% of Stock Token volume happens after hours and on weekends (2098532670204731875). | The LP side of his number: in the NVDA, SPCX and TSLA pools, weekend fees beat what informed flow took by $3.94 to $33.27 per $1, against $1.03 to $1.35 while NYSE is open. |
| 2 | @RobinhoodCrypto | Robinhood Chain team | 648,521 | Oct 15, "Stock Tokens put to work in new ways and markets at our Buildathon with Arbitrum in Singapore" (2110753244205216179) | The largest Robinhood account that posts about Stock Tokens and the Singapore program. | `post-1-sessions.png` under any Stock Token or Robinhood Chain post. Once a week at most; this account is for visibility, not conversation. |
| 3 | @ArbitrumDevs | Arbitrum DevRel | 33,950 | Oct 15, Founder House Singapore mentorship post (2110868328428564975); Oct 15, USDG integration ideas (2110838213191532909) | Runs Founder House Singapore with Robinhood Chain and is collecting USDG use cases. | Under the USDG post: every Uptick pool is a Stock Token/USDG pair, and the engine replays each one's swaps before the vault picks. |
| 4 | @Swagtimus | Arbitrum DevRel | 21,422 | Oct 12, "More to come at our Founder House in Singapore later this month" (2109676031619514645) | Founder House host. Told an options team in Discord on Sep 26 that complex instruments rarely find PMF unless they're 10x better. | LP economics with a measured number: one deposit, and the evidence for the pool it lands in. |
| 5 | @hummusonrails (Ben Greenberg) | Arbitrum DevRel | 11,079 | Oct 15, "$USDG is a major new asset to build with on @arbitrum" (2110648382721024403) | Arbitrum DevRel and an Open House judge; his Sep 10 article is about AI-written code that looks weekend-copyable. | Day 12 mutation post: 14 mutations, each breaking one check and shown to turn the tests red. |
| 6 | @blockbyvlog (Daniel Ortega) | Arbitrum DevRel | 566 | Oct 15, USDG post for teams building "Perps, DEXs, Earn Products or Treasury operations" (2110641863938220226) | Named by @ArbitrumDevs on Oct 16 as "Our DevRel". Small account, so replies get read. | Uptick is an Earn product on USDG pools; reply with the Day 2 band explainer. |
| 7 | @UniswapBuilders (Uniswap Developers) | Uniswap hooks builders | 3,327 | Oct 6, "Who are the best hook builders?" (2107567825368031449); Oct 14, VolatilePair Hook docs (2110458343030702246) | The account where v4 hook work gets shared, and it amplifies new hook launches (the Hookr post, Oct 13). | `post-3-cap.png`: a hook declares its maximum take and the swap enforces it, about 25k gas per swap. |
| 8 | @Lighter_xyz | Lighter | 130,742 | Oct 16, "Options season. Coming soon" (2111070244433252856) | Lighter powers the perps inside Robinhood Wallet with USDG as quote (Jul 1 announcement), holds 15.1% of the chain's USDG ($104.9M) and 3.1% of the top 10 Stock Tokens' supply. | Weekend session data: their market makers quote through the same hours when Stock Token pools pay LPs most. |
| 9 | @WazzCrypto | Stock Token LP | 61,985 | Oct 15, "All my stock lps have been printing and have been in range for 1 month+" (2110798586254344623) | Runs Stock Token LP positions on Robinhood Chain and says so in public. | The session split for the NVDA, SPCX and TSLA pools: weekends returned $3.94 to $33.27 per $1 lost against $1.03 to $1.35 during NYSE hours. |
| 10 | @DefiIgnas | Stock Token LP | 163,879 | Oct 2, pre-IPO trading onchain (2105969706108620896); Sep 22, "I already exited my meme/stock LP positions. Yields went down a lot." (2102366401923346767) | Had stock LP positions and left when yields fell. Largest audience on this list. | Fee APR moves with volume; fees per $1 lost to informed traders says whether the LP was ever ahead. |

Bench, verified the same way: @YEYEmeta (17,700; asked for xStocks LP fee numbers on Sep 10, 2098050005831745695; an Oct 17 post about the haze puts them in Singapore, so a Founder House contact), @Nibel_eth (36,584; asked on Oct 11 for Stock Token yield builders, 2109362739504435283), @vnovakovski (Vladimir Novakovski, Lighter, 29,156), @AtriumAcademy (3,903, Uniswap hook incubator; no original posts among its latest 20).

Skip @RobinhoodChain: 96 followers and one post, dated 2025-07-02. It isn't the team's account.
