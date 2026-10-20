import Link from "next/link";
import { Header, Kept, PrimaryPill, StateChip } from "../parts";
import { COUNTS, EVIDENCE_WINDOW, NVDA_EVIDENCE, REPLAYED_SWAPS, VAULTS, bySymbol, keep } from "../lab-data";
import { pct, shortAddress, signed, swapsLabel, usd } from "@/lib/format";

export const metadata = { title: "Uptick lab C: three doors and a memo" };

const GROUPS = [
  { state: "open", title: "Open", note: "No limit on a single deposit." },
  { state: "reduced", title: "Reduced", note: "A single deposit may add up to $25,000 of stock token." },
  { state: "closed", title: "Closed", note: "The weaker half kept less than the floor." },
] as const;

export default function LabC() {
  const nvda = bySymbol("nvda");
  const e = NVDA_EVIDENCE;
  return (
    <>
      <Header />
      <div className="border-b border-(--lab-hairline) py-2 text-center text-[13px] text-(--lab-mute)">Lab C, three doors and a memo. Home first screen, then vault first screen.</div>

      {/* HOME */}
      <section className="mx-auto grid max-w-[1280px] gap-x-16 gap-y-10 px-6 pb-20 pt-14 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <h1 className="serif verdict text-[30px] leading-[34px] sm:text-[40px] sm:leading-[44px]">Which of your stock tokens can earn, and how much you would keep.</h1>
          <p className="mt-5 text-(--lab-mute)">Every vault sits behind one of three doors, set by {swapsLabel(REPLAYED_SWAPS)} replayed swaps from Robinhood Chain. {COUNTS.open} are open, {COUNTS.reduced} are capped, {COUNTS.closed} are closed.</p>
          <PrimaryPill className="mt-8 w-full sm:w-auto">Connect wallet to find yours</PrimaryPill>
        </div>

        <div className="space-y-12">
          {GROUPS.map((g) => {
            const rows = VAULTS.filter((v) => v.gate.state === g.state);
            return (
              <div key={g.state}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-(--lab-hairline) pb-3">
                  <h2 className="text-[24px] font-semibold leading-8 tracking-[-0.2px]">{g.title}</h2>
                  <span className="text-(--lab-mute)">{rows.length}</span>
                  <span className="text-[13px] text-(--lab-mute) sm:ml-auto">{g.note}</span>
                </div>
                {rows.map((v) =>
                  g.state === "closed" ? (
                    <Link key={v.id} href={`/vault/${v.id}`} className="row grid min-h-11 grid-cols-[56px_minmax(0,1fr)_72px] items-center gap-x-4 border-b border-(--lab-hairline) py-2 text-[13px] sm:grid-cols-[64px_minmax(0,1fr)_72px]">
                      <span className="text-[15px] font-semibold text-(--lab-mute)">{v.symbol}</span>
                      <span className="text-(--lab-mute)"><span className="sm:hidden">Fees {pct(v.feeAprPct)}</span><span className="hidden sm:inline">Fees of {pct(v.feeAprPct)} a year did not cover losses to informed traders and costs.</span></span>
                      <span className="text-right text-[15px]"><Kept value={keep(v)} /></span>
                    </Link>
                  ) : (
                    <Link key={v.id} href={`/vault/${v.id}`} className="row grid h-16 grid-cols-[56px_minmax(0,1fr)_88px] items-center gap-x-4 border-b border-(--lab-hairline) sm:grid-cols-[64px_minmax(0,1fr)_96px_96px]">
                      <span className="text-[15px] font-semibold">{v.symbol}</span>
                      <span className="min-w-0 truncate text-(--lab-mute)">{v.name.replace(" Stock Token", "")}<span className="hidden sm:inline"> at {v.feeTier}</span></span>
                      <span className="hidden text-right text-(--lab-mute) sm:block">{pct(v.feeAprPct)} fees</span>
                      <span className="text-right text-[20px] font-medium leading-6"><Kept value={keep(v)} /></span>
                    </Link>
                  ),
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* VAULT */}
      <div className="border-y border-(--lab-hairline) bg-(--lab-panel) py-2 text-center text-[13px] text-(--lab-mute)">Vault page /vault/nvda</div>
      <section className="mx-auto grid max-w-[1280px] gap-x-16 gap-y-10 px-6 pb-24 pt-10 lg:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="order-2 lg:order-1 lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-lg border border-(--lab-border) bg-(--lab-panel) p-5">
            <div className="text-[15px] font-semibold">Deposit {nvda.symbol}</div>
            <div className="mt-4 flex h-12 items-center justify-between rounded-sm border border-(--lab-border) px-3.5"><span className="text-(--lab-mute)">0.0</span><span>{nvda.symbol}</span></div>
            <div className="mt-4 space-y-2 border-t border-(--lab-hairline) pt-4 text-[13px]">
              <div className="flex justify-between"><span className="text-(--lab-mute)">You receive</span><span>Vault shares</span></div>
              <div className="flex justify-between"><span className="text-(--lab-mute)">Vault size</span><span>{usd(nvda.depositCapUsd)}</span></div>
              <div className="flex justify-between"><span className="text-(--lab-mute)">Per-deposit limit</span><span>None while open</span></div>
            </div>
            <PrimaryPill className="mt-5 w-full">Connect wallet</PrimaryPill>
          </div>
          <p className="mt-4 text-[13px] leading-5 text-(--lab-mute)">Stock Tokens are not offered to US persons. Check that you are eligible in your country before depositing.</p>
        </aside>

        <div className="order-1 max-w-[690px] lg:order-2">
          <div className="text-[13px] text-(--lab-mute)">Vaults / {nvda.symbol}</div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <h2 className="text-[32px] font-medium leading-10 tracking-[-0.33px]">{nvda.symbol} vault</h2>
            <StateChip state="open" />
          </div>
          <p className="serif verdict mt-8 text-[30px] leading-[34px] sm:text-[44px] sm:leading-[48px]">
            Hold {nvda.symbol} here and you keep {signed(keep(nvda))} a year at the worst. The door is open.
          </p>

          <p className="mt-8 text-[17px] leading-7">
            Over the last {e.days} days the {nvda.symbol} / USDG pool paid <b className="font-semibold">{pct(e.feeAprPct)}</b> a year in fees. Informed traders took <b className="font-semibold text-(--lab-loss)">{pct(e.informedLossAprPct)}</b> of it,
            recentring cost <b className="font-semibold text-(--lab-loss)">{pct(e.costAprPct)}</b>, and <b className="font-semibold text-(--lab-kept)">{pct(e.keptAprPct)}</b> stayed with depositors.
          </p>

          <div className="mt-10">
            <h3 className="border-b border-(--lab-hairline) pb-3 text-[24px] font-semibold leading-8 tracking-[-0.2px]">Both halves clear the floor</h3>
            <div className="grid grid-cols-[1fr_1fr_1fr] border-b border-(--lab-hairline) py-3 text-[13px] text-(--lab-mute)"><span /><span className="text-right">First 15 days</span><span className="text-right">Last 15 days</span></div>
            <div className="grid grid-cols-[1fr_1fr_1fr] items-baseline border-b border-(--lab-hairline) py-3.5"><span>Kept a year</span><span className="text-right text-[20px] font-medium"><Kept value={e.keptFirstHalf} /></span><span className="text-right text-[20px] font-medium"><Kept value={e.keptSecondHalf} /></span></div>
            <div className="grid grid-cols-[1fr_1fr_1fr] items-baseline border-b border-(--lab-hairline) py-3.5"><span className="text-(--lab-mute)">Floor to stay open</span><span className="text-right text-(--lab-mute)">{signed(e.floorApr, 0)}</span><span className="text-right text-(--lab-mute)">{signed(e.floorApr, 0)}</span></div>
            <p className="mt-4 text-(--lab-mute)">{nvda.gate.reason}</p>
          </div>

          <dl className="mt-10 grid gap-x-8 gap-y-5 text-[13px] leading-5 sm:grid-cols-[150px_1fr]">
            <dt className="text-(--lab-text)"><span className="term">Informed traders</span></dt><dd className="text-(--lab-mute)">Traders who act on a price move before the pool has repriced, so the pool sells low and buys high to them.</dd>
            <dt className="text-(--lab-text)"><span className="term">Recentring</span></dt><dd className="text-(--lab-mute)">Moving the vault&apos;s price band back to the market price once a day, at 02:00 UTC after each NYSE session.</dd>
            <dt className="text-(--lab-text)"><span className="term">Floor</span></dt><dd className="text-(--lab-mute)">The lowest yearly figure a weaker half may show before the vault is closed: {signed(e.floorApr, 0)}.</dd>
          </dl>
          <p className="mt-8 text-[13px] text-(--lab-mute)">Pool {shortAddress(nvda.pool)} · Stock Token {shortAddress(nvda.token)} · {nvda.gate.swaps.toLocaleString("en-US")} swaps, {EVIDENCE_WINDOW.start.slice(0, 10)} to {EVIDENCE_WINDOW.end.slice(0, 10)}</p>
        </div>
      </section>
    </>
  );
}
