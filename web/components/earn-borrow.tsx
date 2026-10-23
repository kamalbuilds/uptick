"use client";

import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { CircleNotch } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { SectionTitle, toneClass } from "./ledger";
import { Term } from "./term";
import { StepList, useStepRunner } from "./step-runner";
import { WalletButton } from "./wallet-button";
import { erc20Abi, vaultAbi } from "@/lib/abis";
import { robinhoodChain } from "@/lib/chain";
import { collateralMarket } from "@/lib/collateral-markets";
import { depositRoom, num, perDepositLimitUsd, pct, shareOfBalance, signed, usd } from "@/lib/format";
import { usePrices } from "@/lib/prices";
import { knownRevert } from "@/lib/revert";
import { cn } from "@/lib/utils";
import {
  BORROW_CAP_BPS, COLLATERAL_MARGIN_BPS, MORPHO_BLUE, aprPct, borrowAtBps, borrowRoom, collateralFromQuote, debtAssets, earnAndBorrowSteps, irmAbi,
  marketId, marketLiquidity, morphoAbi, oracleAbi, positionRisk, sharePriceUsd, type MarketParams,
} from "@/lib/morpho";
import { SHARE_DECIMALS, type VaultConfig } from "@/lib/vaults";

const DECIMALS = 18;
const USDG_DECIMALS = 6;
const SLIDER_STEPS = 100;
/** Where the borrow slider rests on a fresh page: 40 of 100 steps of the cap, a modest loan the holder moves either way. */
const SLIDER_REST = 40;
const ONE_TOKEN = 10n ** BigInt(DECIMALS);

function parse(v: string): bigint | null {
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  try {
    const n = parseUnits(v, DECIMALS);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

const usdg = (n: bigint) => num(Number(formatUnits(n, USDG_DECIMALS)), 2);

/** Earn and borrow on a vault page: deposit the Stock Token, post the shares to Morpho Blue and borrow USDG, as one wallet confirmation when the wallet batches.
 *  The numbers and the ticket render for a vault whose Morpho market is in web/lib/collateral-markets.json and exists on-chain; every other open vault shows what the loan will be and that it opens with the market. */
export function EarnBorrow({ cfg }: { cfg: VaultConfig }) {
  if (cfg.gate.state === "closed") return null;
  const market = collateralMarket(cfg.id, cfg.vault);
  return (
    <section aria-labelledby="earn-borrow">
      <SectionTitle id="earn-borrow" aside={market ? `Morpho Blue · ${pct(Number(market.lltv) / 1e16, 1)} loan to value limit` : "Morpho Blue"}>Earn and borrow</SectionTitle>
      <p className="mt-4 max-w-[690px] text-[20px] font-medium leading-7 tracking-[-0.2px]">Earn the pool fees on your {cfg.symbol}, and borrow USDG against the same position.</p>
      <p className="mt-2 max-w-[690px] text-mute">
        One confirmation deposits {cfg.symbol} into the vault, posts the vault shares as collateral and sends USDG to your wallet. The shares keep earning pool fees while they are collateral.
      </p>
      {market && cfg.vault ? <Flow cfg={cfg} vault={cfg.vault} market={market} /> : <Opening cfg={cfg} />}
    </section>
  );
}

/** The loan before its market exists: the facts that are fixed by design and the earn figure that is already measured. Every borrow figure waits for the market. */
function Opening({ cfg }: { cfg: VaultConfig }) {
  const kept = cfg.gate.worstHalfApr;
  return (
    <div className="mt-6 grid gap-x-16 gap-y-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="min-w-0 self-start rounded-lg border border-line bg-panel p-5">
        <p className="text-[15px] font-semibold">Borrowing opens with the {cfg.symbol} market</p>
        <p className="mt-1 text-[13px] leading-5 text-mute">When the Morpho Blue market for the {cfg.symbol} vault share is live, the borrow limit, slider and liquidation price appear here and the deposit below becomes one step. The deposit ticket earns the pool fees on its own.</p>
      </div>
      <dl className="min-w-0 self-start">
        <Row k={<>You keep, <Term id="worstHalf">weaker half</Term></>}><span className={cn("figure", toneClass(kept))}>{signed(kept)}</span> a year</Row>
        <Row k="Collateral">The {cfg.symbol} vault share, earning while posted</Row>
        <Row k="You borrow">USDG, at the market rate</Row>
        <Row k="Share price" last>Chainlink only, so a swap in the pool never moves it</Row>
      </dl>
    </div>
  );
}

function Flow({ cfg, vault, market }: { cfg: VaultConfig; vault: `0x${string}`; market: MarketParams }) {
  const { address, isConnected, chainId } = useAccount();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [sliderPos, setSliderPos] = useState(SLIDER_REST);
  const { run, running, finished, failedAt, batchOk, start: startSteps, retry, reset } = useStepRunner();

  const id = marketId(market);
  const onChain = Boolean(address && chainId === robinhoodChain.id);
  const parsed = parse(amount);
  // Until an amount is typed the ledger sizes one token, from the vault's own quote, so the page shows what a position looks like before anyone connects.
  const basis = parsed ?? ONE_TOKEN;
  const livePrice = usePrices().data?.byId.get(cfg.id)?.usd;
  const stockPrice = livePrice ?? cfg.refPriceUsd;

  // The market and its oracle are read without a wallet, so the borrow numbers show before anyone connects.
  const mkt = useReadContract({ address: MORPHO_BLUE, abi: morphoAbi, functionName: "market", args: [id], chainId: robinhoodChain.id, query: { refetchInterval: 15_000 } });
  const oracle = useReadContract({ address: market.oracle, abi: oracleAbi, functionName: "price", chainId: robinhoodChain.id, query: { refetchInterval: 15_000 } });
  const [supplyAssets, , borrowAssets, borrowShares, lastUpdate] = mkt.data ?? [];
  const marketExists = lastUpdate !== undefined && lastUpdate > 0n;
  const rate = useReadContract({
    address: market.irm,
    abi: irmAbi,
    functionName: "borrowRateView",
    args: mkt.data ? [market, { totalSupplyAssets: mkt.data[0], totalSupplyShares: mkt.data[1], totalBorrowAssets: mkt.data[2], totalBorrowShares: mkt.data[3], lastUpdate: mkt.data[4], fee: mkt.data[5] }] : undefined,
    chainId: robinhoodChain.id,
    query: { enabled: marketExists },
  });

  const reads = useReadContracts({
    allowFailure: false,
    query: { enabled: onChain, refetchInterval: 15_000 },
    contracts: address ? [
      { address: cfg.token, abi: erc20Abi, functionName: "balanceOf", args: [address], chainId: robinhoodChain.id },
      { address: cfg.token, abi: erc20Abi, functionName: "allowance", args: [address, vault], chainId: robinhoodChain.id },
      { address: vault, abi: erc20Abi, functionName: "allowance", args: [address, MORPHO_BLUE], chainId: robinhoodChain.id },
      { address: MORPHO_BLUE, abi: morphoAbi, functionName: "position", args: [id, address], chainId: robinhoodChain.id },
      { address: vault, abi: vaultAbi, functionName: "maxDeposit", args: [address], chainId: robinhoodChain.id },
    ] : [],
  });
  const [balance, tokenAllowance, shareAllowance, position, maxDeposit] = reads.data ?? [];

  const preview = useReadContract({
    address: vault, abi: vaultAbi, functionName: "previewDeposit", args: [basis], chainId: robinhoodChain.id,
  });
  const quote = preview.data;

  const price = oracle.data;
  const heldCollateral = position?.[2] ?? 0n;
  const debt = borrowShares !== undefined && borrowAssets !== undefined && position ? debtAssets(position[1], borrowAssets, borrowShares) : 0n;
  const liquidity = supplyAssets !== undefined && borrowAssets !== undefined ? marketLiquidity(supplyAssets, borrowAssets) : 0n;
  const posted = quote !== undefined ? collateralFromQuote(quote) : 0n;
  const room = price !== undefined ? borrowRoom({ collateral: heldCollateral + posted, price, lltv: market.lltv, debt, liquidity }) : undefined;
  const borrow = room ? borrowAtBps(room.cap, (sliderPos * 10_000) / SLIDER_STEPS) : 0n;
  const risk = price !== undefined ? positionRisk({ collateral: heldCollateral + posted, price, lltv: market.lltv, debt: debt + borrow }) : undefined;

  const amountNum = parsed ? Number(formatUnits(parsed, DECIMALS)) : 0;
  const amountUsd = amountNum * stockPrice;
  const unreadable = amount !== "" && parsed === null;
  const overBalance = parsed !== null && balance !== undefined && parsed > balance;
  const reducedLimit = cfg.gate.state === "reduced" ? perDepositLimitUsd(cfg.depositCapUsd) : null;
  const overCap = reducedLimit !== null && amountUsd > reducedLimit;
  const vaultRoom = depositRoom(parsed, maxDeposit, cfg.depositCapUsd, stockPrice);
  const overRoom = vaultRoom?.over ?? false;
  useEffect(() => {
    if (!finished) return;
    setAmount("");
    setSliderPos(SLIDER_REST);
    void reads.refetch();
    void mkt.refetch();
    void queryClient.invalidateQueries({ queryKey: ["readContracts"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  async function start() {
    if (!address || !parsed || quote === undefined || tokenAllowance === undefined || shareAllowance === undefined) return;
    const steps = earnAndBorrowSteps({
      symbol: cfg.symbol, token: cfg.token, vault, market, account: address, deposit: parsed, collateral: posted, borrow, tokenAllowance, shareAllowance,
    });
    await startSteps(steps);
  }

  const lltvPct = Number(market.lltv) / 1e16;
  const shown = quote !== undefined ? num(Number(formatUnits(quote, SHARE_DECIMALS)), 6) : null;
  const kept = cfg.gate.worstHalfApr;
  const limitText = room ? usdg(room.maxBorrow) : null;
  const sharePrice = price !== undefined ? sharePriceUsd(price, SHARE_DECIMALS, USDG_DECIMALS) : undefined;
  const liqSharePrice = risk && risk.liquidationPrice > 0n ? sharePriceUsd(risk.liquidationPrice, SHARE_DECIMALS, USDG_DECIMALS) : undefined;
  const drop = risk?.dropToLiquidation ?? null;
  const borrowApr = rate.data !== undefined ? aprPct(rate.data) : undefined;
  const canFill = balance !== undefined && balance > 0n && !running;
  const activePct = parsed === null ? undefined : [25, 50, 75, 100].find((p) => shareOfBalance(balance, p) === parsed);

  const blocker =
    unreadable ? "Enter a number, for example 1.5." :
    !parsed ? "Enter an amount." :
    overBalance ? `Above your ${cfg.symbol} balance.` :
    overCap && reducedLimit !== null ? `A reduced vault limits a single deposit to ${usd(reducedLimit, { compact: false })}.` :
    overRoom && vaultRoom ? `This vault takes up to ${num(vaultRoom.tokens, 4)} ${cfg.symbol} more.` :
    preview.isError ? (knownRevert(preview.error)?.copy ?? "The vault cannot quote a deposit right now.") :
    quote === undefined || tokenAllowance === undefined ? "Reading the vault." :
    borrow > 0n && price === undefined ? "Borrowing is paused while the oracle has no price." :
    null;

  if (mkt.isSuccess && !marketExists) return <Opening cfg={cfg} />;

  const stockLiq = drop !== null && stockPrice > 0 ? stockPrice * (1 - drop) : undefined;
  const hf = risk?.healthFactor ?? null;
  const hfTone = hf === null ? "" : hf < 1.1 ? "text-loss" : hf < 1.25 ? "text-caution" : "";
  const hfWord = hf === null ? "" : hf < 1.1 ? "Close to liquidation" : hf < 1.25 ? "Thin margin" : "Comfortable";
  const limitPct = room && room.maxBorrow > 0n ? Math.min(100, Number(((debt + borrow) * 10_000n) / room.maxBorrow) / 100) : 0;
  const capPct = room && room.maxBorrow > 0n ? Math.min(100, Number(((debt + room.cap) * 10_000n) / room.maxBorrow) / 100) : 0;
  const sized = parsed ? `${amount} ${cfg.symbol}` : `1 ${cfg.symbol}`;

  return (
    <div className="mt-6 grid gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="min-w-0 self-start rounded-lg border border-line bg-panel p-5">
        <label htmlFor="eb-amount" className="flex items-baseline justify-between text-[13px] leading-5 text-mute">
          <span>{cfg.symbol} to deposit</span>
          {balance !== undefined && <span className="figure">Balance {num(Number(formatUnits(balance, DECIMALS)), 6)}</span>}
        </label>
        <div className="flex h-14 items-center rounded-lg border border-line bg-canvas focus-within:border-fg">
          <input
            id="eb-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            value={amount}
            disabled={running}
            onChange={(e) => { setAmount(e.target.value.trim()); if (run && !running) reset(); }}
            className="figure h-full min-w-0 flex-1 bg-transparent px-3 text-[24px] outline-none placeholder:text-mute disabled:opacity-60"
            aria-invalid={unreadable || overBalance || overCap || overRoom}
          />
          <span className="pr-3 text-[15px] font-semibold">{cfg.symbol}</span>
        </div>
        {amountNum > 0 && <p className="figure mt-1 text-[13px] leading-5 text-mute">{`≈ ${usd(amountUsd, { compact: false })}`}</p>}
        <div role="group" aria-label="Fill a share of the balance" className="mt-2 flex gap-2">
          {[25, 50, 75, 100].map((p) => (
            <button
              key={p}
              type="button"
              disabled={!canFill}
              aria-pressed={activePct === p}
              onClick={() => { const v = shareOfBalance(balance, p); if (v !== undefined) setAmount(formatUnits(v, DECIMALS)); }}
              className={cn("press h-7 flex-1 rounded-full border text-[12px] font-semibold disabled:opacity-55", activePct === p ? "border-fg bg-fg text-canvas" : "border-line text-mute enabled:hover:bg-raised enabled:hover:text-fg")}
            >
              {p === 100 ? "Max" : `${p}%`}
            </button>
          ))}
        </div>

        <div className="mt-6 border-t border-hairline pt-5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="eb-borrow" className="text-[13px] leading-5 text-mute">Borrow</label>
            <span className="figure text-[24px] leading-8" data-testid="eb-borrow-amount">{usdg(borrow)} <span className="text-[15px] font-semibold">USDG</span></span>
          </div>
          <input
            id="eb-borrow"
            type="range"
            min={0}
            max={SLIDER_STEPS}
            step={1}
            value={sliderPos}
            disabled={running || !room || room.cap === 0n}
            onChange={(e) => setSliderPos(Number(e.target.value))}
            className="mt-3 h-6 w-full accent-[var(--color-fg)] disabled:opacity-50"
            aria-valuetext={`${usdg(borrow)} USDG`}
          />
          <div className="relative mt-2 h-1.5 rounded-full bg-hairline" role="img" aria-label={`The loan uses ${num(limitPct, 0)}% of the borrow limit`}>
            <span className="absolute inset-y-0 left-0 rounded-full bg-fg" style={{ width: `${limitPct}%` }} aria-hidden />
            <span className="absolute -inset-y-1 w-px bg-mute" style={{ left: `${capPct}%` }} aria-hidden />
          </div>
          <div className="figure mt-1 flex justify-between gap-3 text-[12px] leading-4 text-mute">
            <span>{room ? `${num(limitPct, 0)}% of the limit` : "n/a"}</span>
            <span>{room ? `Slider stops at ${Number(BORROW_CAP_BPS) / 100}% (${usdg(room.cap)})` : ""}</span>
          </div>
          <p className="mt-2 text-[13px] leading-5 text-mute">
            {!room ? "The oracle has no price yet." : room.liquidityBound ? `Morpho has ${usdg(liquidity)} USDG to lend in this market, which is the most the slider offers.` : room.cap === 0n && liquidity === 0n ? "No USDG is supplied to this market yet, so there is nothing to borrow." : "Liquidation begins at the limit, so the slider stops short of it."}
          </p>
        </div>

        <div className="mt-5">
          {!isConnected || chainId !== robinhoodChain.id ? (
            <WalletButton size="lg" label={!isConnected ? "Connect wallet" : undefined} className="w-full" />
          ) : failedAt >= 0 && run?.mode === "sequential" ? (
            <div className="flex flex-wrap gap-3">
              <Button size="lg" onClick={retry}>Retry from “{run.steps[failedAt].label}”</Button>
              <Button size="lg" variant="outline" onClick={reset}>Start over</Button>
            </div>
          ) : failedAt >= 0 ? (
            <Button size="lg" variant="outline" onClick={reset}>Start over</Button>
          ) : (
            <Button size="lg" className="w-full" disabled={blocker !== null || running || finished} onClick={start}>
              {running ? <><CircleNotch size={20} className="animate-spin motion-reduce:animate-none" aria-hidden /> {run?.mode === "batch" ? "Confirm in your wallet" : "Working through the steps"}</> : borrow > 0n ? `Deposit ${cfg.symbol} and borrow ${usdg(borrow)} USDG` : `Deposit ${cfg.symbol}`}
            </Button>
          )}
          {!run && blocker && (parsed !== null || unreadable) && <p className="mt-2 text-[13px] leading-5 text-caution">{blocker}</p>}
          {!run && isConnected && chainId === robinhoodChain.id && (
            <p className="mt-2 text-[13px] leading-5 text-mute">{batchOk ? "Your wallet batches these steps into one confirmation." : "Your wallet confirms each step in turn."} Stock Tokens are not offered to US persons. Check that you are eligible in your country before depositing.</p>
          )}
          {run && <StepList run={run} />}
          {run?.error && <p role="alert" className="mt-3 break-words text-[13px] leading-5 text-loss">{run.error}</p>}
          {finished && run && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <p role="status" className="text-[13px] leading-5 text-kept">Done. {run.steps.some((s) => s.id === "borrow") ? "The shares are collateral on Morpho and the USDG is in your wallet." : `Your ${cfg.symbol} is in the vault.`}</p>
              <Button size="sm" variant="outline" onClick={reset}>Close</Button>
            </div>
          )}
        </div>
      </div>

      <div className="min-w-0 self-start" aria-live="polite">
        <p className="text-[13px] leading-5 text-mute">{parsed ? `Sized for ${sized}.` : `Sized for ${sized}. Enter your amount to size yours.`}</p>
        <dl>
          <Row k={<>You keep, <Term id="worstHalf">weaker half</Term></>}><span className={cn("figure", toneClass(kept))}>{signed(kept)}</span> a year</Row>
          <Row k="You receive">{shown ? <><span className="figure" data-testid="eb-shares">{shown}</span> {shown === "1" ? "vault share" : "vault shares"}</> : <span className="text-mute">Reading the vault</span>}</Row>
          <Row k={<>Max borrow at {pct(lltvPct, 1)}</>}>{limitText ? <><span className="figure" data-testid="eb-max-borrow">{limitText}</span> USDG</> : <span className="text-mute">Waiting for the oracle price</span>}</Row>
          <Row k="Borrow rate" last>{borrowApr !== undefined ? <><span className="figure">{pct(borrowApr, 2)}</span> a year, moves with use</> : <span className="text-mute">Reading the market</span>}</Row>
        </dl>
        <dl className="mt-6 rounded-sm border border-line px-4">
          <Row k="Liquidation price">
            {stockLiq !== undefined && liqSharePrice !== undefined && sharePrice !== undefined ? (
              <span className="block">
                <span className="figure text-[20px] font-medium leading-6" data-testid="eb-liquidation">{usd(stockLiq, { compact: false })}</span> <span className="text-[15px] font-semibold">{cfg.symbol}</span>
                <span className="figure block text-[13px] leading-5 text-mute">now {usd(stockPrice, { compact: false })}, a fall of {pct((drop ?? 0) * 100, 1)}</span>
                <span className="figure block text-[13px] leading-5 text-mute">the share liquidates at {usd(liqSharePrice, { compact: false })}, now {usd(sharePrice, { compact: false })}</span>
              </span>
            ) : <span className="text-mute">Nothing owed, so nothing to liquidate</span>}
          </Row>
          <Row k="Health factor" last>
            {hf !== null ? <><span className={cn("figure text-[20px] font-medium leading-6", hfTone)} data-testid="eb-health">{hf > 99 ? ">99" : hf.toFixed(2)}</span> <span className={cn("text-[13px]", hfTone || "text-mute")}>{hfWord}</span></> : <span className="text-mute">Shown once you borrow</span>}
          </Row>
        </dl>
        {(heldCollateral > 0n || debt > 0n) && (
          <dl><Row k="Your Morpho position" last><span className="figure">{num(Number(formatUnits(heldCollateral, SHARE_DECIMALS)), 6)}</span> shares posted, <span className="figure">{usdg(debt)}</span> USDG owed</Row></dl>
        )}
        <p className="mt-4 text-[13px] leading-5 text-mute">
          The share is priced from Chainlink only, so a swap in the pool never moves the liquidation price. It is read as if the share fell one for one with {cfg.symbol}; the share also holds USDG, so the real {cfg.symbol} price sits lower. The vault keeps a {num(cfg.entryFeeBps / 100, 2)}% entry fee, and {Number(COLLATERAL_MARGIN_BPS) / 100}% of the shares stay in your wallet as margin for a price move while the transaction lands.
          A liquidator repays the USDG and takes the shares plus a bonus.
        </p>
      </div>
    </div>
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
