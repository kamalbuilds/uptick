// Runs the earn-and-borrow calls against the real Morpho Blue singleton on a local Anvil fork of Robinhood Chain (4663).
// Start the fork first:  anvil --fork-url https://rpc.mainnet.chain.robinhood.com --port 8599 --silent
// Run:                   node --experimental-strip-types scripts/morpho-fork-check.ts
// It uses the live USDG/AMZN market (a plain token as collateral, since no Uptick vault is deployed): the supplyCollateral and borrow
// calls come from lib/morpho.ts, and the borrow limit, liquidation price and slider cap are checked against what Morpho itself accepts.
import { createPublicClient, createTestClient, createWalletClient, encodeFunctionData, getAddress, http, parseAbi, type Address, type Hex } from "viem";
import { borrowRoom, debtAssets, earnAndBorrowSteps, marketId, marketLiquidity, maxBorrowOf, MORPHO_BLUE, morphoAbi, oracleAbi, positionRisk } from "../lib/morpho.ts";
import { erc20Abi } from "../lib/abis.ts";

const url = process.env.FORK_URL ?? "http://127.0.0.1:8599";
const chain = { id: 4663, name: "Robinhood Chain fork", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } } as const;
const pub = createPublicClient({ chain, transport: http(url) });
const test = createTestClient({ chain, mode: "anvil", transport: http(url) });

const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const AMZN: Address = "0x12f190a9F9d7D37a250758b26824B97CE941bF54";
const market = {
  loanToken: USDG, collateralToken: AMZN,
  oracle: getAddress("0xB1E9aE2B51875b5A0Af7290189Bdd77F9758eE3A"), irm: getAddress("0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1"), lltv: 625_000_000_000_000_000n,
};
const user: Address = "0x00000000000000000000000000000000000b0b01";
const lender: Address = "0x00000000000000000000000000000000000c0c02";
const id = marketId(market);

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) process.exitCode = 1;
}

/** The Uniswap v4 PoolManager holds both tokens in size; the fork moves some from it to the test account. */
const POOL_MANAGER: Address = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const transferAbi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
async function give(token: Address, who: Address, amount: bigint) {
  const status = await send(POOL_MANAGER, token, encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [who, amount] }));
  const bal = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  if (status !== "success" || bal < amount) throw new Error(`could not fund ${who} with ${token}: ${status}, balance ${bal}`);
}

async function send(from: Address, to: Address, data: Hex): Promise<"success" | "reverted"> {
  await test.impersonateAccount({ address: from });
  await test.setBalance({ address: from, value: 10n ** 20n });
  const w = createWalletClient({ chain, transport: http(url), account: from });
  const hash = await w.sendTransaction({ to, data, gas: 3_000_000n });
  return (await pub.waitForTransactionReceipt({ hash })).status;
}

const marketTuple = { a: market.loanToken, b: market.collateralToken, c: market.oracle, d: market.irm, e: market.lltv };
const supplyAbi = parseAbi([
  "struct MP { address a; address b; address c; address d; uint256 e; }",
  "function supply(MP mp, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)",
]);

const collateral = 2n * 10n ** 18n;
await give(AMZN, user, 10n * 10n ** 18n);
await give(USDG, lender, 1_000_000n * 10n ** 6n);
await send(lender, USDG, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [MORPHO_BLUE, 100_000n * 10n ** 6n] }));
check("lender supplies 100,000 USDG to the market", (await send(lender, MORPHO_BLUE, encodeFunctionData({ abi: supplyAbi, functionName: "supply", args: [marketTuple, 100_000n * 10n ** 6n, 0n, lender, "0x"] }))) === "success", "supply tx");

const price = await pub.readContract({ address: market.oracle, abi: oracleAbi, functionName: "price" });
const before = await pub.readContract({ address: MORPHO_BLUE, abi: morphoAbi, functionName: "market", args: [id] });
const room = borrowRoom({ collateral, price, lltv: market.lltv, debt: 0n, liquidity: marketLiquidity(before[0], before[2]) });
const borrow = room.cap / 2n;
console.log(`oracle price ${price}, borrow limit ${room.maxBorrow}, slider cap ${room.cap}, borrowing ${borrow}`);

const steps = earnAndBorrowSteps({
  symbol: "AMZN", token: AMZN, vault: AMZN, market, account: user, deposit: 1n, collateral, borrow, tokenAllowance: 1n, shareAllowance: 0n,
}).filter((s) => s.id !== "deposit");
check("steps are approve, supplyCollateral, borrow", steps.map((s) => s.id).join() === "approve-shares,supply-collateral,borrow", steps.map((s) => s.id).join());

const usdgBefore = await pub.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [user] });
for (const s of steps) check(`Morpho accepts ${s.id}`, (await send(user, s.call.to, s.call.data)) === "success", s.label);
const usdgAfter = await pub.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [user] });
const pos = await pub.readContract({ address: MORPHO_BLUE, abi: morphoAbi, functionName: "position", args: [id, user] });
const after = await pub.readContract({ address: MORPHO_BLUE, abi: morphoAbi, functionName: "market", args: [id] });
check("USDG landed in the borrower's wallet", usdgAfter - usdgBefore === borrow, `${usdgAfter - usdgBefore} received, ${borrow} asked`);
check("collateral posted equals the plan", pos[2] === collateral, `${pos[2]} posted`);
const owed = debtAssets(pos[1], after[2], after[3]);
check("debt read back equals the borrow", owed >= borrow && owed <= borrow + 1n, `${owed} owed`);

const risk = positionRisk({ collateral, price, lltv: market.lltv, debt: owed });
check("healthy at the oracle price", maxBorrowOf(collateral, price, market.lltv) >= owed, `health factor ${risk.healthFactor}`);
check("healthy exactly at the liquidation price", maxBorrowOf(collateral, risk.liquidationPrice, market.lltv) >= owed, `${risk.liquidationPrice}`);
check("unhealthy one tick below it", maxBorrowOf(collateral, risk.liquidationPrice - 1n, market.lltv) < owed, `${risk.liquidationPrice - 1n}`);

// Must-fail: Morpho refuses a borrow that takes the position past the LLTV limit, so the limit the UI computes is the one Morpho enforces.
const over = earnAndBorrowSteps({
  symbol: "AMZN", token: AMZN, vault: AMZN, market, account: user, deposit: 1n, collateral, borrow: room.maxBorrow, tokenAllowance: 1n, shareAllowance: collateral,
}).find((s) => s.id === "borrow")!;
let refused = false;
try {
  refused = (await send(user, over.call.to, over.call.data)) === "reverted";
} catch {
  refused = true;
}
check("Morpho refuses a second borrow that pushes past the limit", refused, `limit ${room.maxBorrow}, already owed ${owed}`);
