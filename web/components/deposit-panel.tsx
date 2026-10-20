"use client";

import { useMemo, useState } from "react";
import { formatUnits, parseUnits, zeroAddress, type Hash } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { CheckCircle, CircleNotch, WarningCircle, ArrowSquareOut } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WalletButton } from "./wallet-button";
import { erc20Abi, routerAbi, vaultAbi } from "@/lib/abis";
import { robinhoodChain, txUrl } from "@/lib/chain";
import { REDUCED_CAP_STOCK_USD, useEvidence } from "@/lib/evidence";
import { depositRoom, num, pct, usd } from "@/lib/format";
import { useVaultStats } from "@/lib/hooks";
import { errMessage, waitForReceipt } from "@/lib/tx";
import { ROUTER, SHARE_DECIMALS, USDG, type VaultConfig } from "@/lib/vaults";

type Tx =
  | { phase: "idle" }
  | { phase: "signing"; label: string }
  | { phase: "pending"; label: string; hash: Hash }
  | { phase: "confirmed"; label: string; hash: Hash }
  | { phase: "failed"; label: string; error: string; hash?: Hash };

const DECIMALS = 18; // Stock Tokens are 18-decimal ERC-20s (verified on-chain for NVDA and SPCX).
const USDG_DECIMALS = 6;

// UptickRouter custom errors, as 4-byte selectors.
const UNHEALTHY = "0x08a4d6fa";
const INSUFFICIENT_SHARES = "0xcb1d8bba";

function parse(v: string, decimals = DECIMALS): bigint | null {
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  try {
    const n = parseUnits(v, decimals);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

/** Router reverts carry a custom error inside the viem error cause chain. Name the ones a depositor can act on. */
function depositError(err: unknown): string {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const data = (cur as { data?: unknown }).data;
    if (typeof data === "string") {
      if (data.startsWith(UNHEALTHY)) return "The price feed is not fresh. Deposits pause until it updates.";
      if (data.startsWith(INSUFFICIENT_SHARES)) return "The price moved past your quote. Try again.";
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  const message = errMessage(err);
  if (/\bUnhealthy\b/.test(message)) return "The price feed is not fresh. Deposits pause until it updates.";
  if (/InsufficientShares/.test(message)) return "The price moved past your quote. Try again.";
  return message;
}

export function DepositPanel({ cfg }: { cfg: VaultConfig }) {
  const { address, isConnected, chainId } = useAccount();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const { writeContractAsync } = useWriteContract();
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
  const gate = useEvidence(cfg.id).data?.gate;
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
  // A reduced vault caps a single deposit at REDUCED_CAP_STOCK_USD of stock token, converted at the live Chainlink price.
  const capTokens = gate?.state === "reduced" && priceUsd !== undefined && priceUsd > 0 ? REDUCED_CAP_STOCK_USD / priceUsd : null;
  // Stock mode compares stock tokens to the cap; USDG mode compares dollars to the same cap.
  const capInput = usdgMode ? (gate?.state === "reduced" ? REDUCED_CAP_STOCK_USD : null) : capTokens;
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
      await Promise.all([reads.refetch(), usdgReads.refetch(), usdgPreview.refetch()]);
      if (label !== "Approval") setAmount("");
    } catch (err) {
      setTx({ phase: "failed", label, error: usdgMode ? depositError(err) : errMessage(err), hash });
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

  return (
    <div className="rounded-xl bg-canvas p-5 sm:p-6">
      <Tabs value={tab} onValueChange={(v) => { setTab(v as "deposit" | "withdraw"); setTx({ phase: "idle" }); setAmount(""); }}>
        <TabsList aria-label="Deposit or withdraw">
          <TabsTrigger value="deposit">Deposit</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
        </TabsList>
        <TabsContent value="deposit" />
        <TabsContent value="withdraw" />
      </Tabs>

      {tab === "deposit" && ROUTER && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold" id="pay-with-label">Pay with</span>
          <div role="group" aria-labelledby="pay-with-label" className="grid grid-cols-2 gap-1 rounded-full bg-sage p-1">
            {([["stock", cfg.symbol], ["usdg", "USDG"]] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={payWith === mode}
                onClick={() => switchPay(mode)}
                className={`h-9 rounded-full px-4 text-sm font-semibold transition-[background-color,color] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${payWith === mode ? "bg-canvas text-ink" : "text-body hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <label htmlFor="amount" className="mt-5 flex items-baseline justify-between text-sm font-semibold">
        <span>{tab === "deposit" ? `${usdgMode ? "USDG" : cfg.symbol} to deposit` : `${cfg.symbol} to withdraw`}</span>
        {maxIn !== undefined && (
          <button type="button" className="figure text-xs font-normal underline underline-offset-4 hover:text-ink-deep" onClick={() => setAmount(formatUnits(maxIn, payDecimals))}>
            {tab === "deposit" ? "Balance" : "Available"} {num(Number(formatUnits(maxIn, payDecimals)), 6)} · Max
          </button>
        )}
      </label>
      <div className="mt-2 flex items-center rounded-md border border-ink bg-canvas focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
        <input
          id="amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0"
          value={amount}
          disabled={!vault || busy}
          onChange={(e) => { setAmount(e.target.value.trim()); if (tx.phase !== "idle" && !busy) setTx({ phase: "idle" }); }}
          className="figure h-14 min-w-0 flex-1 bg-transparent px-4 text-2xl outline-none placeholder:text-mute disabled:opacity-60"
          aria-invalid={overBalance || overCap || overRoom}
          aria-describedby={usdgMode && parsedUsdg ? "amount-help quote-help" : "amount-help"}
        />
        <span className="pr-4 text-lg font-semibold">{usdgMode ? "USDG" : cfg.symbol}</span>
      </div>
      <p id="amount-help" className="figure mt-1.5 min-h-5 text-xs text-body">
        {overBalance ? (
          <span className="text-negative-deep">Above your {tab === "deposit" ? "balance" : "withdrawable amount"}.</span>
        ) : overCap && capInput !== null ? (
          <span className="text-warning-deep">
            {usdgMode
              ? `A reduced vault caps a single deposit at ${usd(REDUCED_CAP_STOCK_USD)}.`
              : `A reduced vault caps a single deposit at ${usd(REDUCED_CAP_STOCK_USD)}, about ${num(capTokens ?? 0, 2)} ${cfg.symbol} today.`}
          </span>
        ) : overRoom && capRoom ? (
          <span className="text-warning-deep">
            {capRoom.tokens > 0
              ? `This vault takes up to ${num(capRoom.tokens, 4)} ${cfg.symbol} more, at its $${num(cfg.depositCapUsd, 0)} size cap.`
              : `This vault is at its $${num(cfg.depositCapUsd, 0)} size cap and takes no more deposits.`}
          </span>
        ) : (
          ""
        )}
      </p>
      {usdgMode && parsedUsdg && (
        <p id="quote-help" className="figure mt-1 text-xs text-body">
          {quoteReady && quotedStock !== undefined && minShares !== undefined
            ? `About ${num(Number(formatUnits(quotedStock, DECIMALS)), 6)} ${cfg.symbol} deposited, at least ${num(Number(formatUnits(minShares, SHARE_DECIMALS)), 6)} shares`
            : priceUsd === undefined || priceUsd <= 0
              ? "Quote unavailable. USDG deposits need a live price."
              : "Quote unavailable. Deposits need a share estimate."}
        </p>
      )}

      <div className="mt-4 rounded-lg bg-sage p-4 text-sm leading-6" aria-live="polite">
        <p className="font-semibold">Before you sign</p>
        {parsedAmount ? (
          <ul className="mt-1 space-y-1.5 text-body">{summary.map((l) => <li key={l}>{l}</li>)}</ul>
        ) : (
          <p className="mt-1 text-body">
            {tab === "deposit"
              ? usdgMode
                ? `Enter an amount of USDG. The router swaps it for ${cfg.symbol} and deposits the result.`
                : `Enter an amount of ${cfg.symbol}. This panel then shows what you send, what you receive, and where your ${cfg.symbol} goes.`
              : `Enter an amount of ${cfg.symbol}. This panel then shows how many shares you burn and what you receive.`}
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-body">
        Stock Tokens are not offered to US persons. Check that you are eligible in your country before depositing.
      </p>

      <div className="mt-4">
        {!cfg.open ? (
          <Button size="lg" className="w-full" disabled>Deposits closed</Button>
        ) : !vault ? (
          <Button size="lg" className="w-full" disabled>Vault opening</Button>
        ) : !isConnected ? (
          <div className="[&>div>button]:w-full [&>button]:w-full"><WalletButton /></div>
        ) : chainId !== robinhoodChain.id ? (
          <div className="[&>div>button]:w-full [&>button]:w-full"><WalletButton /></div>
        ) : (
          <Button size="lg" className="w-full" disabled={!parsedAmount || overBalance || overCap || overRoom || busy || readsLoading || (usdgMode && !quoteReady)} onClick={submit}>
            {busy ? <><CircleNotch size={20} className="animate-spin motion-reduce:animate-none" aria-hidden /> {tx.phase === "signing" ? "Confirm in your wallet" : "Waiting for the chain"}</> : actionLabel}
          </Button>
        )}
      </div>

      <TxStatus tx={tx} />
      {gate && <p className={`mt-3 text-sm ${gate.state === "closed" ? "text-negative-deep" : gate.state === "reduced" ? "text-warning-deep" : "text-body"}`}>{gate.reason}</p>}
      {!cfg.open && (
        <p className={`text-sm text-body ${gate ? "mt-1.5" : "mt-3"}`}>Fees {pct(cfg.feeAprPct)}, kept {pct(cfg.keptAprPct)} over the held-out 15 days.{gate ? "" : " Deposits open when kept APR stays above -20 in both halves."}</p>
      )}
      {cfg.open && !vault && (
        <p className="mt-3 text-sm text-body">The {cfg.symbol} vault is opening. Deposits unlock here the moment its address is live on Robinhood Chain.</p>
      )}
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
    <div role="status" className={`mt-4 flex items-start gap-3 rounded-lg p-4 text-sm ${tx.phase === "confirmed" ? "bg-primary-pale text-positive-deep" : tx.phase === "failed" ? "bg-negative/10 text-negative-deep" : "bg-sage text-ink"}`}>
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
