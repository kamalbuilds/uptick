"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckForm } from "./check-form";
import { StateChip, toneClass } from "./ledger";
import { Skeleton } from "./status";
import { Term } from "./term";
import { TokenLogo } from "./token-logo";
import { Button } from "@/components/ui/button";
import { EXPLORER } from "@/lib/chain";
import { num, perDepositLimitUsd, shortAddress, signed, usd, usdWhole } from "@/lib/format";
import { usdSigned } from "@/lib/leak";
import { priceLabel } from "@/lib/price-math";
import { parseOwner, type ScanRow, type WalletScan } from "@/lib/scan";
import { useWalletScan } from "@/lib/use-scan";
import { REPLAY_WINDOW, VAULTS, isoDay } from "@/lib/vaults";
import { cn } from "@/lib/utils";

/** Whole dollars from a thousand up, cents below. */
const money = (n: number): string => (n === 0 ? "$0" : n >= 1000 ? usdWhole(n) : usd(n, { compact: false }));

const COLS = "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_96px_minmax(0,1fr)_minmax(0,1.3fr)_128px]";
const ROW = `row grid grid-cols-2 items-center gap-x-4 gap-y-2 border-b border-hairline px-3 py-4 ${COLS}`;

function Holding({ r }: { r: ScanRow }) {
  const capped = r.putToWorkUsd !== null && r.holdingUsd !== null && r.putToWorkUsd < r.holdingUsd - 0.5;
  const note = capped
    ? `The vault takes ${money(r.putToWorkUsd as number)}`
    : r.state === "reduced"
      ? `Up to ${usdWhole(perDepositLimitUsd(r.depositCapUsd))} a deposit`
      : r.priceUsd !== null
        ? `at ${priceLabel(r.priceUsd)}`
        : "Chainlink gave no usable price";
  return (
    <div className="text-right lg:text-left">
      <p className="figure text-[17px] font-medium leading-6">{r.holdingUsd === null ? "No price" : money(r.holdingUsd)}</p>
      <p className="text-[13px] leading-4 text-mute">{note}</p>
    </div>
  );
}

function TokenCell({ r }: { r: ScanRow }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <TokenLogo symbol={r.symbol} size={28} />
      <div className="min-w-0">
        <p className="font-semibold leading-5">{r.symbol}</p>
        <p className="figure truncate text-[13px] leading-4 text-mute">{num(Number(r.balance), 4)} {r.symbol}</p>
      </div>
    </div>
  );
}

function WorkRow({ r }: { r: ScanRow }) {
  const b = r.borrow;
  return (
    <li className={ROW}>
      <TokenCell r={r} />
      <Holding r={r} />
      <div><StateChip state={r.state} term /></div>
      <div className="text-right lg:text-left">
        {r.keptPerYearUsd === null ? (
          <p className="text-[13px] leading-5 text-mute">Waits for a price</p>
        ) : (
          <>
            <p className={cn("figure text-[17px] font-medium leading-6", toneClass(r.keptPerYearUsd))}>{usdSigned(r.keptPerYearUsd)} a year</p>
            <p className="text-[13px] leading-4 text-mute">{signed(r.worstHalfApr)}, weaker half</p>
          </>
        )}
      </div>
      <div className="col-span-2 lg:col-span-1">
        {b.kind === "room" ? (
          <>
            <p className="figure text-[17px] font-medium leading-6">up to {money(b.usd)}</p>
            <p className="text-[13px] leading-4 text-mute">at the market&rsquo;s {num(b.lltv, 1)}% limit</p>
          </>
        ) : (
          <p className="text-[13px] leading-5 text-mute">Borrowing opens with the market</p>
        )}
      </div>
      <div className="col-span-2 lg:col-span-1 lg:justify-self-end">
        <Button asChild variant="outline" size="sm" className="w-full lg:w-auto">
          <Link href={`/vault/${r.id}`} aria-label={`Put ${r.symbol} to work`}>Put to work</Link>
        </Button>
      </div>
    </li>
  );
}

function RefusedRow({ r }: { r: ScanRow }) {
  return (
    <li className="row border-b border-hairline px-3 py-4">
      <div className="flex items-center justify-between gap-4">
        <TokenCell r={r} />
        <div className="flex items-center gap-4">
          <span className="figure text-[17px] font-medium">{r.holdingUsd === null ? "No price" : money(r.holdingUsd)}</span>
          <StateChip state="closed" term />
        </div>
      </div>
      <p className="mt-2 max-w-[690px] text-mute">{r.reason}</p>
    </li>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] leading-5 text-mute">{label}</dt>
      <dd className="figure mt-0.5 text-[24px] font-medium leading-8">{value}</dd>
      <dd className="mt-0.5 text-[13px] leading-5 text-mute">{note}</dd>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function verdict(who: string, s: WalletScan): string {
  const { idleUsd, putToWork, refused, unpriced } = s.totals;
  if (idleUsd === 0 && unpriced.length > 0) return `${who} holds Stock Tokens whose Chainlink feeds gave no usable price in this read.`;
  if (putToWork.tokens > 0) return `${who} holds ${money(idleUsd)} of Stock Tokens doing nothing. Uptick would put ${money(putToWork.usd)} of it to work.`;
  return `${who} holds ${money(idleUsd)} of Stock Tokens, ${refused.tokens === 1 ? "and its vault is" : "and every vault is"} closed. Uptick puts none of it to work.`;
}

function Results({ s }: { s: WalletScan }) {
  const who = shortAddress(s.owner);
  const work = s.rows.filter((r) => r.state !== "closed");
  const refused = s.rows.filter((r) => r.state === "closed");
  const t = s.totals;

  if (s.rows.length === 0) {
    return (
      <>
        <p className="serif verdict mt-10 max-w-[900px] text-[30px] leading-[34px] sm:text-[44px] sm:leading-[48px]">{who} holds none of the {s.tracked} Stock Tokens.</p>
        <div className="mt-8 max-w-[690px] border-t border-hairline pt-6">
          <p className="text-mute">
            The wallet was read on Robinhood Chain at <a className="underline underline-offset-4" href={`${EXPLORER}/block/${s.block}`} target="_blank" rel="noreferrer">block {s.block.toLocaleString("en-US")}</a>.
            The tokens checked are {VAULTS.map((v) => v.symbol).sort().join(", ")}. A wallet that holds any of them shows here, with what each vault would keep and where a loan opens.
          </p>
          <Button asChild variant="outline" className="mt-6"><Link href="/vaults">See the vaults that are launching</Link></Button>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="serif verdict mt-10 max-w-[900px] text-[30px] leading-[34px] sm:text-[44px] sm:leading-[48px]">{verdict(who, s)}</p>

      <dl className="mt-8 grid grid-cols-1 gap-y-4 border-y border-hairline py-4 sm:grid-cols-3 sm:gap-x-0 sm:py-5 sm:[&>div+div]:border-l sm:[&>div+div]:border-hairline sm:[&>div+div]:pl-6">
        <Fact label="Idle Stock Tokens" value={money(t.idleUsd)} note={`${plural(s.rows.length, "token", "tokens")} of ${s.tracked} tracked`} />
        <Fact
          label="Uptick puts to work"
          value={money(t.putToWork.usd)}
          note={t.putToWork.tokens === 0 ? "No open or reduced vault holds one" : `${plural(t.putToWork.tokens, "token", "tokens")}, open or reduced${t.putToWork.holdingUsd - t.putToWork.usd > 0.5 ? `, of ${money(t.putToWork.holdingUsd)} held` : ""}`}
        />
        <Fact
          label="Uptick refuses"
          value={money(t.refused.usd)}
          note={t.refused.tokens === 0 ? "Every token held has an open door" : `${plural(t.refused.tokens, "token", "tokens")}, closed, reasons below`}
        />
      </dl>

      {work.length > 0 && (
        <section aria-labelledby="work" className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline pb-3">
            <h2 id="work" className="text-2xl font-semibold leading-8 tracking-[-0.2px]">Put to work <span className="ml-1 text-[17px] font-normal text-mute">{work.length}</span></h2>
            <p className="text-[13px] text-mute">
              At the <Term id="worstHalf">weaker half</Term> of the replay these keep{" "}
              <span className={cn("figure", toneClass(t.putToWork.keptPerYearUsd))}>{usdSigned(t.putToWork.keptPerYearUsd)}</span> a year
              {t.putToWork.borrowRoomUsd !== null ? <> and open up to <span className="figure text-fg">{money(t.putToWork.borrowRoomUsd)}</span> of borrowing</> : null}
            </p>
          </div>
          <div className={`hidden px-3 pb-1 pt-3 text-[13px] leading-5 text-mute lg:grid lg:items-center lg:gap-x-4 ${COLS}`} aria-hidden>
            <span>Token</span><span>Holding</span><span>State</span><span>Kept a year</span><span>Borrow room</span><span />
          </div>
          <ul>{work.map((r) => <WorkRow key={r.id} r={r} />)}</ul>
        </section>
      )}

      {refused.length > 0 && (
        <section aria-labelledby="refused" className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline pb-3">
            <h2 id="refused" className="text-2xl font-semibold leading-8 tracking-[-0.2px]">Uptick refuses <span className="ml-1 text-[17px] font-normal text-mute">{refused.length}</span></h2>
            <p className="text-[13px] text-mute">A closed vault takes no deposits. Exit in kind is never closed.</p>
          </div>
          <ul>{refused.map((r) => <RefusedRow key={r.id} r={r} />)}</ul>
        </section>
      )}

      {t.unpriced.length > 0 && (
        <p className="mt-6 max-w-[690px] text-[13px] leading-5 text-mute">
          No usable Chainlink round for {t.unpriced.join(", ")} in this read, so {t.unpriced.length === 1 ? "it is" : "they are"} left out of every dollar figure above.
        </p>
      )}

      <p className="mt-8 max-w-[690px] text-[13px] leading-5 text-mute">
        Read from Robinhood Chain in one Multicall3 call at <a className="underline underline-offset-4" href={`${EXPLORER}/block/${s.block}`} target="_blank" rel="noreferrer">block {s.block.toLocaleString("en-US")}</a>,
        priced by the Chainlink feeds the vaults read. Kept is the weaker 15-day half of the {REPLAY_WINDOW.days}-day replay to {isoDay(REPLAY_WINDOW.end)}, taken on the deposit net of the entry fee.
        It measures past swaps and is not a promise. The vaults are launching, and each row opens its vault page.
      </p>
    </>
  );
}

function Loading() {
  return (
    <div className="mt-10" aria-busy="true" aria-label="Reading the wallet from Robinhood Chain">
      <Skeleton className="h-24 w-full max-w-[760px]" />
      <Skeleton className="mt-8 h-20 w-full" />
      <Skeleton className="mt-8 h-16 w-full" />
      <Skeleton className="mt-2 h-16 w-full" />
    </div>
  );
}

/** /check: paste a wallet, see which Stock Tokens sit idle, what each vault would keep, and where a loan opens. The address lives in the URL so a result can be shared. */
export function IdleFinder() {
  const raw = useSearchParams().get("address") ?? "";
  const owner = parseOwner(raw);
  const q = useWalletScan(owner);

  return (
    <div className="mx-auto max-w-[1280px] px-6 pb-8 pt-10 lg:pt-14">
      <h1 className="text-[32px] font-medium leading-10 tracking-[-0.33px]">Find your idle Stock Tokens</h1>
      <p className="mt-2 max-w-[690px] text-mute">
        Paste any wallet address. Uptick reads its balances of the {VAULTS.length} tracked Stock Tokens straight from Robinhood Chain, prices them with Chainlink, and shows what each vault would keep and where a loan opens. No wallet connection.
      </p>
      <CheckForm key={raw} initial={raw} className="mt-6 max-w-[640px]" />
      {raw !== "" && owner === null ? (
        <p role="alert" className="mt-4 max-w-[640px] text-loss">The address in the link is not a wallet address. Paste the 42-character 0x address above.</p>
      ) : null}

      {owner === null ? null : q.isError ? (
        <div role="alert" className="mt-10 max-w-[640px] border-t border-hairline pt-4">
          <p className="font-semibold">The chain did not answer for this wallet.</p>
          <p className="mt-1 text-[13px] text-mute">Every figure here is read live from Robinhood Chain. Retry asks again.</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void q.refetch()}>Retry</Button>
        </div>
      ) : !q.data ? (
        <Loading />
      ) : (
        <Results s={q.data} />
      )}
    </div>
  );
}
