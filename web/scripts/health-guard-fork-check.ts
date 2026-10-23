// Proves "Make it safer" (web/lib/loan.ts) on the real Morpho Blue singleton, on a local Anvil fork of Robinhood Chain (4663). No keys: the fork is
// taken from the public RPC and every account is impersonated.
// Start the fork first:  anvil --fork-url https://rpc.mainnet.chain.robinhood.com --port 8599 --silent
// Run:                   node --experimental-strip-types scripts/health-guard-fork-check.ts
//
// A  The live USDG/AMZN market, a plain token as collateral. A borrower takes a loan at about 1.35 health, a week passes, the plan repays from the wallet,
//    and the health factor Morpho itself computes (its stored state, the oracle) is at the target. The interest port is compared with Morpho to the wei,
//    and a halved repay is shown to miss the target.
// B  An Uptick vault share as collateral: a vault, its UptickShareOracle and a market on the live singleton are created on the fork. The wallet holds no
//    USDG, so the plan takes shares out, exits them in kind, repays with the USDG leg, and the batch lands at the target.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createTestClient, createWalletClient, decodeFunctionData, decodeFunctionResult, encodeFunctionData, getAddress, http, parseAbi, type Address, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { accrueInterest, loanView, marketStateOf, planSafer, repayEffect, type InKindQuote, type MarketState, type SaferPlan } from "../lib/loan.ts";
import { MORPHO_BLUE, irmAbi, marketId, morphoAbi, oracleAbi, type MarketParams, type Step } from "../lib/morpho.ts";
import { erc20Abi } from "../lib/abis.ts";

const url = process.env.FORK_URL ?? "http://127.0.0.1:8599";
const chain = { id: 4663, name: "Robinhood Chain fork", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } } as const;
const pub = createPublicClient({ chain, transport: http(url) });
const test = createTestClient({ chain, mode: "anvil", transport: http(url) });

const head = await pub.getBlock();
if (BigInt(Math.floor(Date.now() / 1000)) - head.timestamp > 1_800n || head.number < 95_900_000n) {
  throw new Error(`the fork is not fresh (head ${head.number} at ${head.timestamp}): this script moves time, so restart anvil before each run`);
}

const TARGET = 1.6;
const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const AMZN: Address = "0x12f190a9F9d7D37a250758b26824B97CE941bF54";
const POOL_MANAGER: Address = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const IRM: Address = getAddress("0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1");
const LLTV = 625_000_000_000_000_000n;
const amzn: MarketParams = { loanToken: USDG, collateralToken: AMZN, oracle: getAddress("0xB1E9aE2B51875b5A0Af7290189Bdd77F9758eE3A"), irm: IRM, lltv: LLTV };
const borrower: Address = "0x00000000000000000000000000000000000b0b01";
const lender: Address = "0x00000000000000000000000000000000000c0c02";

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) process.exitCode = 1;
}

async function send(from: Address, to: Address, data: Hex): Promise<{ status: "success" | "reverted"; block: bigint; at: bigint }> {
  await test.impersonateAccount({ address: from });
  await test.setBalance({ address: from, value: 10n ** 20n });
  const w = createWalletClient({ chain, transport: http(url), account: from });
  const hash = await w.sendTransaction({ to, data, gas: 6_000_000n });
  const r = await pub.waitForTransactionReceipt({ hash });
  return { status: r.status, block: r.blockNumber, at: (await pub.getBlock({ blockNumber: r.blockNumber })).timestamp };
}
/** Anvil deletes a snapshot when it is reverted to, so a second revert to the same id silently does nothing. This returns a fresh id for the state it restored, and throws if the revert did not happen. */
async function rewind(id: Hex): Promise<Hex> {
  if ((await test.request({ method: "evm_revert", params: [id] } as never)) !== true) throw new Error(`evm_revert ${id} did nothing: the snapshot was already used`);
  return test.snapshot();
}
/** True when the transaction mined successfully. A revert prints the 4-byte error the call returns, so a failing step names its cause. */
const ok = async (from: Address, to: Address, data: Hex) => {
  const r = await send(from, to, data);
  if (r.status === "success") return true;
  const why = await pub.call({ account: from, to, data, blockNumber: r.block - 1n }).then(() => "no revert on replay", (e: { cause?: { data?: Hex }; message: string }) => e.cause?.data?.slice(0, 10) ?? e.message.split("\n")[0]);
  console.log(`  reverted ${to} ${data.slice(0, 10)}: ${why}`);
  return false;
};

const transferAbi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
async function give(token: Address, who: Address, amount: bigint, source: Address = POOL_MANAGER) {
  const res = await send(source, token, encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [who, amount] }));
  const bal = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  if (res.status !== "success" || bal < amount) throw new Error(`could not fund ${who} with ${token}: ${res.status}, balance ${bal}`);
}
const balance = (token: Address, who: Address) => pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

const supplyAbi = parseAbi([
  "struct MP { address a; address b; address c; address d; uint256 e; }",
  "function supply(MP mp, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)",
]);
const tuple = (m: MarketParams) => ({ a: m.loanToken, b: m.collateralToken, c: m.oracle, d: m.irm, e: m.lltv });

/** The IRM's rate for `market` as the chain computes it for a block stamped `at`. */
async function rateAt(m: MarketParams, market: MarketState, at?: bigint): Promise<bigint> {
  const r = await pub.call({
    to: m.irm, data: encodeFunctionData({ abi: irmAbi, functionName: "borrowRateView", args: [m, market] }),
    ...(at ? { blockOverrides: { time: at } } : {}),
  });
  return decodeFunctionResult({ abi: irmAbi, functionName: "borrowRateView", data: r.data! });
}
const readMarket = async (id: Hex, blockNumber?: bigint) => marketStateOf(await pub.readContract({ address: MORPHO_BLUE, abi: morphoAbi, functionName: "market", args: [id], blockNumber }));
const readPosition = (id: Hex, who: Address, blockNumber?: bigint) => pub.readContract({ address: MORPHO_BLUE, abi: morphoAbi, functionName: "position", args: [id, who], blockNumber });
const readPrice = (oracle: Address, blockNumber?: bigint) => pub.readContract({ address: oracle, abi: oracleAbi, functionName: "price", blockNumber });

/** Health factor as Morpho's `_isHealthy` sees it from storage, written here without the lib: borrow shares to assets rounded up, collateral value rounded down. */
async function chainHealth(m: MarketParams, who: Address): Promise<{ health: number; debt: bigint }> {
  const id = marketId(m);
  const [, bs, col] = await readPosition(id, who);
  const mk = await readMarket(id);
  const debt = (bs * (mk.totalBorrowAssets + 1n) + mk.totalBorrowShares + 1_000_000n - 1n) / (mk.totalBorrowShares + 1_000_000n);
  const price = await readPrice(m.oracle);
  const maxBorrow = (((col * price) / 10n ** 36n) * m.lltv) / 10n ** 18n;
  return { health: debt === 0n ? Infinity : Number((maxBorrow * 1_000_000n) / debt) / 1e6, debt };
}

/** Runs a plan the way a sequential wallet does: one transaction per step, the first stamped `at`, each next block one second later. */
async function run(steps: Step[], from: Address, at: bigint): Promise<boolean> {
  for (let i = 0; i < steps.length; i++) {
    await test.setNextBlockTimestamp({ timestamp: at + BigInt(i) });
    if (!(await ok(from, steps[i].call.to, steps[i].call.data))) return false;
  }
  return true;
}

/** The inputs of planSafer, read from the chain the way the app reads them. */
async function inputs(m: MarketParams, vault: Address, who: Address, inKind?: InKindQuote, target = TARGET) {
  const id = marketId(m);
  const [, bs, col] = await readPosition(id, who);
  const market = await readMarket(id);
  const now = (await pub.getBlock()).timestamp;
  return {
    symbol: "STOCK", market: m, vault, account: who, collateral: col, borrowShares: bs, state: market, borrowRate: await rateAt(m, market), now,
    price: await readPrice(m.oracle), target, usdgBalance: await balance(USDG, who),
    usdgAllowance: await pub.readContract({ address: USDG, abi: erc20Abi, functionName: "allowance", args: [who, MORPHO_BLUE] }), inKind,
  };
}
const ready = (p: SaferPlan) => {
  if (p.status !== "ready") throw new Error(`plan is ${p.status}: ${"reason" in p ? p.reason : ""}`);
  return p;
};
const fmt = (n: bigint, d = 6) => (Number(n) / 10 ** d).toFixed(4);

// =====================================================================================================================================
// A. repay from the wallet, on the live USDG/AMZN market
// =====================================================================================================================================
async function partA() {
  const id = marketId(amzn);
  const WEEK = 7n * 86_400n;
  await give(AMZN, borrower, 20n * 10n ** 18n);
  await give(USDG, lender, 40_000n * 10n ** 6n);
  await ok(lender, USDG, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [MORPHO_BLUE, 40_000n * 10n ** 6n] }));
  check("A lender supplies 3,200 USDG to the live market", await ok(lender, MORPHO_BLUE, encodeFunctionData({ abi: supplyAbi, functionName: "supply", args: [tuple(amzn), 3_200n * 10n ** 6n, 0n, lender, "0x"] })), "supply tx");

  await ok(borrower, AMZN, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [MORPHO_BLUE, 20n * 10n ** 18n] }));
  const collateralAbi = parseAbi(["struct MP { address a; address b; address c; address d; uint256 e; }", "function supplyCollateral(MP mp, uint256 assets, address onBehalf, bytes data)"]);
  await ok(borrower, MORPHO_BLUE, encodeFunctionData({ abi: collateralAbi, functionName: "supplyCollateral", args: [tuple(amzn), 20n * 10n ** 18n, borrower, "0x"] }));
  const price0 = await readPrice(amzn.oracle);
  const limit = (((20n * 10n ** 18n * price0) / 10n ** 36n) * LLTV) / 10n ** 18n;
  const borrowed = (limit * 74n) / 100n;
  const b = await send(borrower, MORPHO_BLUE, encodeFunctionData({ abi: morphoAbi, functionName: "borrow", args: [amzn, borrowed, 0n, borrower, borrower] }));
  check("A borrower takes 74% of the limit", b.status === "success", `limit ${fmt(limit)}, borrowed ${fmt(borrowed)} USDG`);
  const opening = await chainHealth(amzn, borrower);
  check("A the loan starts below the target", opening.health < TARGET, `health ${opening.health}`);

  // The same loan a week on: the market has not accrued, so only the interest port knows the debt.
  const t1 = b.at + WEEK;
  await test.setNextBlockTimestamp({ timestamp: t1 });
  await test.mine({ blocks: 1 });
  await give(USDG, borrower, 5_000n * 10n ** 6n);
  let snap = await test.snapshot();

  const plan = ready(planSafer(await inputs(amzn, AMZN, borrower)));
  const stored = await readMarket(id);
  const storedDebt = ((await readPosition(id, borrower))[1] * (stored.totalBorrowAssets + 1n) + stored.totalBorrowShares + 1_000_000n - 1n) / (stored.totalBorrowShares + 1_000_000n);
  check("A the plan repays from the wallet and sees interest the chain has not stored", plan.path === "repay" && plan.before.debt > storedDebt, `stored debt ${fmt(storedDebt)}, accrued ${fmt(plan.before.debt)}, health ${plan.before.healthFactor?.toFixed(4)} -> ${plan.after.healthFactor?.toFixed(4)}, repay ${fmt(plan.repay)} USDG`);

  const lastStepBlock = await run(plan.steps, borrower, t1 + 30n);
  check("A the batch mines", lastStepBlock, plan.steps.map((s) => s.id).join(" then "));
  const done = await chainHealth(amzn, borrower);
  check("A health on the chain is at the target", done.health >= TARGET && done.health < TARGET + 0.002, `health ${done.health} against target ${TARGET}, debt ${fmt(done.debt)} USDG`);

  // The port against Morpho, to the wei: the market and the borrower's shares one block before the repay, accrued and repaid by the lib, against what the chain holds after.
  const repayBlock = await pub.getBlockNumber({ cacheTime: 0 });
  const repayAt = (await pub.getBlock({ blockNumber: repayBlock })).timestamp;
  const before = await readMarket(id, repayBlock - 1n);
  const [, bsBefore] = await readPosition(id, borrower, repayBlock - 1n);
  const rate = await rateAt(amzn, before, repayAt);
  const expectedMarket = repayEffect(accrueInterest(before, rate, repayAt), bsBefore, plan.repay);
  const actualMarket = await readMarket(id);
  const [, bsAfter] = await readPosition(id, borrower);
  check("A the interest port and repay match Morpho's storage exactly", JSON.stringify({ ...actualMarket, bs: bsAfter }, (_, v) => (typeof v === "bigint" ? v.toString() : v)) === JSON.stringify({ ...expectedMarket.market, bs: expectedMarket.borrowShares }, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    `rate ${rate}, ${repayAt - before.lastUpdate} s of interest, borrow assets ${actualMarket.totalBorrowAssets}, shares ${bsAfter}`);

  // Must-fail: the same plan with the repay halved leaves the position under the target. The guard above is a check that can go red.
  snap = await rewind(snap);
  const halved = encodeFunctionData({ abi: morphoAbi, functionName: "repay", args: [amzn, plan.repay / 2n, 0n, borrower, "0x"] });
  const broken: Step[] = plan.steps.map((s) => (s.id === "repay" ? { ...s, call: { ...s.call, data: halved } } : s));
  await test.setNextBlockTimestamp({ timestamp: t1 + 30n });
  const ranBroken = await run(broken, borrower, t1 + 30n);
  const weak = await chainHealth(amzn, borrower);
  check("A must-fail: a halved repay leaves the chain under the target", ranBroken && weak.health < TARGET, `health ${weak.health} against target ${TARGET}`);

  // An accrual vector for the unit tests: Morpho's own accrueInterest, nothing else, from a recorded state.
  snap = await rewind(snap);
  const pre = await readMarket(id);
  const bigAt = t1 + 3n * 86_400n;
  const bigRate = await rateAt(amzn, pre, bigAt);
  await test.setNextBlockTimestamp({ timestamp: bigAt });
  await ok(borrower, MORPHO_BLUE, encodeFunctionData({ abi: morphoAbi, functionName: "accrueInterest", args: [amzn] }));
  const post = await readMarket(id);
  check("A accrueInterest three days on equals the port", JSON.stringify(post, (_, v) => (typeof v === "bigint" ? v.toString() : v)) === JSON.stringify(accrueInterest(pre, bigRate, bigAt), (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    `borrow assets ${pre.totalBorrowAssets} -> ${post.totalBorrowAssets}, rate ${bigRate}`);
  if (process.env.PRINT_VECTOR) console.log("vector", JSON.stringify({ fork_head: Number(head.number), market_id: id, before: pre, borrowRate: bigRate, at: bigAt, after: post }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  const view = loanView({ collateral: 20n * 10n ** 18n, borrowShares: (await readPosition(id, borrower))[1], market: pre, borrowRate: bigRate, now: bigAt, price: price0, lltv: LLTV });
  const onChain = await chainHealth(amzn, borrower);
  check("A the position debt at that block equals the chain's", view.debt === onChain.debt, `${view.debt} vs ${onChain.debt}`);
  snap = await rewind(snap);
}

// =====================================================================================================================================
// B. an Uptick vault share as collateral, a wallet with no USDG: take shares out, exit in kind, repay with the USDG leg
// =====================================================================================================================================
const REPO = new URL("../../", import.meta.url).pathname;
const A0: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // anvil account 0, impersonated; its key is derived below only to let forge broadcast
const TREASURY: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const vaultOps = parseAbi([
  "function asset() view returns (address)",
  "function maxDeposit(address receiver) view returns (uint256)",
  "function lastRebalance() view returns (uint256)",
  "function params() view returns (uint16,uint16,uint16,uint16,uint16,uint32,uint32,uint32)",
  "function rebalance()",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function redeemInKind(uint256 shares, address receiver, address owner) returns (uint256 stockOut, uint256 usdgOut)",
  "function health() view returns (uint8 status, uint256 price, uint256 updatedAt, uint160 sqrtOracle, uint160 sqrtTwap, uint160 sqrtSpot)",
]);
const morphoOps = parseAbi([
  "struct MP { address a; address b; address c; address d; uint256 e; }",
  "function createMarket(MP mp)",
  "function supplyCollateral(MP mp, uint256 assets, address onBehalf, bytes data)",
  "function withdrawCollateral(MP mp, uint256 assets, address onBehalf, address receiver)",
]);
const approve = (spender: Address, amount: bigint) => encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });
const advance = async (seconds: bigint) => { await test.increaseTime({ seconds: Number(seconds) }); await test.mine({ blocks: 1 }); };
const repayAmount = (data: Hex): bigint => decodeFunctionData({ abi: morphoAbi, data }).args![1] as bigint;

/** Deploys the NVDA vault through the factory with the repo's own DeployAll script (the one mainnet uses). */
function deployVault(): { vault: Address; factory: Address; token: Address } {
  execFileSync("node", [`${REPO}scripts/deploy-list.mjs`, "/tmp/hg-all.json"], { cwd: REPO });
  const nvda = (JSON.parse(readFileSync("/tmp/hg-all.json", "utf8")) as { symbol: string; token: Address }[]).filter((e) => e.symbol === "NVDA");
  if (nvda.length !== 1) throw new Error("NVDA is not in the deploy list");
  writeFileSync(`${REPO}contracts/cache/deploy-list-hg.json`, JSON.stringify(nvda));
  const key = mnemonicToAccount("test test test test test test test test test test test junk").getHdKey().privateKey!;
  const out = execFileSync("forge", ["script", "script/DeployAll.s.sol", "--rpc-url", url, "--broadcast"], {
    cwd: `${REPO}contracts`, encoding: "utf8",
    env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: "1", DEPLOY_LIST: "cache/deploy-list-hg.json", ALLOW_CLOSED: "true", ANVIL_KEY: BigInt(`0x${Buffer.from(key).toString("hex")}`).toString(), OWNER: A0, KEEPER: A0, TREASURY, MIN_REBALANCE_INTERVAL: "3600" },
  });
  const factory = /VaultFactory\s+(0x[0-9a-fA-F]{40})/.exec(out)?.[1];
  const vault = /StockVault\s+NVDA\s+(0x[0-9a-fA-F]{40})/.exec(out)?.[1];
  if (!factory || !vault) throw new Error(`could not read the deployed addresses from forge:\n${out.split("\n").slice(-12).join("\n")}`);
  return { vault: getAddress(vault), factory: getAddress(factory), token: nvda[0].token };
}

async function partB() {
  const { vault, factory, token } = deployVault();
  const pool: Address = getAddress("0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3"); // the NVDA v3 pool: holds the Stock Token to lend to test accounts
  const asset = await pub.readContract({ address: vault, abi: vaultOps, functionName: "asset" });
  check("B the factory deployed an NVDA vault", (await pub.getCode({ address: vault }))!.length > 100 && asset.toLowerCase() === token.toLowerCase(), vault);

  // seed, rebalance (the keeper step that opens the Uniswap position), let the TWAP catch up
  // The pool does not trade on the fork, so one TWAP window of time lets its average settle on spot even when the pool moved in the minutes before the fork block.
  await advance(700n);
  const room = await pub.readContract({ address: vault, abi: vaultOps, functionName: "maxDeposit", args: [A0] });
  const seed = room < 20n * 10n ** 18n ? room : 20n * 10n ** 18n;
  await give(token, A0, seed, pool);
  await ok(A0, token, approve(vault, seed));
  check("B seed deposit", await ok(A0, vault, encodeFunctionData({ abi: vaultOps, functionName: "deposit", args: [seed, A0] })), `${seed} NVDA wei of a ${room} cap`);
  // the borrower's deposit, before the keeper opens the position, so the position holds its NVDA
  await give(token, borrower, 12n * 10n ** 18n, pool);
  await ok(borrower, token, approve(vault, 12n * 10n ** 18n));
  check("B borrower deposits 12 NVDA", await ok(borrower, vault, encodeFunctionData({ abi: vaultOps, functionName: "deposit", args: [12n * 10n ** 18n, borrower] })), "deposit(12 NVDA)");
  const minInterval = (await pub.readContract({ address: vault, abi: vaultOps, functionName: "params" }))[7];
  const last = await pub.readContract({ address: vault, abi: vaultOps, functionName: "lastRebalance" });
  const now0 = (await pub.getBlock()).timestamp;
  if (last + BigInt(minInterval) + 1n > now0) await advance(last + BigInt(minInterval) + 1n - now0);
  check("B keeper rebalance opens the position", await ok(A0, vault, encodeFunctionData({ abi: vaultOps, functionName: "rebalance" })), "rebalance()");
  await advance(700n);
  const health = await pub.readContract({ address: vault, abi: vaultOps, functionName: "health" });
  check("B the vault reads Ok", health[0] === 0, `status ${health[0]}, Chainlink price ${health[1]}`);

  // the oracle and the market on the live singleton
  const art = JSON.parse(readFileSync(`${REPO}contracts/out/UptickShareOracle.sol/UptickShareOracle.json`, "utf8")) as { abi: never; bytecode: { object: Hex } };
  await test.impersonateAccount({ address: A0 });
  const w = createWalletClient({ chain, transport: http(url), account: A0 });
  const deployHash = await w.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args: [factory, vault], gas: 6_000_000n });
  const oracle = (await pub.waitForTransactionReceipt({ hash: deployHash })).contractAddress!;
  const share: MarketParams = { loanToken: USDG, collateralToken: vault, oracle, irm: IRM, lltv: LLTV };
  const id = marketId(share);
  check("B createMarket on the live singleton", await ok(A0, MORPHO_BLUE, encodeFunctionData({ abi: morphoOps, functionName: "createMarket", args: [tuple(share)] })), id);
  const price = await readPrice(oracle);
  check("B the oracle prices a share", price > 10n ** 19n && price < 10n ** 23n, `price ${price} in the 1e36 scale, about $${Number(price) / 1e18} a share`);

  await give(USDG, lender, 200_000n * 10n ** 6n);
  await ok(lender, USDG, approve(MORPHO_BLUE, 200_000n * 10n ** 6n));
  await ok(lender, MORPHO_BLUE, encodeFunctionData({ abi: supplyAbi, functionName: "supply", args: [tuple(share), 100_000n * 10n ** 6n, 0n, lender, "0x"] }));

  // the borrower: 12 NVDA into the vault, the shares posted, a loan at about 1.45 health, and no USDG left in the wallet
  const shares = await pub.readContract({ address: vault, abi: vaultOps, functionName: "balanceOf", args: [borrower] });
  await ok(borrower, vault, approve(MORPHO_BLUE, shares));
  check("B the borrower posts its shares", await ok(borrower, MORPHO_BLUE, encodeFunctionData({ abi: morphoOps, functionName: "supplyCollateral", args: [tuple(share), shares, borrower, "0x"] })), `${shares} shares`);
  const limit = (((shares * price) / 10n ** 36n) * LLTV) / 10n ** 18n;
  // Exiting in kind improves a loan only while the USDG leg of the exit is a larger share of the collateral than the loan is of its value, and that share moves with
  // where the pool sits in the vault's band. So the loan is sized from the vault's own quote: two points of value under what the leg can repay, at most health 1.45.
  const probe = await pub.simulateContract({ address: vault, abi: vaultOps, functionName: "redeemInKind", args: [shares, borrower, MORPHO_BLUE], account: MORPHO_BLUE });
  const value = (shares * price) / 10n ** 36n;
  const leg = Number(probe.result[1]) / Number(value);
  const borrowed = BigInt(Math.floor(Number(value) * Math.min(0.625 / 1.45, leg * 0.995 - 0.02)));
  const openingHealth = Number(limit) / Number(borrowed);
  const targetB = Math.max(1.6, Math.round((openingHealth + 0.1) * 20) / 20);
  const bo = await send(borrower, MORPHO_BLUE, encodeFunctionData({ abi: morphoAbi, functionName: "borrow", args: [share, borrowed, 0n, borrower, borrower] }));
  check("B the borrower takes a loan sized to the exit", bo.status === "success", `USDG leg is ${(leg * 100).toFixed(1)}% of the share's value; limit ${fmt(limit)}, borrowed ${fmt(borrowed)} USDG, health ${openingHealth.toFixed(3)}, target ${targetB}`);
  await ok(borrower, USDG, encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [lender, await balance(USDG, borrower)] }));
  check("B the wallet holds no USDG", (await balance(USDG, borrower)) === 0n, "0 USDG");
  await advance(6n * 3_600n);
  // SCENE_ONLY=1 stops here and leaves the fork as the app should see it: a vault, its oracle, a market and a wallet holding a loan sized to the vault's exit (health 1.45 or a little more).
  // Put `scene.market` in web/lib/collateral-markets.json, `scene.vault` in NEXT_PUBLIC_VAULTS, point NEXT_PUBLIC_RPC_URL at the fork and open /portfolio as `scene.borrower`.
  if (process.env.SCENE_ONLY) {
    console.log("scene", JSON.stringify({ vault, oracle, irm: IRM, lltv: LLTV.toString(), borrower, symbol: "NVDA", id: "nvda" }));
    process.exit(process.exitCode ?? 0);
  }

  // what the vault would pay for all the collateral, asked of the vault itself as Morpho would be: no oracle, no signature
  const sim = await pub.simulateContract({ address: vault, abi: vaultOps, functionName: "redeemInKind", args: [shares, borrower, MORPHO_BLUE], account: MORPHO_BLUE });
  const quote: InKindQuote = { shares, stock: sim.result[0], usdg: sim.result[1] };
  console.log(`  vault quote for all ${shares} shares: ${quote.stock} NVDA wei and ${fmt(quote.usdg)} USDG`);

  let snap = await test.snapshot();
  const plan = ready(planSafer({ ...(await inputs(share, vault, borrower, quote, targetB)), symbol: "NVDA" }));
  check("B the plan exits in kind, in rounds", plan.path === "in-kind", `${plan.rounds} rounds, ${fmt(plan.shares, 24)} shares out, ${fmt(plan.repay)} USDG repaid, health ${plan.before.healthFactor?.toFixed(4)} -> ${plan.after.healthFactor?.toFixed(4)}`);

  // Morpho itself refuses the one-round version: the shares cannot all leave first
  const oneGo = encodeFunctionData({ abi: morphoOps, functionName: "withdrawCollateral", args: [tuple(share), plan.shares, borrower, borrower] });
  check("B must-fail: Morpho refuses to take all the shares out in one withdrawal", (await send(borrower, MORPHO_BLUE, oneGo).catch(() => ({ status: "reverted" as const }))).status === "reverted", `${fmt(plan.shares, 24)} shares`);
  snap = await rewind(snap);

  const stockBefore = await balance(token, borrower);
  const t0 = (await pub.getBlock()).timestamp + 30n;
  let lowest = Infinity;
  for (let i = 0; i < plan.steps.length; i++) {
    await test.setNextBlockTimestamp({ timestamp: t0 + BigInt(i) });
    check(`B step ${i + 1} ${plan.steps[i].id}`, await ok(borrower, plan.steps[i].call.to, plan.steps[i].call.data), plan.steps[i].label);
    lowest = Math.min(lowest, (await chainHealth(share, borrower)).health);
  }
  const done = await chainHealth(share, borrower);
  check("B health on the chain is at the target", done.health >= targetB && done.health < targetB + 0.05, `health ${done.health} against target ${targetB}, debt ${fmt(done.debt)} USDG`);
  check("B never below the step floor between two transactions", lowest >= 1.03, `lowest ${lowest}`);
  const stockBack = (await balance(token, borrower)) - stockBefore;
  check("B the stock leg is back in the wallet", stockBack > 0n && stockBack >= (plan.stock * 999n) / 1000n, `${stockBack} NVDA wei back, plan said ${plan.stock}`);
  check("B the margin stays as USDG", (await balance(USDG, borrower)) > 0n, `${fmt(await balance(USDG, borrower))} USDG left`);

  // Must-fail: the same plan with every repay halved lands under the target on the chain
  snap = await rewind(snap);
  const weak: Step[] = plan.steps.map((s) => s.id !== "repay" ? s : { ...s, call: { ...s.call, data: encodeFunctionData({ abi: morphoAbi, functionName: "repay", args: [share, repayAmount(s.call.data) / 2n, 0n, borrower, "0x"] }) } });
  const rans = await run(weak, borrower, (await pub.getBlock()).timestamp + 30n);
  const low = await chainHealth(share, borrower);
  check("B must-fail: halved repays leave the chain under the target", !(rans && low.health >= targetB), `batch mined: ${rans}, health ${low.health} against target ${targetB}`);
}

const base = await test.snapshot();
await partB();
await rewind(base);
await partA();
console.log(process.exitCode ? "FAILED" : "all checks passed");

