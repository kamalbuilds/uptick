"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { FetchError, Skeleton } from "./status";
import { VaultStatus } from "./vault-card";
import { pct } from "@/lib/format";
import { sourceLabel, type VaultStats } from "@/lib/keeper";
import { useVaultList } from "@/lib/vault-list";
import { countLine, filterVaults, tiersOf } from "@/lib/vault-filter";
import { VAULTS, type VaultConfig } from "@/lib/vaults";
import { cn } from "@/lib/utils";

const chip = "rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-150";

function Row({ cfg, stats, pending }: { cfg: VaultConfig; stats: VaultStats | undefined; pending: boolean }) {
  return (
    <li>
      <Link
        href={`/vault/${cfg.id}`}
        className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 rounded-lg px-4 py-4 transition-colors duration-150 hover:bg-canvas sm:grid-cols-[1.4fr_1fr_0.7fr_auto]"
      >
        <div>
          <p className="display text-3xl">{cfg.symbol}</p>
          <p className="text-sm text-body">{cfg.name}</p>
        </div>
        <p className="figure text-right text-xl font-medium sm:text-left">
          {stats ? pct(stats.feeAprPct) : pending ? <Skeleton className="inline-block h-6 w-16 align-middle" /> : "Unavailable"}
          <span className="block text-xs font-normal text-body">{stats ? `fee APR, ${stats.aprWindowDays}-day ${stats.source}` : "fee APR"}</span>
        </p>
        <p className="figure hidden text-xl font-medium sm:block">
          {cfg.feeTier}
          <span className="block text-xs font-normal text-body">pool fee tier</span>
        </p>
        <span className="col-span-2 justify-self-start sm:col-span-1 sm:justify-self-end"><VaultStatus cfg={cfg} /></span>
      </Link>
    </li>
  );
}

/** Every eligible vault: search by ticker or company, filter by pool fee tier, best fee APR first once the stats API answers. */
export function VaultList() {
  const q = useVaultList();
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("all");
  const tiers = useMemo(() => tiersOf(VAULTS), []);
  const stats = useMemo(() => new Map((q.data ?? []).map((s) => [s.id, s])), [q.data]);
  const ordered = useMemo(
    () => (q.data ? [...VAULTS].sort((a, b) => (stats.get(b.id)?.feeAprPct ?? -1) - (stats.get(a.id)?.feeAprPct ?? -1)) : VAULTS),
    [q.data, stats],
  );
  const shown = filterVaults(ordered, query, tier);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="figure text-lg font-medium" aria-live="polite">{countLine(shown.length, VAULTS.length)}</p>
        <label className="relative block sm:w-72">
          <span className="sr-only">Search vaults by ticker or company</span>
          <MagnifyingGlass size={18} weight="bold" aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-body" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ticker or company"
            autoComplete="off"
            className="h-11 w-full rounded-full border border-sage-line bg-canvas pl-11 pr-4 text-base text-ink placeholder:text-mute"
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
              className={cn(chip, tier === t ? "bg-ink text-primary" : "bg-canvas text-ink hover:bg-primary-pale")}
            >
              {t === "all" ? "All pools" : `${t} pool`}
            </button>
          ))}
        </div>
      )}

      {q.isError && <div className="mt-6"><FetchError what="the vault list" onRetry={() => q.refetch()} /></div>}

      {shown.length === 0 ? (
        <div className="mt-6 rounded-lg bg-canvas p-6">
          <p className="font-semibold">No vault matches{query.trim() ? ` "${query.trim()}"` : ""}{tier !== "all" ? ` in the ${tier} pool tier` : ""}.</p>
          <button type="button" className="mt-2 text-sm font-semibold underline underline-offset-4" onClick={() => { setQuery(""); setTier("all"); }}>
            Show all {VAULTS.length} vaults
          </button>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-sage-line border-y border-sage-line">
          {shown.map((v) => <Row key={v.id} cfg={v} stats={stats.get(v.id)} pending={q.isPending} />)}
        </ul>
      )}
    </div>
  );
}
