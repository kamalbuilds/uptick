"use client";

import { useEffect, useRef, useState } from "react";
import { usd } from "@/lib/format";
import type { PriceChart } from "@/lib/keeper";

const DAY = 86400;
const dayLabel = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const stamp = (t: number) => new Date(t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Round price ticks (1, 2, 2.5, 5 times a power of ten) inside [min, max]. */
function niceTicks(min: number, max: number, want: number): number[] {
  const raw = (max - min) / want, mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(+v.toFixed(6));
  return out;
}

const bandAt = (c: PriceChart, t: number) => c.bands.find((b) => t >= b.from && t < b.to) ?? c.bands[c.bands.length - 1];

/** The pool price against the strategy band: the band steps to the oracle price at 02:00 UTC after each NYSE session, the line is the pool price. */
export function BandChart({ symbol, chart, compact = false }: { symbol: string; chart: PriceChart; compact?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = compact ? 96 : width < 520 ? 240 : 320;
  const padR = compact ? 8 : 64, padB = compact ? 4 : 28, padT = 10, padL = 4;
  const t0 = chart.history[0].t, t1 = chart.history[chart.history.length - 1].t;

  const lo = Math.min(...chart.history.map((p) => p.price), ...chart.bands.map((b) => b.lower));
  const hi = Math.max(...chart.history.map((p) => p.price), ...chart.bands.map((b) => b.upper));
  const pad = (hi - lo) * 0.06;
  const x = (t: number) => padL + ((t - t0) / (t1 - t0)) * Math.max(1, width - padL - padR);
  const y = (p: number) => padT + (1 - (p - (lo - pad)) / (hi - lo + 2 * pad)) * (H - padT - padB);
  const pt = (p: { t: number; price: number }) => `${x(p.t).toFixed(1)} ${y(p.price).toFixed(1)}`;

  const line = chart.history.map((p, i) => `${i ? "L" : "M"}${pt(p)}`).join("");
  const outRuns: string[] = [];
  let run: string[] = [];
  chart.history.forEach((p, i) => {
    const b = bandAt(chart, p.t);
    if (p.price < b.lower || p.price > b.upper) {
      if (!run.length && i > 0) run.push(`M${pt(chart.history[i - 1])}`);
      run.push(`${run.length ? "L" : "M"}${pt(p)}`);
    } else if (run.length) { run.push(`L${pt(p)}`); outRuns.push(run.join("")); run = []; }
  });
  if (run.length) outRuns.push(run.join(""));

  const ticks = niceTicks(lo - pad, hi + pad, 4);
  const every = width < 520 ? 3 : 2;
  const dayTicks: number[] = [];
  for (let t = Math.ceil(t0 / DAY) * DAY, i = 0; t < t1 - DAY / 2; t += DAY, i++) if (i % every === 0) dayTicks.push(t);

  const last = chart.history[chart.history.length - 1];
  const hp = hover === null ? null : chart.history.reduce((a, p) => (Math.abs(p.t - hover) < Math.abs(a.t - hover) ? p : a));
  const hb = hp ? bandAt(chart, hp.t) : null;
  const label = `${symbol} pool price over ${Math.round((t1 - t0) / DAY)} days against the strategy band. Now ${usd(chart.poolUsd)}, ${
    chart.band ? `${chart.inBand ? "inside" : "outside"} the band of ${usd(chart.band.lower)} to ${usd(chart.band.upper)}` : "band unavailable"}.`;

  return (
    <div>
      <div ref={ref} className="relative select-none" style={{ height: H, touchAction: "pan-y" }} data-chart-points={chart.history.length} data-chart-bands={chart.bands.length}>
        {width > 0 && (
          <svg
            width={width} height={H} role="img" aria-label={label} className="block overflow-visible"
            onPointerMove={compact ? undefined : (e) => setHover(t0 + ((e.clientX - e.currentTarget.getBoundingClientRect().left - padL) / Math.max(1, width - padL - padR)) * (t1 - t0))}
            onPointerLeave={() => setHover(null)}
          >
            {!compact && ticks.map((p) => (
              <line key={p} x1={padL} x2={width - padR} y1={y(p)} y2={y(p)} stroke="var(--color-hairline)" strokeWidth={1} />
            ))}
            {chart.bands.map((b) => {
              const a = Math.max(x(b.from), padL), z = x(Math.min(b.to, t1));
              return (
                <g key={b.from}>
                  <rect x={a} y={y(b.upper)} width={Math.max(0, z - a)} height={y(b.lower) - y(b.upper)} fill="var(--color-raised)" />
                  <line x1={a} x2={z} y1={y(b.upper)} y2={y(b.upper)} stroke="var(--color-line)" strokeWidth={1.5} />
                  <line x1={a} x2={z} y1={y(b.lower)} y2={y(b.lower)} stroke="var(--color-line)" strokeWidth={1.5} />
                </g>
              );
            })}
            {!compact && ticks.map((p) => (
              <text key={p} x={width - padR + 8} y={y(p) + 4} fontSize={12} fill="var(--color-mute)">{usd(p)}</text>
            ))}
            {!compact && dayTicks.map((t) => (
              <text key={t} x={x(t)} y={H - 6} fontSize={12} textAnchor="middle" fill="var(--color-mute)">{dayLabel(t)}</text>
            ))}
            <path d={line} className="draw" pathLength={1000} style={{ ["--len" as string]: 1000 }} fill="none" stroke="var(--color-fg)" strokeWidth={compact ? 1.75 : 2} strokeLinejoin="round" strokeLinecap="round" />
            {outRuns.map((d) => <path key={d} d={d} fill="none" stroke="var(--color-caution)" strokeWidth={compact ? 2.25 : 2.5} strokeLinejoin="round" strokeLinecap="round" />)}
            <circle cx={x(last.t)} cy={y(last.price)} r={compact ? 4.5 : 6} fill="var(--color-fg)" stroke="var(--color-canvas)" strokeWidth={2} />
            {hp && hb && (
              <g pointerEvents="none">
                <line x1={x(hp.t)} x2={x(hp.t)} y1={padT} y2={H - padB} stroke="var(--color-fg)" strokeWidth={1} strokeDasharray="3 3" />
                <circle cx={x(hp.t)} cy={y(hp.price)} r={4.5} fill="var(--color-canvas)" stroke="var(--color-fg)" strokeWidth={2} />
              </g>
            )}
          </svg>
        )}
        {hp && hb && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-40 rounded-lg border border-line bg-raised px-3 py-2 text-xs text-mute"
            style={{ left: Math.min(Math.max(x(hp.t) - 80, 0), Math.max(0, width - 168)) }}
          >
            <p>{stamp(hp.t)}</p>
            <p className="figure mt-0.5 text-sm text-fg">{usd(hp.price)}</p>
            <p className="figure mt-0.5">Band {usd(hb.lower)} to {usd(hb.upper)}</p>
          </div>
        )}
      </div>
      {!compact && (
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-mute">
          <li className="flex items-center gap-2"><span className="h-0.5 w-5 bg-fg" aria-hidden />Pool price</li>
          <li className="flex items-center gap-2"><span className="h-3.5 w-5 rounded-[3px] border-y-[1.5px] border-line bg-raised" aria-hidden />Band, {chart.bandPct}% around the Chainlink price, re-centred at 02:00 UTC after each NYSE session</li>
          <li className="flex items-center gap-2"><span className="h-0.5 w-5 bg-caution" aria-hidden />Outside the band</li>
        </ul>
      )}
    </div>
  );
}

/** Where the price sits against today's band. */
export function BandReadout({ chart }: { chart: PriceChart }) {
  const b = chart.band;
  if (!b) return null;
  const room = Math.min(chart.poolUsd - b.lower, b.upper - chart.poolUsd) / chart.poolUsd * 100;
  const rows: [string, string][] = [
    ["Pool price", usd(chart.poolUsd)],
    ["Chainlink price", usd(chart.chainlinkUsd)],
    ["Band today", `${usd(b.lower)} to ${usd(b.upper)}`],
    chart.inBand ? ["Room to the nearest edge", `${room.toFixed(1)}%`] : ["Position", "Outside the band"],
  ];
  return (
    <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[13px] text-mute">{k}</dt>
          <dd className="figure mt-0.5 text-[17px] font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
