"use client";

import { FetchError, Skeleton } from "./status";
import { useEvidence, type Evidence, type SessionKey } from "@/lib/evidence";
import { pct } from "@/lib/format";

const SESSIONS: { key: SessionKey; label: string }[] = [
  { key: "regular", label: "NYSE hours" },
  { key: "night", label: "Weeknights" },
  { key: "weekend", label: "Weekends" },
];

const tier = (bps100: number) => `${(bps100 / 10_000).toFixed(2)}%`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dollars = (n: number) => `$${n.toFixed(2)}`;
const count = (n: number) => new Intl.NumberFormat("en-US").format(n);

/** Fee APR for each pool the token trades in. The chosen pool is the one filled bar; the rest are outlined. */
function Bars({ e }: { e: Evidence }) {
  const max = Math.max(...e.pools.map((p) => p.feeAprPct));
  return (
    <ul className="mt-3 space-y-2.5">
      {e.pools.map((p) => {
        const chosen = p.pool === e.chosenPool;
        return (
          <li key={p.pool} className="grid grid-cols-[7.5rem_minmax(0,1fr)_4rem] items-center gap-3">
            <span className={chosen ? "font-semibold" : "text-mute"}>{p.label} pool</span>
            <span className="h-2" aria-hidden>
              <span className={`block h-2 rounded-[2px] ${chosen ? "bg-fg" : "bg-line"}`} style={{ width: `${Math.max(2, (p.feeAprPct / max) * 100)}%` }} />
            </span>
            <span className="figure text-right font-medium">{pct(p.feeAprPct)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Sessions({ e }: { e: Evidence }) {
  return (
    <dl className="mt-3 border-t border-hairline">
      {SESSIONS.map((s) => (
        <div key={s.key} className="flex items-baseline justify-between gap-4 border-b border-hairline py-2.5">
          <dt className="text-mute">{s.label}</dt>
          <dd className="figure font-medium">{dollars(e.feePerLoss[s.key])}</dd>
        </div>
      ))}
    </dl>
  );
}

export const FEE_CAP_LINE = "Uptick only deposits into pools without fee-taking hooks or with a declared on-chain cap.";

/** Why the vault sits in its pool: fee APR per pool and tier, and fee earned per dollar lost to informed traders by session. */
export function WhyThisPool({ id, symbol }: { id: string; symbol: string }) {
  const q = useEvidence(id);
  if (q.isError) return <div className="mt-4"><FetchError what={`${symbol} evidence`} onRetry={() => q.refetch()} /></div>;
  if (q.isPending) return <Skeleton className="mt-4 h-48 w-full" />;
  const e = q.data;
  if (!e) return null;

  return (
    <div className="pt-5" aria-label="Why this pool">
      <p className="text-[17px] font-semibold">
        {symbol} / USDG at the <span className="figure">{tier(e.chosenFeeTier)}</span> fee tier
      </p>
      <div className="mt-6 grid gap-x-16 gap-y-8 md:grid-cols-2">
        <div>
          <h3 className="text-[15px] font-semibold">Fee APR by pool</h3>
          <Bars e={e} />
        </div>
        <div>
          <h3 className="text-[15px] font-semibold">Fees earned per $1 lost to informed traders</h3>
          <Sessions e={e} />
        </div>
      </div>
      <p className="mt-6 text-[13px] leading-5 text-mute">
        <span className="figure font-medium text-fg">{count(e.swapsReplayed)}</span> swaps replayed, {day(e.windowStart)} to {day(e.windowEnd)}. {FEE_CAP_LINE}
      </p>
    </div>
  );
}
