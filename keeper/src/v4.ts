/** Uniswap v4 pool rules shared by the keeper scripts: which pool keys StockVaultV4 can hold, and StateView reads. keeper/replay/replay.py mirrors V4_HOOK_FLAGS and the key rule (keeper/test/v4.test.ts asserts it). */
import { parseAbi, type Address } from "viem";

export const POOL_MANAGER: Address = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
export const STATE_VIEW: Address = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
export const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
]);

/** A pool whose fee carries this flag lets its hook set the fee per swap. */
export const DYNAMIC_FEE = 0x800000;

/** Hook permission flags (address low bits) StockVaultV4 refuses: before/after removeLiquidity, before/after swap, before/after addLiquidity and the four returns-delta flags (only initialize and donate hooks pass). */
export const V4_HOOK_FLAGS = (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2) | (1 << 1) | 1;

const ZERO = /^0x0{40}$/i;

/** The pool key StockVaultV4 accepts: a static fee, and the zero hook, or an allow-listed hook (lowercase set) with none of V4_HOOK_FLAGS set. */
export function v4KeyOk(fee: number, hooks: string, allow: ReadonlySet<string>): boolean {
  if ((fee & DYNAMIC_FEE) !== 0) return false;
  if (ZERO.test(hooks)) return true;
  return allow.has(hooks.toLowerCase()) && (Number(BigInt(hooks) & 0xffffn) & V4_HOOK_FLAGS) === 0;
}
