"use client";

import type { Keep } from "@/lib/evidence";
import { pct, signed } from "@/lib/format";
import { buildOutcomeRows } from "@/lib/outcome";
import { cn } from "@/lib/utils";

const barTone = (tone: string, value: number) => {
  if (tone === "lose" || value < 0) return "bg-negative";
  if (tone === "total") return "bg-ink";
  return "bg-primary";
};

/** The keeper's 30-day replay as one waterfall: fees, the two costs, and what a depositor keeps. */
export function NetOutcome({ keep, symbol }: { keep?: Keep | null; symbol: string }) {
  if (!keep) return null;
  const rows = buildOutcomeRows(keep);

  return (
    <section aria-labelledby="net-outcome" className="rounded-xl bg-canvas p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="net-outcome" className="text-2xl leading-none">What you keep</h2>
        <p className="text-sm text-body">30-day replay, annualised.</p>
      </div>
      <p className="mt-2 max-w-xl text-sm text-body">Every dollar the pool pays in fees, less the two costs the replay prices.</p>

      <ul className="mt-5 space-y-3">
        {rows.map((r) => (
          <li
            key={r.key}
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5 sm:grid-cols-[15rem_minmax(0,1fr)_5.5rem]",
              r.key === "kept" && "border-t border-sage-line pt-4",
            )}
          >
            <span className={cn("text-body", r.key === "kept" && "font-semibold text-ink")}>{r.label}</span>
            <span className={cn("figure text-right text-base font-medium sm:order-3", r.value < 0 ? "text-negative-deep" : "text-ink", r.key === "kept" && "font-semibold")}>
              {signed(r.value)}
            </span>
            <span className="col-span-2 h-2 rounded-full bg-sage sm:order-2 sm:col-span-1" aria-hidden>
              <span className={cn("block h-2 rounded-full", barTone(r.tone, r.value))} style={{ width: `${r.widthPct}%` }} />
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-5 rounded-lg bg-sage p-4">
        <dl className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-body">Holding {symbol} idle</dt>
            <dd className="figure text-sm font-medium text-ink">{pct(0, 0)} extra</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-body">This vault, held-out half</dt>
            <dd className={cn("figure text-sm font-medium", keep.keptSecondHalf < 0 ? "text-negative-deep" : "text-positive-deep")}>{signed(keep.keptSecondHalf)}</dd>
          </div>
        </dl>
      </div>

      <p className="mt-4 max-w-xl text-sm text-body">
        Kept APR is earned on top of your {symbol} exposure: you keep the stock&rsquo;s price moves either way, the vault adds what the pool pays after losses.
      </p>
    </section>
  );
}
