"use client";

import { useMemo, useState } from "react";
import { formatUnits, parseUnits, zeroAddress, type Hash } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { CheckCircle, CircleNotch, WarningCircle, ArrowSquareOut } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toneClass } from "./ledger";
import { Term } from "./term";
import { WalletButton } from "./wallet-button";
import { erc20Abi, routerAbi, vaultAbi } from "@/lib/abis";
import { robinhoodChain, txUrl } from "@/lib/chain";
import { depositRoom, entryFeePct, netOfEntryFee, num, shareOfBalance, perDepositLimitUsd, signed, usd, usdWhole } from "@/lib/format";
import { useVaultStats } from "@/lib/hooks";
import { usePrices } from "@/lib/prices";
import { usdSigned, yearlyUsd } from "@/lib/leak";
import { knownRevert } from "@/lib/revert";
import { inKindSlice } from "@/lib/in-kind";
import { errMessage, waitForReceipt } from "@/lib/tx";
import { cn } from "@/lib/utils";
import { ROUTER, SHARE_DECIMALS, USDG, type VaultConfig } from "@/lib/vaults";

type Tx =
  | { phase: "idle" }
  | { phase: "signing"; label: string }
  | { phase: "pending"; label: string; hash: Hash }
  | { phase: "confirmed"; label: string; hash: Hash }
  | { phase: "failed"; label: string; error: string; hash?: Hash; belowMin?: boolean };

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
const txError = (err: unknown): string => knownRevert(err)?.copy ?? errMessage(err);

/** The docked deposit ticket: one bar pinned to the bottom of the vault page. It carries the amount, what that amount earns at the
 *  worst-half rate, the vault size and the per-deposit limit, and opens a "before you sign" panel above itself once there is an amount. */
export function DepositPanel({ cfg, layout = "dock" }: { cfg: VaultConfig; /** "dock" is the bar pinned to the bottom of the vault page; "side" is the same form stacked in a column for the list page. */ layout?: "dock" | "side" }) {
  const { address, isConnected, chainId } = useAccount();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [payWith, setPayWith] = useState<"stock" | "usdg">("stock");
  const [amount, setAmount] = useState("");
  const [tx, setTx] = useState<Tx>({ phase: "idle" });
  const [exitKind, setExitKind] = useState(false);

  const vault = cfg.vault;
  const onChain = Boolean(vault && address && chainId === robinhoodChain.id);
  const usdgMode = tab === "deposit" && payWith === "usdg" && Boolean(ROUTER);
  const inKind = tab === "withdraw" && exitKind;
  const payDecimals = usdgMode ? USDG_DECIMALS : inKind ? SHARE_DECIMALS : DECIMALS;
  const parsed = parse(amount);
  const parsedUsdg = parse(amount, USDG_DECIMALS);
  const parsedShares = parse(amount, SHARE_DECIMALS);
  const parsedAmount = usdgMode ? parsedUsdg : inKind ? parsedShares : parsed;
  const gate = cfg.gate;
  // The stats API quotes the chart price; the live Chainlink read stands in while it has none, so the cap and the USDG quote never wait on it.
  const livePrice = usePrices().data?.byId.get(cfg.id)?.usd;
  const priceUsd = useVaultStats(cfg.id).data?.chart?.chainlinkUsd ?? livePrice;

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
    query: { enabled: Boolean(vault && parsed && !usdgMode && !inKind) },
  });

  // The in-kind quote reads only balances, supply and the position: no oracle, so it answers while the feed is stale.
  const holdings = useReadContracts({
    allowFailure: false,
    query: { enabled: Boolean(inKind && vault), refetchInterval: 15_000 },
    contracts: vault ? [
      { address: vault, abi: vaultAbi, functionName: "totalSupply", chainId: robinhoodChain.id },
      { address: vault, abi: vaultAbi, functionName: "stock", chainId: robinhoodChain.id },
      { address: vault, abi: vaultAbi, functionName: "usdg", chainId: robinhoodChain.id },
      { address: vault, abi: vaultAbi, functionName: "totalStockOwed", chainId: robinhoodChain.id },
      { address: vault, abi: vaultAbi, functionName: "positionInfo", chainId: robinhoodChain.id },
    ] : [],
  });
  const [supply, stockToken, usdgToken, stockOwed, position] = holdings.data ?? [];
  const balances = useReadContracts({
    allowFailure: false,
    query: { enabled: Boolean(inKind && vault && stockToken && usdgToken), refetchInterval: 15_000 },
    contracts: vault && stockToken && usdgToken ? [
      { address: stockToken, abi: erc20Abi, functionName: "balanceOf", args: [vault], chainId: robinhoodChain.id },
      { address: usdgToken, abi: erc20Abi, functionName: "balanceOf", args: [vault], chainId: robinhoodChain.id },
    ] : [],
  });
  const [vaultStock, vaultUsdg] = balances.data ?? [undefined, undefined];
  const slice = inKind && parsedShares !== null && supply !== undefined && stockOwed !== undefined && position && vaultStock !== undefined && vaultUsdg !== undefined
    ? inKindSlice(parsedShares, {
        supply,
        idleStock: vaultStock > stockOwed ? vaultStock - stockOwed : 0n,
        idleUsdg: vaultUsdg,
        positionStock: position.stockAmount,
        positionUsdg: position.usdgAmount,
        feesStock: position.uncollectedStock,
        feesUsdg: position.uncollectedUsdg,
      })
    : null;

  // How much more the vault takes: its own maxDeposit (depositCap less assets) once deployed, else its dollar size over the stock price.
  const room = useReadContract({
    address: vault, abi: vaultAbi, functionName: "maxDeposit", args: [address ?? zeroAddress], chainId: robinhoodChain.id,
    query: { enabled: Boolean(vault), refetchInterval: 15_000 },
  });

  const amountNum = parsedAmount ? Number(formatUnits(parsedAmount, payDecimals)) : 0;
  const maxIn = tab === "deposit" ? balance : inKind ? shares : maxWithdraw;
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
  // The rate is earned on what the vault credits: the deposit less the entry fee, which stays in the vault.
  const netUsd = netOfEntryFee(amountUsd, cfg.entryFeeBps);
  const yearly = yearlyUsd(netUsd, rate);
  const feeText = entryFeePct(cfg.entryFeeBps);
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
          `The vault keeps a ${feeText} entry fee on the ${cfg.symbol} it receives. You receive about ${sharesPart}, net of it. The minimum is set from the live quote, so a worse fill reverts.`,
          `Your position is worth what ${cfg.symbol} is worth: its dollar value rises and falls with the ${cfg.symbol} price.`,
        ].filter(Boolean) as string[];
      }
      return [
        needsApproval ? `First you approve the vault to move ${num(amountNum)} ${cfg.symbol}. That is one signature and moves nothing yet.` : null,
        `You send ${num(amountNum)} ${cfg.symbol}. The vault keeps ${feeText} of it as the entry fee and you receive about ${sharesPart}.`,
        `The vault holds your ${cfg.symbol} in the ${cfg.symbol}/USDG pool inside its price band. Fees raise the share price.`,
        `Your position is worth what ${cfg.symbol} is worth: its dollar value rises and falls with the ${cfg.symbol} price.`,
      ].filter(Boolean) as string[];
    }
    if (inKind) {
      return [
        `You burn ${num(amountNum, 6)} vault shares and receive your slice of both tokens the vault holds, ${cfg.symbol} and USDG, sent straight to your wallet.`,
        `The split follows the pool at the moment your transaction lands, so the amounts can shift a little from the quote.`,
      ];
    }
    return [
      `You burn about ${sharesPart} and receive ${num(amountNum)} ${cfg.symbol} at the vault's share price.`,
      `Your share of the position leaves the pool. Fees already earned are part of what you receive.`,
    ];
  }, [tab, inKind, usdgMode, needsApproval, amountNum, preview.data, minShares, quotedStock, cfg.symbol, feeText]);

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
      setTx({ phase: "failed", label, error: txError(err), hash, belowMin: knownRevert(err)?.name === "ExitBelowMinimum" });
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
        return send("Deposit", () => writeContractAsync({ address: router, abi: routerAbi, functionName: cfg.venue === "v4" ? "depositUsdgV4" : "depositUsdg", args: [vault, parsedAmount, minShares, address], chainId: robinhoodChain.id }));
      }
      if (needsApproval) {
        return send("Approval", () => writeContractAsync({ address: cfg.token, abi: erc20Abi, functionName: "approve", args: [vault, parsedAmount], chainId: robinhoodChain.id }));
      }
      return send("Deposit", () => writeContractAsync({ address: vault, abi: vaultAbi, functionName: "deposit", args: [parsedAmount, address], chainId: robinhoodChain.id }));
    }
    // Exit in kind goes straight to the vault, not the router. It needs no approval and no peripheral contract, so the exit stays
    // open if the router is paused or unset, and it reads no oracle. The router's redeemInKindMin adds minimums, but the vault pays a
    // pro-rata slice by construction, so a minimum only guards a pool move between quote and mining, which the quote line discloses.
    if (inKind) {
      return send("Exit in kind", () => writeContractAsync({ address: vault, abi: vaultAbi, functionName: "redeemInKind", args: [parsedAmount, address, address], chainId: robinhoodChain.id }));
    }
    if (isMaxWithdraw && shares !== undefined) {
      return send("Withdrawal", () => writeContractAsync({ address: vault, abi: vaultAbi, functionName: "redeem", args: [shares, address, address], chainId: robinhoodChain.id }));
    }
    return send("Withdrawal", () => writeContractAsync({ address: vault, abi: vaultAbi, functionName: "withdraw", args: [parsedAmount, address, address], chainId: robinhoodChain.id }));
  }

  /** One-click from an ExitBelowMinimum revert: carry the amount over as shares (convertToShares reads no oracle), else leave it blank. */
  async function switchToInKind() {
    let next = "";
    if (client && vault && shares !== undefined) {
      if (isMaxWithdraw) next = formatUnits(shares, SHARE_DECIMALS);
      else if (parsed) {
        try {
          const s = await client.readContract({ address: vault, abi: vaultAbi, functionName: "convertToShares", args: [parsed] });
          next = formatUnits(s < shares ? s : shares, SHARE_DECIMALS);
        } catch {
          next = "";
        }
      }
    }
    setExitKind(true);
    setAmount(next);
    setTx({ phase: "idle" });
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
    : inKind ? "Exit in kind" : `Withdraw ${cfg.symbol}`;

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
  const side = layout === "side";

  // 25/50/75/Max fill a share of the balance (deposit) or of what is withdrawable (withdraw), in the token's own base units.
  const chipValue = (p: number): bigint | undefined => shareOfBalance(maxIn, p);
  const activePct = parsedAmount === null ? undefined : [25, 50, 75, 100].find((p) => chipValue(p) === parsedAmount);
  const canFill = Boolean(vault) && !busy && maxIn !== undefined && maxIn > 0n;
  function fill(p: number) {
    const v = chipValue(p);
    if (v === undefined) return;
    setAmount(formatUnits(v, payDecimals));
    if (tx.phase !== "idle" && !busy) setTx({ phase: "idle" });
  }

  const tabsEl = (
    <Tabs value={tab} onValueChange={(v) => { setTab(v as "deposit" | "withdraw"); setExitKind(false); setTx({ phase: "idle" }); setAmount(""); }}>
      <TabsList aria-label="Deposit or withdraw" className={side ? "grid grid-cols-2 gap-0 border-b border-hairline" : undefined}>
        <TabsTrigger value="deposit">Deposit</TabsTrigger>
        <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
      </TabsList>
      <TabsContent value="deposit" />
      <TabsContent value="withdraw" />
    </Tabs>
  );

  const payEl = tab === "deposit" && ROUTER ? (
    <div role="group" aria-label="Pay with" className={cn("flex gap-0.5 rounded-full bg-raised p-0.5", side && "w-full")}>
      {([["stock", cfg.symbol], ["usdg", "USDG"]] as const).map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          aria-pressed={payWith === mode}
          onClick={() => switchPay(mode)}
          className={cn("press h-8 rounded-full px-3 text-[13px] font-semibold", side && "flex-1", payWith === mode ? "bg-fg text-canvas" : "text-mute hover:text-fg")}
        >
          {label}
        </button>
      ))}
    </div>
  ) : null;

  const exitEl = tab === "withdraw" ? (
    <div role="group" aria-label="Withdraw as" className={cn("flex gap-0.5 rounded-full bg-raised p-0.5", side && "w-full")}>
      {([[false, `Withdraw ${cfg.symbol}`], [true, "Exit in kind"]] as const).map(([mode, label]) => (
        <button
          key={label}
          type="button"
          aria-pressed={exitKind === mode}
          disabled={busy}
          onClick={() => { setExitKind(mode); setAmount(""); setTx({ phase: "idle" }); }}
          className={cn("press h-8 rounded-full px-3 text-[13px] font-semibold", side && "flex-1", exitKind === mode ? "bg-fg text-canvas" : "text-mute hover:text-fg")}
        >
          {label}
        </button>
      ))}
    </div>
  ) : null;

  const amountEl = (
    <div className={cn("min-w-0", !side && "lg:w-[270px] lg:shrink-0")}>
      <label htmlFor="amount" className="flex items-baseline justify-between text-[13px] leading-5 text-mute">
        <span>{tab === "deposit" ? "To deposit" : inKind ? "Shares to exit" : "To withdraw"}</span>
        {maxIn !== undefined && (
          <span className="figure">{tab === "deposit" ? "Balance" : "Available"} {num(Number(formatUnits(maxIn, payDecimals)), 6)}</span>
        )}
      </label>
      <div className={cn("flex items-center rounded-lg border border-line bg-canvas focus-within:border-fg", side ? "h-14" : "h-11")}>
        <input
          id="amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0"
          value={amount}
          disabled={!vault || busy}
          onChange={(e) => { setAmount(e.target.value.trim()); if (tx.phase !== "idle" && !busy) setTx({ phase: "idle" }); }}
          className={cn("figure h-full min-w-0 flex-1 bg-transparent px-3 outline-none placeholder:text-mute disabled:opacity-60", side ? "text-[24px]" : "text-[17px]")}
          aria-invalid={overBalance || overCap || overRoom}
          aria-describedby={help ? "amount-help" : undefined}
        />
        <span className="pr-3 text-[15px] font-semibold">{inKind ? "shares" : unit}</span>
      </div>
      {side && amountNum > 0 && !inKind && <p className="figure mt-1 text-[13px] leading-5 text-mute">{`≈ ${usd(amountUsd, { compact: false })}`}</p>}
      {help && <p id="amount-help" className={cn("figure mt-1 text-[12px] leading-4", help.tone)}>{help.text}</p>}
      <div role="group" aria-label="Fill a share of the amount" className="mt-2 flex gap-2">
        {[25, 50, 75, 100].map((p) => (
          <button
            key={p}
            type="button"
            disabled={!canFill}
            aria-pressed={activePct === p}
            onClick={() => fill(p)}
            className={cn("press h-7 flex-1 rounded-full border text-[12px] font-semibold disabled:opacity-55", activePct === p ? "border-fg bg-fg text-canvas" : "border-line text-mute enabled:hover:bg-panel enabled:hover:text-fg")}
          >
            {p === 100 ? "Max" : `${p}%`}
          </button>
        ))}
      </div>
    </div>
  );

  const ctaEl = opening ? (
    <Button size="lg" disabled className={side ? "w-full" : undefined}>Vault opening</Button>
  ) : !isConnected || chainId !== robinhoodChain.id ? (
    <WalletButton size="lg" label={!isConnected ? "Connect wallet" : undefined} className={side ? "w-full" : undefined} />
  ) : (
    <Button size="lg" className={side ? "w-full" : undefined} disabled={!parsedAmount || overBalance || overCap || overRoom || busy || readsLoading || (usdgMode && !quoteReady)} onClick={submit}>
      {busy ? <><CircleNotch size={20} className="animate-spin motion-reduce:animate-none" aria-hidden /> {tx.phase === "signing" ? "Confirm in your wallet" : "Waiting for the chain"}</> : actionLabel}
    </Button>
  );

  const estimateEl = (
    <div className="min-w-0 text-[13px] leading-5">
      {tab === "deposit" ? (
        parsedAmount ? (
          <>
            <p className="text-[15px] font-medium"><span className="figure">{num(amountNum, 4)} {unit}</span> <span className="text-mute">≈</span> <span className={cn("figure", toneClass(yearly))}>{usdSigned(yearly)} a year</span></p>
            <p className="text-mute">at the <Term id="worstHalf">worst-half</Term> rate, <span className={cn("figure", toneClass(rate))}>{signed(rate)}</span>, on <span className="figure">{usd(netUsd, { compact: false })}</span> after the entry fee</p>
            <p className="text-mute"><Term id="entryFee" /> <span className="figure">{feeText}</span>, kept in the vault for existing holders</p>
          </>
        ) : (
          <>
            <p className="text-[15px] font-medium"><Term id="worstHalf">Worst-half</Term> rate <span className={cn("figure", toneClass(rate))}>{signed(rate)}</span> a year</p>
            <p className="text-mute">Enter an amount to see it in dollars. <Term id="entryFee" /> <span className="figure">{feeText}</span>, kept in the vault for existing holders.</p>
          </>
        )
      ) : inKind ? (
        <>
          <p className="text-[15px] font-medium" aria-live="polite">
            {slice
              ? <>You receive about <span className="figure">{num(Number(formatUnits(slice.stock, DECIMALS)), 6)} {cfg.symbol}</span> and <span className="figure">{num(Number(formatUnits(slice.usdg, USDG_DECIMALS)), 4)} USDG</span></>
              : parsedShares && (holdings.isError || balances.isError) ? "The chain did not answer for the quote. Exit in kind still works."
              : "Enter shares to see what you receive."}
          </p>
          <p className="text-mute">Exit in kind works even when the price feed is stale or the pool is moving; you receive both tokens instead of only the Stock Token.</p>
        </>
      ) : (
        <>
          <p className="text-[15px] font-medium">Exit in kind is always open</p>
          <p className="text-mute">Your share of both tokens, even when the price feed is stale.</p>
        </>
      )}
    </div>
  );

  const factsEl = (
    <dl className={cn("text-[13px] leading-5", side ? "border-t border-hairline pt-1" : "col-span-2 flex flex-wrap gap-x-5 lg:order-4 lg:shrink-0 lg:flex-col")}>
      <div className={cn("flex gap-2", side && "justify-between border-b border-hairline py-2")}><dt className="text-mute">Vault size</dt><dd className="figure">{sizeCap}</dd></div>
      <div className={cn("flex gap-2", side && "justify-between border-b border-hairline py-2")}><dt className="text-mute">Per-deposit limit</dt><dd className="figure">{limit}</dd></div>
      {side && <div className="flex justify-between gap-2 py-2"><dt className="text-mute">Recentres</dt><dd>02:00 UTC after each NYSE session</dd></div>}
    </dl>
  );

  const detailsEl = detailsOpen ? (
    <div className={cn("text-[13px] leading-5", side ? "border-t border-hairline pt-3" : "mb-3 max-h-[32dvh] overflow-y-auto border-b border-hairline pb-3")} aria-live="polite">
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
      <TxStatus tx={tx} onExitInKind={tab === "withdraw" && !inKind ? switchToInKind : undefined} />
    </div>
  ) : null;

  const openingNote = opening ? <p className={cn("mt-2 text-[13px] text-mute", !side && "hidden sm:block")}>The {cfg.symbol} vault is opening. Deposits unlock here the moment its address is live on Robinhood Chain.</p> : null;

  if (side) {
    return (
      <div role="region" aria-label={`Deposit and withdraw ${cfg.symbol}`}>
        {closed ? (
          <div className="space-y-4">
            <div>
              <p className="font-semibold">Deposits are closed</p>
              <p className="mt-1 text-[13px] leading-5 text-mute">{gate.reason}</p>
            </div>
            <Button size="lg" className="w-full" disabled>Deposits closed</Button>
            {factsEl}
          </div>
        ) : (
          <div className="space-y-4">
            {tabsEl}
            {payEl}
            {exitEl}
            {amountEl}
            {estimateEl}
            {ctaEl}
            {factsEl}
            {openingNote}
          </div>
        )}
        {detailsEl ? <div className="mt-4">{detailsEl}</div> : null}
      </div>
    );
  }

  return (
    <div className="sticky bottom-[var(--ticker-h)] z-10 border-t border-line bg-panel" role="region" aria-label={`Deposit and withdraw ${cfg.symbol}`}>
      <div className="mx-auto max-w-[1280px] px-6 py-3 sm:py-4">
        {detailsEl}
        {closed ? (
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
            <p className="max-w-[760px] text-[13px] leading-5 text-mute"><span className="font-semibold text-fg">Deposits are closed. </span>{gate.reason}</p>
            <Button size="lg" className="w-full sm:w-auto" disabled>Deposits closed</Button>
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-2 lg:flex lg:items-center lg:gap-x-5">
            <div className="col-span-2 flex items-center justify-between gap-4 lg:col-auto lg:shrink-0 lg:justify-start lg:gap-5">
              {tabsEl}
              {payEl}
              {exitEl}
            </div>
            {amountEl}
            <div className="lg:order-5 lg:shrink-0">{ctaEl}</div>
            <div className="col-span-2 lg:order-3 lg:col-auto lg:flex-1">{estimateEl}</div>
            {factsEl}
          </div>
        )}
        {openingNote}
      </div>
    </div>
  );
}

function TxStatus({ tx, onExitInKind }: { tx: Tx; onExitInKind?: () => void }) {
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
        {tx.phase === "failed" && tx.belowMin && onExitInKind && (
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onExitInKind}>Exit in kind instead</Button>
        )}
        {link && <p className="mt-1">{link}</p>}
      </div>
    </div>
  );
}
