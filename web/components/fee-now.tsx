"use client";

import { useEffect, useState } from "react";
import { SESSION_LABEL, MAX_FEE_BPS, feeBps, nextChange, sessionAt, type Session } from "@/lib/session";

const ROWS: Session[] = ["Regular", "OffHours", "Weekend"];

function countdown(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const hms = [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  return d > 0 ? `${d}d ${hms}` : hms;
}

/** The fee the Uptick hook charges this pool right now, from the same session rules the hook runs. */
export function FeeNow({ compact = false }: { compact?: boolean }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const s = sessionAt(now);
  const next = nextChange(now);

  return (
    <div className={compact ? "mt-6 border-t border-sage-line pt-4" : "rounded-xl bg-canvas p-5 sm:p-6"} aria-label="Fee right now">
      <p className="text-sm font-semibold uppercase tracking-[0.08em] text-body">Fee right now</p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-3" suppressHydrationWarning>
        <span className="display text-5xl text-ink">{feeBps(s)} bps</span>
        <span className="text-lg font-semibold text-body">{SESSION_LABEL[s]}</span>
      </p>
      <p className="mt-1 text-sm text-body" suppressHydrationWarning>
        {SESSION_LABEL[next.to]} fee starts in <span className="figure font-medium text-ink">{countdown(next.at - now)}</span>
      </p>

      <table className="mt-4 w-full text-sm">
        <caption className="pb-1 text-left font-semibold text-ink">Same trade, three sessions</caption>
        <tbody className="divide-y divide-sage-line border-y border-sage-line">
          {ROWS.map((r) => (
            <tr key={r} className={r === s ? "bg-primary-pale" : undefined} suppressHydrationWarning>
              <th scope="row" className="py-2 pl-2 text-left font-normal text-body">{SESSION_LABEL[r]}</th>
              <td className="figure py-2 pr-2 text-right font-medium text-ink">{feeBps(r)} bps</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-sm text-body">
        Fee cap: an Uptick pool can never charge more than <strong className="font-semibold text-ink">{MAX_FEE_BPS} bps</strong>; enforced inside every swap.
      </p>
    </div>
  );
}
