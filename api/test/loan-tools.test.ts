import { afterEach, describe, expect, test } from "bun:test";
import { decodeFunctionData, type Address } from "viem";
import worker from "../src/worker";
import { setLoanToolDeps } from "../src/mcp";
import { accrueInterest } from "../../web/lib/loan.ts";
import { MORPHO_BLUE, debtAssets, maxBorrowOf, morphoAbi } from "../../web/lib/morpho.ts";
import { erc20Abi, vaultAbi } from "../../web/lib/abis.ts";
import { BORROWER, ENTRY, LLTV, USDG, VAULT, freshChain, fakeClient, type Chain } from "./fake-chain";

const env = { VAULTS: JSON.stringify({ nvda: VAULT }), NETWORK: "robinhood-chain-fork" } as Record<string, unknown>;
const ctx = {} as ExecutionContext;

type Result = { structuredContent: Record<string, any>; isError?: boolean };
async function callTool(name: string, args: Record<string, unknown>, e: Record<string, unknown> = env): Promise<Result> {
  const res = await worker.fetch(
    new Request("https://uptick.test/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }),
    e as never,
    ctx,
  );
  return ((await res.json()) as { result: Result }).result;
}

const withChain = (chain: Chain) => setLoanToolDeps({ client: fakeClient(chain), markets: { nvda: ENTRY } });
afterEach(() => setLoanToolDeps({}));

/** The health factor a position has after `calls` run in order on the fake node's state, computed here from the decoded calldata and not by the planner. */
function healthAfter(chain: Chain, calls: { to: string; data: `0x${string}` }[], inKind?: { stock: bigint; usdg: bigint }) {
  const me = BORROWER.toLowerCase();
  const pos = { ...chain.positions[me] };
  let market = accrueInterest(chain.market!, chain.rate, chain.now);
  let wallet = chain.usdg[me] ?? 0n;
  let shares = 0n;
  for (const c of calls) {
    if (c.to === MORPHO_BLUE) {
      const d = decodeFunctionData({ abi: morphoAbi, data: c.data });
      if (d.functionName === "withdrawCollateral") {
        const amount = d.args![1] as bigint;
        pos.collateral -= amount;
        shares += amount;
        expect(maxBorrowOf(pos.collateral, chain.price, LLTV)).toBeGreaterThanOrEqual(debtAssets(pos.borrowShares, market.totalBorrowAssets, market.totalBorrowShares));
      } else if (d.functionName === "repay") {
        const assets = d.args![1] as bigint;
        expect(wallet).toBeGreaterThanOrEqual(assets);
        wallet -= assets;
        const burned = (assets * (market.totalBorrowShares + 1_000_000n)) / (market.totalBorrowAssets + 1n);
        pos.borrowShares -= burned;
        market = { ...market, totalBorrowShares: market.totalBorrowShares - burned, totalBorrowAssets: market.totalBorrowAssets - assets };
      } else throw new Error(d.functionName);
    } else if (c.to === VAULT) {
      const d = decodeFunctionData({ abi: vaultAbi, data: c.data });
      expect(d.functionName).toBe("redeemInKind");
      const n = d.args![0] as bigint;
      expect(shares).toBeGreaterThanOrEqual(n);
      shares -= n;
      wallet += (inKind!.usdg * n) / chain.positions[me].collateral;
    }
  }
  const debt = debtAssets(pos.borrowShares, market.totalBorrowAssets, market.totalBorrowShares);
  return Number((maxBorrowOf(pos.collateral, chain.price, LLTV) * 1_000_000n) / debt) / 1e6;
}

describe("check_loan_health", () => {
  test("a vault with no Morpho market answers has_market false with the reason, and no node is asked", async () => {
    const r = await callTool("check_loan_health", { address: BORROWER, vault: "nvda" });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ vault: "nvda", has_market: false, has_position: false });
    expect(r.structuredContent.reason).toMatch(/no Morpho market is configured for vault nvda/);
  });

  test("reports collateral, accrued debt, health factor and the liquidation share price from the node", async () => {
    const chain = freshChain();
    withChain(chain);
    const r = await callTool("check_loan_health", { address: BORROWER, vault: "nvda" });
    const s = r.structuredContent;
    expect(s).toMatchObject({ vault: "nvda", address: BORROWER, has_market: true, has_position: true, collateral_shares: String(100n * 10n ** 24n), collateral_value_usdg: String(20_000n * 10n ** 6n) });
    // three days of ~8% on $400,000 borrowed accrue into the borrower's share of the debt: above the $9,000 stored, under $9,010
    expect(Number(s.debt_usdg)).toBeGreaterThan(9_000_000_000);
    expect(Number(s.debt_usdg)).toBeLessThan(9_010_000_000);
    expect(s.health_factor).toBeGreaterThan(1.38);
    expect(s.health_factor).toBeLessThan(1.39);
    expect(s.drop_to_liquidation).toBeGreaterThan(0.27);
    expect(s.drop_to_liquidation).toBeLessThan(0.29);
    // the share liquidates at debt / (collateral * lltv): about $144 against $200 now
    expect(Number(s.liquidation_share_price) / 1e18).toBeGreaterThan(143);
    expect(Number(s.liquidation_share_price) / 1e18).toBeLessThan(145);
    expect(s.share_price).toBe(String(200n * 10n ** 18n));
  });

  test("a wallet with no position, a market not yet on-chain, a bad address, an unknown vault and a missing node each answer plainly", async () => {
    const chain = freshChain();
    withChain(chain);
    const empty = await callTool("check_loan_health", { address: "0x00000000000000000000000000000000000d0d04", vault: "nvda" });
    expect(empty.structuredContent).toMatchObject({ has_market: true, has_position: false });
    expect(empty.structuredContent.reason).toMatch(/no collateral or debt/);

    chain.market = null;
    const missing = await callTool("check_loan_health", { address: BORROWER, vault: "nvda" });
    expect(missing.structuredContent).toMatchObject({ has_market: false });
    expect(missing.structuredContent.reason).toMatch(/not created on-chain/);

    expect((await callTool("check_loan_health", { address: "0x12", vault: "nvda" })).isError).toBe(true);
    expect((await callTool("check_loan_health", { address: BORROWER, vault: "nope" })).isError).toBe(true);

    setLoanToolDeps({ markets: { nvda: ENTRY } }); // a market, but no client and no CHAIN_RPC_URL
    const noNode = await callTool("check_loan_health", { address: BORROWER, vault: "nvda" });
    expect(noNode.isError).toBe(true);
    expect(noNode.structuredContent.error).toMatch(/CHAIN_RPC_URL/);
  });
});

describe("prepare_make_safer", () => {
  test("a wallet holding USDG gets approve and repay, and the decoded calls leave the loan at the target", async () => {
    const chain = freshChain();
    chain.usdg[BORROWER.toLowerCase()] = 20_000n * 10n ** 6n;
    withChain(chain);
    const r = await callTool("prepare_make_safer", { address: BORROWER, vault: "nvda" });
    const s = r.structuredContent;
    expect(s).toMatchObject({ status: "ready", path: "repay", target_health: 1.6, rounds: 0, network: "robinhood-chain-fork" });
    const txs = s.transactions as { chainId: number; to: Address; data: `0x${string}`; value: string; description: string }[];
    expect(txs.map((t) => t.to)).toEqual([USDG, MORPHO_BLUE]);
    expect(txs.every((t) => t.chainId === 4663 && t.value === "0")).toBe(true);
    const approve = decodeFunctionData({ abi: erc20Abi, data: txs[0].data });
    expect(approve.args).toEqual([MORPHO_BLUE, BigInt(s.repay_usdg)]);
    const repay = decodeFunctionData({ abi: morphoAbi, data: txs[1].data });
    expect(repay.args![1]).toBe(BigInt(s.repay_usdg));
    expect(repay.args![3]).toBe(BORROWER);
    expect(s.health_before).toBeLessThan(1.4);
    expect(s.health_after_estimate).toBeGreaterThanOrEqual(1.6);
    // run on the model: execution ten minutes after the read still lands at the target
    chain.now += 600n;
    expect(healthAfter(chain, txs)).toBeGreaterThanOrEqual(1.6);
  });

  test("a wallet with no USDG gets rounds of withdraw, exit in kind and repay, and the decoded calls leave the loan at the target", async () => {
    const chain = freshChain(); // the vault pays 50% of the share's value as USDG
    withChain(chain);
    const r = await callTool("prepare_make_safer", { address: BORROWER, vault: "nvda", target_health: 1.6 });
    const s = r.structuredContent;
    expect(s).toMatchObject({ status: "ready", path: "in_kind" });
    expect(s.rounds).toBeGreaterThanOrEqual(2);
    const txs = s.transactions as { to: Address; data: `0x${string}`; description: string }[];
    expect(txs.length).toBe(s.rounds * 3 + 1);
    expect(txs[0].to).toBe(MORPHO_BLUE);
    expect(decodeFunctionData({ abi: morphoAbi, data: txs[0].data }).functionName).toBe("withdrawCollateral");
    expect(txs[1].to).toBe(VAULT);
    expect(decodeFunctionData({ abi: vaultAbi, data: txs[1].data }).functionName).toBe("redeemInKind");
    expect(txs[0].description).toMatch(/Take the shares out of Morpho/);
    chain.now += 600n;
    expect(healthAfter(chain, txs, chain.inKind!)).toBeGreaterThanOrEqual(1.6);
    expect(BigInt(s.stock_returned)).toBeGreaterThan(0n);
  });

  test("a loan that is safe, a wallet without a loan, a market that is missing and a route that cannot work each return no calldata and say why", async () => {
    const chain = freshChain();
    chain.usdg[BORROWER.toLowerCase()] = 20_000n * 10n ** 6n;
    withChain(chain);

    const safe = (await callTool("prepare_make_safer", { address: BORROWER, vault: "nvda", target_health: 1.2 })).structuredContent;
    expect(safe).toMatchObject({ status: "already_safe", transactions: [] });
    expect(safe.reason).toMatch(/already meets/);

    const none = (await callTool("prepare_make_safer", { address: "0x00000000000000000000000000000000000d0d04", vault: "nvda" })).structuredContent;
    expect(none).toMatchObject({ status: "no_position", transactions: [] });
    expect(none.reason).toMatch(/no collateral or debt/);

    setLoanToolDeps({}); // no market is configured in the shipped data
    const nomarket = (await callTool("prepare_make_safer", { address: BORROWER, vault: "nvda" })).structuredContent;
    expect(nomarket).toMatchObject({ status: "no_market", transactions: [] });
    expect(nomarket.reason).toMatch(/no Morpho market/);

    const poor = freshChain();
    poor.inKind = null; // no USDG and the vault cannot be asked
    withChain(poor);
    const stuck = (await callTool("prepare_make_safer", { address: BORROWER, vault: "nvda" })).structuredContent;
    expect(stuck).toMatchObject({ status: "unreachable", transactions: [] });
    expect(stuck.reason).toMatch(/could not be asked/);
  });

  test("refuses a target outside 1.05 to 5, a bad address and an unknown vault", async () => {
    withChain(freshChain());
    for (const target_health of [1.0, 5.5, "high", Number.NaN]) {
      expect((await callTool("prepare_make_safer", { address: BORROWER, vault: "nvda", target_health })).isError).toBe(true);
    }
    expect((await callTool("prepare_make_safer", { address: "nope", vault: "nvda" })).isError).toBe(true);
    expect((await callTool("prepare_make_safer", { address: BORROWER, vault: "nope" })).isError).toBe(true);
  });
});
