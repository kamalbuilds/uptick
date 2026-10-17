# Uptick on X: copy kit

Sources, all under `/Users/kamal/Desktop/arbitrium/`: session split `spikes/stock-vaults/FINDINGS.md`; cap results `spikes/capped-hooks/FINDINGS.md` and `spikes/capped-hooks/evidence/`; hooks figures `docs/research/founder-house/OUTREACH-fomo-gmgn.md` and `docs/paper/claims.md`; fork vault `stock-vaults-app/docs/FORK-DEMO.md`; guards and mutations `stock-vaults-app/contracts/SECURITY.md`; keeper clock `stock-vaults-app/keeper/src/calendar.ts`. Post text sits in fenced blocks so it pastes with line breaks intact; every block is 280 characters or fewer by X's count (`src/count.py` checks).

Images, sizes and placement: see `README.md` in this folder.

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

## Pinned post

Image: `post-1-sessions.png`

```text
LPs in Robinhood Chain's NVDA, SPCX and TSLA pools earned $1.03 to $1.35 in fees per $1 lost to informed traders while NYSE was open, and $3.94 to $33.27 on weekends (5.1M swaps, 54 days).

Uptick ranks each token's pools on that replay and deploys its vault into the top one.
```

## Launch thread (7 posts)

Ships Day 0, Sunday Oct 18, 14:00 UTC (22:00 Singapore, 10:00 New York). A weekend finding, posted on a weekend.

1/ Image: `post-1-sessions.png`

```text
A ±2% LP position in Robinhood Chain's NVDA, SPCX and TSLA pools earned $3.94 to $33.27 in fees for every $1 lost to informed traders on weekends, and $1.03 to $1.35 while NYSE was open.

That's from replaying 5.1M swaps over 54 days.
```

2/ No image

```text
The measure: after every swap, check the price an hour later. If it moved against the pool, the LP sold too cheap or bought too dear, and that gap is what informed flow took (the 1h markout).

Fees divided by that loss give fees per $1 lost. Above 1, the LP comes out ahead.
```

3/ No image

```text
Weekends paid best on all three pools:

NVDA 1.29 NYSE hours, 1.30 weeknights, 3.94 weekends
SPCX 1.03, 3.90, 7.78
TSLA 1.35, 3.70, 33.27

Pooled: 13.64 on weekends, 1.16 in NYSE hours. The fee tier you sit in moves the number about as much as the clock.
```

4/ No image

```text
The obvious strategy: tight ranges while NYSE is open, wide after hours, pause on weekends. We pre-registered a test and it could not be told apart from randomly reassigned session labels in 56 of 64 cells.

The weekend pause skips the session that pays most per dollar lost.
```

5/ Image: `post-4-app.png`

```text
So Uptick measures. For each token its engine replays the swaps in every USDG pool and fee tier it can trade, picks the v3 pool with the best edge (fees minus informed-trader losses minus costs) on the first half of the window, and scores that pick on the second.
```

6/ Image: `post-2-hooks.png`

```text
Picking a pool on Robinhood Chain also means checking its hook. In 49 hours, about $1.2M left traders through hooks on pools quoting 0 to 1%, with single swaps losing 5 to 11%. Across chains, 0x rates 80% of 84K v4 hooks malicious or likely malicious.
```

7/ Image: `post-3-cap.png`

```text
A hook built on CappedTakeHook declares its maximum take, and any swap above it reverts, whatever router sent it. On a Robinhood Chain mainnet fork, 200 of 200 over-cap swaps revert.

The NVDA vault itself sits in a Uniswap v3 pool, where no hook can run.
```

## Founder version for @kamalbuilds

Image: `post-1-sessions.png`. Quote-post the thread's first post, or post standalone the same day.

```text
I replayed 5.1M swaps from Robinhood Chain's Stock Token pools to see whether LPing NVDA, SPCX and TSLA pays.

While NYSE is open, LPs earn $1.03 to $1.35 in fees per $1 lost to informed traders. On weekends, $3.94 to $33.27.

So I built @uptickfi to pick pools from that.
```

Swap `@uptickfi` for whichever handle gets claimed.

## 14-day calendar

One post a day from the product account. Times in UTC; NYSE opens 13:30 UTC until US clocks change on Nov 1. Five posts carry an image and nine go out as text, so the feed doesn't read like a deck.

| Day | Date | Time | Type | Image |
|---|---|---|---|---|
| 1 | Mon Oct 19 | 13:30 | Finding: the NYSE session | `banner.png` |
| 2 | Tue Oct 20 | 13:00 | Product shot | `post-4-app.png` |
| 3 | Wed Oct 21 | 14:00 | Cap mechanism | `post-3-cap.png` |
| 4 | Thu Oct 22 | 14:00 | Build note: edge over APR | none |
| 5 | Fri Oct 23 | 02:00 | Founder House Singapore, day 1 | none |
| 6 | Sat Oct 24 | 03:00 | Finding: weekends | `post-1-sessions.png` |
| 7 | Sun Oct 25 | 03:00 | Founder House Singapore, day 3 | none |
| 8 | Mon Oct 26 | 14:00 | Finding: hooks | `post-2-hooks.png` |
| 9 | Tue Oct 27 | 14:00 | Cap mechanism: nested swap guard | none |
| 10 | Wed Oct 28 | 14:00 | Product: exits | none |
| 11 | Thu Oct 29 | 14:00 | Finding: shuffled-label control | none |
| 12 | Fri Oct 30 | 14:00 | Build note: mutation tests | none |
| 13 | Sat Oct 31 | 15:00 | Product: fork vault read-back | none |
| 14 | Sun Nov 1 | 15:00 | Build note: the keeper's clock | none |

Founder House posts go out in Singapore morning (02:00 to 03:00 UTC is 10:00 to 11:00 SGT).

### Day 1, Mon Oct 19, at the NYSE open. Image: `banner.png`

```text
The NYSE bell just rang. Over 54 days, LPs in Robinhood Chain's NVDA, SPCX and TSLA pools earned $1.03 to $1.35 in fees per $1 lost to informed traders during these 6.5 hours. On weekends the same pools paid $3.94 to $33.27.
```

### Day 2, Tue Oct 20. Image: `post-4-app.png`

```text
The NVDA vault provides liquidity in the NVDA/USDG 0.05% pool, inside a band 5% either side of the Chainlink price. At each NYSE open the keeper re-centres the band on the new price, and swap fees accrue to your shares while the pool price stays inside.
```

### Day 3, Wed Oct 21. Image: `post-3-cap.png`

```text
A hook built on CappedTakeHook writes its maxTakeBps to CapRegistry when it deploys. Inside every swap, the base contract measures what the hook took and reverts with TakeExceedsCap above that line. Under a 3% cap, a 3.01% take reverted 60 of 60 times; 2.99% passed 60 of 60.
```

### Day 4, Thu Oct 22. No image

```text
A pool can show a fat fee APR while informed traders take out more than the fees bring in. So Uptick ranks pools on edge: fees, minus what traders who knew the price an hour ahead took, minus rebalance cost. APR leaves out the middle term.
```

### Day 5, Fri Oct 23, Founder House day 1. No image

```text
Arbitrum Founder House Singapore starts today, run with Robinhood Chain. We're there through Sunday with the NVDA vault on a mainnet fork and the 5.1M-swap replay behind it. If you LP NVDA, SPCX or TSLA on the chain, find us and we'll pull up your pool's session split.
```

### Day 6, Sat Oct 24. Image: `post-1-sessions.png`

```text
Saturday on Robinhood Chain: NYSE is shut, the Chainlink equity feeds have gone quiet, and the Stock Token pools keep trading. Over our 54-day window, TSLA pool LPs made $33.27 in fees for every $1 lost to informed traders on weekends. SPCX made $7.78 and NVDA $3.94.
```

### Day 7, Sun Oct 25, Founder House day 3. No image

```text
Last day of Founder House Singapore. Two things are open on the laptop if you stop by: the session split from 5.1M replayed swaps, and a fork test where a hook trying to skim 3% runs into a 2.5% cap and reverts 200 times in 200.
```

### Day 8, Mon Oct 26. Image: `post-2-hooks.png`

```text
Quoted fee: 0 to 1%. What hooks on some Robinhood Chain pools kept on single swaps: 5 to 11%. About $1.2M left traders through those hooks in 49 hours. On those pools the fee shown is not the fee paid.
```

### Day 9, Tue Oct 27. No image

```text
A hook could dodge a cap by swapping its own pool inside the callback. A lock flag can't see that: v4-core skips hook callbacks when the hook itself swaps. UptickHook fingerprints slot0 and liquidity around each callback and reverts with NestedStateChange if either moved.
```

### Day 10, Wed Oct 28. No image

```text
Leaving an Uptick vault never waits on an oracle. redeemInKind pays your share in both tokens with no price check, no swap and no pause. Deposits and the regular redeem do pass an oracle gate first: Chainlink fresh, with the pool's TWAP and spot price both inside bounds of it.
```

### Day 11, Thu Oct 29. No image

```text
We checked the session result against chance. An hours-aware LP strategy cannot be distinguished from randomly reassigned session labels in 56 of 64 cells. Session labels add no edge over random labels on this chain.
```

### Day 12, Fri Oct 30. No image

```text
StockVault ships with 14 mutation runs. Each breaks one guard (the TWAP bound, say, or the first-depositor share offset), runs the fork tests that cover it and expects red, then restores the source and expects green. Seven invariants also hold across 4,800 random calls each.
```

### Day 13, Sat Oct 31. No image

```text
Fork read-back for the NVDA vault, against the forked NVDA/USDG pool and Chainlink feed: 232.86 NVDA of assets, worth $49,968.98 at a Chainlink price of $214.59, in a range of $203.80 to $225.46. The position is in range.
```

### Day 14, Sun Nov 1. No image

```text
US clocks went back overnight, so from Monday the Uptick keeper re-centres at 14:35 UTC instead of 13:35, five minutes after the NYSE open either way. Its calendar is rule-based and knows the ten NYSE holidays and the early closes, so nobody edits a cron line twice a year.
```

## Reply strategy

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

## Numbers that stay out of posts

- 74.5% of v4 trades through hooks: Bitquery, no window or method on disk. The repo's own read of 3,183,184 swaps gives 42.8% (`docs/paper/claims.md` X3).
- 78% of Stock Token flow off-hours: a transfer proxy that also counts LP adds, removes and multi-hop legs (claims X1). Swap events give 55.3% in the three pools.
- "NYSE hours are the worst session": NYSE is not separable from weeknights on NVDA or TSLA 0.30%, and pooled NYSE fees (1.16) still exceed markout. Claim "weekends pay LPs far more per dollar lost" (13.64 vs 1.16 pooled) instead.
- TSLA's 33.27 comes from the thinnest pool ($35.8M over 54 days). Expect a quant to ask; the answer is the pool size.
