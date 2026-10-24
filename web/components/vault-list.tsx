"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { DepositPanel } from "./deposit-panel";
import { Kept, RowAxis, RowBar, SectionTitle, StateChip, GATE_LABEL } from "./ledger";
import { PriceCell, PriceLine } from "./price";
import { YieldPair } from "./yield-pair";
import { Term } from "./term";
import { PairLogo, TokenLogo } from "./token-logo";
import { REDUCED_CAP_STOCK_USD } from "@/lib/evidence";
import { KEPT_AFTER } from "@/lib/fee-lead";
import { pct, signed, usdWhole } from "@/lib/format";
import { countLine, filterVaults, tiersOf } from "@/lib/vault-filter";
import { BY_KEEP, VAULTS, type VaultConfig } from "@/lib/vaults";
import { cn } from "@/lib/utils";

/** Below the lg breakpoint there is no side panel, so a row opens its vault page instead of loading the panel. */
const WIDE = "(min-width: 1024px)";
const useWide = () =>
  useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );

/** Columns by width. Under 640px: vault, fees earned, kept after fast traders. 640px and up: price, state and the page link join. The bar sits between price and fees where the row has the room (768 to 1023px, and 1280px and up beside the panel). */
const GRID =
  "grid items-center gap-x-4 grid-cols-[minmax(0,1fr)_72px_100px] sm:grid-cols-[minmax(0,1fr)_76px_84px_100px_72px_32px] md:grid-cols-[minmax(0,1fr)_76px_minmax(80px,100px)_84px_100px_72px_32px] lg:grid-cols-[minmax(0,1fr)_76px_84px_100px_72px_32px] xl:grid-cols-[minmax(0,1fr)_80px_minmax(90px,1fr)_84px_100px_72px_32px]";
const BAR_SHOWN = "hidden md:block lg:hidden xl:block";

function Row({ cfg, selected, wide, onSelect }: { cfg: VaultConfig; selected: boolean; wide: boolean; onSelect: () => void }) {
  const router = useRouter();
  const keep = cfg.gate.worstHalfApr;
  const fee = cfg.keep.feeApr;
  return (
    <li data-selected={wide && selected} className="row relative border-b border-hairline has-[button:focus-visible]:shadow-[inset_0_0_0_2px_var(--color-fg)]">
      <div className={`${GRID} min-h-[60px] py-2 pl-3 pr-3`}>
        <button
          type="button"
          aria-pressed={wide ? selected : undefined}
          aria-label={wide ? `${cfg.symbol}, ${cfg.name.replace(" Stock Token", "")}. Load its deposit panel` : `${cfg.symbol}, ${cfg.name.replace(" Stock Token", "")}. Open the vault page`}
          onClick={() => (wide ? onSelect() : router.push(`/vault/${cfg.id}`))}
          className="flex min-w-0 items-center gap-3 text-left after:absolute after:inset-0 after:content-['']"
        >
          <TokenLogo symbol={cfg.symbol} size={28} />
          <span className="min-w-0">
            <span className="block font-semibold leading-5">{cfg.symbol}</span>
            <span className={cn("block text-[12px] leading-4 sm:hidden", cfg.gate.state === "open" ? "text-kept" : cfg.gate.state === "reduced" ? "text-caution" : "text-mute")}>{GATE_LABEL[cfg.gate.state]}</span>
            <span className="hidden truncate text-[13px] leading-4 text-mute sm:block">{cfg.name.replace(" Stock Token", "")}, {cfg.feeTier}</span>
          </span>
        </button>
        <span className="hidden text-right sm:block"><PriceCell id={cfg.id} /></span>
        <span className={`${BAR_SHOWN} h-8`}>
          <RowBar keep={keep} label={`${cfg.symbol} keeps ${signed(keep)} a year in its weaker half`} />
        </span>
        <span className="figure text-right text-[17px] font-medium leading-6"><span className="sr-only">Fees earned </span>{pct(fee)}</span>
        <span className="text-right text-[15px] leading-6"><span className="sr-only">{KEPT_AFTER} </span><Kept value={keep} /></span>
        <span className="hidden justify-self-end sm:block"><StateChip state={cfg.gate.state} /></span>
        <Link
          href={`/vault/${cfg.id}`}
          aria-label={`Open the ${cfg.symbol} vault page`}
          className="press relative z-10 hidden size-8 items-center justify-center rounded-lg border border-line text-mute hover:bg-raised hover:text-fg sm:inline-flex"
        >
          <CaretRight size={16} weight="bold" aria-hidden />
        </Link>
      </div>
    </li>
  );
}

function ColumnHeads() {
  return (
    <div className={`${GRID} items-end px-3 pb-1 pt-3 text-[13px] leading-4 text-mute`}>
      <span>Vault</span>
      <span className="hidden text-right sm:block">Price</span>
      <span className={BAR_SHOWN}><RowAxis /></span>
      <span className="text-right"><Term id="feesEarned" /></span>
      <span className="text-right"><Term id="kept">{KEPT_AFTER}</Term></span>
      <span className="hidden text-right sm:block">State</span>
      <span className="hidden sm:block" />
    </div>
  );
}

/** The panel that stays beside the list: the selected vault's identity, its live price, and the same deposit form the vault page docks. */
function ActionPanel({ cfg }: { cfg: VaultConfig }) {
  const worst = cfg.gate.worstHalfApr;
  return (
    <aside aria-label="Deposit panel" className="hidden lg:block">
      <div className="sticky top-20 max-h-[calc(100dvh-8.5rem)] overflow-y-auto rounded-lg border border-line bg-panel p-5">
        <div className="flex items-center gap-3">
          <PairLogo symbol={cfg.symbol} size={32} />
          <div className="min-w-0">
            <h2 className="truncate text-[20px] font-semibold leading-6 tracking-[-0.2px]">{cfg.symbol} vault</h2>
            <p className="truncate text-[13px] leading-5 text-mute">{cfg.name.replace(" Stock Token", "")}, {cfg.symbol} / USDG, {cfg.feeTier}</p>
          </div>
          <StateChip state={cfg.gate.state} term className="ml-auto" />
        </div>
        <div className="mt-4 space-y-1.5">
          <PriceLine id={cfg.id} />
          <YieldPair feeApr={cfg.keep.feeApr} keptApr={worst} size="side" />
        </div>
        <div className="mt-5">
          <DepositPanel key={cfg.id} cfg={cfg} layout="side" />
        </div>
        <nav aria-label={`${cfg.symbol} vault links`} className="mt-4 flex flex-wrap gap-x-5 border-t border-hairline pt-3 text-[13px]">
          <Link href={`/vault/${cfg.id}`} className="inline-block py-1 font-semibold underline underline-offset-4">Open the {cfg.symbol} page</Link>
          <Link href="/docs/how-vaults-work" className="inline-block py-1 text-mute underline underline-offset-4 hover:text-fg">How vaults work</Link>
          <Link href="/docs/exit-in-kind" className="inline-block py-1 text-mute underline underline-offset-4 hover:text-fg">Exit in kind</Link>
        </nav>
      </div>
    </aside>
  );
}

const chip = "press h-9 max-lg:h-11 rounded-full border px-4 text-[13px] font-medium";

/** Every eligible vault, vaults taking deposits first and the closed ones folded away, each section in order of what a holder keeps. A row leads with the fees the pool paid
 *  and puts kept after fast traders beside it; it loads its deposit panel beside the list. Search by ticker or company ("/" jumps to it), filter by pool fee tier. */
export function VaultList() {
  const wide = useWide();
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("all");
  const [closedOpen, setClosedOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(() => (BY_KEEP.find((v) => v.gate.state !== "closed") ?? BY_KEEP[0]).id);
  const search = useRef<HTMLInputElement>(null);
  const tiers = useMemo(() => tiersOf(VAULTS), []);
  const shown = filterVaults(BY_KEEP, query, tier);
  const taking = shown.filter((v) => v.gate.state !== "closed");
  const closed = shown.filter((v) => v.gate.state === "closed");
  const filtering = query.trim() !== "" || tier !== "all";
  const selected = VAULTS.find((v) => v.id === selectedId) ?? BY_KEEP[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = (list: VaultConfig[]) =>
    list.map((v) => <Row key={v.id} cfg={v} selected={v.id === selectedId} wide={wide} onSelect={() => setSelectedId(v.id)} />);

  return (
    <div className="grid gap-x-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="figure text-[17px] font-medium" aria-live="polite">{countLine(shown.length, VAULTS.length)}</p>
          <label className="relative block sm:w-72">
            <span className="sr-only">Search vaults by ticker or company</span>
            <MagnifyingGlass size={18} weight="bold" aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
            <input
              ref={search}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ticker or company"
              autoComplete="off"
              aria-keyshortcuts="/"
              className="h-11 w-full rounded-full border border-line bg-transparent pl-11 pr-10 text-[15px] text-fg placeholder:text-mute"
            />
            <kbd className="pointer-events-none absolute right-4 top-1/2 hidden h-5 -translate-y-1/2 items-center rounded border border-line px-1.5 text-[12px] text-mute sm:inline-flex" aria-hidden>/</kbd>
          </label>
        </div>

        {tiers.length > 1 && (
          <div role="group" aria-label="Pool fee tier" className="mt-4 flex flex-wrap gap-2">
            {["all", ...tiers].map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tier === t}
                onClick={() => setTier(t)}
                className={cn(chip, tier === t ? "border-fg bg-fg text-canvas" : "border-line text-fg hover:bg-panel")}
              >
                {t === "all" ? "All pools" : `${t} pool`}
              </button>
            ))}
          </div>
        )}

        {shown.length === 0 ? (
          <div className="mt-6 border-y border-hairline py-8">
            <p className="font-semibold">No vault matches{query.trim() ? ` "${query.trim()}"` : ""}{tier !== "all" ? ` in the ${tier} pool tier` : ""}.</p>
            <button type="button" className="mt-2 text-[13px] font-semibold underline underline-offset-4" onClick={() => { setQuery(""); setTier("all"); }}>
              Show all {VAULTS.length} vaults
            </button>
          </div>
        ) : (
          <>
            <p className="mb-8 mt-6 max-w-[690px] text-[13px] leading-5 text-mute max-lg:leading-11 [text-wrap:balance]">
              <Term id="feesEarned" /> is what the pool paid liquidity providers over a year. <Term id="kept">{KEPT_AFTER}</Term> is those fees less what informed traders take back and what recentring costs, read in the <Term id="worstHalf">weaker half</Term> of a 30-day replay. Each vault is <Term id="open" />, <Term id="reduced" /> or <Term id="closed" />.
            </p>
            <div>
              {taking.length > 0 && (
                <section aria-labelledby="taking">
                  <SectionTitle id="taking" aside={<>Open takes any amount. Reduced takes up to {usdWhole(REDUCED_CAP_STOCK_USD)} a deposit.</>}>
                    Cleared to open <span className="ml-1 text-[17px] font-normal text-mute">{taking.length}</span>
                  </SectionTitle>
                  <ColumnHeads />
                  <ul>{rows(taking)}</ul>
                </section>
              )}
              {closed.length > 0 && (
                <details className="group mt-10" open={closedOpen || filtering} onToggle={(e) => setClosedOpen(e.currentTarget.open)}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline pb-3 [&::-webkit-details-marker]:hidden">
                    <h2 className="text-2xl font-semibold leading-8 tracking-[-0.2px]">
                      Closed <span className="ml-1 text-[17px] font-normal text-mute">{closed.length}</span>
                    </h2>
                    <span className="flex items-center gap-2 text-[13px] text-mute">
                      The weaker half kept less than the -20% floor
                      <span className="inline-flex items-center gap-1 text-fg">
                        <span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span>
                        <CaretRight size={14} weight="bold" aria-hidden className="transition-transform duration-150 group-open:rotate-90" />
                      </span>
                    </span>
                  </summary>
                  <ColumnHeads />
                  <ul>{rows(closed)}</ul>
                </details>
              )}
            </div>
          </>
        )}
      </div>
      <ActionPanel cfg={selected} />
    </div>
  );
}
