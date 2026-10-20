import Link from "next/link";
import { Header, Kept, PrimaryPill, StateChip } from "../parts";
import { COUNTS, EVIDENCE_WINDOW, NVDA_EVIDENCE, VAULTS, bySymbol, keep } from "../lab-data";
import { pct, shortAddress, signed } from "@/lib/format";

export const metadata = { title: "Uptick lab B: leak bar and docked ticket" };

const AXIS = { min: -120, max: 10 };
const x = (n: number) => `${((n - AXIS.min) / (AXIS.max - AXIS.min)) * 100}%`;
const RAIL = { min: -40, max: 20 };
const rx = (n: number) => `${((n - RAIL.min) / (RAIL.max - RAIL.min)) * 100}%`;

export default function LabB() {
  const nvda = bySymbol("nvda");
  const e = NVDA_EVIDENCE;
  const lost = COUNTS.total - COUNTS.keepsMoney;
  const keptShare = (e.keptAprPct / e.feeAprPct) * 100;
  const costShare = (e.costAprPct / e.feeAprPct) * 100;
  const lossShare = (e.informedLossAprPct / e.feeAprPct) * 100;
  return (
    <>
      <Header />
      <div className="border-b border-(--lab-hairline) py-2 text-center text-[13px] text-(--lab-mute)">Lab B, the leak drawn to scale with a docked ticket. Home first screen, then vault first screen.</div>

      {/* HOME */}
      <section className="mx-auto max-w-[1280px] px-6 pb-20 pt-14">
        <h1 className="serif verdict max-w-[900px] text-[30px] leading-[34px] sm:text-[44px] sm:leading-[48px]">
          {lost} of {COUNTS.total} stock tokens lost their holders money in at least one half of the last {nvda.gate.days} days. {COUNTS.keepsMoney} did not.
        </h1>
        <p className="mt-5 max-w-[640px] text-(--lab-mute)">Each bar is what a holder kept a year in the weaker half of the last 30 days. A vault is open at zero or above, capped between zero and the floor, and closed below the floor.</p>

        <div className="mt-12">
          <div className="grid grid-cols-[52px_minmax(0,1fr)_60px_72px] items-end gap-x-3 pb-2 text-[13px] text-(--lab-mute) sm:grid-cols-[72px_minmax(0,1fr)_72px_84px] sm:gap-x-5">
            <span />
            <div className="relative h-5">
              <span className="absolute -translate-x-1/2" style={{ left: x(-100) }}>-100%</span>
              <span className="absolute -translate-x-1/2" style={{ left: x(-50) }}>-50%</span>
              <span className="absolute -translate-x-full" style={{ left: x(0) }}>0</span>
            </div>
            <span className="text-right">You keep</span>
            <span className="text-right">Deposits</span>
          </div>
          <div className="border-t border-(--lab-hairline)">
            {VAULTS.map((v) => (
              <Link key={v.id} href={`/vault/${v.id}`} className="row grid h-10 grid-cols-[52px_minmax(0,1fr)_60px_72px] items-center gap-x-3 border-b border-(--lab-hairline) sm:grid-cols-[72px_minmax(0,1fr)_72px_84px] sm:gap-x-5">
                <span className="font-semibold">{v.symbol}</span>
                <span className="relative h-full">
                  <span className="absolute inset-y-0 w-px bg-(--lab-border)" style={{ left: x(0) }} />
                  <span className="absolute inset-y-0 w-px border-l border-dashed border-(--lab-closed)" style={{ left: x(-20) }} />
                  <span
                    className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-[2px] ${keep(v) >= 0 ? "bg-(--lab-kept)" : "bg-(--lab-loss)"}`}
                    style={keep(v) >= 0 ? { left: x(0), width: `max(3px, ${((keep(v)) / (AXIS.max - AXIS.min)) * 100}%)` } : { left: x(keep(v)), width: `calc(${x(0)} - ${x(keep(v))})` }}
                  />
                </span>
                <span className="text-right font-semibold"><Kept value={keep(v)} /></span>
                <span className="flex justify-end"><StateChip state={v.gate.state as "open" | "reduced" | "closed"} /></span>
              </Link>
            ))}
          </div>
          <div className="relative mt-3 hidden h-5 text-[13px] text-(--lab-mute) sm:grid sm:grid-cols-[72px_minmax(0,1fr)_72px_84px] sm:gap-x-5">
            <span />
            <span className="relative"><span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: x(-20) }}>Floor -20%, closed below</span></span>
          </div>
        </div>
      </section>

      {/* VAULT */}
      <div className="border-y border-(--lab-hairline) bg-(--lab-panel) py-2 text-center text-[13px] text-(--lab-mute)">Vault page /vault/nvda</div>
      <section className="mx-auto max-w-[1280px] px-6 pb-4 pt-10">
        <div className="text-[13px] text-(--lab-mute)">Vaults / {nvda.symbol}</div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <h2 className="text-[32px] font-medium leading-10 tracking-[-0.33px]">{nvda.symbol} vault</h2>
          <StateChip state="open" />
          <span className="text-(--lab-mute)">{nvda.name} in the {nvda.symbol} / USDG pool, {nvda.feeTier} fee tier</span>
        </div>
        <p className="serif verdict mt-9 max-w-[900px] text-[30px] leading-[34px] sm:text-[44px] sm:leading-[48px]">
          Of the {pct(e.feeAprPct)} a year this pool paid, {pct(e.informedLossAprPct)} went to informed traders and {pct(e.keptAprPct)} stayed. Deposits are open.
        </p>

        <div className="mt-12">
          <div className="flex items-baseline justify-between text-[13px] text-(--lab-mute)">
            <span>Fees earned, a year, over the last {e.days} days</span><span className="text-(--lab-text)">{signed(e.feeAprPct)}</span>
          </div>
          <div className="mt-3 flex h-14 w-full overflow-hidden rounded-sm">
            <div className="flex items-center bg-(--lab-kept) px-3 text-[15px] font-semibold text-(--lab-canvas)" style={{ width: `${keptShare}%` }}>{signed(e.keptAprPct)}</div>
            <div className="flex items-center justify-center bg-(--lab-loss-dim) text-[13px] font-medium text-(--lab-loss)" style={{ width: `${costShare}%` }}><span className="hidden sm:inline">{pct(e.costAprPct)}</span></div>
            <div className="flex items-center bg-(--lab-loss) px-3 text-[15px] font-semibold text-(--lab-canvas)" style={{ width: `${lossShare}%` }}>{signed(-e.informedLossAprPct)}</div>
          </div>
          <div className="mt-4 grid gap-x-10 gap-y-3 text-[13px] leading-5 sm:grid-cols-3">
            <div><span className="mr-2 inline-block size-2.5 rounded-[2px] bg-(--lab-kept)" /><span className="font-medium text-(--lab-text)">Kept</span><div className="pl-[18px] text-(--lab-mute)">What stays with depositors after both losses.</div></div>
            <div><span className="mr-2 inline-block size-2.5 rounded-[2px] bg-(--lab-loss-dim) ring-1 ring-(--lab-loss)" /><span className="font-medium text-(--lab-text)">Cost of recentring</span><div className="pl-[18px] text-(--lab-mute)">The 02:00 UTC reposition after each NYSE session.</div></div>
            <div><span className="mr-2 inline-block size-2.5 rounded-[2px] bg-(--lab-loss)" /><span className="font-medium text-(--lab-text)">Lost to informed traders</span><div className="pl-[18px] text-(--lab-mute)">Trades from people who knew the price was about to move.</div></div>
          </div>
        </div>

        <div className="mt-14 border-t border-(--lab-hairline) pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1">
            <h3 className="text-[24px] font-semibold leading-8 tracking-[-0.2px]">Why it is open</h3>
            <span className="text-[13px] text-(--lab-mute)">{nvda.gate.swaps.toLocaleString("en-US")} swaps replayed, {EVIDENCE_WINDOW.start.slice(0, 10)} to {EVIDENCE_WINDOW.end.slice(0, 10)}</span>
          </div>
          <div className="relative mt-10 h-16">
            <div className="absolute inset-x-0 top-6 flex h-8 overflow-hidden rounded-sm text-[13px]">
              <div className="bg-(--lab-hairline)" style={{ width: rx(-20) }} />
              <div className="bg-(--lab-caution-dim)" style={{ width: `calc(${rx(0)} - ${rx(-20)})` }} />
              <div className="bg-(--lab-kept-dim)" style={{ width: `calc(100% - ${rx(0)})` }} />
            </div>
            <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[13px] text-(--lab-text)" style={{ left: rx(e.keptSecondHalf) }}>Weaker half {signed(e.keptSecondHalf)}</span>
            <span className="absolute top-[22px] h-12 w-0.5 -translate-x-1/2 bg-(--lab-text)" style={{ left: rx(e.keptSecondHalf) }} />
            <span className="absolute top-[34px] size-3 -translate-x-1/2 rounded-full border-2 border-(--lab-text) bg-(--lab-canvas)" style={{ left: rx(e.keptFirstHalf) }} />
          </div>
          <div className="mt-2 flex text-[13px] font-medium">
            <span className="text-center text-(--lab-mute)" style={{ width: rx(-20) }}>Closed</span>
            <span className="text-center text-(--lab-caution)" style={{ width: `calc(${rx(0)} - ${rx(-20)})` }}>Reduced</span>
            <span className="text-center text-(--lab-kept)" style={{ width: `calc(100% - ${rx(0)})` }}>Open</span>
          </div>
          <div className="mt-1 flex justify-between text-[13px] text-(--lab-mute)">
            <span>-40%</span><span>Floor -20%</span><span>0, break-even</span><span>+20%</span>
          </div>
          <p className="mt-5 max-w-[680px] text-(--lab-mute)">{nvda.gate.reason} The first half kept {signed(e.keptFirstHalf)}.</p>
          <p className="mt-6 text-[13px] text-(--lab-mute)">Pool {shortAddress(nvda.pool)} · Stock Token {shortAddress(nvda.token)} · Robinhood Chain 4663</p>
        </div>

      </section>
    <div className="sticky bottom-0 mt-14 border-t border-(--lab-border) bg-(--lab-panel) px-6 py-4">
      <div className="mx-auto flex max-w-[1232px] flex-wrap items-center gap-x-8 gap-y-3">
        <span className="hidden text-[15px] font-semibold sm:block">Deposit {nvda.symbol}</span>
        <div className="flex h-12 min-w-[180px] flex-1 items-center justify-between rounded-sm border border-(--lab-border) px-3.5 sm:max-w-[280px]"><span className="text-(--lab-mute)">0.0</span><span>{nvda.symbol}</span></div>
        <div className="hidden text-[13px] leading-5 md:block"><div className="text-(--lab-mute)">You receive</div><div>Vault shares</div></div>
        <div className="hidden text-[13px] leading-5 md:block"><div className="text-(--lab-mute)">Per-deposit limit</div><div>None while open</div></div>
        <PrimaryPill className="ml-auto">Connect wallet</PrimaryPill>
      </div>
    </div>
    </>
  );
}
