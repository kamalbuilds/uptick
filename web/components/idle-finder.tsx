"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckForm } from "./check-form";
import { HedgePlan } from "./hedge-plan";
import { StateChip, toneClass } from "./ledger";
import { Skeleton } from "./status";
import { Term } from "./term";
import { TokenLogo } from "./token-logo";
import { Button } from "@/components/ui/button";
import { EXPLORER } from "@/lib/chain";
import { liveSentence, num, perDepositLimitUsd, shortAddress, signed, tokenBalance, usdWhole } from "@/lib/format";
import { usdSigned } from "@/lib/leak";
import { priceLabel } from "@/lib/price-math";
import { parseOwner, type ScanRow, type WalletScan } from "@/lib/scan";
import { useWalletScan } from "@/lib/use-scan";
import { TERMS } from "@/lib/terms";
import { money, verdict } from "@/lib/verdict";
import { LIVE_VAULTS, REPLAY_WINDOW, VAULTS, isoDay } from "@/lib/vaults";
import { cn } from "@/lib/utils";

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
        <p className="figure truncate text-[13px] leading-4 text-mute">{tokenBalance(Number(r.balance))} {r.symbol}</p>
      </div>
    </div>
  );
}

function WorkRow({ r, block }: { r: ScanRow; block: bigint }) {
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
            <p className="text-[13px] leading-4 text-mute">at the market&rsquo;s {num(b.lltv, 1)}% <Term id="lltv">limit</Term></p>
          </>
        ) : (
          <p className="text-[13px] leading-5 text-mute">A loan opens with the vault&rsquo;s <Term id="morpho">Morpho Blue</Term> market</p>
        )}
      </div>
      <div className="col-span-2 lg:col-span-1 lg:justify-self-end">
        <Button asChild variant="outline" size="sm" className="w-full lg:w-auto">
          <Link href={`/vault/${r.id}`} aria-label={`Put ${r.symbol} to work`}>Put to work</Link>
        </Button>
      </div>
      <HedgePlan className="col-span-2 lg:col-span-6" source="wallet" id={r.id} symbol={r.symbol} token={r.token} balanceRaw={r.balanceRaw} block={block} />
    </li>
  );
}

function RefusedRow({ r, block }: { r: ScanRow; block: bigint }) {
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
      <HedgePlan className="mt-2" source="wallet" id={r.id} symbol={r.symbol} token={r.token} balanceRaw={r.balanceRaw} block={block} />
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
          <Button asChild variant="outline" className="mt-6"><Link href="/vaults">See the vaults</Link></Button>
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
          <div className={`hidden px-3 pb-1 pt-3 text-[13px] leading-5 text-mute lg:grid lg:items-center lg:gap-x-4 ${COLS}`}>
            <span>Token</span><span>Holding</span><span>State</span><span><Term id="kept">Kept a year</Term></span><span><Term id="borrowRoom">Borrow room</Term></span><span />
          </div>
          <ul>{work.map((r) => <WorkRow key={r.id} r={r} block={s.block} />)}</ul>
        </section>
      )}

      {refused.length > 0 && (
        <section aria-labelledby="refused" className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline pb-3">
            <h2 id="refused" className="text-2xl font-semibold leading-8 tracking-[-0.2px]">Uptick refuses <span className="ml-1 text-[17px] font-normal text-mute">{refused.length}</span></h2>
            <p className="text-[13px] text-mute">A closed vault takes no deposits. <Term id="inKind">Exit in kind</Term> is never closed.</p>
          </div>
          <ul>{refused.map((r) => <RefusedRow key={r.id} r={r} block={s.block} />)}</ul>
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
        It measures past swaps and is not a promise. {LIVE_VAULTS.length ? `${liveSentence(LIVE_VAULTS.map((v) => v.symbol))} The rest are launching, and each row opens its vault page.` : "The vaults are launching, and each row opens its vault page."}
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

/** The empty page tells a stranger what the result will say: each token held lands in one of three vault states. */
function StateKey() {
  return (
    <section aria-labelledby="state-key" className="mt-12 max-w-[690px] border-t border-hairline pt-6">
      <h2 id="state-key" className="text-2xl font-semibold leading-8 tracking-[-0.2px]">What a result tells you</h2>
      <p className="mt-2 text-mute">Each token the wallet holds lands in one of three states. The replay of the vault&rsquo;s pool splits 30 days into two halves of 15, and the worse half decides.</p>
      <dl className="mt-4 border-t border-hairline">
        {(["open", "reduced", "closed"] as const).map((state) => (
          <div key={state} className="flex flex-col gap-2 border-b border-hairline py-4 sm:flex-row sm:items-baseline sm:gap-6">
            <dt className="w-24 shrink-0"><StateChip state={state} /></dt>
            <dd className="text-mute">{TERMS[state].text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Real Robinhood Chain wallets (externally owned, from Blockscout's top holders on 2026-10-24), one per kind of result. Labels name the
 *  shape of the holding, not its size, because balances move. */
const EXAMPLES = [
  { label: "PLTR holder, one open vault", address: "0x335836A23a2E475265058CB55318EF91A07136b7" },
  { label: "Four tokens across all three states", address: "0xdBD1bac81ad581C7198C9D155cA468F32a0C29DD" },
  { label: "All 17 Stock Tokens", address: "0x92d435C96E63c43E12d6D0AB28f6b0B04072F765" },
  { label: "Mostly NVDA", address: "0x28C66690Ae101a4f07546b07a2Ac8Eb439b6C245" },
] as const;

function Examples({ current }: { current: string }) {
  return (
    <div className="mt-4 max-w-[640px]">
      <p className="text-[13px] leading-5 text-mute">Or open a real holder&rsquo;s wallet</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {EXAMPLES.map((e) => {
          const on = current.toLowerCase() === e.address.toLowerCase();
          return (
            <li key={e.address}>
              <Link
                href={`/check?address=${e.address}`}
                aria-current={on ? "page" : undefined}
                className={cn("flex min-h-11 flex-col justify-center rounded-lg border px-3 py-2 hover:border-fg", on ? "border-fg" : "border-line")}
              >
                <span className="text-[13px] leading-5">{e.label}</span>
                <span className="figure text-[12px] leading-4 text-mute">{shortAddress(e.address)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
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
        Paste any wallet address. Uptick reads which of the {VAULTS.length} Stock Tokens it holds from Robinhood Chain, prices them with Chainlink, and shows what each vault would keep on them and where a loan against them opens. Nothing to connect or sign.
      </p>
      <CheckForm key={raw} initial={raw} className="mt-6 max-w-[640px]" />
      <Examples current={raw} />
      {raw !== "" && owner === null ? (
        <p role="alert" className="mt-4 max-w-[640px] text-loss">The address in the link is not a wallet address. Paste the 42-character 0x address above.</p>
      ) : null}

      {owner === null ? (
        raw === "" ? <StateKey /> : null
      ) : q.isError ? (
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
