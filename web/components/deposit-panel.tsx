"use client";

import { useMemo, useState } from "react";
import { formatUnits, parseUnits, zeroAddress, type Hash } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { CheckCircle, CircleNotch, WarningCircle, ArrowSquareOut } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toneClass } from "./ledger";
import { WalletButton } from "./wallet-button";
import { erc20Abi, routerAbi, vaultAbi } from "@/lib/abis";
import { robinhoodChain, txUrl } from "@/lib/chain";
import { useEvidence } from "@/lib/evidence";
import { depositRoom, num, perDepositLimitUsd, signed, usd, usdWhole } from "@/lib/format";
import { useVaultStats } from "@/lib/hooks";
import { usdSigned, yearlyUsd } from "@/lib/leak";
import { revertCopy } from "@/lib/revert";
import { errMessage, waitForReceipt } from "@/lib/tx";
import { cn } from "@/lib/utils";
import { ROUTER, SHARE_DECIMALS, USDG, type VaultConfig } from "@/lib/vaults";

type Tx =
  | { phase: "idle" }
  | { phase: "signing"; label: string }
  | { phase: "pending"; label: string; hash: Hash }
  | { phase: "confirmed"; label: string; hash: Hash }
  | { phase: "failed"; label: string; error: string; hash?: Hash };

const DECIMALS = 18; // Stock Tokens are 18-decimal ERC-20s (verified on-chain for NVDA and SPCX).
const USDG_DECIMALS = 6;

function parse(v: string, decimals = DECIMALS): bigint | null {
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  try {
    const n = parseUnits(v, decimals);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

/** A revert a depositor can act on gets its own sentence; anything else shows the wallet's message. */
const txError = (err: unknown): string => revertCopy(err) ?? errMessage(err);

/** The docked deposit ticket: one bar pinned to the bottom of the vault page. It carries the amount, what that amount earns at the
 *  worst-half rate, the vault size and the per-deposit limit, and opens a "before you sign" panel above itself once there is an amount. */
export function DepositPanel({ cfg }: { cfg: VaultConfig }) {
  const { address, isConnected, chainId } = useAccount();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [payWith, setPayWith] = useState<"stock" | "usdg">("stock");
  const [amount, setAmount] = useState("");
  const [tx, setTx] = useState<Tx>({ phase: "idle" });

  const vault = cfg.vault;
  const onChain = Boolean(vault && address && chainId === robinhoodChain.id);
  const usdgMode = tab === "deposit" && payWith === "usdg" && Boolean(ROUTER);
  const payDecimals = usdgMode ? USDG_DECIMALS : DECIMALS;
  const parsed = parse(amount);
  const parsedUsdg = parse(amount, USDG_DECIMALS);
  const parsedAmount = usdgMode ? parsedUsdg : parsed;
  const gate = useEvidence(cfg.id).data?.gate ?? cfg.gate;
  const priceUsd = useVaultStats(cfg.id).data?.chart?.chainlinkUsd;

  const reads = useReadContracts({
    allowFailure: false,
    query: { enabled: onChain, refetchInterval: 15_000 },
    contracts: vault && address ? [
      { address: cfg.token, abi: erc20Abi, functionName: "balanceOf", args: [address], chainId: robinhoodChain.id },
      { address: cfg.token, abi: erc20Abi, functionName: "allowance", args: [address, vault], chainId: robinhoodChain.id },
      { address: vault, abi: vaultAbi, functionName: "balanceOf", args: [address], chainId: robinhoodChain.id },
      { address: vault, abi: vaultAbi, functionName: "maxWithdraw", args: [address], chainId: robinhoodChain.id },
    ] : [],
  });
  const [stockBalance, stockAllowance, shares, maxWithdraw] = reads.data ?? [undefined, undefined, undefined, undefined];

  // USDG lives in its own read so a missing router or wallet never breaks the stock path.
  const usdgReads = useReadContracts({
    allowFailure: false,
    query: { enabled: Boolean(usdgMode && ROUTER && address), refetchInterval: 15_000 },
    contracts: ROUTER && address ? [
      { address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [address], chainId: robinhoodChain.id },
      { address: USDG, abi: erc20Abi, functionName: "allowance", args: [address, ROUTER], chainId: robinhoodChain.id },
    ] : [],
  });
  const [usdgBalance, usdgAllowance] = usdgReads.data ?? [undefined, undefined];
  const balance = usdgMode ? usdgBalance : stockBalance;
  const allowance = usdgMode ? usdgAllowance : stockAllowance;

  const preview = useReadContract({
    address: vault,
    abi: vaultAbi,
    functionName: tab === "deposit" ? "previewDeposit" : "previewWithdraw",
    args: parsed ? [parsed] : undefined,
    chainId: robinhoodChain.id,
    query: { enabled: Boolean(vault && parsed && !usdgMode) },
  });

  // How much more the vault takes: its own maxDeposit (depositCap less assets) once deployed, else its dollar size over the stock price.
  const room = useReadContract({
    address: vault, abi: vaultAbi, functionName: "maxDeposit", args: [address ?? zeroAddress], chainId: robinhoodChain.id,
    query: { enabled: Boolean(vault), refetchInterval: 15_000 },
  });

  const amountNum = parsedAmount ? Number(formatUnits(parsedAmount, payDecimals)) : 0;
  const maxIn = tab === "deposit" ? balance : maxWithdraw;
  const isMaxWithdraw = tab === "withdraw" && parsed !== null && maxWithdraw !== undefined && parsed === maxWithdraw;
  const needsApproval = tab === "deposit" && parsedAmount !== null && allowance !== undefined && allowance < parsedAmount;
  const overBalance = parsedAmount !== null && maxIn !== undefined && parsedAmount > maxIn;
  // A reduced vault limits a single deposit to the stock cap or its own size, converted at the live Chainlink price.
  const reducedLimit = gate.state === "reduced" ? perDepositLimitUsd(cfg.depositCapUsd) : null;
  const capTokens = reducedLimit !== null && priceUsd !== undefined && priceUsd > 0 ? reducedLimit / priceUsd : null;
  // Stock mode compares stock tokens to the cap; USDG mode compares dollars to the same cap.
  const capInput = usdgMode ? reducedLimit : capTokens;
  const overCap = tab === "deposit" && capInput !== null && amountNum > capInput;

  // Router quote: leave a 1% cushion for the swap, then ask the vault what those shares are worth.
  const usdgAmount = parsedUsdg ? Number(formatUnits(parsedUsdg, USDG_DECIMALS)) : 0;
  const estimatedStock = usdgMode && parsedUsdg && priceUsd !== undefined && priceUsd > 0
    ? parseUnits(((usdgAmount / priceUsd) * 0.99).toFixed(18), 18)
    : undefined;
  const quotedStock = estimatedStock !== undefined && estimatedStock > 0n ? estimatedStock : undefined;
  const usdgPreview = useReadContract({
    address: vault,
    abi: vaultAbi,
    functionName: "previewDeposit",
    args: quotedStock ? [quotedStock] : undefined,
    chainId: robinhoodChain.id,
    query: { enabled: Boolean(usdgMode && vault && quotedStock) },
  });
  const minShares = usdgPreview.data;
  const quoteReady = quotedStock !== undefined && minShares !== undefined && minShares > 0n;
  const readsLoading = usdgMode ? usdgReads.isLoading : reads.isLoading;

  const capRoom = tab === "deposit" ? depositRoom(usdgMode ? (quotedStock ?? null) : parsed, room.data, cfg.depositCapUsd, priceUsd ?? cfg.refPriceUsd) : null;
  const overRoom = capRoom?.over ?? false;
  const busy = tx.phase === "signing" || tx.phase === "pending";

  // What the entered amount earns a year at the rate the gate measured in the weaker half of the replay. The Chainlink price read when
  // the universe was built stands in until the stats API answers with a live one.
  const rate = gate.worstHalfApr;
  const stockPriceUsd = priceUsd ?? cfg.refPriceUsd;
  const amountUsd = usdgMode ? amountNum : amountNum * stockPriceUsd;
  const yearly = yearlyUsd(amountUsd, rate);
  const unit = usdgMode ? "USDG" : cfg.symbol;

  const summary = useMemo(() => {
    const shownShares = usdgMode ? minShares : preview.data;
    const sharesPart = shownShares !== undefined ? `${num(Number(formatUnits(shownShares, SHARE_DECIMALS)), 6)} vault shares` : "vault shares";
    const stockPart = usdgMode && quotedStock !== undefined ? `${num(Number(formatUnits(quotedStock, DECIMALS)), 6)} ${cfg.symbol}` : cfg.symbol;
    if (tab === "deposit") {
      if (usdgMode) {
        return [
          needsApproval && ROUTER ? `First you approve ${num(amountNum)} USDG to the router. That is one signature and moves nothing yet.` : null,
          `The router swaps ${num(amountNum)} USDG for about ${stockPart} and deposits it into the ${cfg.symbol} vault.`,
          `You receive about ${sharesPart}. The minimum is set from the live quote, so a worse fill reverts.`,
          `Your position is worth what ${cfg.symbol} is worth: its dollar value rises and falls with the ${cfg.symbol} price.`,
        ].filter(Boolean) as string[];
      }
      return [
        needsApproval ? `First you approve the vault to move ${num(amountNum)} ${cfg.symbol}. That is one signature and moves nothing yet.` : null,
        `You send ${num(amountNum)} ${cfg.symbol}. You receive about ${sharesPart}.`,
        `The vault holds your ${cfg.symbol} in the ${cfg.symbol}/USDG pool inside its price band. Fees raise the share price.`,
        `Your position is worth what ${cfg.symbol} is worth: its dollar value rises and falls with the ${cfg.symbol} price.`,
      ].filter(Boolean) as string[];
    }
    return [
      `You burn about ${sharesPart} and receive ${num(amountNum)} ${cfg.symbol} at the vault's share price.`,
      `Your share of the position leaves the pool. Fees already earned are part of what you receive.`,
    ];
  }, [tab, usdgMode, needsApproval, amountNum, preview.data, minShares, quotedStock, cfg.symbol]);

  async function send(label: string, run: () => Promise<Hash>) {
    if (!client) return;
    setTx({ phase: "signing", label });
    let hash: Hash | undefined;
    try {
      hash = await run();
      setTx({ phase: "pending", label, hash });
      const receipt = await waitForReceipt(client, hash);
      if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");
      setTx({ phase: "confirmed", label, hash });
      // The USDG reads are disabled in stock mode; awaiting their refetch never settled and left the amount uncleared after a deposit.
      await Promise.all([reads.refetch(), ...(usdgMode ? [usdgReads.refetch(), usdgPreview.refetch()] : [])]);
      // The exit card reads the same vault; refresh it now, since polling pauses in a background tab and lags by its interval in a foreground one.
      void queryClient.invalidateQueries({ queryKey: ["readContracts"] });
      if (label !== "Approval") setAmount("");
    } catch (err) {
      setTx({ phase: "failed", label, error: txError(err), hash });
    }
  }

  function submit() {
    if (!vault || !address || !parsedAmount) return;
    if (tab === "deposit") {
      const router = ROUTER;
      if (usdgMode) {
        if (!router || minShares === undefined || !quoteReady) return;
        if (needsApproval) {
          return send("Approval", () => writeContractAsync({ address: USDG, abi: erc20Abi, functionName: "approve", args: [router, parsedAmount], chainId: robinhoodChain.id }));
        }
        return send("Deposit", () => writeContractAsync({ address: router, abi: routerAbi, functionName: "depositUsdg", args: [vault, parsedAmount, minShares, address], chainId: robinhoodChain.id }));
      }
      if (needsApproval) {
        return send("Approval", () => writeContractAsync({ address: cfg.token, abi: erc20Abi, functionName: "approve", args: [vault, parsedAmount], chainId: robinhoodChain.id }));
      }
      return send("Deposit", () => writeContractAsync({ address: vault, abi: vaultAbi, functionName: "deposit", args: [parsedAmount, address], chainId: robinhoodChain.id }));
    }
    if (isMaxWithdraw && shares !== undefined) {
      return send("Withdrawal", () => writeContractAsync({ address: vault, abi: vaultAbi, functionName: "redeem", args: [shares, address, address], chainId: robinhoodChain.id }));
    }
    return send("Withdrawal", () => writeContractAsync({ address: vault, abi: vaultAbi, functionName: "withdraw", args: [parsedAmount, address, address], chainId: robinhoodChain.id }));
  }

  function switchPay(mode: "stock" | "usdg") {
    setPayWith(mode);
    setAmount("");
    setTx({ phase: "idle" });
  }

  const actionLabel = tab === "deposit"
    ? usdgMode
      ? (needsApproval ? "Approve USDG" : "Deposit USDG")
      : (needsApproval ? `Approve ${cfg.symbol}` : `Deposit ${cfg.symbol}`)
    : `Withdraw ${cfg.symbol}`;

  const limit = gate.state === "reduced" ? `${usdWhole(perDepositLimitUsd(cfg.depositCapUsd))} a deposit` : gate.state === "open" ? "None while open" : "Closed";
  const sizeCap = usdWhole(cfg.depositCapUsd);
  const closed = gate.state === "closed" || !cfg.open;
  const opening = !closed && !vault;
  const help = overBalance
    ? { tone: "text-loss", text: `Above your ${tab === "deposit" ? "balance" : "withdrawable amount"}.` }
    : overCap && capInput !== null
      ? { tone: "text-caution", text: usdgMode ? `A reduced vault limits a single deposit to ${usdWhole(perDepositLimitUsd(cfg.depositCapUsd))}.` : `A reduced vault limits a single deposit to ${usdWhole(perDepositLimitUsd(cfg.depositCapUsd))}, about ${num(capTokens ?? 0, 2)} ${cfg.symbol} today.` }
      : overRoom && capRoom
        ? { tone: "text-caution", text: capRoom.tokens > 0 ? `This vault takes up to ${num(capRoom.tokens, 4)} ${cfg.symbol} more, at its ${sizeCap} size cap.` : `This vault is at its ${sizeCap} size cap and takes no more deposits.` }
        : null;
  const detailsOpen = Boolean(parsedAmount) || tx.phase !== "idle";

  return (
    <div className="sticky bottom-0 z-10 border-t border-line bg-panel" role="region" aria-label={`Deposit and withdraw ${cfg.symbol}`}>
      <div className="mx-auto max-w-[1280px] px-6 py-3 sm:py-4">
        {detailsOpen && (
          <div className="mb-3 max-h-[32dvh] overflow-y-auto border-b border-hairline pb-3 text-[13px] leading-5" aria-live="polite">
            {parsedAmount ? (
              <>
                <p className="font-semibold text-fg">Before you sign</p>
                <ul className="mt-1 space-y-1 text-mute">{summary.map((l) => <li key={l}>{l}</li>)}</ul>
                {usdgMode && (
                  <p id="quote-help" className="figure mt-1 text-mute">
                    {quoteReady && quotedStock !== undefined && minShares !== undefined
                      ? `About ${num(Number(formatUnits(quotedStock, DECIMALS)), 6)} ${cfg.symbol} deposited, at least ${num(Number(formatUnits(minShares, SHARE_DECIMALS)), 6)} shares`
                      : priceUsd === undefined || priceUsd <= 0
                        ? "Quote unavailable. USDG deposits need a live price."
                        : "Quote unavailable. Deposits need a share estimate."}
                  </p>
                )}
                <p className="mt-1 text-mute">Stock Tokens are not offered to US persons. Check that you are eligible in your country before depositing.</p>
              </>
            ) : null}
            <TxStatus tx={tx} />
          </div>
        )}

        {closed ? (
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
            <p className="max-w-[760px] text-[13px] leading-5 text-mute"><span className="font-semibold text-fg">Deposits are closed. </span>{gate.reason}</p>
            <Button size="lg" className="w-full sm:w-auto" disabled>Deposits closed</Button>
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-2 lg:flex lg:items-center lg:gap-x-5">
            <div className="col-span-2 flex items-center justify-between gap-4 lg:col-auto lg:shrink-0 lg:justify-start lg:gap-5">
              <Tabs value={tab} onValueChange={(v) => { setTab(v as "deposit" | "withdraw"); setTx({ phase: "idle" }); setAmount(""); }}>
                <TabsList aria-label="Deposit or withdraw">
                  <TabsTrigger value="deposit">Deposit</TabsTrigger>
                  <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
                </TabsList>
                <TabsContent value="deposit" />
                <TabsContent value="withdraw" />
              </Tabs>
              {tab === "deposit" && ROUTER && (
                <div role="group" aria-label="Pay with" className="flex gap-0.5 rounded-full bg-raised p-0.5">
                  {([["stock", cfg.symbol], ["usdg", "USDG"]] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={payWith === mode}
                      onClick={() => switchPay(mode)}
                      className={cn("press h-8 rounded-full px-3 text-[13px] font-semibold", payWith === mode ? "bg-fg text-canvas" : "text-mute hover:text-fg")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="min-w-0 lg:w-[270px] lg:shrink-0">
              <label htmlFor="amount" className="flex items-baseline justify-between text-[13px] leading-5 text-mute">
                <span>{tab === "deposit" ? "To deposit" : "To withdraw"}</span>
                {maxIn !== undefined && (
                  <button type="button" className="figure underline underline-offset-4 hover:text-fg" onClick={() => setAmount(formatUnits(maxIn, payDecimals))}>
                    {tab === "deposit" ? "Balance" : "Available"} {num(Number(formatUnits(maxIn, payDecimals)), 6)} · Max
                  </button>
                )}
              </label>
              <div className="flex h-11 items-center rounded-lg border border-line bg-canvas focus-within:border-fg">
                <input
                  id="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.0"
                  value={amount}
                  disabled={!vault || busy}
                  onChange={(e) => { setAmount(e.target.value.trim()); if (tx.phase !== "idle" && !busy) setTx({ phase: "idle" }); }}
                  className="figure h-full min-w-0 flex-1 bg-transparent px-3 text-[17px] outline-none placeholder:text-mute disabled:opacity-60"
                  aria-invalid={overBalance || overCap || overRoom}
                  aria-describedby={help ? "amount-help" : undefined}
                />
                <span className="pr-3 text-[15px] font-semibold">{unit}</span>
              </div>
              {help && <p id="amount-help" className={cn("figure mt-1 text-[12px] leading-4", help.tone)}>{help.text}</p>}
            </div>

            <div className="lg:order-5 lg:shrink-0">
              {opening ? (
                <Button size="lg" disabled>Vault opening</Button>
              ) : !isConnected || chainId !== robinhoodChain.id ? (
                <WalletButton size="lg" label={!isConnected ? "Connect wallet" : undefined} />
              ) : (
                <Button size="lg" disabled={!parsedAmount || overBalance || overCap || overRoom || busy || readsLoading || (usdgMode && !quoteReady)} onClick={submit}>
                  {busy ? <><CircleNotch size={20} className="animate-spin motion-reduce:animate-none" aria-hidden /> {tx.phase === "signing" ? "Confirm in your wallet" : "Waiting for the chain"}</> : actionLabel}
                </Button>
              )}
            </div>
            <div className="col-span-2 min-w-0 text-[13px] leading-5 lg:order-3 lg:flex-1">
              {tab === "deposit" ? (
                parsedAmount ? (
                  <>
                    <p className="text-[15px] font-medium"><span className="figure">{num(amountNum, 4)} {unit}</span> <span className="text-mute">≈</span> <span className={cn("figure", toneClass(yearly))}>{usdSigned(yearly)} a year</span></p>
                    <p className="text-mute">at the worst-half rate, <span className={cn("figure", toneClass(rate))}>{signed(rate)}</span>, on <span className="figure">{usd(amountUsd, { compact: false })}</span></p>
                  </>
                ) : (
                  <>
                    <p className="text-[15px] font-medium">Worst-half rate <span className={cn("figure", toneClass(rate))}>{signed(rate)}</span> a year</p>
                    <p className="text-mute">Enter an amount to see it in dollars.</p>
                  </>
                )
              ) : (
                <>
                  <p className="text-[15px] font-medium">Exit in kind is always open</p>
                  <p className="text-mute">Your share of both tokens, even when the price feed is stale.</p>
                </>
              )}
            </div>

            <dl className="col-span-2 flex flex-wrap gap-x-5 text-[13px] leading-5 lg:order-4 lg:shrink-0 lg:flex-col">
              <div className="flex gap-2"><dt className="text-mute">Vault size</dt><dd className="figure">{sizeCap}</dd></div>
              <div className="flex gap-2"><dt className="text-mute">Per-deposit limit</dt><dd className="figure">{limit}</dd></div>
            </dl>

          </div>
        )}
        {opening && <p className="mt-2 text-[13px] text-mute">The {cfg.symbol} vault is opening. Deposits unlock here the moment its address is live on Robinhood Chain.</p>}
      </div>
    </div>
  );
}

function TxStatus({ tx }: { tx: Tx }) {
  if (tx.phase === "idle" || tx.phase === "signing") return null;
  const link = tx.hash ? (
    <a className="figure inline-flex items-center gap-1 underline underline-offset-4" href={txUrl(tx.hash)} target="_blank" rel="noreferrer">
      {tx.hash.slice(0, 10)}...{tx.hash.slice(-6)} <ArrowSquareOut size={14} aria-hidden />
    </a>
  ) : null;
  return (
    <div role="status" className={cn("mt-2 flex items-start gap-3 rounded-lg border p-3 text-[13px] leading-5", tx.phase === "confirmed" ? "border-kept/50 bg-kept-dim text-kept" : tx.phase === "failed" ? "border-loss/50 bg-loss-dim text-loss" : "border-line bg-raised text-fg")}>
      {tx.phase === "pending" && <CircleNotch size={20} className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />}
      {tx.phase === "confirmed" && <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0" aria-hidden />}
      {tx.phase === "failed" && <WarningCircle size={20} weight="fill" className="mt-0.5 shrink-0" aria-hidden />}
      <div className="min-w-0">
        <p className="font-semibold">
          {tx.phase === "pending" && `${tx.label} sent, waiting for confirmation`}
          {tx.phase === "confirmed" && `${tx.label} confirmed`}
          {tx.phase === "failed" && `${tx.label} did not go through`}
        </p>
        {tx.phase === "failed" && <p className="mt-0.5 break-words">{tx.error}</p>}
        {link && <p className="mt-1">{link}</p>}
      </div>
    </div>
  );
}
