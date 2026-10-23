"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, type Address } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useBlock, useReadContract, useReadContracts, useSimulateContract } from "wagmi";
import { CircleNotch } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "./ledger";
import { Skeleton } from "./status";
import { StepList, useStepRunner } from "./step-runner";
import { erc20Abi, vaultAbi } from "@/lib/abis";
import { robinhoodChain } from "@/lib/chain";
import { collateralMarket } from "@/lib/collateral-markets";
import { num, pct, usd } from "@/lib/format";
import { DEFAULT_TARGET_HEALTH, hasLoan, liquidationInStock, loanView, marketStateOf, planSafer, type SaferPlan } from "@/lib/loan";
import { MORPHO_BLUE, irmAbi, marketId, morphoAbi, oracleAbi, sharePriceUsd, type MarketParams } from "@/lib/morpho";
import { usePrices } from "@/lib/prices";
import { cn } from "@/lib/utils";
import { SHARE_DECIMALS, USDG, type VaultConfig } from "@/lib/vaults";

const USDG_DECIMALS = 6;
const usdg = (n: bigint) => num(Number(formatUnits(n, USDG_DECIMALS)), 2);
const shares = (n: bigint) => num(Number(formatUnits(n, SHARE_DECIMALS)), 6);
const REFRESH_MS = 15_000;

type Live = { cfg: VaultConfig; vault: Address; market: MarketParams };

/** The vaults of `cfgs` that have a Morpho market and a deployed vault. */
const withMarket = (cfgs: VaultConfig[]): Live[] =>
  cfgs.flatMap((cfg) => {
    const market = collateralMarket(cfg.id, cfg.vault);
    return market && cfg.vault ? [{ cfg, vault: cfg.vault, market }] : [];
  });

/** Your loans on Uptick share markets: the section appears only for a connected wallet that has collateral or debt in one of them, and shows each loan with its health and a one-click fix. */
export function YourLoans({ cfgs, className }: { cfgs: VaultConfig[]; className?: string }) {
  const { address, chainId } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const live = useMemo(() => withMarket(cfgs), [cfgs]);
  const onChain = mounted && Boolean(address) && chainId === robinhoodChain.id;
  const found = useReadContracts({
    allowFailure: false,
    query: { enabled: onChain && live.length > 0, refetchInterval: REFRESH_MS * 2 },
    contracts: address ? live.map((l) => ({ address: MORPHO_BLUE, abi: morphoAbi, functionName: "position" as const, args: [marketId(l.market), address] as const, chainId: robinhoodChain.id })) : [],
  });
  if (!onChain || !address || !found.data) return null;
  const held = live.filter((_, i) => hasLoan(found.data[i][2], found.data[i][1]));
  if (held.length === 0) return null;
  return (
    <section aria-labelledby="your-loan" className={className}>
      <SectionTitle id="your-loan" aside="Morpho Blue · vault shares as collateral">Your loan</SectionTitle>
      <div className="divide-y divide-hairline">
        {held.map((l) => <LoanPanel key={l.cfg.id} {...l} owner={address} />)}
      </div>
    </section>
  );
}

function LoanPanel({ cfg, vault, market, owner }: Live & { owner: Address }) {
  const id = marketId(market);
  const queryClient = useQueryClient();
  const [target, setTarget] = useState(DEFAULT_TARGET_HEALTH);
  const runner = useStepRunner();
  const stockPrice = usePrices().data?.byId.get(cfg.id)?.usd ?? cfg.refPriceUsd;

  const side = useReadContracts({
    allowFailure: false,
    query: { refetchInterval: REFRESH_MS },
    contracts: [
      { address: MORPHO_BLUE, abi: morphoAbi, functionName: "market", args: [id], chainId: robinhoodChain.id },
      { address: MORPHO_BLUE, abi: morphoAbi, functionName: "position", args: [id, owner], chainId: robinhoodChain.id },
      { address: market.oracle, abi: oracleAbi, functionName: "price", chainId: robinhoodChain.id },
      { address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [owner], chainId: robinhoodChain.id },
      { address: USDG, abi: erc20Abi, functionName: "allowance", args: [owner, MORPHO_BLUE], chainId: robinhoodChain.id },
    ],
  });
  const [mkt, pos, price, balance, allowance] = side.data ?? [];
  const state = mkt ? marketStateOf(mkt) : undefined;
  const rate = useReadContract({
    address: market.irm, abi: irmAbi, functionName: "borrowRateView", args: state ? [market, state] : undefined, chainId: robinhoodChain.id,
    query: { enabled: Boolean(state && state.lastUpdate > 0n), refetchInterval: REFRESH_MS },
  });
  const block = useBlock({ chainId: robinhoodChain.id, query: { refetchInterval: REFRESH_MS } });
  const collateral = pos?.[2] ?? 0n;
  // What the vault would pay for an in-kind exit of all the collateral, asked as Morpho would ask it. Only the route without USDG in the wallet needs it.
  const quote = useSimulateContract({
    address: vault, abi: vaultAbi, functionName: "redeemInKind", args: [collateral, owner, MORPHO_BLUE], account: MORPHO_BLUE, chainId: robinhoodChain.id,
    query: { enabled: collateral > 0n, refetchInterval: REFRESH_MS * 2 },
  });

  const ready = state && pos && price !== undefined && balance !== undefined && allowance !== undefined && rate.data !== undefined && block.data;
  const input = ready ? { market: state, borrowRate: rate.data, now: block.data.timestamp, price, collateral, borrowShares: pos[1], lltv: market.lltv } : undefined;
  const view = useMemo(() => (input ? loanView(input) : undefined), [input?.market, input?.borrowRate, input?.now, input?.price, input?.collateral, input?.borrowShares]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan: SaferPlan | undefined = useMemo(() => {
    if (!input || balance === undefined || allowance === undefined) return undefined;
    const inKind = quote.data ? { shares: collateral, stock: quote.data.result[0], usdg: quote.data.result[1] } : undefined;
    return planSafer({
      symbol: cfg.symbol, market, vault, account: owner, collateral, borrowShares: input.borrowShares, state: input.market, borrowRate: input.borrowRate, now: input.now, price: input.price,
      target, usdgBalance: balance, usdgAllowance: allowance, inKind,
    });
  }, [input?.market, input?.borrowRate, input?.now, input?.price, balance, allowance, quote.data, target]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!runner.finished) return;
    void side.refetch();
    void rate.refetch();
    void quote.refetch();
    void queryClient.invalidateQueries({ queryKey: ["readContracts"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner.finished]);

  if (side.isError) {
    return (
      <div role="alert" className="py-6">
        <p className="font-semibold">The chain did not answer for your {cfg.symbol} loan.</p>
        <p className="mt-1 text-[13px] text-mute">Every figure here is read live. Retry asks again.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void side.refetch()}>Retry</Button>
      </div>
    );
  }
  if (!view || !input) return <div aria-busy="true" className="py-6"><Skeleton className="h-8 w-80" /><Skeleton className="mt-4 h-40 w-full" /></div>;

  const hf = view.risk.healthFactor;
  const drop = view.risk.dropToLiquidation;
  const stockLiq = liquidationInStock(stockPrice, drop);
  const liqShare = view.risk.liquidationPrice > 0n ? sharePriceUsd(view.risk.liquidationPrice, SHARE_DECIMALS, USDG_DECIMALS) : undefined;
  const sharePrice = sharePriceUsd(input.price, SHARE_DECIMALS, USDG_DECIMALS);
  const tone = hf === null ? "" : hf < 1.1 ? "text-loss" : hf < 1.25 ? "text-caution" : "";
  const word = hf === null ? "No debt" : hf < 1.1 ? "Close to liquidation" : hf < 1.25 ? "Thin margin" : "Comfortable";
  const verdict =
    drop === null ? `Your ${cfg.symbol} shares are posted and nothing is owed.` :
    hf !== null && hf < 1.1 ? `A ${pct(drop * 100, 1)} fall in ${cfg.symbol} liquidates this loan.` :
    `${cfg.symbol} can fall ${pct(drop * 100, 1)} before this loan is liquidated.`;
  const { run } = runner;

  return (
    <article aria-label={`${cfg.symbol} loan`} className="grid gap-x-16 gap-y-8 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <div className="min-w-0">
        <p className="text-[13px] leading-5 text-mute">{cfg.symbol} vault shares as collateral, borrowing USDG</p>
        <p className="serif mt-2 max-w-[560px] text-[26px] leading-8" data-testid="loan-verdict">{verdict}</p>
        <dl className="mt-4">
          <Row k="Collateral"><span className="figure" data-testid="loan-collateral">{shares(view.collateral)}</span> shares, worth <span className="figure">{usdg(view.collateralValue)}</span> USDG</Row>
          <Row k="Debt, interest included"><span className="figure" data-testid="loan-debt">{usdg(view.debt)}</span> USDG</Row>
          <Row k="Health factor">
            {hf !== null ? <><span className={cn("figure text-[20px] font-medium leading-6", tone)} data-testid="loan-health">{hf > 99 ? ">99" : hf.toFixed(2)}</span> <span className={cn("text-[13px]", tone || "text-mute")}>{word}</span></> : <span className="text-mute">{word}</span>}
          </Row>
          <Row k="Liquidation price" last>
            {stockLiq !== undefined && liqShare !== undefined ? (
              <span className="block">
                <span className="figure text-[20px] font-medium leading-6" data-testid="loan-liquidation">{usd(stockLiq, { compact: false })}</span> <span className="text-[15px] font-semibold">{cfg.symbol}</span>
                <span className="figure block text-[13px] leading-5 text-mute">now {usd(stockPrice, { compact: false })}, a fall of {pct((drop ?? 0) * 100, 1)}</span>
                <span className="figure block text-[13px] leading-5 text-mute">the share liquidates at {usd(liqShare, { compact: false })}, now {usd(sharePrice, { compact: false })}</span>
              </span>
            ) : <span className="text-mute">Nothing owed, so nothing to liquidate</span>}
          </Row>
        </dl>
        <p className="mt-4 max-w-[560px] text-[13px] leading-5 text-mute">
          The share is priced from Chainlink only, so a swap in the pool never moves the liquidation price. It is read as if the share fell one for one with {cfg.symbol}; the share also holds USDG, so the real {cfg.symbol} price sits lower.
          Debt includes interest to the latest block, the way Morpho counts it.
        </p>
      </div>

      <div className="min-w-0 self-start rounded-lg border border-line bg-panel p-5">
        <div className="flex items-baseline justify-between">
          <label htmlFor={`safer-${cfg.id}`} className="text-[13px] leading-5 text-mute">Health factor to reach</label>
          <span className="figure text-[24px] leading-8" data-testid="safer-target">{target.toFixed(2)}</span>
        </div>
        <input
          id={`safer-${cfg.id}`}
          type="range" min={1.2} max={3} step={0.05} value={target}
          disabled={runner.running}
          onChange={(e) => { setTarget(Number(e.target.value)); if (run && !runner.running) runner.reset(); }}
          className="mt-3 h-6 w-full accent-[var(--color-fg)] disabled:opacity-50"
          aria-valuetext={`${target.toFixed(2)} health factor`}
        />
        <div aria-live="polite" className="mt-3">
          {plan === undefined ? <Skeleton className="h-24 w-full" /> : <PlanLines plan={plan} symbol={cfg.symbol} stockPrice={stockPrice} />}
        </div>
        <div className="mt-5">
          {runner.failedAt >= 0 && run?.mode === "sequential" ? (
            <div className="flex flex-wrap gap-3">
              <Button size="lg" onClick={() => void runner.retry()}>Retry from “{run.steps[runner.failedAt].label}”</Button>
              <Button size="lg" variant="outline" onClick={runner.reset}>Start over</Button>
            </div>
          ) : runner.failedAt >= 0 ? (
            <Button size="lg" variant="outline" onClick={runner.reset}>Start over</Button>
          ) : (
            <Button size="lg" className="w-full" disabled={plan?.status !== "ready" || runner.running || runner.finished} onClick={() => plan?.status === "ready" && void runner.start(plan.steps)}>
              {runner.running ? <><CircleNotch size={20} className="animate-spin motion-reduce:animate-none" aria-hidden /> {run?.mode === "batch" ? "Confirm in your wallet" : "Working through the steps"}</> : "Make it safer"}
            </Button>
          )}
          {!run && plan?.status === "ready" && (
            <p className="mt-2 text-[13px] leading-5 text-mute">{runner.batchOk ? "Your wallet batches these steps into one confirmation." : "Your wallet confirms each step in turn."} Sized on the debt ten minutes from now, at today&apos;s price.</p>
          )}
          {run && <StepList run={run} />}
          {run?.error && <p role="alert" className="mt-3 break-words text-[13px] leading-5 text-loss">{run.error}</p>}
          {runner.finished && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <p role="status" className="text-[13px] leading-5 text-kept">Done. The loan is safer; the figures on the left are read again from the chain.</p>
              <Button size="sm" variant="outline" onClick={runner.reset}>Close</Button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function PlanLines({ plan, symbol, stockPrice }: { plan: SaferPlan; symbol: string; stockPrice: number }) {
  if (plan.status === "already-safe") return <p className="text-[15px] text-kept">Already at this health factor or better.</p>;
  if (plan.status === "no-position") return <p className="text-[15px] text-mute">{plan.reason}</p>;
  if (plan.status === "unreachable") return <p className="text-[13px] leading-5 text-caution">{plan.reason}</p>;
  const liq = (r: { dropToLiquidation: number | null }) => liquidationInStock(stockPrice, r.dropToLiquidation);
  const before = liq(plan.before);
  const after = liq(plan.after);
  return (
    <dl>
      {plan.path === "repay" ? (
        <Row k="Repay"><span className="figure" data-testid="safer-repay">{usdg(plan.repay)}</span> USDG from your wallet</Row>
      ) : (
        <>
          <Row k="Take out"><span className="figure" data-testid="safer-shares">{shares(plan.shares)}</span> shares, in {plan.rounds} {plan.rounds === 1 ? "round" : "rounds"}</Row>
          <Row k="Repay"><span className="figure" data-testid="safer-repay">{usdg(plan.repay)}</span> USDG, the USDG leg of the exit</Row>
          <Row k={`${symbol} back to you`}><span className="figure">{num(Number(formatUnits(plan.stock, 18)), 4)}</span> {symbol}</Row>
        </>
      )}
      <Row k="Health factor"><span className="figure">{plan.before.healthFactor?.toFixed(2)}</span> to <span className="figure text-kept" data-testid="safer-after">{plan.after.healthFactor === null ? "no debt" : plan.after.healthFactor.toFixed(2)}</span></Row>
      <Row k="Liquidation price" last>
        {before !== undefined && after !== undefined ? <><span className="figure">{usd(before, { compact: false })}</span> to <span className="figure">{usd(after, { compact: false })}</span></> : <span className="text-mute">Nothing owed</span>}
      </Row>
    </dl>
  );
}

function Row({ k, children, last }: { k: React.ReactNode; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-6 py-3", !last && "border-b border-hairline")}>
      <dt className="shrink-0 text-mute">{k}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
