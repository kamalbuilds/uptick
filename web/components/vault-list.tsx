"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { Kept, RowAxis, RowBar, StateChip, GATE_LABEL } from "./ledger";
import { FetchError, Skeleton } from "./status";
import { pct, signed } from "@/lib/format";
import { type VaultStats } from "@/lib/keeper";
import { useVaultList } from "@/lib/vault-list";
import { countLine, filterVaults, tiersOf } from "@/lib/vault-filter";
import { BY_KEEP, VAULTS, type VaultConfig } from "@/lib/vaults";
import { cn } from "@/lib/utils";

const GRID = "grid grid-cols-[56px_minmax(0,1fr)_68px] items-center gap-x-3 sm:grid-cols-[64px_minmax(0,1fr)_minmax(140px,240px)_72px_88px_84px] sm:gap-x-5";

function Row({ cfg, stats, pending }: { cfg: VaultConfig; stats: VaultStats | undefined; pending: boolean }) {
  const keep = cfg.gate.worstHalfApr;
  return (
    <li>
      <Link href={`/vault/${cfg.id}`} className={`row ${GRID} min-h-[56px] border-b border-hairline py-2`}>
        <span>
          <span className="block font-semibold">{cfg.symbol}</span>
          <span className={cn("block text-[12px] leading-4 sm:hidden", cfg.gate.state === "open" ? "text-kept" : cfg.gate.state === "reduced" ? "text-caution" : "text-mute")}>{GATE_LABEL[cfg.gate.state]}</span>
        </span>
        <span className="hidden min-w-0 truncate text-mute sm:block">{cfg.name.replace(" Stock Token", "")}, {cfg.feeTier}</span>
        <span className="col-start-2 h-8 sm:col-start-auto">
          <RowBar keep={keep} label={`${cfg.symbol} keeps ${signed(keep)} a year in its weaker half`} />
        </span>
        <span className="text-right text-[17px] font-medium"><Kept value={keep} /></span>
        <span className="hidden text-right text-mute sm:block">
          {stats ? <><span className="figure text-fg">{pct(stats.feeAprPct)}</span> <span className="text-[12px]">{stats.aprWindowDays}d</span></> : pending ? <Skeleton className="ml-auto h-5 w-14" /> : "Unavailable"}
        </span>
        <span className="hidden justify-self-end sm:block"><StateChip state={cfg.gate.state} /></span>
      </Link>
    </li>
  );
}

const chip = "press h-9 rounded-full border px-4 text-[13px] font-medium";

/** Every eligible vault by what a holder keeps, search by ticker or company, filter by pool fee tier. The fee column is the stats API's live figure. */
export function VaultList() {
  const q = useVaultList();
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("all");
  const tiers = useMemo(() => tiersOf(VAULTS), []);
  const stats = useMemo(() => new Map((q.data ?? []).map((s) => [s.id, s])), [q.data]);
  const shown = filterVaults(BY_KEEP, query, tier);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="figure text-[17px] font-medium" aria-live="polite">{countLine(shown.length, VAULTS.length)}</p>
        <label className="relative block sm:w-72">
          <span className="sr-only">Search vaults by ticker or company</span>
          <MagnifyingGlass size={18} weight="bold" aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ticker or company"
            autoComplete="off"
            className="h-11 w-full rounded-full border border-line bg-transparent pl-11 pr-4 text-[15px] text-fg placeholder:text-mute"
          />
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

      {q.isError && <div className="mt-6"><FetchError what="the live fee figures" onRetry={() => q.refetch()} /></div>}

      {shown.length === 0 ? (
        <div className="mt-6 border-y border-hairline py-8">
          <p className="font-semibold">No vault matches{query.trim() ? ` "${query.trim()}"` : ""}{tier !== "all" ? ` in the ${tier} pool tier` : ""}.</p>
          <button type="button" className="mt-2 text-[13px] font-semibold underline underline-offset-4" onClick={() => { setQuery(""); setTier("all"); }}>
            Show all {VAULTS.length} vaults
          </button>
        </div>
      ) : (
        <>
          <div className={`${GRID} mt-8 pb-2 text-[13px] text-mute`}>
            <span className="col-span-2">You keep a year, weaker half</span>
            <span className="hidden sm:block"><RowAxis /></span>
            <span className="text-right">Keep</span>
            <span className="hidden text-right sm:block">Fees</span>
            <span className="hidden text-right sm:block">Deposits</span>
          </div>
          <ul className="border-t border-hairline">
            {shown.map((v) => <Row key={v.id} cfg={v} stats={stats.get(v.id)} pending={q.isPending} />)}
          </ul>
        </>
      )}
    </div>
  );
}
