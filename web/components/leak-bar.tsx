import { SectionTitle } from "./ledger";
import { leakBar } from "@/lib/leak";
import { pct, signed } from "@/lib/format";
import { REPLAY_WINDOW, isoDay, type VaultConfig } from "@/lib/vaults";

const TONE = {
  kept: { bar: "bg-kept text-canvas", swatch: "bg-kept", name: "Kept over the full 30 days", text: "What stays with depositors after both losses, over the whole window." },
  cost: { bar: "bg-loss-dim text-loss", swatch: "bg-loss-dim ring-1 ring-loss", name: "Recentring cost", text: "The reposition at 02:00 UTC after each NYSE session." },
  markout: { bar: "bg-loss text-canvas", swatch: "bg-loss", name: "Lost to informed traders", text: "Trades from people who knew the price was about to move." },
} as const;

/** One year of the pool's fees drawn to a single scale: what stayed, what recentring cost, what informed traders took. */
export function LeakFigure({ cfg }: { cfg: VaultConfig }) {
  const { feeApr, markoutApr, costApr, keptApr } = cfg.keep;
  const bar = leakBar({ feeApr, markoutApr, costApr, keptApr });
  const value = { kept: keptApr, cost: costApr, markout: markoutApr };
  return (
    <section aria-labelledby="leak">
      <SectionTitle id="leak" aside={<>{REPLAY_WINDOW.days} days to {isoDay(REPLAY_WINDOW.end)}</>}>Where a year of fees goes</SectionTitle>
      <div className="mt-6 flex items-baseline justify-between gap-4 text-[13px] text-mute">
        <span>Fees the pool paid, a year</span>
        <span className="figure text-[17px] font-medium text-fg">{signed(feeApr)}</span>
      </div>
      <div className="relative mt-3">
        <div
          className="flex h-14 w-full overflow-hidden rounded-sm"
          role="img"
          aria-label={`Of ${pct(feeApr)} a year in fees, ${pct(markoutApr)} went to informed traders, ${pct(costApr)} to recentring, and ${signed(keptApr)} was kept over the 30 days.`}
        >
          {bar.segments.map((s) => (
            <div
              key={s.key}
              aria-label={s.key === "cost" ? `Recentring cost ${pct(s.value)}` : undefined}
              className={`flex items-center overflow-hidden whitespace-nowrap px-3 text-[15px] font-semibold ${TONE[s.key].bar}`}
              style={{ width: `${s.widthPct}%` }}
            >
              {s.widthPct >= 9
                ? s.key === "markout"
                  ? signed(-s.value)
                  : s.key === "cost"
                    ? s.widthPct >= 18
                      ? <>Recentring {pct(s.value)}</>
                      : pct(s.value)
                    : signed(s.value)
                : null}
            </div>
          ))}
        </div>
        {bar.overdrawn ? (
          <>
            <span className="absolute -top-1 bottom-[-4px] w-0.5 bg-fg" style={{ left: `${bar.feesEndPct}%` }} aria-hidden />
            <span className="absolute -bottom-6 -translate-x-1/2 whitespace-nowrap text-[13px] text-fg" style={{ left: `${Math.min(Math.max(bar.feesEndPct, 12), 88)}%` }}>Fees end here</span>
          </>
        ) : null}
      </div>
      <div className={`grid gap-x-10 gap-y-3 text-[13px] leading-5 sm:grid-cols-3 ${bar.overdrawn ? "mt-10" : "mt-4"}`}>
        {(["kept", "cost", "markout"] as const).map((k) => (
          <div key={k}>
            <span className={`mr-2 inline-block size-2.5 rounded-[2px] ${k === "kept" ? (keptApr >= 0 ? "bg-kept" : "bg-loss") : TONE[k].swatch}`} aria-hidden />
            <span className="font-medium">{TONE[k].name}</span>
            <span className="figure ml-2 text-mute">{k === "kept" ? signed(value[k]) : pct(value[k])}</span>
            <div className="pl-[18px] text-mute">{TONE[k].text}</div>
          </div>
        ))}
      </div>
      <p className="mt-5 max-w-[690px] text-[13px] leading-5 text-mute">
        Kept is earned on top of your {cfg.symbol}: you keep the stock&rsquo;s price moves either way, and the vault adds what the pool pays after these losses.
      </p>
    </section>
  );
}
