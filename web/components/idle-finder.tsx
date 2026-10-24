"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CaretDown, CaretRight, Check, Link as LinkIcon } from "@phosphor-icons/react";
import { CheckForm } from "./check-form";
import { HedgePlan } from "./hedge-plan";
import { GATE_LABEL, StateChip, toneClass } from "./ledger";
import { Skeleton } from "./status";
import { Term } from "./term";
import { TokenLogo } from "./token-logo";
import { Button } from "@/components/ui/button";
import { EXPLORER, addressUrl } from "@/lib/chain";
import { liveSentence, num, perDepositLimitUsd, shortAddress, signed, tokenBalance, usdWhole } from "@/lib/format";
import { usdSigned } from "@/lib/leak";
import { priceLabel } from "@/lib/price-math";
import { parseOwner, type GateState, type ScanRow, type WalletScan } from "@/lib/scan";
import { useWalletScan } from "@/lib/use-scan";
import { TERMS } from "@/lib/terms";
import { money, names, plan, verdict } from "@/lib/verdict";
import { LIVE_VAULTS, REPLAY_WINDOW, VAULTS, isoDay } from "@/lib/vaults";
import { cn } from "@/lib/utils";

/** One grid on every /check screen: the answer on the left, the thing you act on, 340px wide, on the right. */
const SPLIT = "lg:grid-cols-[minmax(0,1fr)_340px]";
const COLS = "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.25fr)_minmax(0,1.2fr)_44px]";
const STATE_FILL: Record<GateState, string> = { open: "bg-kept", reduced: "bg-caution", closed: "bg-closed" };

/** The deployed vault address for a scan row, or undefined while its vault is launching. */
const vaultAddress = (id: string) => VAULTS.find((v) => v.id === id)?.vault;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const MobileLabel = ({ children }: { children: string }) => <p className="text-[13px] leading-4 text-mute lg:hidden">{children}</p>;

function TokenCell({ r }: { r: ScanRow }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <TokenLogo symbol={r.symbol} size={36} />
      <div className="min-w-0">
        <p className="font-semibold leading-5">{r.symbol}</p>
        <p className="figure truncate text-[13px] leading-4 text-mute">{tokenBalance(Number(r.balance))} {r.symbol}</p>
      </div>
    </div>
  );
}

function HeldCell({ r, maxUsd }: { r: ScanRow; maxUsd: number }) {
  const share = r.holdingUsd === null || maxUsd <= 0 ? 0 : Math.max(2, Math.round((r.holdingUsd / maxUsd) * 100));
  return (
    <div className="text-right lg:text-left">
      <MobileLabel>Held</MobileLabel>
      <p className="figure text-[17px] font-medium leading-6">{r.holdingUsd === null ? "No price" : money(r.holdingUsd)}</p>
      <p className="text-[13px] leading-4 text-mute">{r.priceUsd !== null ? `at ${priceLabel(r.priceUsd)}` : "Chainlink gave no usable price"}</p>
      <span className="mt-1.5 hidden h-[3px] max-w-[140px] rounded-full bg-hairline lg:block" aria-hidden>
        <span className="block h-full rounded-full bg-mute" style={{ width: `${share}%` }} />
      </span>
    </div>
  );
}

/** Live vaults link to their address on Blockscout; the rest say they are launching. */
function VaultStatus({ id, symbol }: { id: string; symbol: string }) {
  const addr = vaultAddress(id);
  return addr ? (
    <a
      className="relative inline-flex min-h-11 items-center text-[13px] leading-4 text-fg underline underline-offset-4 lg:min-h-5"
      href={addressUrl(addr)}
      target="_blank"
      rel="noreferrer"
      aria-label={`${symbol} vault on Blockscout`}
    >
      Live at {shortAddress(addr)}
    </a>
  ) : (
    <p className="text-[13px] leading-4 text-mute">Launching</p>
  );
}

function TakesCell({ r }: { r: ScanRow }) {
  const b = r.borrow;
  if (r.state === "closed") {
    return (
      <div>
        <MobileLabel>Can go to work</MobileLabel>
        <p className="text-[15px] leading-6 text-mute">Nothing, vault closed</p>
      </div>
    );
  }
  if (r.putToWorkUsd === null) {
    return (
      <div>
        <MobileLabel>Can go to work</MobileLabel>
        <p className="text-[13px] leading-5 text-mute">Waits for a price</p>
      </div>
    );
  }
  const capped = r.holdingUsd !== null && r.putToWorkUsd < r.holdingUsd - 0.5;
  const full = r.vault !== null && r.putToWorkUsd === 0;
  return (
    <div>
      <MobileLabel>Can go to work</MobileLabel>
      <div className="flex flex-wrap items-center gap-x-2">
        <p className="figure text-[17px] font-medium leading-6">{money(r.putToWorkUsd)}</p>
        <StateChip state={r.state} />
      </div>
      <p className="text-[13px] leading-4 text-mute">
        {full ? "Full or paused right now" : r.state === "reduced" ? `Vault size ${usdWhole(r.depositCapUsd)}, up to ${usdWhole(perDepositLimitUsd(r.depositCapUsd))} a deposit` : capped ? (r.roomUsd !== null ? `Room left today ${money(r.roomUsd)}` : `Vault size ${usdWhole(r.depositCapUsd)}`) : "All of it"}
      </p>
      {b.kind === "room" ? (
        <p className="text-[13px] leading-4 text-mute">Borrow up to {money(b.usd)} at the market&rsquo;s {num(b.lltv, 1)}% <Term id="lltv">limit</Term></p>
      ) : null}
      <VaultStatus id={r.id} symbol={r.symbol} />
    </div>
  );
}

function WeakerCell({ r }: { r: ScanRow }) {
  return (
    <div className="text-right lg:text-left">
      <MobileLabel>Weaker half</MobileLabel>
      {r.keptPerYearUsd !== null ? (
        <>
          <p className={cn("figure text-[17px] font-medium leading-6", toneClass(r.keptPerYearUsd))}>{usdSigned(r.keptPerYearUsd)} a year</p>
          <p className="text-[13px] leading-4 text-mute">{signed(r.worstHalfApr)} on the deposit</p>
        </>
      ) : r.state === "closed" ? (
        <>
          <p className="figure text-[17px] font-medium leading-6 text-loss">{signed(r.worstHalfApr)} a year</p>
          <p className="text-[13px] leading-4 text-mute">below the floor</p>
        </>
      ) : (
        <p className="text-[13px] leading-5 text-mute">Waits for a price</p>
      )}
    </div>
  );
}

function HoldingRow({ r, block, maxUsd }: { r: ScanRow; block: bigint; maxUsd: number }) {
  const closed = r.state === "closed";
  const href = `/vault/${r.id}`;
  const label = closed || !vaultAddress(r.id) ? `See the ${r.symbol} vault` : `Put ${r.symbol} to work`;
  return (
    <li className="row border-b border-hairline px-3 py-3 lg:py-3">
      <div className={cn("grid grid-cols-2 items-start gap-x-4 gap-y-4 lg:items-center", COLS)}>
        <TokenCell r={r} />
        <HeldCell r={r} maxUsd={maxUsd} />
        <TakesCell r={r} />
        <WeakerCell r={r} />
        <Button asChild variant="outline" className="col-span-2 lg:hidden">
          <Link href={href}>{label}</Link>
        </Button>
        <Link href={href} aria-label={label} className="press hidden size-11 items-center justify-center rounded-full border border-line hover:bg-raised lg:inline-flex">
          <CaretRight size={18} aria-hidden />
        </Link>
      </div>
      {closed ? <p className="mt-3 max-w-[690px] text-[13px] leading-5 text-mute">{r.reason}</p> : null}
      <HedgePlan className="mt-1" source="wallet" id={r.id} symbol={r.symbol} token={r.token} balanceRaw={r.balanceRaw} block={block} />
    </li>
  );
}

/** The tokens a wallet holds as overlapped marks, largest first, with a count for the rest. */
function MarkStack({ rows, size, max }: { rows: ScanRow[]; size: number; max: number }) {
  return (
    <span className="flex items-center" aria-hidden>
      {rows.slice(0, max).map((r, i) => <TokenLogo key={r.id} symbol={r.symbol} size={size} className={cn("ring-2 ring-canvas", i > 0 && "-ml-1.5")} />)}
      {rows.length > max ? <span className="figure ml-2 text-[13px] text-mute">+{rows.length - max}</span> : null}
    </span>
  );
}

/** The wallet drawn to scale: one segment per token, widest first, tinted by what its vault does with it. */
function HoldBar({ rows }: { rows: ScanRow[] }) {
  const priced = rows.filter((r) => r.holdingUsd !== null && r.holdingUsd > 0);
  const total = sum(priced.map((r) => r.holdingUsd as number));
  if (total <= 0) return null;
  const by: Record<GateState, number> = { open: 0, reduced: 0, closed: 0 };
  for (const r of priced) by[r.state] += r.holdingUsd as number;
  const states = (["open", "reduced", "closed"] as const).filter((s) => by[s] > 0);
  const summary = states.map((s) => `${GATE_LABEL[s]} ${money(by[s])}`).join(", ");
  return (
    <div className="mt-4">
      {priced.length > 1 ? <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`The wallet by vault state: ${summary}`}>
        {priced.map((r) => <span key={r.id} className={STATE_FILL[r.state]} style={{ width: `${((r.holdingUsd as number) / total) * 100}%`, minWidth: 3 }} />)}
      </div> : null}
      <ul className={cn("flex flex-col text-[13px] leading-5 text-mute lg:flex-row lg:flex-wrap lg:gap-x-5", priced.length > 1 && "mt-1")}>
        {states.map((s) => (
          <li key={s} className="flex min-h-11 items-center gap-2 lg:min-h-6">
            <span className={cn("size-2 rounded-full", STATE_FILL[s])} aria-hidden />
            <span>In <Term id={s}>{s}</Term> vaults</span> <span className="figure text-fg">{money(by[s])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TRow({ k, v, note, tone, desktop }: { k: React.ReactNode; v: string; note?: string; tone?: string; /** Shown from the large breakpoint up only: the rows below carry the same figure on a phone. */ desktop?: boolean }) {
  return (
    <div className={cn("items-baseline justify-between gap-4 border-b border-hairline py-3", desktop ? "hidden lg:flex" : "flex")}>
      <dt className="text-mute">{k}</dt>
      <dd className="text-right">
        <span className={cn("figure font-medium", tone)}>{v}</span>
        {note ? <span className="block text-[13px] leading-4 text-mute">{note}</span> : null}
      </dd>
    </div>
  );
}

function CopyLink() {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(window.location.href);
      setState("done");
    } catch {
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), 2400);
  }
  return (
    <>
      <Button variant="soft" className="mt-2 w-full" onClick={() => void copy()}>
        {state === "done" ? <Check size={18} aria-hidden /> : <LinkIcon size={18} aria-hidden />}
        {state === "done" ? "Link copied" : "Copy link to this check"}
      </Button>
      <p role="status" className="sr-only">{state === "done" ? "Link copied" : state === "failed" ? "The browser blocked copying. The link is in the address bar." : ""}</p>
      {state === "failed" ? <p className="mt-2 text-[13px] leading-5 text-mute">The browser blocked copying. The link is in the address bar.</p> : null}
    </>
  );
}

/** The one thing to act on, read from the same plan as the headline: what can go to work today, what waits for a launch, the weaker half of the live vault to open, and the way in. */
function Ticket({ s }: { s: WalletScan }) {
  const t = s.totals;
  const p = plan(s);
  // The primary action is the live vault to open, unless what it takes is too small to lead, and then it is the live vault list.
  const lead = p.tiny ? undefined : p.lead;
  const leadAddr = lead?.vault ?? undefined;
  const wh = lead && lead.keptPerYearUsd !== null ? { gain: lead.keptPerYearUsd >= 0, usd: Math.abs(lead.keptPerYearUsd) } : null;
  const liveSymbols = LIVE_VAULTS.map((v) => v.symbol);
  const aside = p.tiny && p.lead && p.lead.vault ? p.lead : undefined;
  // With only a tiny live holding, the big number is the launching rest, so the primary action opens the largest launching vault it holds.
  const nextUp = aside ? s.rows.filter((r) => r.vault === null && r.state !== "closed" && (r.putToWorkUsd ?? 0) > 0).sort((a, b) => (b.putToWorkUsd as number) - (a.putToWorkUsd as number))[0] : undefined;
  const tail =
    p.full.length > 0 && !p.lead
      ? `${names(p.full)} ${p.full.length === 1 ? "is" : "are"} full or paused right now.`
      : aside
        ? (t.refused.tokens > 0 ? "The rest of this wallet is in tokens whose vaults are launching or closed." : "The rest of this wallet is in tokens whose vaults are launching.")
        : p.launching.usd > 0
          ? "This wallet holds none of them, and the vaults for its tokens are launching."
          : "This wallet holds none of them, and its tokens' vaults are closed.";
  return (
    <section aria-labelledby="ticket" className="rounded-lg border border-line bg-panel p-5">
      <h2 id="ticket" className="text-[13px] font-normal leading-5 text-mute">{lead || p.launching.usd === 0 ? "You can put to work today" : "Can go to work when vaults launch"}</h2>
      <p className="figure mt-1 text-[32px] font-medium leading-9">{money(lead ? p.live.usd : p.launching.usd)}</p>
      <p className="mt-1 text-[13px] leading-5 text-mute">of {money(t.idleUsd)} held in {plural(s.rows.length, "token", "tokens")}</p>
      <dl className="mt-4 border-t border-hairline">
        {lead && p.launching.usd > 0 ? <TRow k="Launching vaults" v={money(p.launching.usd)} note={names(p.launching.symbols)} /> : null}
        {t.refused.tokens > 0 ? <TRow k={<><Term id="closed">Closed</Term> vaults</>} v={money(t.refused.usd)} note="No deposits" /> : null}
        {wh && lead ? (
          <TRow desktop k={<Term id="worstHalf">Weaker half</Term>} v={`${wh.gain ? "+" : "-"}${money(wh.usd)} a year`} tone={wh.gain ? "text-kept" : "text-loss"} note={`${lead.symbol}, in the replay, past trades`} />
        ) : null}
        {t.putToWork.borrowRoomUsd !== null ? <TRow desktop k={<Term id="borrowRoom">Borrow room</Term>} v={`up to ${money(t.putToWork.borrowRoomUsd)}`} /> : null}
      </dl>
      {lead && leadAddr ? (
        <>
          <div className="mt-5 flex items-center gap-3">
            <TokenLogo symbol={lead.symbol} size={32} />
            <div className="min-w-0">
              <p className="font-medium leading-5">{lead.symbol} vault</p>
              <a className="figure relative inline-flex min-h-11 items-center text-[13px] leading-4 text-mute underline underline-offset-4 hover:text-fg lg:min-h-5" href={addressUrl(leadAddr)} target="_blank" rel="noreferrer">
                Live at {shortAddress(leadAddr)}, {lead.roomUsd !== null ? `room for ${money(lead.roomUsd)} today` : `up to ${usdWhole(lead.depositCapUsd)}`}
              </a>
            </div>
          </div>
          <Button asChild size="lg" className="mt-3 w-full">
            <Link href={`/vault/${lead.id}`}>Put {lead.symbol} to work</Link>
          </Button>
          {p.live.symbols.length > 1 ? <p className="mt-2 text-center text-[13px] leading-5 text-mute">{plural(p.live.symbols.length - 1, "more live vault", "more live vaults")} in the list.</p> : null}
        </>
      ) : (
        <>
          <p className="mt-5 text-[13px] leading-5 text-mute">{liveSymbols.length > 0 ? `${liveSentence(liveSymbols)} ${tail}` : "The vaults for these tokens are launching."}</p>
          <Button asChild size="lg" className="mt-3 w-full">
            {nextUp ? <Link href={`/vault/${nextUp.id}`}>See the {nextUp.symbol} vault</Link> : <Link href="/vaults">{liveSymbols.length > 0 ? "See the live vaults" : "See the vaults"}</Link>}
          </Button>
          {aside && aside.putToWorkUsd !== null ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline pt-4">
              <TokenLogo symbol={aside.symbol} size={32} />
              <p className="min-w-0 flex-1 text-[15px] leading-5">
                <span className="figure font-medium">{money(aside.putToWorkUsd)}</span> of {aside.symbol} can go in now
              </p>
              <Button asChild variant="outline">
                <Link href={`/vault/${aside.id}`}>Put {aside.symbol} to work</Link>
              </Button>
            </div>
          ) : null}
        </>
      )}
      <CopyLink />
    </section>
  );
}

function AnotherWallet({ raw, className }: { raw: string; className?: string }) {
  return (
    <details className={cn("group mt-4 border-t border-hairline", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between py-2 [&::-webkit-details-marker]:hidden">
        Check another wallet
        <CaretDown size={16} className="transition-transform duration-150 group-open:rotate-180" aria-hidden />
      </summary>
      <CheckForm key={raw} initial={raw} stacked className="pb-4 pt-1" />
    </details>
  );
}

function NoHoldings({ s, raw }: { s: WalletScan; raw: string }) {
  return (
    <div className={cn("mt-4 grid gap-x-12 gap-y-8", SPLIT)}>
      <div>
        <p className="serif verdict text-[30px] leading-[34px] sm:text-[44px] sm:leading-[48px]">This wallet holds none of the {s.tracked} Stock Tokens.</p>
        <p className="mt-4 max-w-[690px] text-mute">
          The wallet was read on Robinhood Chain at <a className="touch -my-3 inline-block py-3 underline underline-offset-4" href={`${EXPLORER}/block/${s.block}`} target="_blank" rel="noreferrer">block {s.block.toLocaleString("en-US")}</a>.
          The tokens checked are {VAULTS.map((v) => v.symbol).sort().join(", ")}. A wallet that holds any of them shows here, with what each vault would keep and where a loan opens.
        </p>
        <Button asChild variant="outline" className="mt-6"><Link href="/vaults">See the vaults</Link></Button>
      </div>
      <div>
        <p className="text-[13px] leading-5 text-mute">Check another wallet</p>
        <CheckForm key={raw} initial={raw} stacked className="mt-1" />
      </div>
    </div>
  );
}

function Results({ s, raw }: { s: WalletScan; raw: string }) {
  const t = s.totals;
  if (s.rows.length === 0) return <NoHoldings s={s} raw={raw} />;
  const v = verdict(s);
  const maxUsd = Math.max(0, ...s.rows.map((r) => r.holdingUsd ?? 0));

  return (
    <>
      <div className={cn("mt-4 grid gap-x-12", SPLIT)}>
        <div className="lg:col-start-1">
          <p className="serif verdict text-[30px] leading-[34px] sm:text-[44px] sm:leading-[48px]">{v.main}</p>
          {v.more ? <p className="mt-3 max-w-[690px] text-[17px] leading-6 text-mute">{v.more}</p> : null}
        </div>

        <aside className="mt-8 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:mt-0 lg:self-start lg:sticky lg:top-24">
          <Ticket s={s} />
          <AnotherWallet raw={raw} className="hidden lg:block" />
        </aside>

        <section aria-labelledby="holds" className="mt-8 lg:col-start-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 id="holds" className="text-2xl font-semibold leading-8 tracking-[-0.2px]">What the wallet holds</h2>
            <p className="text-[13px] text-mute">{s.rows.length} of {s.tracked} Stock Tokens{s.rows.length > 1 ? ", largest first" : ""}</p>
          </div>
          <HoldBar rows={s.rows} />
          <div className={cn("mt-4 hidden border-b border-hairline px-3 pb-2 text-[13px] leading-5 text-mute lg:grid lg:items-center lg:gap-x-4", COLS)}>
            <span>Token</span>
            <span>Held</span>
            <span>Can go to work</span>
            <span><Term id="kept">Kept</Term> a year, <Term id="worstHalf">weaker half</Term></span>
            <span />
          </div>
          <ul className="border-t border-hairline lg:border-t-0">{s.rows.map((r) => <HoldingRow key={r.id} r={r} block={s.block} maxUsd={maxUsd} />)}</ul>
        </section>

        <div className="mt-8 lg:col-start-1">
          <AnotherWallet raw={raw} className="mb-8 mt-0 border-b lg:hidden" />
          {t.unpriced.length > 0 && (
            <p className="mb-6 max-w-[690px] text-[13px] leading-5 text-mute">
              Chainlink had no usable price for {t.unpriced.join(", ")} in this read, so {t.unpriced.length === 1 ? "it is" : "they are"} left out of every dollar figure above.
            </p>
          )}
          <p className="max-w-[690px] text-[13px] leading-5 text-mute">
            A closed vault takes no deposits. <Term id="inKind">Exit in kind</Term> is never closed. A loan against the vault shares opens with each vault&rsquo;s <Term id="morpho">Morpho Blue</Term> market.
          </p>
          <p className="mt-3 max-w-[690px] text-[13px] leading-5 text-mute">
            Read from Robinhood Chain in a single call at <a className="touch -my-3 inline-block py-3 underline underline-offset-4" href={`${EXPLORER}/block/${s.block}`} target="_blank" rel="noreferrer">block {s.block.toLocaleString("en-US")}</a>,
            priced by the Chainlink feeds the vaults read. Kept is the weaker 15-day half of the {REPLAY_WINDOW.days}-day replay to {isoDay(REPLAY_WINDOW.end)}, taken on the deposit net of the entry fee.
            It measures past swaps and is not a promise. {LIVE_VAULTS.length ? `${liveSentence(LIVE_VAULTS.map((v) => v.symbol))} The rest are launching, and each row opens its vault page.` : "The vaults are launching, and each row opens its vault page."}
          </p>
        </div>
      </div>
    </>
  );
}

function Loading() {
  return (
    <div className={cn("mt-4 grid gap-x-12", SPLIT)} aria-busy="true" aria-label="Reading the wallet from Robinhood Chain">
      <div className="lg:col-start-1">
        <Skeleton className="h-24 w-full max-w-[760px]" />
        <Skeleton className="mt-10 h-24 w-full" />
        <Skeleton className="mt-2 h-24 w-full" />
        <Skeleton className="mt-2 h-24 w-full" />
      </div>
      <Skeleton className="mt-8 h-[360px] w-full lg:col-start-2 lg:row-start-1 lg:mt-0" />
    </div>
  );
}

/** The empty page tells a stranger what the result will say: each token held lands in one of three vault states. */
function StateKey() {
  return (
    <section aria-labelledby="state-key" className="border-t border-hairline pt-6 lg:border-t-0 lg:pt-1">
      <h2 id="state-key" className="text-2xl font-semibold leading-8 tracking-[-0.2px]">What a result tells you</h2>
      <p className="mt-2 text-mute">Each token the wallet holds lands in one of three states. The replay of the vault&rsquo;s pool splits 30 days into two halves of 15, and the weaker half decides.</p>
      <dl className="mt-4 border-t border-hairline">
        {(["open", "reduced", "closed"] as const).map((state) => (
          <div key={state} className="flex flex-col gap-2 border-b border-hairline py-4">
            <dt><StateChip state={state} /></dt>
            <dd className="text-mute">{TERMS[state].text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Real Robinhood Chain wallets (externally owned, from Blockscout's top holders on 2026-10-24), one per kind of result. Labels name the
 *  shape of the holding, not its size, because balances move. The marks and the dollar figure on each card are read live. */
const EXAMPLES = [
  { label: "PLTR holder, one open vault", address: "0x335836A23a2E475265058CB55318EF91A07136b7" },
  { label: "Four tokens across all three states", address: "0xdBD1bac81ad581C7198C9D155cA468F32a0C29DD" },
  { label: "All 17 Stock Tokens", address: "0x92d435C96E63c43E12d6D0AB28f6b0B04072F765" },
  { label: "Mostly NVDA", address: "0x28C66690Ae101a4f07546b07a2Ac8Eb439b6C245" },
] as const;

const MARKS = 5;

function ExampleCard({ e, on }: { e: (typeof EXAMPLES)[number]; on: boolean }) {
  const q = useWalletScan(parseOwner(e.address));
  const rows = q.data?.rows ?? [];
  return (
    <Link
      href={`/check?address=${e.address}`}
      aria-current={on ? "page" : undefined}
      className={cn("press flex h-full min-h-11 flex-col justify-between gap-4 rounded-lg border p-4 hover:border-fg hover:bg-panel", on ? "border-fg bg-panel" : "border-line")}
    >
      <div className="flex min-h-9 items-center justify-between gap-3">
        {q.data ? (
          <>
            <MarkStack rows={rows} size={32} max={MARKS} />
            <span className="text-right">
              <span className="figure block text-[17px] font-medium leading-6">{money(q.data.totals.idleUsd)}</span>
              <span className="block text-[13px] leading-4 text-mute">{plural(rows.length, "token", "tokens")}</span>
            </span>
          </>
        ) : q.isError ? null : (
          <Skeleton className="h-8 w-full" />
        )}
      </div>
      <div>
        <p className="font-medium leading-5">{e.label}</p>
        <p className="figure text-[13px] leading-5 text-mute">{shortAddress(e.address)}</p>
      </div>
    </Link>
  );
}

function Examples({ current, className }: { current: string; className?: string }) {
  return (
    <section aria-labelledby="examples" className={className}>
      <h2 id="examples" className="text-[13px] font-normal leading-5 text-mute">Or open a real holder&rsquo;s wallet</h2>
      <ul className="mt-2 grid gap-3 sm:grid-cols-2">
        {EXAMPLES.map((e) => <li key={e.address}><ExampleCard e={e} on={current.toLowerCase() === e.address.toLowerCase()} /></li>)}
      </ul>
    </section>
  );
}

function Start({ raw }: { raw: string }) {
  return (
    <div className={cn("grid gap-x-12 gap-y-12", SPLIT)}>
      <div>
        <h1 className="text-[32px] font-medium leading-10 tracking-[-0.33px]">Find your idle Stock Tokens</h1>
        <p className="mt-2 max-w-[690px] text-mute">
          Paste any wallet address. Uptick reads which of the {VAULTS.length} Stock Tokens it holds from Robinhood Chain, prices them with Chainlink, and shows what each vault would keep on them and where a loan against them opens. Nothing to connect or sign.
        </p>
        <CheckForm key={raw} initial={raw} className="mt-6 max-w-[640px]" />
        {raw !== "" ? (
          <p role="alert" className="mt-4 max-w-[640px] text-loss">The address in the link is not a wallet address. Paste the 42-character 0x address above.</p>
        ) : null}
        <Examples current={raw} className="mt-8" />
      </div>
      <StateKey />
    </div>
  );
}

function CheckedWallet({ owner, raw }: { owner: NonNullable<ReturnType<typeof parseOwner>>; raw: string }) {
  const q = useWalletScan(owner);
  return (
    <>
      <h1 className="flex flex-wrap items-baseline gap-x-3 text-[15px] font-medium leading-6">
        <span>Stock Tokens in <span className="figure" title={owner}>{shortAddress(owner)}</span></span>
        <span className="text-[13px] font-normal text-mute">on Robinhood Chain</span>
      </h1>
      {q.isError ? (
        <div role="alert" className="mt-10 max-w-[640px] border-t border-hairline pt-4">
          <p className="font-semibold">The chain did not answer for this wallet.</p>
          <p className="mt-1 text-[13px] text-mute">Every figure here is read live from Robinhood Chain. Retry asks again.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Retry</Button>
            <Button asChild size="sm" variant="soft"><Link href="/check">Check another wallet</Link></Button>
          </div>
        </div>
      ) : !q.data ? (
        <Loading />
      ) : (
        <>
          <Results s={q.data} raw={raw} />
          <Examples current={raw} className="mt-14 border-t border-hairline pt-6" />
        </>
      )}
    </>
  );
}

/** /check: paste a wallet, see what its Stock Tokens hold, what Uptick can put to work, and where to go next. The address lives in the URL so a result can be shared. */
export function IdleFinder() {
  const raw = useSearchParams().get("address") ?? "";
  const owner = parseOwner(raw);
  return (
    <div className="mx-auto max-w-[1280px] px-6 pb-8 pt-8 lg:pt-12">
      {owner === null ? <Start raw={raw} /> : <CheckedWallet owner={owner} raw={raw} />}
    </div>
  );
}
