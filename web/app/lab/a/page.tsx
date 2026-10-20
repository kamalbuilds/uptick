import Link from "next/link";
import { Header, Kept, LedgerRow, PrimaryPill, SectionTitle, StateChip } from "../parts";
import { COUNTS, EVIDENCE_WINDOW, NVDA_EVIDENCE, REPLAYED_SWAPS, VAULTS, bySymbol, keep } from "../lab-data";
import { pct, shortAddress, signed, swapsLabel, usd } from "@/lib/format";

export const metadata = { title: "Uptick lab A: ruled column and ticket" };

const GAUGE = { min: -25, max: 15 };
const at = (n: number) => `${((n - GAUGE.min) / (GAUGE.max - GAUGE.min)) * 100}%`;

export default function LabA() {
  const nvda = bySymbol("nvda");
  const e = NVDA_EVIDENCE;
  return (
    <>
      <Header />
      <div className="border-b border-(--lab-hairline) py-2 text-center text-[13px] text-(--lab-mute)">Lab A, ruled column with a sticky ticket. Home first screen, then vault first screen.</div>

      {/* HOME */}
      <section className="mx-auto grid max-w-[1280px] gap-x-12 gap-y-10 px-6 pb-20 pt-14 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div>
          <h1 className="serif verdict max-w-[720px] text-[30px] leading-[34px] sm:text-[44px] sm:leading-[48px]">
            {COUNTS.keepsMoney} of {COUNTS.total} stock tokens kept their holders&apos; money in both halves of the last {nvda.gate.days} days. Those {COUNTS.open} are open.
          </h1>
          <p className="mt-5 max-w-[620px] text-(--lab-mute)">
            Uptick replayed {swapsLabel(REPLAYED_SWAPS)} of Robinhood Chain&apos;s own swaps. A vault opens only where the weaker half of 30 days kept more than the floor, after what fast traders took.
          </p>

          <div className="mt-12">
            <div className="grid grid-cols-[minmax(0,1fr)_88px_88px] items-center gap-4 border-b border-(--lab-hairline) pb-3 text-[13px] text-(--lab-mute) sm:grid-cols-[minmax(0,1fr)_96px_96px_96px]">
              <span>Stock token</span>
              <span className="hidden text-right sm:block">Fees earned</span>
              <span className="text-right">You keep</span>
              <span className="text-right">Deposits</span>
            </div>
            {VAULTS.map((v) => (
              <Link key={v.id} href={`/vault/${v.id}`} className="row grid h-14 grid-cols-[minmax(0,1fr)_88px_88px] items-center gap-4 border-b border-(--lab-hairline) sm:grid-cols-[minmax(0,1fr)_96px_96px_96px]">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{v.symbol}</span>
                  <span className="ml-3 hidden text-[13px] text-(--lab-mute) sm:inline">{v.name.replace(" Stock Token", "")}</span>
                </span>
                <span className="hidden text-right text-(--lab-mute) sm:block">{pct(v.feeAprPct)}</span>
                <span className="text-right text-[15px] font-semibold"><Kept value={keep(v)} /></span>
                <span className="flex justify-end"><StateChip state={v.gate.state as "open" | "reduced" | "closed"} /></span>
              </Link>
            ))}
          </div>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-lg border border-(--lab-border) bg-(--lab-panel) p-5">
            <div className="text-[15px] font-semibold">Your stock tokens</div>
            <p className="mt-2 text-[13px] leading-5 text-(--lab-mute)">Connect a wallet and the tokens you hold move to the top, with what each would keep.</p>
            <PrimaryPill className="mt-5 w-full">Connect wallet</PrimaryPill>
          </div>
          <p className="mt-4 text-[13px] leading-5 text-(--lab-mute)">
            <span className="term">You keep</span> is fees earned less what informed traders took and the cost of recentring, per year, in the weaker half of the last {nvda.gate.days} days.
          </p>
        </aside>
      </section>

      {/* VAULT */}
      <div className="border-y border-(--lab-hairline) bg-(--lab-panel) py-2 text-center text-[13px] text-(--lab-mute)">Vault page /vault/nvda</div>
      <section className="mx-auto grid max-w-[1280px] gap-x-12 gap-y-10 px-6 pb-24 pt-10 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div>
          <div className="text-[13px] text-(--lab-mute)">Vaults / {nvda.symbol}</div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <h2 className="text-[32px] font-medium leading-10 tracking-[-0.33px]">{nvda.symbol} vault</h2>
            <StateChip state="open" />
          </div>
          <p className="mt-1 text-(--lab-mute)">{nvda.name} in the {nvda.symbol} / USDG pool, {nvda.feeTier} fee tier</p>

          <p className="serif verdict mt-10 max-w-[680px] text-[30px] leading-[34px] sm:text-[44px] sm:leading-[48px]">
            {nvda.symbol} kept {signed(keep(nvda))} a year in its weaker half. Deposits are open.
          </p>
          <p className="mt-4 max-w-[620px] text-(--lab-mute)">{nvda.gate.reason}</p>

          <div className="mt-12">
            <SectionTitle>Where the fees went</SectionTitle>
            <LedgerRow label="Fees earned" value={<span className="text-(--lab-text)">{signed(e.feeAprPct)}</span>} note={`Pool at ${nvda.feeTier}, annualised over ${e.days} days`} />
            <LedgerRow label="Lost to informed traders" value={<span className="text-(--lab-loss)">{signed(-e.informedLossAprPct)}</span>} note="Trades from people who knew the price was about to move" />
            <LedgerRow label="Cost of recentring" value={<span className="text-(--lab-loss)">{signed(-e.costAprPct)}</span>} note="The 02:00 UTC reposition after each NYSE session" />
            <LedgerRow strong label="Kept over all 30 days" value={<span className="text-(--lab-kept)">{signed(e.keptAprPct)}</span>} />
          </div>

          <div className="mt-12">
            <SectionTitle>The risk</SectionTitle>
            <div className="mt-5 grid rounded-sm border border-(--lab-border) md:grid-cols-[2fr_1fr]">
              <div className="p-5">
                <div className="text-[13px] text-(--lab-mute)">Kept a year, each half of the replay, against the floor</div>
                <div className="relative mt-9 h-10">
                  <div className="absolute inset-x-0 top-5 h-px bg-(--lab-border)" />
                  <div className="absolute top-0 flex -translate-x-1/2 flex-col items-center text-[13px] text-(--lab-loss)" style={{ left: at(-20) }}>
                    <span>Floor {signed(-20, 0)}</span><span className="h-4 w-px bg-(--lab-loss)" />
                  </div>
                  <div className="absolute top-0 flex -translate-x-1/2 flex-col items-center text-[13px] text-(--lab-mute)" style={{ left: at(0) }}>
                    <span>0</span><span className="h-4 w-px bg-(--lab-mute)" />
                  </div>
                  <span className="absolute top-[14px] size-3 -translate-x-1/2 rounded-full bg-(--lab-kept)" style={{ left: at(e.keptSecondHalf) }} />
                  <span className="absolute top-[14px] size-3 -translate-x-1/2 rounded-full border-2 border-(--lab-kept) bg-(--lab-canvas)" style={{ left: at(e.keptFirstHalf) }} />
                </div>
                <div className="mt-6 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-(--lab-mute)">
                  <span><span className="mr-2 inline-block size-2.5 rounded-full border-2 border-(--lab-kept)" />First half {signed(e.keptFirstHalf)}</span>
                  <span><span className="mr-2 inline-block size-2.5 rounded-full bg-(--lab-kept)" />Weaker half {signed(e.keptSecondHalf)}</span>
                </div>
              </div>
              <div className="border-t border-(--lab-border) md:border-l md:border-t-0">
                <div className="border-b border-(--lab-border) p-5"><div className="text-[13px] text-(--lab-mute)">Swaps replayed</div><div className="text-[20px] font-medium">{nvda.gate.swaps.toLocaleString("en-US")}</div></div>
                <div className="p-5"><div className="text-[13px] text-(--lab-mute)">Per-deposit limit</div><div className="text-[20px] font-medium">None while open</div></div>
              </div>
            </div>
          </div>

          <dl className="mt-12 grid gap-y-3 text-[13px] sm:grid-cols-[160px_1fr]">
            <dt className="text-(--lab-mute)">Pool</dt><dd>{shortAddress(nvda.pool)}</dd>
            <dt className="text-(--lab-mute)">Stock Token</dt><dd>{shortAddress(nvda.token)}</dd>
            <dt className="text-(--lab-mute)">Replay window</dt><dd>{EVIDENCE_WINDOW.start.slice(0, 10)} to {EVIDENCE_WINDOW.end.slice(0, 10)}, Robinhood Chain 4663</dd>
          </dl>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-lg border border-(--lab-border) bg-(--lab-panel)">
            <div className="flex gap-6 border-b border-(--lab-hairline) px-5 pt-4 text-[15px]">
              <span className="border-b-2 border-(--lab-text) pb-3 font-semibold">Deposit</span>
              <span className="pb-3 text-(--lab-mute)">Withdraw</span>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between text-[13px] text-(--lab-mute)">
                <span>Pay with</span><span><span className="text-(--lab-text)">NVDA</span> · USDG</span>
              </div>
              <div className="flex h-12 items-center justify-between rounded-sm border border-(--lab-border) px-3.5"><span className="text-(--lab-mute)">0.0</span><span>NVDA</span></div>
              <div className="space-y-2 border-t border-(--lab-hairline) pt-4 text-[13px]">
                <div className="flex justify-between"><span className="text-(--lab-mute)">Vault size</span><span>{usd(nvda.depositCapUsd)}</span></div>
                <div className="flex justify-between"><span className="text-(--lab-mute)">You receive</span><span>Vault shares</span></div>
                <div className="flex justify-between"><span className="text-(--lab-mute)">Goes to</span><span>{nvda.symbol} / USDG pool, band of 5%</span></div>
              </div>
              <PrimaryPill className="w-full">Connect wallet</PrimaryPill>
              <p className="text-[13px] leading-5 text-(--lab-mute)">Stock Tokens are not offered to US persons. Check that you are eligible in your country before depositing.</p>
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}
