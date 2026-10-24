"use client";

import { useId, useState } from "react";
import { formatUnits, type Address } from "viem";
import { useSimulateContract } from "wagmi";
import { CaretDown, Check, Copy } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "./status";
import { Term } from "./term";
import { vaultAbi } from "@/lib/abis";
import { robinhoodChain } from "@/lib/chain";
import { ago, num, pct, usd } from "@/lib/format";
import { DEFAULT_UNWIND_MINUTES, agentInstruction, type HedgePlan as Plan } from "@/lib/hedge";
import { STRESS_FALL_PCT, aprText, bpLabel, costSentences, driftFor, DRIFT_SYMBOLS, earnsOrPays, healthAfterFall, lighterTradeUrl, money, orderLines, orderText, utcStamp } from "@/lib/hedge-view";
import { MORPHO_BLUE } from "@/lib/morpho";
import { usePrices } from "@/lib/prices";
import { useHedgePlan, type BorrowRate, type MarginBasis } from "@/lib/use-hedge";
import { cn } from "@/lib/utils";
import { SHARE_DECIMALS, type VaultConfig } from "@/lib/vaults";

type Ok = Extract<Plan, { status: "ok" }>;

type Common = { id: string; symbol: string; token: Address; /** The block a wallet scan read the balance at: the multiplier is read at the same block. */ block?: bigint; className?: string };
type WalletProps = Common & { source: "wallet"; balanceRaw: bigint };
type LoanProps = Common & {
  source: "loan";
  /** Vault shares posted as collateral, and the stock leg redeemInKind would hand back for them (undefined while the vault is quoting). */
  shares: bigint;
  stockLeg: bigint | undefined;
  /** The Morpho rate this loan pays, as a yearly percent. Undefined while it is being read. */
  loanRate: BorrowRate | undefined;
  /** The loan's health factor now, or null with no debt. */
  healthFactor: number | null;
};

const bpText = bpLabel;
const utcClock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

function HRow({ k, children, last }: { k: React.ReactNode; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6", !last && "border-b border-hairline")}>
      <dt className="shrink-0 text-mute">{k}</dt>
      <dd className="min-w-0 sm:text-right">{children}</dd>
    </div>
  );
}

const Sub = ({ children }: { children: React.ReactNode }) => <span className="figure block text-[13px] leading-5 text-mute">{children}</span>;

/** The weekend hedge for one Stock Token, closed until opened: a holder (or a borrower, sized from the stock leg of the vault shares posted as collateral) sees what the short on Lighter
 *  Robinhood Chain would be and cost, read live when the panel opens. Nothing is placed from here. */
export function HedgePlan(p: WalletProps | LoanProps) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div className={p.className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((o) => !o)}
        className="press -ml-3 inline-flex h-11 items-center lg:h-9 gap-2 rounded-full px-3 text-[13px] font-semibold text-mute hover:bg-panel hover:text-fg"
      >
        {open ? "Hide the hedge plan" : `Hedge ${p.symbol} for the weekend`}
        <CaretDown size={14} weight="bold" aria-hidden className={cn("transition-transform duration-150 ease-out motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <div id={panel}>{open ? <Panel {...p} /> : null}</div>
    </div>
  );
}

function Panel(p: WalletProps | LoanProps) {
  const loan = p.source === "loan" ? p : null;
  const balanceRaw = p.source === "wallet" ? p.balanceRaw : loan && loan.loanRate ? loan.stockLeg : undefined;
  const s = useHedgePlan({ symbol: p.symbol, token: p.token, balanceRaw, block: p.block, loanRate: loan?.loanRate, enabled: true });

  return (
    <section aria-label={`${p.symbol} weekend hedge plan`} aria-live="polite" className="mt-2 border-t border-hairline pt-5 pb-2">
      {s.status === "idle" || s.status === "loading" ? (
        <div aria-busy="true" aria-label="Reading Lighter Robinhood Chain and the chain">
          <Skeleton className="h-6 w-72" />
          <Skeleton className="mt-3 h-40 w-full max-w-[690px]" />
        </div>
      ) : s.status === "error" ? (
        <div role="alert" className="max-w-[640px]">
          <p className="font-semibold">The hedge plan could not be read.</p>
          <p className="mt-1 break-words text-[13px] text-mute">{s.message}. Every figure here is read live from Lighter and the chain. Retry asks again.</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={s.retry}>Retry</Button>
        </div>
      ) : s.status === "unsized" ? (
        <p className="max-w-[640px] text-mute">{p.symbol} is left unsized: {s.reason}.</p>
      ) : s.plan.status === "no_perp" ? (
        <p className="max-w-[640px]" data-testid="hedge-no-perp">Lighter Robinhood Chain lists no active {p.symbol} perpetual, so there is no short to place against this token.</p>
      ) : s.plan.status === "below_min" ? (
        <p className="max-w-[640px]" data-testid="hedge-below-min">
          The {p.symbol} {p.source === "wallet" ? "in this wallet" : "behind these shares"} is {s.plan.limit === "min_base_amount" ? <>under Lighter&rsquo;s smallest {p.symbol} order of {s.plan.minBase.value} shares</> : <>worth under Lighter&rsquo;s smallest order of {usd(s.plan.minQuoteUsd.value, { compact: false })}</>}, so there is nothing to short.
        </p>
      ) : (
        <Ready p={p} plan={s.plan} margin={s.margin} block={s.multiplierBlock} readAt={s.readAt} balanceRaw={balanceRaw as bigint} />
      )}
    </section>
  );
}

function Ready({ p, plan, margin, block, readAt, balanceRaw }: { p: WalletProps | LoanProps; plan: Ok; margin: MarginBasis; block: bigint; readAt: string; balanceRaw: bigint }) {
  const loan = p.source === "loan" ? p : null;
  const feed = usePrices().data?.byId.get(p.id);
  const drift = driftFor(p.symbol);
  const shares = plan.size.value.shares;
  const mult = Number(BigInt(plan.size.value.multiplier)) / 1e18;
  const held = num(Number(formatUnits(balanceRaw, 18)), 4);
  const notional = plan.notionalUsd.value;
  const { openBp, roundTripBp } = plan.slippage.value;
  const carry = plan.carry.value;
  const mc = plan.marginCarry.value;
  const net = plan.netBp;
  // Once Friday's close has passed the short starts now, and the hours, funding and margin interest are for what is left of the weekend.
  const started = new Date(plan.window.startAt) > new Date(plan.window.closeAt);
  const afterFall = loan ? healthAfterFall(loan.healthFactor, STRESS_FALL_PCT) : null;

  const price = notional / Number(shares);
  const stockLtv = margin.kind === "stock" ? margin.loanToValue : null;
  const cost = costSentences({
    symbol: p.symbol,
    notionalUsd: notional,
    roundTripBp: roundTripBp === "unfillable" ? 0 : roundTripBp,
    feeBp: plan.fees.value.bp,
    marginUsdg: plan.marginUsdg.value,
    tokenPrice: price,
    stockLoanToValue: stockLtv,
    marginInterestUsd: mc.borrowed ? mc.usd : null,
    fundingUsd: carry === null ? null : carry.usd,
  });

  // Phones read headline, ticket, ledger; from 1024px the ticket sits beside both.
  return (
    <div className="grid gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:grid-rows-[auto_1fr] lg:gap-x-16 lg:gap-y-6">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        <p className="serif max-w-[560px] text-[22px] leading-7" data-testid="hedge-headline">
          Sell {shares} {p.symbol} on Lighter from {started ? "now" : utcStamp(plan.window.closeAt)} to {utcStamp(plan.window.unwindAt)}.
        </p>
        {roundTripBp === "unfillable" ? (
          <p className="mt-3 max-w-[560px] text-caution" data-testid="hedge-cost">Lighter&rsquo;s book is too thin for this size, so no cost is priced.</p>
        ) : (
          <p className="mt-3 max-w-[560px] text-[15px] leading-6" data-testid="hedge-cost">{cost.join(" ")}</p>
        )}
        <p className="mt-2 text-[13px] leading-5 text-mute">
          {Math.round(plan.window.hours)} hours {started ? "left" : "in all"}. Buy back {DEFAULT_UNWIND_MINUTES} minutes before the US open.
        </p>
      </div>

      <HandOff className="lg:col-start-2 lg:row-span-2 lg:row-start-1" symbol={p.symbol} shares={shares} leverage={plan.leverage} proposal={plan.proposal} />

      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <dl className="max-w-[690px]" data-testid="hedge-ledger">
          <HRow k="Shares to short">
            <span className="figure text-[20px] font-medium leading-6" data-testid="hedge-shares">{shares}</span> <span className="text-[15px] font-semibold">{p.symbol}</span>
            <Sub>
              {loan ? <>the stock leg of {num(Number(formatUnits(loan.shares, SHARE_DECIMALS)), 6)} vault shares, {held} {p.symbol},</> : <>{held} {p.symbol} in the wallet</>}{mult === 1 ? "" : <> times the {mult.toFixed(6)} multiplier</>}, about {money(notional)}
            </Sub>
          </HRow>

          <HRow k="Entry and round trip">
            {roundTripBp === "unfillable" || openBp === "unfillable" ? (
              <span className="text-caution" data-testid="hedge-slippage">Book too thin for this size</span>
            ) : (
              <>
                <span className="figure" data-testid="hedge-slippage">{bpText(openBp)} in, {bpText(roundTripBp)} round trip</span>
                <Sub>against the best 250 orders a side at {utcClock(plan.slippage.fetchedAt)} UTC{plan.fees.value.bp === 0 ? ", 0% fees" : `, taker ${plan.fees.value.takerFee} maker ${plan.fees.value.makerFee}`}</Sub>
              </>
            )}
          </HRow>

          <HRow k={<Term id="funding">Weekend funding</Term>}>
            {carry === null ? (
              <span className="text-mute" data-testid="hedge-funding">Under 24 weekend hours in Lighter&rsquo;s last 28 days, so no figure</span>
            ) : (
              <>
                <span className="figure" data-testid="hedge-funding">
                  Past weekends {carry.bp >= 0 ? "paid" : "charged"} a short {bpText(carry.bp)} ({money(carry.usd)})
                </span>
                <Sub>the mean of {carry.weekendRows} weekend hours of the last 28 days</Sub>
              </>
            )}
          </HRow>

          <HRow k="Margin">
            <Margin plan={plan} margin={margin} symbol={p.symbol} mc={mc} price={price} />
          </HRow>

          <HRow k="Net at past funding">
            {net === null ? (
              <span className="text-mute" data-testid="hedge-net">Waits for a complete read</span>
            ) : (
              <>
                <span className={cn("figure font-medium", net > 0 ? "text-kept" : net < 0 ? "text-loss" : "")} data-testid="hedge-net">
                  would have {net > 0 ? "netted" : net < 0 ? "cost" : "broken even at"} {bpText(net)} ({money(plan.netUsd as number)})
                </span>
                <Sub>at the last 28 days of weekend funding, less round-trip slippage{mc.borrowed ? ", fees and margin interest" : " and fees"}</Sub>
              </>
            )}
          </HRow>

          {drift ? (
            <HRow k="Gap between your pool and Lighter at the Monday buy-back">
              <span className="figure" data-testid="hedge-drift">about &plusmn;{drift.unwind.sdBp} bp</span>
              <Sub>largest {drift.unwind.maxAbsBp} bp on the {drift.pool} pool, measured 30 minutes before the open; &plusmn;{drift.open.sdBp} bp at the open. The last {drift.unwind.n} weekends, a past range and not a forecast</Sub>
            </HRow>
          ) : null}

          <HRow k="Chainlink feed" last={loan === null}>
            {feed ? <span className="figure" data-testid="hedge-feed">{p.symbol} / USD updated {ago(feed.updatedAt * 1000)}</span> : <span className="text-mute" data-testid="hedge-feed">The {p.symbol} feed has not answered yet</span>}
          </HRow>

          {loan ? (
            <HRow k={<Term id="healthFactor" />} last>
              {afterFall !== null && loan.healthFactor !== null ? (
                <>
                  <span className={cn("figure text-[20px] font-medium leading-6", afterFall < 1.1 ? "text-loss" : afterFall < 1.25 ? "text-caution" : "")} data-testid="hedge-health">{afterFall.toFixed(2)}</span>{" "}
                  <span className="text-[13px] text-mute">after a {STRESS_FALL_PCT}% fall</span>
                  <Sub>from {loan.healthFactor.toFixed(2)} now, with the hedge ignored</Sub>
                </>
              ) : (
                <span className="text-mute">Nothing is owed, so there is no health factor to stress</span>
              )}
            </HRow>
          ) : null}
        </dl>

        {loan ? <p className="mt-3 max-w-[690px] text-[13px] leading-5 text-mute" data-testid="hedge-loan-note">Lighter profit does not repay Morpho. The short is a separate account on a separate exchange, and the loan stays open until you repay it.</p> : null}
        <p className="mt-3 max-w-[690px] text-[13px] leading-5 text-mute">
          Read at {utcClock(readAt)} UTC from api.rh.lighter.xyz and, for the token&rsquo;s split multiplier, from Robinhood Chain at block {block.toLocaleString("en-US")}. Funding and the pool gap describe past weekends, not the next one.
        </p>
      </div>
    </div>
  );
}

function Margin({ plan, margin, symbol, mc, price }: { plan: Ok; margin: MarginBasis; symbol: string; mc: { borrowed: boolean; bp: number; usd: number }; price: number }) {
  const usdg = money(plan.marginUsdg.value);
  const ownUsdg = <Sub>or {usdg} of your own USDG at {plan.leverage}x</Sub>;
  if (margin.kind === "stock") {
    const ltv = margin.loanToValue;
    const tokens = ltv !== null && ltv > 0 ? Math.ceil(plan.marginUsdg.value / (price * ltv)) : null;
    return (
      <span data-testid="hedge-margin">
        <span>Post {tokens !== null ? `about ${num(tokens, 0)} ` : ""}{symbol} as Lighter margin{margin.capTokens !== null ? ` (up to ${num(margin.capTokens, 0)} per account)` : ""}</span>
        {ltv !== null ? <Sub>Lighter counts a token at {pct(ltv * 100, 0)} of its value, so {usdg} of margin takes{tokens !== null ? ` about ${num(tokens, 0)} ${symbol}` : ` ${symbol} worth ${money(plan.marginUsdg.value / ltv)}`}. Nothing is borrowed, so no interest is counted</Sub> : <Sub>Nothing is borrowed, so no interest is counted</Sub>}
        {ownUsdg}
      </span>
    );
  }
  if (margin.kind === "own") {
    return (
      <span data-testid="hedge-margin">
        <span className="figure">{usdg} USDG at {plan.leverage}x</span>
        <Sub>{margin.why === "no_market" ? `no Morpho market has ${usdg} to lend against ${symbol} right now, so no interest is counted` : "the Morpho rate did not answer, so no interest is counted"}</Sub>
      </span>
    );
  }
  return (
    <span data-testid="hedge-margin">
      <span className="figure">{usdg} USDG at {plan.leverage}x costs {bpText(mc.bp)} ({money(mc.usd)})</span>
      <Sub>{margin.kind === "loan" ? "the USDG you borrowed" : "USDG borrowed on Morpho Blue"} at {aprText(margin.rate.pct)} a year for the {Math.round(plan.window.hours)} hours</Sub>
    </span>
  );
}

type Copy = "idle" | "done" | "failed";

function useCopy(text: string) {
  const [state, setState] = useState<Copy>("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
  }
  return [state, copy] as const;
}

function HandOff({ symbol, shares, leverage, proposal, className }: { symbol: string; shares: string; leverage: number; proposal: Ok["proposal"]; className?: string }) {
  const [order, copyOrder] = useCopy(orderText(symbol, shares, leverage));
  const [agent, copyAgent] = useCopy(proposal ? agentInstruction(proposal) : "");
  return (
    <div className={cn("min-w-0 self-start rounded-lg border border-line bg-panel p-5", className)} data-testid="hedge-ticket">
      <p className="text-[15px] font-semibold">Take it to Lighter</p>
      <p className="mt-1 text-[13px] leading-5 text-mute">Lighter opens on the {symbol} market. Enter the order below in its form.</p>
      <dl className="mt-4" data-testid="hedge-order">
        {orderLines(symbol, shares, leverage).map(([k, v], i, all) => (
          <div key={k} className={cn("flex items-baseline justify-between gap-6 py-2", i < all.length - 1 && "border-b border-hairline")}>
            <dt className="text-mute">{k}</dt>
            <dd className="figure min-w-0 break-all text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex flex-col gap-3">
        <Button asChild size="lg" className="w-full">
          <a href={lighterTradeUrl(symbol)} target="_blank" rel="noreferrer">Open {symbol} on Lighter</a>
        </Button>
        {proposal ? (
          <Button size="lg" variant="outline" className="w-full" onClick={() => void copyAgent()} data-testid="hedge-copy-agent">
            {agent === "done" ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
            {agent === "done" ? "Instruction copied" : "Copy for your agent"}
          </Button>
        ) : null}
        <Button size="lg" variant="outline" className="w-full" onClick={() => void copyOrder()}>
          {order === "done" ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
          {order === "done" ? "Order copied" : "Copy the order"}
        </Button>
      </div>
      {agent === "failed" || order === "failed" ? <p role="alert" className="mt-2 text-[13px] leading-5 text-caution">The browser blocked the copy. Select the lines above instead.</p> : null}
      {proposal ? (
        <p className="mt-3 text-[13px] leading-5 text-mute" data-testid="hedge-agent-note">
          Copy for your agent is a proposed order for your own Lighter agent running lighter-agent-kit: sell {proposal.size.base} {symbol} at {proposal.order.limit_price} or higher, {proposal.leverage.suggested}x, valid until {utcClock(proposal.valid_until)} UTC, closed by {utcStamp(proposal.exit_by)}. It asks the agent to paper trade first. Your agent signs with your key; Uptick holds none.
        </p>
      ) : null}
      <p className="mt-3 text-[13px] leading-5 text-mute">You place the order on Lighter, or your agent does, and close it there before the unwind time above.</p>
    </div>
  );
}

/** The loan's hedge: sizes the short from the stock leg of the vault shares posted as collateral, asked of the vault the way Morpho would ask it. */
export function LoanHedge({ cfg, vault, owner, collateral, loanRate, healthFactor, className }: { cfg: VaultConfig; vault: Address; owner: Address; collateral: bigint; loanRate: BorrowRate | undefined; healthFactor: number | null; className?: string }) {
  const quote = useSimulateContract({
    address: vault, abi: vaultAbi, functionName: "redeemInKind", args: [collateral, owner, MORPHO_BLUE], account: MORPHO_BLUE, chainId: robinhoodChain.id,
    query: { enabled: collateral > 0n },
  });
  if (quote.isError) {
    return (
      <p role="alert" className={cn("text-[13px] leading-5 text-mute", className)}>
        The vault could not quote the {cfg.symbol} behind these shares right now, so the short cannot be sized.{" "}
        <button type="button" className="underline underline-offset-4" onClick={() => void quote.refetch()}>Ask again</button>
      </p>
    );
  }
  return <HedgePlan className={className} id={cfg.id} symbol={cfg.symbol} token={cfg.token} source="loan" shares={collateral} stockLeg={quote.data?.result[0]} loanRate={loanRate} healthFactor={healthFactor} />;
}
