"use client";

import { FetchError, Skeleton } from "./status";
import { useEvidence, type Evidence, type SessionKey } from "@/lib/evidence";
import { pct, signed } from "@/lib/format";

const SESSIONS: { key: SessionKey; label: string; compact: string }[] = [
  { key: "regular", label: "NYSE hours", compact: "in NYSE hours" },
  { key: "night", label: "Weeknights", compact: "on weeknights" },
  { key: "weekend", label: "Weekends", compact: "on weekends" },
];

const tier = (bps100: number) => `${(bps100 / 10_000).toFixed(2)}%`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dollars = (n: number) => `$${n.toFixed(2)}`;
const count = (n: number) => new Intl.NumberFormat("en-US").format(n);

function Bars({ e }: { e: Evidence }) {
  const max = Math.max(...e.pools.map((p) => p.feeAprPct));
  return (
    <ul className="mt-3 space-y-2">
      {e.pools.map((p) => {
        const chosen = p.pool === e.chosenPool;
        return (
          <li key={p.pool} className="grid grid-cols-[8rem_1fr_4rem] items-center gap-3 text-sm">
            <span className={chosen ? "font-semibold text-ink" : "text-body"}>{p.label} pool</span>
            <span className="h-3 rounded-full bg-sage" aria-hidden>
              <span className={`block h-3 rounded-full ${chosen ? "bg-primary" : "bg-mute"}`} style={{ width: `${Math.max(2, (p.feeAprPct / max) * 100)}%` }} />
            </span>
            <span className="figure text-right font-medium text-ink">{pct(p.feeAprPct)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Kept({ e }: { e: Evidence }) {
  const rows: [string, string][] = [
    ["Fees earned", pct(e.keep.feeAprPct)],
    ["Lost to informed traders (1h markout)", `-${pct(e.keep.markoutAprPct)}`],
    ["Rebalancing cost", `-${pct(e.keep.costAprPct)}`],
    ["Kept (30 days)", signed(e.keep.keptAprPct)],
    ["Kept (held-out 15 days)", signed(e.keep.keptSecondHalf)],
  ];
  return (
    <dl className="mt-3 divide-y divide-sage-line border-y border-sage-line">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-body">{k}</dt>
          <dd className="figure font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Sessions({ e }: { e: Evidence }) {
  return (
    <dl className="mt-3 divide-y divide-sage-line border-y border-sage-line">
      {SESSIONS.map((s) => (
        <div key={s.key} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-body">{s.label}</dt>
          <dd className="figure font-medium text-ink">{dollars(e.feePerLoss[s.key])}</dd>
        </div>
      ))}
    </dl>
  );
}

const Foot = ({ e }: { e: Evidence }) => (
  <p className="mt-3 text-sm text-body">
    <span className="figure font-medium text-ink">{count(e.swapsReplayed)}</span> swaps replayed, {day(e.windowStart)} to {day(e.windowEnd)}.
  </p>
);

export const FEE_CAP_LINE = "Uptick only deposits into pools without fee-taking hooks or with a declared on-chain cap.";

/** Why the vault sits in its pool: fee APR per pool and tier, and fee earned per dollar lost to informed traders by session. */
export function WhyThisPool({ id, symbol, compact = false }: { id: string; symbol: string; compact?: boolean }) {
  const q = useEvidence(id);
  if (q.isError) return <div className={compact ? "mt-6" : "mt-4"}><FetchError what={`${symbol} evidence`} onRetry={() => q.refetch()} /></div>;
  if (q.isPending) return <Skeleton className={compact ? "mt-6 h-32 w-full" : "mt-4 h-64 w-full"} />;
  const e = q.data;
  if (!e) return null;

  if (compact) {
    return (
      <div className="mt-6 border-t border-sage-line pt-4" aria-label="Why this pool">
        <p className="text-sm font-semibold text-ink">Why the {tier(e.chosenFeeTier)} pool</p>
        <Bars e={e} />
        <p className="mt-3 text-sm text-body">
          Fees per dollar lost to informed traders:{" "}
          {SESSIONS.map((s, i) => (
            <span key={s.key}>{i > 0 && ", "}<span className="figure font-medium text-ink">{dollars(e.feePerLoss[s.key])}</span> {s.compact}</span>
          ))}.
        </p>
        <Foot e={e} />
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl bg-canvas p-5 sm:p-6" aria-label="Why this pool">
      <p className="text-lg font-semibold text-ink">
        {symbol} / USDG at the <span className="figure">{tier(e.chosenFeeTier)}</span> fee tier
      </p>
      <div className="mt-5 grid gap-8 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-body" style={{ fontFamily: "var(--font-sans)", fontStretch: "100%", letterSpacing: "0.08em" }}>Fee APR by pool</h3>
          <Bars e={e} />
        </div>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-body" style={{ fontFamily: "var(--font-sans)", fontStretch: "100%", letterSpacing: "0.08em" }}>Fees earned per $1 lost to informed traders</h3>
          <Sessions e={e} />
        </div>
      </div>
      <div className="mt-8">
        <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-body" style={{ fontFamily: "var(--font-sans)", fontStretch: "100%", letterSpacing: "0.08em" }}>What LPs keep, annualised</h3>
        <Kept e={e} />
        <p className={`mt-3 text-sm ${e.gate.state === "closed" ? "text-negative-deep" : e.gate.state === "reduced" ? "text-warning-deep" : "text-body"}`}>{e.gate.reason}</p>
      </div>
      <Foot e={e} />
      <p className="mt-2 text-sm text-body">{FEE_CAP_LINE}</p>
    </div>
  );
}
