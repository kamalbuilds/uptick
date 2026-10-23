# Fables venue read

Question: would Uptick holders keep more in Fables pools than in the pool the vault uses today?

Answer: no. Fables runs 13 USDG pools over Stock Tokens we track. Replayed at the fee each swap actually paid, the Fables pool keeps more than the chosen pool in both 15-day halves on none of the 12 tokens that can be replayed. It keeps more in the second half only on SPY (+2.7 points of edge APR) and TSLA (+2.0), and less in the first half on both. Both sides of SPY sit at roughly zero. No Fables hook should go on the allow-list on this evidence, and the vault could not hold one without code changes (section 4).

Window, strategy, halves, markout and cost model are the ones in `keeper/replay/replay.py` (30 days to 2026-10-17 00:00 UTC, first 15 days calibrate, last 15 days test, band per token from `keeper/data/params.json`, recentre at 02:00 UTC after each NYSE session). Numbers below are percent a year of edge (fees minus markout loss minus cost) on the capital shown.

## 1. Fables on chain 4663

Sources, in order of weight: the PoolManager (`0x8366a39CC670B4001A1121B8F6A443A643e40951`) Initialize and Swap logs, `eth_call` reads of each hook and of StateView, Sourcify full-match verified source for every hook (`https://sourcify.dev/server/v2/contract/4663/<hook>`), and Fables' public research repo `carluzh/fables-research` for the AccessManager address and the intent of the fee design. The HackQuest page (`https://www.hackquest.io/projects/Fables`) is the claim: about $46M TVL, $2.34B cumulative volume, $4.53M swap fees, 57 markets. We did not verify those totals. The Fables app repo `carluzh/fables-zap` is private; nothing here depends on it.

How the pools were found, not guessed: `keeper/scripts/build-fables-pools.ts` takes every dynamic-fee (fee flag `0x800000`) pool that `replay/pull.py` discovered for the 17 tracked tokens, 332 distinct hook addresses, and probes each hook with the FablesBaseHook ABI (`MAX_POKE_TTL`, `ABSOLUTE_MAX_FEE`, `authority`) plus a Sourcify source path of `src/Fables*.sol`. Seven hooks pass, 325 do not (Arrakis, Marlin, Otto, SessionFeeHook, V4IndexEngine and unverified ones). The seven share one AccessManager. Output: `keeper/data/fables-pools.json`.

| hook | contract | deployed (block) | ABSOLUTE_MAX_FEE | tracked pools |
| --- | --- | ---: | ---: | --- |
| `0x66622f77b797d506e5376f7798b67ab288966080` | FablesRWA | 37,254,394 | 20,000 | NVDA |
| `0x5eb87f69be00df39981622fd60a8de4b7837e080` | FablesRWA | 54,551,909 | 50,000 | SPCX, CRCL, AMZN, INTC, MSTR, MU, PLTR |
| `0xa0e8fbff13e24af2b5e61a72800e08a161bde080` | FablesRWA | 37,254,418 | 15,000 | SPY |
| `0x70a9a88402989226847ec122043ce5e7ff462080` | FablesRWA | 41,250,387 | 15,000 | AAPL |
| `0x08e52564bad99e05a694b4809f397edca417a080` | FablesRamp | 54,551,942 | 50,000 | GME |
| `0x8af95932ec4484fb10c641a4cbcf19a798cb2080` | FablesRWA | 44,862,450 | 15,000 | META |
| `0x67d86050d22d574df046f3d90f722045f714e080` | FablesRWA | 41,250,408 | 20,000 | TSLA |

All seven are deployed by `0x359856655934338d798F9ccE1f181486301D36a5`, show `runtimeMatch` and `creationMatch` of `match` on Sourcify, are not proxies, and carry address permission bits `0x2080`: beforeInitialize and beforeSwap, nothing else.

Pools on tracked tokens against USDG, 30 days to 2026-10-17 (volume from the pulled Swap events, fee is the event `fee` field volume-weighted; cap, floor and fee now read from the hook at block 95,912,936):

| token | pool id | hook | 30d swaps | 30d volume | vw fee (pips) | fee levels | fee cap (pips) | poke floor | fee now |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AAPL | `0xa2347ba69167e5602f74640ffbf737ee7cdd825e4726d3462564fc6533070147` | `0x70a9a88402989226847ec122043ce5e7ff462080` | 22,041 | $6.88M | 580 | 419 | 8,000 | 300 | 350 |
| AMZN | `0x5619cb8420678b47997f20925eb01be8750c907d6226a0df5d7eafeff966346f` | `0x5eb87f69be00df39981622fd60a8de4b7837e080` | 1,839 | $0.46M | 3913 | 320 | 30,000 | 3,000 | 3,150 |
| CRCL | `0xdb9c34002d173981250969293af6f43f42a26f2110f19893bbe2ad373375e9e6` | `0x5eb87f69be00df39981622fd60a8de4b7837e080` | 18,755 | $9.96M | 2011 | 986 | 50,000 | 800 | 1,500 |
| GME | `0xbb15d6b62c893a86912b5d4b14599f9cc72111e5898327dcadefa0352f20ae11` | `0x08e52564bad99e05a694b4809f397edca417a080` | 9,248 | $4.19M | 500 | 1 | 20,000 | 300 | 500 |
| INTC | `0x5e4c353496e4c82a406a38ca1eaad6d2d4cdb8d405d422faff84bcb6f548d97e` | `0x5eb87f69be00df39981622fd60a8de4b7837e080` | 3,308 | $2.79M | 10124 | 189 | 50,000 | 9,000 | 10,000 |
| META | `0x4ac4259eb99dce57268a856719d087fa1a53569b2fed6f330aabe32d9a4aa4f5` | `0x8af95932ec4484fb10c641a4cbcf19a798cb2080` | 8,123 | $1.41M | 1127 | 340 | 8,000 | 450 | 600 |
| MSTR | `0xe1c3e133c917674bd51704e47c7dfe7f0d66375c89ceb30b083de95f9a1dc5ea` | `0x5eb87f69be00df39981622fd60a8de4b7837e080` | 11,209 | $2.07M | 1881 | 587 | 50,000 | 800 | 1,500 |
| MU | `0x8e36bc9877b9383ae306dd937d40ab0e9df65811e7fdfb6bad25e7102bc398b2` | `0x5eb87f69be00df39981622fd60a8de4b7837e080` | 6,247 | $0.52M | 2312 | 287 | 50,000 | 1,000 | 2,000 |
| NVDA | `0x7990aad9e8fb048f49a155a7df5603db0366f0657035b78eb4196395cccb3dcd` | `0x66622f77b797d506e5376f7798b67ab288966080` | 27,577 | $8.63M | 1035 | 986 | 8,000 | 300 | 500 |
| PLTR | `0xbe1a90db81cf52603ea9059a6fde2e5fa893a8750647ff189ee7618c61b4c4f9` | `0x5eb87f69be00df39981622fd60a8de4b7837e080` | 1,346 | $0.06M | 2542 | 219 | 50,000 | 1,400 | 1,700 |
| SPCX | `0xb81d873dfb2bb1aaf08804053f8940fd06bb30a2b5a0fafcdbcc7325544452b9` | `0x5eb87f69be00df39981622fd60a8de4b7837e080` | 26,222 | $10.73M | 1181 | 611 | 30,000 | 500 | 500 |
| SPY | `0x8674c1c5544f3c9563565b5d4bd5916701d90b3559b072acf7cef5b4fc5b8dcd` | `0xa0e8fbff13e24af2b5e61a72800e08a161bde080` | 38,686 | $30.54M | 520 | 13 | 8,000 | 250 | 500 |
| TSLA | `0xd5effce87036cd858146c0c15fa825c231a9de1843200ca108e431e431331e8e` | `0x67d86050d22d574df046f3d90f722045f714e080` | 17,638 | $4.23M | 1280 | 1083 | 10,000 | 400 | 1,500 |

AMD, GOOGL, QQQ and USO have no Fables USDG pool (re-checked from Initialize logs at head on 2026-10-23). Across the 13 tokens the Fables pools carried $82.5M in the window against $750.8M on the chosen pools, with $2.06M of combined +-5% depth.

## 2. Replay at the actual per-swap fee

`keeper/replay/fables.py` imports `replay.py` and changes one thing. The engine already reads each v4 Swap event's `fee` into `fee_override`, so a Fables pool books LP income at the fee that swap paid, and the vault's own rebalance swaps pay the median of those fees. `replay.py` skipped these pools because it cannot read a hook-set fee off the pool key; the event field is what makes them replayable. The PoolManager protocol fee is zero on all 13 pools, so the event fee is the LP fee (`load_fables_pools` refuses a pool where it is not). Output: `keeper/data/fables-replay.json`; `python3 replay/fables.py --table` prints the tables.

Each token runs at two sizes. Size A is what the Fables pool's own +-5% depth carries at the 20% share rule (`vault_cap_usd`, the rule the v4 pools already use). Size B is the token's own cap, the capital of its chosen pool's replay. The chosen pool is re-run under the same code in the same process: v3 for every token but PLTR, which deploys on its v4 10000 pool.

Size A, what a Fables vault could actually deploy (cal = first half, test = second half, percent a year; diff = Fables minus chosen):

| token | Fables vol 30d | Fables fee (vw pips) | Fables size | Fables cal | Fables test | chosen pool | chosen cal | chosen test | cal diff | test diff | verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| AAPL | 6.88M | 580 | $34,870 | -5.0 | -0.7 | v3 500 | +2.7 | +3.9 | -7.7 | -4.6 | chosen pool keeps more |
| AMZN | 0.46M | 3913 | $20,765 | -9.1 | -7.6 | v3 3000 | +2.4 | -2.9 | -11.5 | -4.7 | chosen pool keeps more |
| CRCL | 9.96M | 2011 | $11,649 | -122.6 | -34.9 | v3 3000 | -0.1 | -28.4 | -122.4 | -6.5 | chosen pool keeps more |
| GME | 4.19M | 500 | $11 | -221.1 | -296.0 | v3 10000 | +101.9 | -144.2 | -323.0 | -151.8 | chosen pool keeps more |
| INTC | 2.79M | 10124 | $5,162 | -320.7 | -3.7 | v3 3000 | -2.0 | +3.4 | -318.7 | -7.0 | chosen pool keeps more |
| META | 1.41M | 1127 | $1,867 | -32.7 | -16.9 | v3 3000 | +4.8 | -10.8 | -37.5 | -6.2 | chosen pool keeps more |
| MSTR | 2.07M | 1881 | $2,184 | -164.0 | -147.0 | v3 10000 | +18.5 | -37.1 | -182.5 | -109.9 | chosen pool keeps more |
| MU | 0.52M | 2312 | $546 | -5.5 | -33.2 | v3 3000 | +7.3 | -14.5 | -12.9 | -18.7 | chosen pool keeps more |
| NVDA | 8.63M | 1035 | $51,404 | -46.2 | -81.8 | v3 500 | +29.4 | -6.6 | -75.6 | -75.2 | chosen pool keeps more |
| PLTR | 0.06M | 2542 | n/a | n/a | n/a | v4 10000 | +181.4 | +12.8 | n/a | n/a | not replayed: 30-day volume $61,658 is below the $250,000 the replay needs to mean anything |
| SPCX | 10.73M | 1181 | $23,638 | +13.5 | -253.3 | v3 500 | +80.6 | -199.5 | -67.1 | -53.8 | chosen pool keeps more |
| SPY | 30.54M | 520 | $100,000 | -0.4 | -1.3 | v3 500 | +4.1 | -4.0 | -4.5 | +2.7 | Fables wins weaker half only |
| TSLA | 4.23M | 1280 | $18,927 | +4.7 | -25.3 | v3 3000 | +12.5 | -27.4 | -7.8 | +2.0 | Fables wins weaker half only |

Size B, same capital as the chosen pool (Fables pools are thinner than the capital, so rebalance price impact dominates and the Fables numbers fall further):

| token | Fables vol 30d | Fables fee (vw pips) | Fables size | Fables cal | Fables test | chosen pool | chosen cal | chosen test | cal diff | test diff | verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| AAPL | 6.88M | 580 | $73,983 | -7.8 | -2.7 | v3 500 | +2.7 | +3.9 | -10.5 | -6.6 | chosen pool keeps more |
| AMZN | 0.46M | 3913 | $68,501 | -24.8 | -19.3 | v3 3000 | +2.4 | -2.9 | -27.2 | -16.4 | chosen pool keeps more |
| CRCL | 9.96M | 2011 | $100,000 | -916.5 | -64.4 | v3 3000 | -0.1 | -28.4 | -916.4 | -36.0 | chosen pool keeps more |
| GME | 4.19M | 500 | n/a | n/a | n/a | v3 10000 | +101.9 | -144.2 | n/a | n/a | not replayed: non-finite or beyond 1000% a year |
| INTC | 2.79M | 10124 | $19,116 | -956.9 | -17.7 | v3 3000 | -2.0 | +3.4 | -954.9 | -21.1 | chosen pool keeps more |
| META | 1.41M | 1127 | $24,118 | -124.1 | -37.7 | v3 3000 | +4.8 | -10.8 | -129.0 | -26.9 | chosen pool keeps more |
| MSTR | 2.07M | 1881 | $22,206 | -864.6 | -427.6 | v3 10000 | +18.5 | -37.1 | -883.0 | -390.6 | chosen pool keeps more |
| MU | 0.52M | 2312 | n/a | n/a | n/a | v3 3000 | +7.3 | -14.5 | n/a | n/a | not replayed: non-finite or beyond 1000% a year |
| NVDA | 8.63M | 1035 | $100,000 | -79.8 | -132.4 | v3 500 | +29.4 | -6.6 | -109.1 | -125.8 | chosen pool keeps more |
| PLTR | 0.06M | 2542 | n/a | n/a | n/a | v4 10000 | +181.4 | +12.8 | n/a | n/a | not replayed: 30-day volume $61,658 is below the $250,000 the replay needs to mean anything |
| SPCX | 10.73M | 1181 | $100,000 | -92.7 | -447.0 | v3 500 | +80.6 | -199.5 | -173.3 | -247.5 | chosen pool keeps more |
| SPY | 30.54M | 520 | $100,000 | -0.4 | -1.3 | v3 500 | +4.1 | -4.0 | -4.5 | +2.7 | Fables wins weaker half only |
| TSLA | 4.23M | 1280 | $83,206 | -13.6 | -51.5 | v3 3000 | +12.5 | -27.4 | -26.2 | -24.1 | chosen pool keeps more |

Reading it:

- The chosen pool keeps more in both halves on 10 of 12 tokens at size A. The two exceptions are second-half-only: SPY (-1.3 against -4.0, but -0.4 against +4.1 in the first half) and TSLA (-25.3 against -27.4, both under the -20 keep floor, so the vault stays closed either way).
- SPY is the nearest case and it is a tie: Fables -0.4 and -1.3, chosen +4.1 and -4.0. Neither earns on $100,000.
- PLTR cannot be replayed: the Fables PLTR pool did $61,658 of volume in 30 days (floor for a replay is $250,000), against the vault's v4 10000 pool at +181.4 and +12.8. GME's Fables pool is $44 deep; its size A row is an arithmetic artefact ($11 vault) and should be read as not replayable.
- The dynamic fee does earn more. On NVDA, forcing the fee to the chosen pool's 500 pips cuts the fee APR from 47.5 to 24.5. It does not cover the markout (72.9 a year at size A) because the flow the pool attracts is the adverse flow.

Fee per dollar of markout loss by session, vault replay at size A on the Fables pool against the chosen pool (1.0 is break-even on fees alone, before cost):

| token | session | Fables volume | Fables fee per $ lost | chosen volume | chosen fee per $ lost |
| --- | --- | ---: | ---: | ---: | ---: |
| NVDA | nyse_hours | $2.9M | 0.82 | $160.3M | 1.32 |
| NVDA | weeknight | $4.3M | 0.49 | $133.3M | 1.08 |
| NVDA | weekend | $1.4M | 0.87 | $55.1M | 2.82 |
| SPY | nyse_hours | $10.5M | 0.93 | $5.7M | 1.26 |
| SPY | weeknight | $14.0M | 1.30 | $4.9M | 1.59 |
| SPY | weekend | $6.1M | 1.81 | $1.1M | 2.20 |
| AAPL | nyse_hours | $2.5M | 0.90 | $18.6M | 1.23 |
| AAPL | weeknight | $2.6M | 0.80 | $12.0M | 1.45 |
| AAPL | weekend | $1.8M | 3.44 | $2.5M | 4.58 |
| TSLA | nyse_hours | $2.3M | 1.06 | $4.6M | 1.17 |
| TSLA | weeknight | $1.0M | 0.65 | $2.5M | 1.00 |
| TSLA | weekend | $0.9M | 1.91 | $0.2M | 7.30 |
| SPCX | nyse_hours | $4.8M | 0.56 | $138.6M | 0.65 |
| SPCX | weeknight | $5.4M | 0.55 | $69.2M | 1.09 |
| SPCX | weekend | $0.5M | 1.94 | $28.6M | 4.91 |

The Fables fee per dollar lost is below the chosen pool's in all 15 rows, including the weeknight and weekend sessions the hook prices up. The calendar tiers and pokes do not buy back the adverse selection the pool takes on.

### Must-fail: the Swap event fee is what is booked

- `FABLES_FEE_MODE=static` replaces every swap's fee with the chosen pool's tier (`keeper/data/fables-replay-static-control.json`). The size A full-window edge changed on 12 of 12 replayed pools, for example AAPL -2.9 to -5.8, NVDA -64.6 to -87.6, SPCX -110.4 to -160.6, TSLA -10.0 to +19.9, MSTR -149.5 to +449.3, and the volume-weighted fee collapsed to one level (`distinct_fee_levels` 986 to 1 on NVDA).
- `keeper/replay/test_fables.py`: forces NVDA to 500 pips and requires fee APR to move by more than 5 points and pool fees by more than 20%; rewrites the pulled rows' fee column to 500 and requires the result to equal the forced run exactly (so the column, not something else, is the source); and requires a pool with a nonzero PoolManager protocol fee to be refused.
- Red: replacing the event fee with a constant inside `replay_fables_pool` made `test_event_fee_is_used` fail on its first assertion (the hook no longer moved the fee). Removing the protocol-fee assertion made `test_protocol_fee_guard` fail with "a pool with a PoolManager protocol fee must be refused". Both restored, both green.

## 3. Hook read

Sources: Sourcify full-match source of `FablesRWA` at `0x66622f77...` (older singleton) and `0x5eb87f69...` (newer singleton, block 54,551,909), and `FablesRamp` at `0x08e52564...`, files `src/base/FablesBaseHook.sol`, `src/base/FablesLedger.sol`, `src/FablesRWA.sol`, `src/FablesRamp.sol`.

Callbacks. Only `beforeInitialize` and `beforeSwap`. `beforeInitialize` requires the dynamic-fee flag and a configured pool. `beforeSwap` is `external view`, returns `BeforeSwapDeltaLibrary.ZERO_DELTA` and the fee with the override flag; it reads storage and `block.timestamp` and writes nothing. No `afterSwap`, no add or remove liquidity callbacks, no donate callbacks, no return-delta flags (address bits 3 to 0 clear).

Fee logic. Fee resolves as the live poke if one is set, otherwise the autonomous fee (session floor for RWA pools: open, overnight, closed tiers, opening descent, closing ramp; a flat fee for `FablesRamp`), clamped to the pool's cap. The newer singleton adds a per-direction premium and two-sided pokes. Bounds: cap per pool up to the hook's `ABSOLUTE_MAX_FEE` (15,000 to 50,000 pips, fixed in bytecode), floor of 100 pips (`MIN_POOL_FEE`), a poke lasts at most 72 hours and may not cut more than half of the live autonomous fee.

Can it take value from an LP. Not through the swap path: no delta is returned, so the only thing the hook sets is the fee, and that fee is paid to LPs. An LP can lose indirectly if a fee is set too low for the flow (a poke cannot go under the pool floor or under half the autonomous fee) or so high that volume leaves. On the ledger, which is how Fables LPs normally hold liquidity (the hook owns the PoolManager positions and mints ERC-6909 receipts 1:1 with liquidity), the admin can set a claim fee on fees only, capped at 20% in bytecode (`MAX_CLAIM_FEE_BPS = 2000`), applied at accrual with a rate history so a backlog is not re-priced. Principal is never touched.

Can it block an exit. No: there is no remove-liquidity callback, so a position held directly in the PoolManager can always be removed. On the ledger, `withdraw` reads no admin state and is excluded from pause. A pause (at most 7 days, renewable, hook-wide or per pool) freezes deposits, claims, staking and receipt transfers. A `beforeSwap` revert would stop swaps only; a past config bug of that kind (an opening-descent overflow that reverted every swap in the open session) was fixed in bytecode with `MAX_DESCENT_WINDOW`. For a vault that matters as its own rebalance swaps would revert while `redeemInKind` stays open.

Admin keys, read from the AccessManager `0xA362D98B33A7bb5B5E2180a05f995A70FB404f30` at block 95,919,274 (`keeper/data/fables-admin.json`, `keeper/scripts/probe-fables-admin.ts`):

| role | what it gates on the hooks | members (execution delay) |
| --- | --- | --- |
| 0 (ADMIN) | `setPoolConfig`, `setClaimFee`, `setDistributor`, `setFFFeeSink`, `setPaused`, `setPoolPaused`, `setPoolAsymmetry`, `setBallotGate` | `0x3598...36a5`, the deployer: an EOA with an EIP-7702 delegation to unverified code at `0x5A7FC11397E9a8AD41BF10bf13F22B0a63f96f6d` (0 s) |
| 1 | `pokeFee` | three EOAs (0 s); role admin is role 5, held by the deployer |
| 4 | `pause`, `pausePool`, `clearPoke` | one EOA (0 s); role admin is role 6, held by the deployer |
| 2 | calendar overrides, session hours, DST mode | one EOA (3,600 s) |
| 9 | `setClaimFeeBps` | no members |

A 2-of-3 Safe (`0x215F...4b73`, owners `0x386C...44b8`, `0x240B...9fa8`, `0xa75d...F395b`) holds role 13 with an 86,400 s delay; role 13 gates none of the hook functions read here, and neither do roles 3, 7, 10, 11 or 12.

Read plainly: fee caps, floors, claim fees and pauses are set by one key with no execution delay, the same key that deployed everything and that administers the poke and pause roles. That key is a delegated EOA, so who can sign as it is not readable from chain. The hook source and the Fables research repo describe a delayed-admin path for config writes; the roles as deployed show a zero execution delay on role 0 at the block read. The target admin delay (the delay on changing roles for a hook) is 3,600 s on the older singletons and 86,400 s on the newer ones.

Upgradeability. None. Sourcify reports no proxy for any of the seven; behaviour is the verified bytecode. Change comes from `setPoolConfig` and pokes inside `ABSOLUTE_MAX_FEE`, from the AccessManager (an OpenZeppelin `AccessManager` can re-point a target to a different authority through its admin role, which only changes who may call the same restricted functions), or from a new singleton and new pools. Two generations already exist (blocks 37.25M to 44.86M and 54.55M), and a pool key binds its hook address, so a pool stays on the code it was created with.

## 4. Recommendation

Do not allow-list a Fables hook. Reasons, in order:

1. Nothing to gain. The chosen pool keeps more on 10 of 12 tokens in both halves; SPY is a tie near zero; TSLA is closed either way; PLTR, where the vault earns +12.8 in the test half, has a Fables pool that did $61,658 of volume in 30 days.
2. The vault cannot hold these pools as built. `StockVaultV4` reverts `DynamicFeePool` on the `0x800000` flag and `ForbiddenHook` on the beforeSwap bit (V4R-L1 forbids bits 7, 6, 11, 10 as constants), and the factory's allow-list only adds `HookNotAllowed` on top. An address on `keeper/data/v4-hook-allowlist.json` is not enough. This lane changes neither contract.
3. Governance. Config and pause sit on one zero-delay key.

What a vault would need if a Fables pool ever wins its token:

- A contract change in `StockVaultV4` (and the factory) that accepts the dynamic-fee flag only for allow-listed hooks and the beforeSwap bit only for hooks pinned by runtime code hash (the hashes are recorded per hook in `fables-pools.json`), not by address alone. The V4R-L1 sandwich needs a state-changing callback; the Fables `beforeSwap` is `view`, which is the property the pin would encode.
- A fee ceiling on the vault's own swaps. The live pool fee is read from StateView `lpFee` at swap time and the swap reverts above a per-vault limit, because Fables caps run from 0.8% to 5% by pool.
- A security review of that change, a re-read of the roles above at the deploy block, and an event watch on `RoleGranted`, `FeePoked`, `PoolConfigured`, `PausedSet` so the allow-list entry can be removed the day a delay or cap moves.
- Evidence gate before any of it: a 30-day replay where the Fables pool beats the chosen pool in both halves for the token, with at least $1M of volume in the window and depth that carries the vault at the 20% rule. Re-run with `python3 replay/fables.py` after `bun scripts/build-fables-pools.ts`.

## 5. Blind spots

- The replay holds the swap flow fixed; a vault inside a Fables pool would not change the fees the hook charges, but it would change the pool's liquidity, which the 20% share rule bounds.
- The PoolManager protocol fee was read at head (block 95,912,936) and is zero on all 13 pools. The window's historical value was not read; the event fees are clean pip values, which is consistent with zero.
- FABLES emissions, partner campaigns (the HackQuest page cites about $3,800 a week across four pools) and creator-fee rewards go to ledger LPs and are not modelled. Against the size of the deficits above they would not change a verdict, but the replay does not prove that.
- Two 15-day halves of one 30-day regime. Differences of 2 to 3 points (SPY, TSLA) are inside what one more week can move.
- Pools on the 13 tracked tokens created after the 2026-10-20 discovery were not re-discovered; AMD, GOOGL, QQQ and USO were re-checked on 2026-10-23.
- A direct PoolManager position in a Fables pool was read from the hook's callback set, not exercised on a fork.
- The EIP-7702 delegate behind the ADMIN key is unverified code.
