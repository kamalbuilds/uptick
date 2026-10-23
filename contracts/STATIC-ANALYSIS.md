# Static analysis

Slither 0.11.5 and Aderyn 0.6.8 run over `contracts/src` (14 files, 3,047 nSLOC). The raw output is committed beside this file in `static-analysis/` and each result below carries a verdict.

| Verdict | Meaning |
|---|---|
| False positive | The detector's pattern is present and the harm it names is not reachable; the reason is given. |
| Accepted residual | The pattern is real, bounded, and priced in; the bound is given. |
| True positive | A code-hygiene item. It is listed with a proposed fix and `src/` is unchanged by this pass. |

## Reproduce

```
cd contracts
slither .                                              # slither.config.json filters lib/, test/, script/ and writes static-analysis/slither.json
aderyn . --src src --output static-analysis/aderyn-report.md
```

`static-analysis/slither.txt` and `static-analysis/aderyn.txt` are the console output of each run; `slither.json.gz` is the gzip of Slither's full result set (the config writes it as `slither.json`) and `aderyn-report.md` is Aderyn's report.

## Slither: 181 results

| Verdict | Results |
|---|---|
| False positive | 105 |
| Accepted residual | 67 |
| True positive (low) | 2 |
| True positive (informational) | 7 |

### reentrancy-balance (High, 8)

**False positive.** Every flagged function is a `nonReentrant` entry point (`depositUsdg`, `depositUsdgV4`) or an internal step reached only from one (`_swap`). The calls go to the vault's immutable swap router and PoolManager, or to a vault the router's registry check (`onlyRegistered`) admits. The "stale" variables are the return values of those very calls (`shares`, `out`), compared to the caller's minimum after the call; the balance read before the call is the baseline of a before/after difference, which is the intended use.

| Result | Location |
|---|---|
| #5 | Reentrancy in UptickRouter.depositUsdgV4(IStockVault,uint256,uint256,address) (src/UptickRouter.sol#163-196): |
| #6 | Reentrancy in UptickRouter.depositUsdg(IStockVault,uint256,uint256,address) (src/UptickRouter.sol#119-157): |
| #7 | Reentrancy in StockVault._swap(IERC20,IERC20,uint256,uint256) (src/StockVault.sol#825-835): |
| #8 | Reentrancy in UptickRouter.depositUsdgV4(IStockVault,uint256,uint256,address) (src/UptickRouter.sol#163-196): |
| #9 | Reentrancy in UptickRouter.depositUsdg(IStockVault,uint256,uint256,address) (src/UptickRouter.sol#119-157): |
| #10 | Reentrancy in UptickRouter.depositUsdg(IStockVault,uint256,uint256,address) (src/UptickRouter.sol#119-157): |
| #11 | Reentrancy in StockVaultV4._swap(IERC20,IERC20,uint256,uint256) (src/v4/StockVaultV4.sol#847-852): |
| #12 | Reentrancy in UptickRouter.depositUsdgV4(IStockVault,uint256,uint256,address) (src/UptickRouter.sol#163-196): |

### weak-prng (High, 5)

**False positive.** The modulo is calendar arithmetic (day of week, daylight-saving boundary, seconds of day) in UptickHook, and the floor-toward-negative-infinity step of the mean tick in TickOracleV4.twap. Nothing derives a random value from block data.

| Result | Location |
|---|---|
| #0 | UptickHook.sessionAt(uint256) (src/hook/UptickHook.sol#199-211) uses a weak PRNG: "sod = ts % DAY (src/hook/UptickHook.sol#201)" |
| #1 | UptickHook._isDst(uint256,uint256) (src/hook/UptickHook.sol#214-221) uses a weak PRNG: "end = (nov1 + (7 - (nov1 + 4) % 7) % 7) * DAY + 21600 (src/hook/UptickHook.sol#219)" |
| #2 | TickOracleV4.twap(uint32) (src/v4/TickOracleV4.sol#97-114) uses a weak PRNG: "delta < 0 && delta % w != 0 (src/v4/TickOracleV4.sol#112)" |
| #3 | UptickHook.sessionAt(uint256) (src/hook/UptickHook.sol#199-211) uses a weak PRNG: "dow = (day + 4) % 7 (src/hook/UptickHook.sol#202)" |
| #4 | UptickHook._isDst(uint256,uint256) (src/hook/UptickHook.sol#214-221) uses a weak PRNG: "start = (mar1 + (7 - (mar1 + 4) % 7) % 7 + 7) * DAY + 25200 (src/hook/UptickHook.sol#218)" |

### divide-before-multiply (Medium, 13)

**Accepted residual.** Truncating before the slippage factor lowers a minimum by at most one raw unit in 1e24 liquidity units; a lower minimum cannot make a mint fail.

| Result | Location |
|---|---|
| #13 | VaultMath.mintMins(uint160,int24,int24,uint256,uint256,uint256) (src/VaultMath.sol#62-73) performs a multiplication on the result of a division: |
| #22 | VaultMath.mintMins(uint160,int24,int24,uint256,uint256,uint256) (src/VaultMath.sol#62-73) performs a multiplication on the result of a division: |

**False positive.** Hinnant civil-date algorithm: the integer divisions are the algorithm.

| Result | Location |
|---|---|
| #14 | UptickHook._civil(uint256) (src/hook/UptickHook.sol#233-243) performs a multiplication on the result of a division: |
| #17 | UptickHook._days(uint256,uint256,uint256) (src/hook/UptickHook.sol#245-252) performs a multiplication on the result of a division: |
| #18 | UptickHook._civil(uint256) (src/hook/UptickHook.sol#233-243) performs a multiplication on the result of a division: |
| #19 | UptickHook._civil(uint256) (src/hook/UptickHook.sol#233-243) performs a multiplication on the result of a division: |
| #21 | UptickHook._civil(uint256) (src/hook/UptickHook.sol#233-243) performs a multiplication on the result of a division: |
| #23 | UptickHook._civil(uint256) (src/hook/UptickHook.sol#233-243) performs a multiplication on the result of a division: |
| #24 | UptickHook._days(uint256,uint256,uint256) (src/hook/UptickHook.sol#245-252) performs a multiplication on the result of a division: |

**False positive.** Deliberate order: buffer first, then pool fee, floored in the vault's favour; `previewWithdraw` inverts it step for step, which a test pins (`withdraw(maxWithdraw)` never asks for more shares than held).

| Result | Location |
|---|---|
| #15 | StockVault.previewRedeem(uint256) (src/StockVault.sol#501-503) performs a multiplication on the result of a division: |
| #16 | StockVaultV4.previewRedeem(uint256) (src/v4/StockVaultV4.sol#514-516) performs a multiplication on the result of a division: |

**Accepted residual.** Two floors, each truncating at most one raw unit of the swap minimum; the result is a minimum a unit lower, never a failed or looser-by-more-than-one-unit swap.

| Result | Location |
|---|---|
| #20 | StockVault._minOut(uint256) (src/StockVault.sol#846-848) performs a multiplication on the result of a division: |
| #25 | StockVaultV4._minOut(uint256) (src/v4/StockVaultV4.sol#858-860) performs a multiplication on the result of a division: |

### incorrect-equality (Medium, 25)

**False positive.** None compares a token balance or ether amount, the case the detector exists for. They are sentinel and identity tests: `tokenId == 0` (no position), `shares == supply` (full exit), `assets == type(uint256).max` (uncapped), `l.blk == block.number` (the same-block share lock), `zeroForOne == stockIsToken0` (booleans), `f0 == 0 && f1 == 0` and `part == 0` (nothing to move), `b.ts == 0` (unwritten ring slot), and the calendar and holiday tables in UptickHook. A donation cannot flip any of them.

| Result | Location |
|---|---|
| #26 | UptickHook.sessionAt(uint256) (src/hook/UptickHook.sol#199-211) uses a dangerous strict equality: |
| #27 | StockVaultV4._update(address,address,uint256) (src/v4/StockVaultV4.sol#695-705) uses a dangerous strict equality: |
| #28 | StockVault._release(uint256,uint256) (src/StockVault.sol#701-717) uses a dangerous strict equality: |
| #29 | StockVault._harvest(StockVault.Snapshot) (src/StockVault.sol#722-742) uses a dangerous strict equality: |
| #30 | StockVault.maxMint(address) (src/StockVault.sol#489-492) uses a dangerous strict equality: |
| #31 | StockVault._deployInto(int24,int24,StockVault.Snapshot) (src/StockVault.sol#773-801) uses a dangerous strict equality: |
| #32 | StockVault._harvest(StockVault.Snapshot) (src/StockVault.sol#722-742) uses a dangerous strict equality: |
| #33 | StockVault._closePosition() (src/StockVault.sol#744-758) uses a dangerous strict equality: |
| #34 | StockVault._uncollectedFees() (src/StockVault.sol#1002-1005) uses a dangerous strict equality: |
| #35 | StockVault._deploy(StockVault.Snapshot) (src/StockVault.sol#766-769) uses a dangerous strict equality: |
| #36 | StockVaultV4._deployInto(int24,int24,StockVaultV4.Snapshot) (src/v4/StockVaultV4.sol#814-829) uses a dangerous strict equality: |
| #37 | StockVault._release(uint256,uint256) (src/StockVault.sol#701-717) uses a dangerous strict equality: |
| #38 | StockVault._exit(address,address,address,uint256,uint256,bool,StockVault.Snapshot) (src/StockVault.sol#666-697) uses a dangerous strict equality: |
| #39 | StockVaultV4._harvest(StockVaultV4.Snapshot) (src/v4/StockVaultV4.sol#761-788) uses a dangerous strict equality: |
| #40 | StockVault._update(address,address,uint256) (src/StockVault.sol#651-661) uses a dangerous strict equality: |
| #41 | TickOracleV4.twap(uint32) (src/v4/TickOracleV4.sol#97-114) uses a dangerous strict equality: |
| #42 | StockVault._balanceInventory(int24,int24,StockVault.Snapshot) (src/StockVault.sol#804-823) uses a dangerous strict equality: |
| #43 | StockVaultV4._release(uint256,uint256) (src/v4/StockVaultV4.sol#740-757) uses a dangerous strict equality: |
| #44 | StockVaultV4._balanceInventory(int24,int24,StockVaultV4.Snapshot) (src/v4/StockVaultV4.sol#831-845) uses a dangerous strict equality: |
| #45 | StockVaultV4._release(uint256,uint256) (src/v4/StockVaultV4.sol#740-757) uses a dangerous strict equality: |
| #46 | UptickHook._isHoliday(uint256) (src/hook/UptickHook.sol#224-231) uses a dangerous strict equality: |
| #47 | StockVault.currentRange() (src/StockVault.sol#457-464) uses a dangerous strict equality: |
| #48 | StockVaultV4.maxMint(address) (src/v4/StockVaultV4.sol#505-508) uses a dangerous strict equality: |
| #49 | StockVault._release(uint256,uint256) (src/StockVault.sol#701-717) uses a dangerous strict equality: |
| #50 | StockVaultV4._exit(address,address,address,uint256,uint256,bool,StockVaultV4.Snapshot) (src/v4/StockVaultV4.sol#707-736) uses a dangerous strict equality: |

### reentrancy-no-eth (Medium, 10)

**Accepted residual.** Write reentrancy is closed: every external mutator of both vaults is `nonReentrant` (deposit, mint, withdraw, redeem, redeemInKind, claimStockOwed, rebalance); `poke` on a v4 vault writes one bounded oracle observation; the owner setters are `onlyOwner` or `onlyQueued`. The only code that runs inside the flagged calls is the immutable position manager, router and PoolManager, the Stock Token's `transfer`, and for a v4 vault the pool's hook, which must be on the factory allow-list and cannot hold the forbidden permission bits. The residual is read-only: a view (`totalAssets`, `previewRedeem`, `positionInfo`) read from inside one of those callees sees bookkeeping written after the call. That needs a hostile allow-listed hook or a Stock Token with transfer callbacks, and the owner controls the allow-list.

| Result | Location |
|---|---|
| #51 | Reentrancy in StockVaultV4._deploy(StockVaultV4.Snapshot) (src/v4/StockVaultV4.sol#805-812): |
| #52 | Reentrancy in StockVaultV4._release(uint256,uint256) (src/v4/StockVaultV4.sol#740-757): |
| #53 | Reentrancy in StockVaultV4.redeemInKind(uint256,address,address) (src/v4/StockVaultV4.sol#580-613): |
| #54 | Reentrancy in StockVaultV4.rebalance() (src/v4/StockVaultV4.sol#626-639): |
| #55 | Reentrancy in StockVault.rebalance() (src/StockVault.sol#625-638): |
| #56 | Reentrancy in StockVaultV4.redeemInKind(uint256,address,address) (src/v4/StockVaultV4.sol#580-613): |
| #57 | Reentrancy in StockVault._deployInto(int24,int24,StockVault.Snapshot) (src/StockVault.sol#773-801): |
| #58 | Reentrancy in StockVault.redeemInKind(uint256,address,address) (src/StockVault.sol#575-608): |
| #59 | Reentrancy in StockVault.rebalance() (src/StockVault.sol#625-638): |
| #60 | Reentrancy in StockVaultV4.rebalance() (src/v4/StockVaultV4.sol#626-639): |

### uninitialized-local (Medium, 12)

**False positive.** Each local is a deliberate zero start: an accumulator (`credited`, `forfeited`, `minted`, `cum`), a struct filled on one branch (`last`, `lo`, `f`), or a value returned as zero on the path that skips it. Solidity zero-initialises them.

| Result | Location |
|---|---|
| #61 | StockVaultV4._exit(address,address,address,uint256,uint256,bool,StockVaultV4.Snapshot).forfeited (src/v4/StockVaultV4.sol#721) is a local variable never initialized |
| #62 | StockVault.redeemInKind(uint256,address,address).credited (src/StockVault.sol#595) is a local variable never initialized |
| #63 | UptickShareOracle.valueInUsdg(uint256,uint160).posUsdg (src/UptickShareOracle.sol#143) is a local variable never initialized |
| #64 | StockVault._exit(address,address,address,uint256,uint256,bool,StockVault.Snapshot).forfeited (src/StockVault.sol#680) is a local variable never initialized |
| #65 | TickOracleV4._atOrBefore(uint32,uint16).lo (src/v4/TickOracleV4.sol#133) is a local variable never initialized |
| #66 | StockVault._harvest(StockVault.Snapshot).minted (src/StockVault.sol#733) is a local variable never initialized |
| #67 | StockVaultV4.redeemInKind(uint256,address,address).credited (src/v4/StockVaultV4.sol#600) is a local variable never initialized |
| #68 | TickOracleV4.record(uint160,uint16).last (src/v4/TickOracleV4.sol#68) is a local variable never initialized |
| #69 | UptickShareOracle.valueInUsdg(uint256,uint160).posStock (src/UptickShareOracle.sol#142) is a local variable never initialized |
| #70 | StockVaultV4._harvest(StockVaultV4.Snapshot).minted (src/v4/StockVaultV4.sol#779) is a local variable never initialized |
| #71 | StockVaultV4.unlockCallback(bytes).f (src/v4/StockVaultV4.sol#650) is a local variable never initialized |
| #72 | TickOracleV4.record(uint160,uint16).cum (src/v4/TickOracleV4.sol#78) is a local variable never initialized |

### unused-return (Medium, 37)

**False positive.** Tuple destructuring that names only the fields the function needs (`latestRoundData`, `slot0`, `positions`, `ticks`, `health`, `params`, `getSlot0`).

| Result | Location |
|---|---|
| #73 | UptickHook._reference() (src/hook/UptickHook.sol#166-181) ignores return value by (answer,updatedAt) = feed.latestRoundData() (src/hook/UptickHook.sol#167-180) |
| #75 | UptickShareOracle.valueInUsdg(uint256,uint160) (src/UptickShareOracle.sol#140-161) ignores return value by (None,perfFeeBps,None,None,None,None,None,None) = vault.params() (src/UptickShareOracle.sol#155) |
| #76 | StockVault._liquidity() (src/StockVault.sol#1007-1009) ignores return value by (None,None,None,None,None,None,None,liq,None,None,None,None) = positionManager.positions(tokenId) (src/StockVault.sol#1008) |
| #79 | VaultMath.twapSqrt(IUniswapV3Pool,uint32) (src/VaultMath.sol#111-124) ignores return value by (cum) = pool.observe(ago) (src/VaultMath.sol#114-123) |
| #80 | StockVaultV4Lens.totalValueInUSDG(StockVaultV4) (src/v4/StockVaultV4Lens.sol#22-27) ignores return value by (st,price,None,None,None,None) = v.health() (src/v4/StockVaultV4Lens.sol#23) |
| #81 | StockVault.positionInfo() (src/StockVault.sol#441-454) ignores return value by (None,tick,None,None,None,None,None) = pool.slot0() (src/StockVault.sol#452) |
| #83 | TickOracleV4.record(uint160,uint16) (src/v4/TickOracleV4.sol#64-93) ignores return value by (None,spotTick,None,None) = poolManager.getSlot0(PoolId.wrap(poolId)) (src/v4/TickOracleV4.sol#74) |
| #84 | VaultMath.uncollectedFees(IUniswapV3Pool,INonfungiblePositionManager,uint256) (src/VaultMath.sol#128-151) ignores return value by (None,None,None,None,None,tl,tu,liq,last0,last1,owed0,owed1) = npm.positions(id) (src/VaultMath.sol# |
| #85 | StockVaultV4._pos() (src/v4/StockVaultV4.sol#982-985) ignores return value by vaultMathV4.position(poolManager,poolId,address(this),tickLower,tickUpper) (src/v4/StockVaultV4.sol#984) |
| #88 | StockVault.redeemInKind(uint256,address,address) (src/StockVault.sol#575-608) ignores return value by (st) = this.health() (src/StockVault.sol#582-587) |
| #89 | StockVault._read() (src/StockVault.sol#891-913) ignores return value by (spot,None,None,None,None,None,None) = pool.slot0() (src/StockVault.sol#903) |
| #90 | StockVaultV4.constructor(StockVaultV4.Config,StockVaultV4.Params,string,string) (src/v4/StockVaultV4.sol#253-303) ignores return value by (sqrtP,None,protocolFee,lpFee) = pm.getSlot0(PoolId.wrap(id)) (src/v4/StockVaultV4.sol#273) |
| #91 | StockVaultV4.redeemInKind(uint256,address,address) (src/v4/StockVaultV4.sol#580-613) ignores return value by (st) = this.health() (src/v4/StockVaultV4.sol#587-592) |
| #93 | VaultMath._feeGrowthInside(IUniswapV3Pool,int24,int24) (src/VaultMath.sol#153-167) ignores return value by (None,None,lo0,lo1,None,None,None,None) = pool.ticks(tl) (src/VaultMath.sol#157) |
| #94 | StockVaultV4._read() (src/v4/StockVaultV4.sol#891-914) ignores return value by (id,answer,updatedAt,answeredIn) = feed.latestRoundData() (src/v4/StockVaultV4.sol#892-900) |
| #95 | StockVault._checkParams(StockVault.Params,IUniswapV3Pool) (src/StockVault.sol#398-409) ignores return value by (None,None,None,cardinality,None,None,None) = pool_.slot0() (src/StockVault.sol#406) |
| #96 | VaultMath._feeGrowthInside(IUniswapV3Pool,int24,int24) (src/VaultMath.sol#153-167) ignores return value by (None,None,hi0,hi1,None,None,None,None) = pool.ticks(tu) (src/VaultMath.sol#158) |
| #97 | StockVaultV4._slot0() (src/v4/StockVaultV4.sol#987-989) ignores return value by poolManager.getSlot0(PoolId.wrap(poolId)) (src/v4/StockVaultV4.sol#988) |
| #98 | VaultMath._feeGrowthInside(IUniswapV3Pool,int24,int24) (src/VaultMath.sol#153-167) ignores return value by (None,tick,None,None,None,None,None) = pool.slot0() (src/VaultMath.sol#154) |
| #99 | StockVault._read() (src/StockVault.sol#891-913) ignores return value by (id,answer,updatedAt,answeredIn) = feed.latestRoundData() (src/StockVault.sol#892-900) |
| #100 | StockVault._deployInto(int24,int24,StockVault.Snapshot) (src/StockVault.sol#773-801) ignores return value by (spotNow,None,None,None,None,None,None) = pool.slot0() (src/StockVault.sol#783) |
| #101 | UptickRouter.depositUsdgV4(IStockVault,uint256,uint256,address) (src/UptickRouter.sol#163-196) ignores return value by (status,price,None,None,None,None) = vault.health() (src/UptickRouter.sol#171) |
| #102 | VaultMathV4.info(IPoolManager,bytes32,address,int24,int24,uint160) (src/v4/VaultMathV4.sol#46-73) ignores return value by (None,tick,None,None) = pm.getSlot0(id) (src/v4/VaultMathV4.sol#55) |
| #103 | UptickShareOracle.price() (src/UptickShareOracle.sol#131-136) ignores return value by (status,px,updatedAt,sqrtOracle,None,None) = vault.health() (src/UptickShareOracle.sol#132) |
| #104 | UptickRouter.depositUsdg(IStockVault,uint256,uint256,address) (src/UptickRouter.sol#119-157) ignores return value by (status,price,None,None,None,None) = vault.health() (src/UptickRouter.sol#127) |
| #106 | StockVault._uncollectedFees() (src/StockVault.sol#1002-1005) ignores return value by vaultMath.uncollectedFees(pool,positionManager,tokenId) (src/StockVault.sol#1004) |
| #109 | UptickHook._quote(PoolId,bool) (src/hook/UptickHook.sol#144-160) ignores return value by (sqrtP,None,None,None) = poolManager.getSlot0(id) (src/hook/UptickHook.sol#150) |

**Accepted residual.** The amounts the callee returns are not used; the post-condition is checked another way: a before/after balance difference against `minOut` (`_swap`, `depositUsdg`), the caller's slippage minimums on the mint and increase (`mintMins`), or a collect of everything owed (`type(uint128).max`).

| Result | Location |
|---|---|
| #74 | UptickRouter._settle(IPoolManager,Currency,int128) (src/UptickRouter.sol#231-239) ignores return value by pm.settle() (src/UptickRouter.sol#235) |
| #77 | StockVault._swap(IERC20,IERC20,uint256,uint256) (src/StockVault.sol#825-835) ignores return value by router.exactInputSingle(ISwapRouter02.ExactInputSingleParams(address(tokenIn),address(tokenOut),poolFee,address(this),amountIn,mi |
| #78 | StockVault._closePosition() (src/StockVault.sol#744-758) ignores return value by positionManager.decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams(id,liq,0,0,block.timestamp)) (src/StockVault.sol#750-752) |
| #82 | UptickRouter.depositUsdg(IStockVault,uint256,uint256,address) (src/UptickRouter.sol#119-157) ignores return value by swapRouter.exactInputSingle(ISwapRouter02.ExactInputSingleParams(address(usdg),address(stock),vault.poolFee(),add |
| #86 | StockVault._deployInto(int24,int24,StockVault.Snapshot) (src/StockVault.sol#773-801) ignores return value by positionManager.increaseLiquidity(INonfungiblePositionManager.IncreaseLiquidityParams(tokenId,a0,a1,m0,m1,block.timestamp |
| #87 | StockVault._release(uint256,uint256) (src/StockVault.sol#701-717) ignores return value by positionManager.collect(INonfungiblePositionManager.CollectParams(tokenId,address(this),uint128(d0),uint128(d1))) (src/StockVault.sol#711-71 |
| #92 | UptickRouter._swapV4(IStockVaultV4,uint24,IERC20,IERC20,uint256) (src/UptickRouter.sol#198-211) ignores return value by IPoolManager(pm).unlock(abi.encode(k,! s0,usdgIn)) (src/UptickRouter.sol#209) |
| #105 | StockVaultV4._settle(Currency,int128) (src/v4/StockVaultV4.sol#668-676) ignores return value by poolManager.settle() (src/v4/StockVaultV4.sol#672) |
| #107 | StockVault._deployInto(int24,int24,StockVault.Snapshot) (src/StockVault.sol#773-801) ignores return value by (id,None,None,None) = positionManager.mint(INonfungiblePositionManager.MintParams(t0,t1,poolFee,tl,tu,a0,a1,m0,m1,address |
| #108 | StockVault._closePosition() (src/StockVault.sol#744-758) ignores return value by positionManager.collect(INonfungiblePositionManager.CollectParams(id,address(this),type()(uint128).max,type()(uint128).max)) (src/StockVault.sol#754- |

### missing-zero-check (Low, 2)

**True positive (low).** `setKeeper(address(0))` is accepted. The setter is `onlyQueued`, so it passes through the owner's 24-hour queue, and a zero keeper only turns the keeper role off: `rebalance` is then callable by anyone after PERMISSIONLESS_DELAY (26 hours). No funds move and `redeemInKind` is unaffected. Proposed fix: `if (keeper_ == address(0)) revert BadConfig();` in both vaults, if a keeper-less state is not wanted. `VaultFactory._setDefaults` does not require a non-zero keeper either, so a keeper-less vault is a state the design already admits.

| Result | Location |
|---|---|
| #110 | StockVaultV4.setKeeper(address).keeper_ (src/v4/StockVaultV4.sol#355) lacks a zero-check on : |
| #111 | StockVault.setKeeper(address).keeper_ (src/StockVault.sol#344) lacks a zero-check on : |

### reentrancy-benign (Low, 5)

**False positive.** Same entry points and same callees as `reentrancy-no-eth`; the variables written after the call are the credited-stock ledger (`stockOwed`), the new tick bounds and the `_unlocking` flag.

| Result | Location |
|---|---|
| #112 | Reentrancy in StockVault.redeemInKind(uint256,address,address) (src/StockVault.sol#575-608): |
| #113 | Reentrancy in StockVaultV4._deployInto(int24,int24,StockVaultV4.Snapshot) (src/v4/StockVaultV4.sol#814-829): |
| #114 | Reentrancy in StockVault._deployInto(int24,int24,StockVault.Snapshot) (src/StockVault.sol#773-801): |
| #115 | Reentrancy in UptickRouter._swapV4(IStockVaultV4,uint24,IERC20,IERC20,uint256) (src/UptickRouter.sol#198-211): |
| #116 | Reentrancy in StockVaultV4.redeemInKind(uint256,address,address) (src/v4/StockVaultV4.sol#580-613): |

### reentrancy-events (Low, 2)

**False positive.** `executeChange` is `onlyOwner`; its self-call reverts bubble up, and the event is emitted after the queued change has run, which is the order an indexer wants.

| Result | Location |
|---|---|
| #117 | Reentrancy in StockVaultV4.executeChange(bytes) (src/v4/StockVaultV4.sol#327-341): |
| #118 | Reentrancy in StockVault.executeChange(bytes) (src/StockVault.sol#316-330): |

### timestamp (Low, 43)

**Accepted residual.** Every comparison is against a window measured in minutes to days: feed staleness (25 hours), the TWAP window (10 minutes), rebalance interval (1 to 24 hours), the 24-hour change queue, the 26-hour permissionless delay, corporate-action lead and lag, the NYSE session table, and the hook registry timestamp. None is a randomness source and none turns on a second-level difference.

| Result | Location |
|---|---|
| #119 | StockVault._update(address,address,uint256) (src/StockVault.sol#651-661) uses timestamp for comparisons |
| #120 | UptickHook._isDst(uint256,uint256) (src/hook/UptickHook.sol#214-221) uses timestamp for comparisons |
| #121 | StockVault.maxDeposit(address) (src/StockVault.sol#481-487) uses timestamp for comparisons |
| #122 | StockVault._deployInto(int24,int24,StockVault.Snapshot) (src/StockVault.sol#773-801) uses timestamp for comparisons |
| #123 | TickOracleV4.record(uint160,uint16) (src/v4/TickOracleV4.sol#64-93) uses timestamp for comparisons |
| #124 | StockVault.redeem(uint256,address,address) (src/StockVault.sol#560-570) uses timestamp for comparisons |
| #125 | StockVault._balanceInventory(int24,int24,StockVault.Snapshot) (src/StockVault.sol#804-823) uses timestamp for comparisons |
| #126 | StockVault._corporateActionWindow(uint32) (src/StockVault.sol#921-931) uses timestamp for comparisons |
| #127 | StockVault._closePosition() (src/StockVault.sol#744-758) uses timestamp for comparisons |
| #128 | UptickHook._civil(uint256) (src/hook/UptickHook.sol#233-243) uses timestamp for comparisons |
| #129 | UptickHook._isHoliday(uint256) (src/hook/UptickHook.sol#224-231) uses timestamp for comparisons |
| #130 | StockVault._deploy(StockVault.Snapshot) (src/StockVault.sol#766-769) uses timestamp for comparisons |
| #131 | StockVault._isDust(uint256) (src/StockVault.sol#839-841) uses timestamp for comparisons |
| #132 | TickOracleV4._atOrBefore(uint32,uint16) (src/v4/TickOracleV4.sol#131-144) uses timestamp for comparisons |
| #133 | StockVault._idleStock() (src/StockVault.sol#1013-1016) uses timestamp for comparisons |
| #134 | StockVaultV4._corporateActionWindow(uint32) (src/v4/StockVaultV4.sol#916-926) uses timestamp for comparisons |
| #135 | TickOracleV4._clamp(int24,int24,int24) (src/v4/TickOracleV4.sol#146-148) uses timestamp for comparisons |
| #136 | StockVault._release(uint256,uint256) (src/StockVault.sol#701-717) uses timestamp for comparisons |
| #137 | StockVaultV4.executeChange(bytes) (src/v4/StockVaultV4.sol#327-341) uses timestamp for comparisons |
| #138 | StockVault._uncollectedFees() (src/StockVault.sol#1002-1005) uses timestamp for comparisons |
| #139 | StockVault.withdraw(uint256,address,address) (src/StockVault.sol#545-555) uses timestamp for comparisons |
| #140 | StockVault.maxMint(address) (src/StockVault.sol#489-492) uses timestamp for comparisons |
| #141 | StockVault._swap(IERC20,IERC20,uint256,uint256) (src/StockVault.sol#825-835) uses timestamp for comparisons |
| #142 | StockVault._exit(address,address,address,uint256,uint256,bool,StockVault.Snapshot) (src/StockVault.sol#666-697) uses timestamp for comparisons |
| #143 | StockVault._read() (src/StockVault.sol#891-913) uses timestamp for comparisons |
| #144 | StockVaultV4.queueChange(bytes) (src/v4/StockVaultV4.sol#312-325) uses timestamp for comparisons |
| #145 | StockVault.queueChange(bytes) (src/StockVault.sol#301-314) uses timestamp for comparisons |
| #146 | StockVault.executeChange(bytes) (src/StockVault.sol#316-330) uses timestamp for comparisons |
| #147 | StockVault.redeemInKind(uint256,address,address) (src/StockVault.sol#575-608) uses timestamp for comparisons |
| #148 | StockVault._harvest(StockVault.Snapshot) (src/StockVault.sol#722-742) uses timestamp for comparisons |
| #149 | UptickHook.sessionAt(uint256) (src/hook/UptickHook.sol#199-211) uses timestamp for comparisons |
| #150 | TickOracleV4.twap(uint32) (src/v4/TickOracleV4.sol#97-114) uses timestamp for comparisons |
| #151 | StockVault.rebalance() (src/StockVault.sol#625-638) uses timestamp for comparisons |
| #152 | StockVault.currentRange() (src/StockVault.sol#457-464) uses timestamp for comparisons |
| #153 | UptickHook._reference() (src/hook/UptickHook.sol#166-181) uses timestamp for comparisons |
| #154 | CapRegistry.capOf(address) (src/hook/CapRegistry.sol#28-31) uses timestamp for comparisons |
| #155 | StockVault._valuationAt(StockVault.Snapshot,uint256) (src/StockVault.sol#947-960) uses timestamp for comparisons |
| #156 | StockVaultV4.poke() (src/v4/StockVaultV4.sol#489-493) uses timestamp for comparisons |
| #157 | UptickShareOracle.price() (src/UptickShareOracle.sol#131-136) uses timestamp for comparisons |
| #158 | CapRegistry.register(uint16) (src/hook/CapRegistry.sol#21-26) uses timestamp for comparisons |
| #159 | StockVault.positionInfo() (src/StockVault.sol#441-454) uses timestamp for comparisons |
| #160 | StockVaultV4.rebalance() (src/v4/StockVaultV4.sol#626-639) uses timestamp for comparisons |
| #161 | StockVaultV4._read() (src/v4/StockVaultV4.sol#891-914) uses timestamp for comparisons |

### assembly (Informational, 6)

**False positive.** Three purposes, each reviewed: `create2` in the factory with the vault's own revert data copied out (so `BadConfig` and `BadParams` surface by name), the same revert bubbling in `executeChange`, and transient-storage reads and writes (`tstore`, `tload`) in CappedTakeHook for the per-swap delta handoff.

| Result | Location |
|---|---|
| #162 | StockVaultV4.executeChange(bytes) (src/v4/StockVaultV4.sol#327-341) uses assembly |
| #163 | VaultFactory.createVault(bytes,address,address,address,uint256) (src/VaultFactory.sol#135-188) uses assembly |
| #164 | CappedTakeHook.beforeSwap(address,PoolKey,IPoolManager.SwapParams,bytes) (src/hook/CappedTakeHook.sol#71-89) uses assembly |
| #165 | CappedTakeHook._enforce(PoolId,address,PoolKey,IPoolManager.SwapParams,BalanceDelta,int128,uint24) (src/hook/CappedTakeHook.sol#119-171) uses assembly |
| #166 | StockVault.executeChange(bytes) (src/StockVault.sol#316-330) uses assembly |
| #167 | VaultFactory.createVaultV4(bytes,address,uint24,int24,address,address,uint256) (src/VaultFactory.sol#195-265) uses assembly |

### cyclomatic-complexity (Informational, 3)

**False positive.** Branch count of `redeemInKind` (13) and the hook `_enforce` (12) reflects the exit path that must tolerate a paused oracle, a reverting Stock Token transfer and a closed gate. Splitting it would move the branches, not remove them.

| Result | Location |
|---|---|
| #168 | StockVaultV4.redeemInKind(uint256,address,address) (src/v4/StockVaultV4.sol#580-613) has a high cyclomatic complexity (13). |
| #169 | StockVault.redeemInKind(uint256,address,address) (src/StockVault.sol#575-608) has a high cyclomatic complexity (13). |
| #170 | CappedTakeHook._enforce(PoolId,address,PoolKey,IPoolManager.SwapParams,BalanceDelta,int128,uint24) (src/hook/CappedTakeHook.sol#119-171) has a high cyclomatic complexity (12). |

### low-level-calls (Informational, 2)

**False positive.** `address(this).call(data)` runs a payload the owner queued 24 hours earlier, with the selector restricted by the `onlyQueued` setters (a call from any other sender reverts `ChangeNotQueued`); a failed call reverts with its own data.

| Result | Location |
|---|---|
| #171 | Low level call in StockVaultV4.executeChange(bytes) (src/v4/StockVaultV4.sol#327-341): |
| #172 | Low level call in StockVault.executeChange(bytes) (src/StockVault.sol#316-330): |

### too-many-digits (Informational, 1)

**False positive.** `0x800000` is the Uniswap v4 dynamic-fee flag; the vault refuses such a pool.

| Result | Location |
|---|---|
| #173 | StockVaultV4.constructor(StockVaultV4.Config,StockVaultV4.Params,string,string) (src/v4/StockVaultV4.sol#253-303) uses literals with too many digits: |

### unindexed-event-address (Informational, 5)

**True positive (informational).** The address argument is in log data, not a topic. Moving it to a topic changes how every decoder reads the log. Proposed fix with the next bytecode revision: `indexed` on `KeeperUpdated`, `TreasuryUpdated` and `DefaultsSet`.

| Result | Location |
|---|---|
| #174 | Event VaultFactory.DefaultsSet(address,address,address) (src/VaultFactory.sol#84) has address parameters but no indexed parameters |
| #175 | Event StockVaultV4.KeeperUpdated(address) (src/v4/StockVaultV4.sol#215) has address parameters but no indexed parameters |
| #176 | Event StockVaultV4.TreasuryUpdated(address) (src/v4/StockVaultV4.sol#216) has address parameters but no indexed parameters |
| #177 | Event StockVault.TreasuryUpdated(address) (src/StockVault.sol#212) has address parameters but no indexed parameters |
| #178 | Event StockVault.KeeperUpdated(address) (src/StockVault.sol#211) has address parameters but no indexed parameters |

### unused-state (Informational, 2)

**True positive (informational).** `Q128` and `UNIT_LIQUIDITY` are declared private and unused in `StockVault` (VaultMath keeps its own copies). Dead constants cost no bytecode. Proposed fix: delete lines 135 and 136 of `src/StockVault.sol`.

| Result | Location |
|---|---|
| #179 | StockVault.Q128 (src/StockVault.sol#135) is never used in StockVault (src/StockVault.sol#35-1039) |
| #180 | StockVault.UNIT_LIQUIDITY (src/StockVault.sol#136) is never used in StockVault (src/StockVault.sol#35-1039) |

## Aderyn: 2 high and 14 low issue classes

Each class lists its instances by file and line from `static-analysis/aderyn-report.md`.

### H-1: Reentrancy: State change after external call (30 listed)

**False positive.** Constructors (`StockVault`, `StockVaultV4`, `VaultFactory`, `UptickShareOracle`, `UptickHook`) read the pool, feed and token while assigning immutables and storage: the contract has no callable surface until the constructor returns, so there is nothing to re-enter. The function-level instances (`redeemInKind`, lines 582 and 597 of `StockVault.sol`, 587 and 602 of `StockVaultV4.sol`) sit behind `nonReentrant`; the first is a staticcall on the vault's own `health()`, and the second is the Stock Token's `transfer`, which runs after the shares are burned.

| File | Lines |
|---|---|
| `src/StockVault.sol` | 252, 253, 258, 268, 269, 271, 272, 273, 280, 582, 597 |
| `src/UptickShareOracle.sol` | 117, 119, 120, 123, 124, 125, 126 |
| `src/VaultFactory.sol` | 145, 182, 212, 258 |
| `src/hook/UptickHook.sol` | 92, 93, 95 |
| `src/v4/StockVaultV4.sol` | 289, 290, 291, 587, 602 |

### H-2: Unsafe Casting of integers (3 listed)

**Accepted residual.** Three instances are listed (the report header counts four). `uint128(d0)`, `uint128(d1)` in `_release` are the amounts the position manager just returned from `decreaseLiquidity`, which the manager itself stores as `uint128` owed amounts. `int24(t)` in `VaultMath.twapSqrt` and `TickOracleV4.twap` is a mean of ticks that are each within `int24`, so the mean is. The share-lock `uint128(... + value)` in `_update` would truncate only above 3.4e38 share units (3.4e14 Stock Tokens). Proposed hardening, no behaviour change below those bounds: `SafeCast.toUint128` at the lock.

| File | Lines |
|---|---|
| `src/StockVault.sol` | 712 |
| `src/VaultMath.sol` | 120 |
| `src/v4/TickOracleV4.sol` | 113 |

### L-1: Centralization Risk (23 listed)

**Accepted residual.** Owner powers are the documented role table in `SECURITY.md`: risk parameters, keeper and the instant-deploy switch pass through a 24-hour queue that holders see in `ChangeQueued`; `pause` and `setDepositCap` can only shrink what the vault accepts; `redeemInKind` is never gated and not pausable. The owner is a multisig on mainnet.

| File | Lines |
|---|---|
| `src/StockVault.sol` | 35, 301, 316, 332, 368, 379, 385, 389, 394 |
| `src/VaultFactory.sol` | 28, 110, 118, 137, 203 |
| `src/v4/StockVaultV4.sol` | 44, 312, 327, 343, 379, 390, 395, 399, 403 |

### L-2: Incorrect Order of Division and Multiplication (6 listed)

**Accepted residual.** Same sites as Slither `divide-before-multiply`; see its verdicts above.

| File | Lines |
|---|---|
| `src/StockVault.sol` | 502, 847 |
| `src/VaultMath.sol` | 71, 72 |
| `src/v4/StockVaultV4.sol` | 515, 859 |

### L-3: Large Numeric Literal (6 listed)

**False positive.** `20_000` is the named `MAX_ENTRY_FEE` (pips) at its declaration; `10_000` is the basis-point scale in `CapRegistry`, `CappedTakeHook` and `UptickHook`; the YYYYMMDD key in `UptickHook._isHoliday` is the date encoding of the holiday table. Each literal is the scale of its own formula.

| File | Lines |
|---|---|
| `src/StockVault.sol` | 126 |
| `src/hook/CapRegistry.sol` | 23 |
| `src/hook/CappedTakeHook.sol` | 176 |
| `src/hook/UptickHook.sol` | 153, 226 |
| `src/v4/StockVaultV4.sol` | 137 |

### L-4: Literal Instead of Constant (88 listed)

**False positive.** Basis-point and pip scales (`1e4`, `1e6`) and tick and share-offset literals in the maths. A named constant for `1e4` at every use would read worse than the literal the formulas are written in.

| File | Lines |
|---|---|
| `src/StockVault.sol` | 275, 276, 399, 400, 401, 402, 431, 502, 509, 690, 732, 737, 847, 938, 959, 990, 991, 997, 998 |
| `src/UptickRouter.sol` | 136, 179, 276, 277 |
| `src/UptickShareOracle.sol` | 125, 126, 127 |
| `src/VaultMath.sol` | 49, 71, 72, 96, 97 |
| `src/hook/CappedTakeHook.sol` | 161, 166 |
| `src/hook/UptickHook.sol` | 85, 153, 169, 176, 185, 186, 189, 192, 202, 207, 216, 218, 219, 226, 234, 235, 236, 237, 238, 239, 240, 241, 242, 247, 248, 249, 250, 251 |
| `src/v4/StockVaultV4.sol` | 293, 294, 408, 409, 410, 411, 430, 515, 519, 729, 743, 778, 783, 859, 932, 955, 970, 971, 976, 977 |
| `src/v4/StockVaultV4Lens.sol` | 47, 48, 52, 54, 55 |
| `src/v4/VaultMathV4.sol` | 101, 105 |

### L-5: Local Variable Shadows State Variable (32 listed)

**False positive.** Every instance is a member of a struct definition (`Config`, `PositionInfo` and the hook configuration in `StockVault.sol` 63 to 97, `StockVaultV4.sol` 73 to 108, `UptickHook.sol` 46 to 54) named like a state variable; a struct member is not a local and shadows nothing.

| File | Lines |
|---|---|
| `src/StockVault.sol` | 63, 64, 65, 66, 67, 68, 70, 71, 72, 95, 96, 97 |
| `src/hook/UptickHook.sol` | 46, 47, 48, 49, 50, 51, 52, 53, 54 |
| `src/v4/StockVaultV4.sol` | 73, 74, 75, 76, 77, 79, 80, 81, 83, 107, 108 |

### L-6: PUSH0 Opcode (3 listed)

**False positive.** The suite compiles for `evm_version = "cancun"` and forks Robinhood Chain, whose Uniswap v4 PoolManager is itself built on Cancun transient storage, so the chain executes Cancun opcodes (`PUSH0` included).

| File | Lines |
|---|---|
| `src/hook/CapRegistry.sol` | 2 |
| `src/hook/CappedTakeHook.sol` | 2 |
| `src/hook/UptickHook.sol` | 2 |

### L-7: Loop Contains `require`/`revert` (1 listed)

**False positive.** `VaultMathV4.fit` shrinks the liquidity at most six times until both token amounts fit, then reverts `CannotFit()`; an input that cannot fit must fail the call, not be skipped.

| File | Lines |
|---|---|
| `src/v4/VaultMathV4.sol` | 92 |

### L-8: State Change Without Event (1 listed)

**False positive.** `depositUsdgV4` sets and clears `_unlocking` around the PoolManager call; it is a within-transaction callback guard and an event for it would carry no information.

| File | Lines |
|---|---|
| `src/UptickRouter.sol` | 163 |

### L-9: Address State Variable Set Without Checks (2 listed)

**True positive (low).** Same result as Slither `missing-zero-check`: `setKeeper(address(0))`. See that verdict and its proposed fix.

| File | Lines |
|---|---|
| `src/StockVault.sol` | 345 |
| `src/v4/StockVaultV4.sol` | 356 |

### L-10: Unchecked Return (20 listed)

**Accepted residual.** Same sites as Slither `unused-return`; the swap, collect and liquidity calls are checked by balance difference or slippage minimums, and `_exit`/`health` returns are read where used.

| File | Lines |
|---|---|
| `src/StockVault.sol` | 552, 567, 585, 711, 750, 754, 795, 820, 828 |
| `src/UptickRouter.sol` | 142, 209, 235 |
| `src/v4/StockVaultV4.sol` | 558, 570, 590, 672, 809, 828, 842, 849 |

### L-11: Uninitialized Local Variable (2 listed)

**False positive.** Loop counters (`uint256 i;`) start at zero by design.

| File | Lines |
|---|---|
| `src/VaultFactory.sol` | 288 |
| `src/v4/VaultMathV4.sol` | 92 |

### L-12: Unsafe ERC20 Operation (2 listed)

**Accepted residual.** `stock.transfer(receiver, stockOut)` in `redeemInKind` is a `try` on the raw `transfer` on purpose: a Stock Token that reverts for an issuer pause or a blocklisted receiver must not block the exit, so the amount is credited to `stockOwed` and claimed later with `claimStockOwed`. `safeTransfer` would revert instead.

| File | Lines |
|---|---|
| `src/StockVault.sol` | 597 |
| `src/v4/StockVaultV4.sol` | 602 |

### L-13: Unspecific Solidity Pragma (3 listed)

**True positive (informational).** Pins to float: `CapRegistry.sol`, `CappedTakeHook.sol`, `UptickHook.sol` declare `^0.8.26`; every other source file is `0.8.26`. Proposed fix: `pragma solidity 0.8.26;` in the three hook files so the deployed bytecode matches the compiler the suite ran.

| File | Lines |
|---|---|
| `src/hook/CapRegistry.sol` | 2 |
| `src/hook/CappedTakeHook.sol` | 2 |
| `src/hook/UptickHook.sol` | 2 |

### L-14: Unused State Variable (2 listed)

**True positive (informational).** Same result as Slither `unused-state`: `Q128` and `UNIT_LIQUIDITY`. Proposed fix: delete.

| File | Lines |
|---|---|
| `src/StockVault.sol` | 135, 136 |

## Findings that carry a proposed change

`src/` is unchanged by this pass. The items below are the only true positives, in the order of weight.

| Item | Where | Proposed change |
|---|---|---|
| `setKeeper` accepts the zero address (low) | `StockVault.sol` 344, `StockVaultV4.sol` 355 | `if (keeper_ == address(0)) revert BadConfig();` |
| Share-lock amount cast without a bound (hardening) | `StockVault.sol` 656, `StockVaultV4.sol` 700 | `SafeCast.toUint128(...)` for the lock amount and block number |
| Floating pragma in the three hook files | `src/hook/*.sol` | `pragma solidity 0.8.26;` |
| Unused private constants | `StockVault.sol` 135 and 136 | delete |
| Address arguments not indexed in three admin events | `StockVault`, `StockVaultV4`, `VaultFactory` | `indexed` on the address argument at the next bytecode revision |

