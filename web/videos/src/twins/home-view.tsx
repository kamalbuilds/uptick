import { Kept, RowAxis, SectionTitle } from "@/components/ledger";
import { swapsLabel } from "@/lib/format";
import { rowBar } from "@/lib/leak";
import { cn } from "@/lib/utils";

import { byState, GATE_COUNTS, isoDay, REPLAY_WINDOW, REPLAYED_SWAPS, type Vault } from "../data";
import { enter } from "../motion";

/** vault-row.tsx ROW_GRID, copied: that file imports next/link, which a film cannot load. */
const ROW_GRID = "grid grid-cols-[52px_minmax(0,1fr)_68px] items-center gap-x-3 sm:grid-cols-[64px_minmax(0,1fr)_minmax(180px,300px)_72px] sm:gap-x-5";

/**
 * Twin of RowBar (components/ledger.tsx): same markup and geometry (lib/leak.ts rowBar), with the bar growing from the zero tick.
 * grow = 1 is the static bar. A negative value grows leftwards from zero, as it is drawn on the site.
 */
function RowBarTwin({ keep, grow }: { keep: number; grow: number }) {
  const b = rowBar(keep);
  const width = b.widthPct * grow;
  const left = keep >= 0 ? b.zeroPct : b.zeroPct - width;
  return (
    <span className="relative block h-full" role="img">
      <span className="absolute inset-x-0 top-1/2 h-px bg-hairline" aria-hidden />
      <span className="absolute inset-y-2 left-0 w-px bg-closed" aria-hidden />
      <span className="absolute inset-y-2 w-px bg-mute" style={{ left: `${b.zeroPct}%` }} aria-hidden />
      <span
        className={cn("absolute top-1/2 h-2 -translate-y-1/2 rounded-[2px]", keep >= 0 ? "bg-kept" : "bg-loss")}
        style={{ left: `${left}%`, width: `${width}%`, minWidth: grow > 0 ? 3 : 0 }}
        aria-hidden
      />
      {b.clipped ? <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 bg-fg" aria-hidden /> : null}
    </span>
  );
}

export type RowAnim = { show: number; grow: number };

/** Twin of VaultRow (components/vault-row.tsx) without the link. `ticker` is the traveler slot: it is hidden while the traveler is on screen. */
export function RowTwin({ cfg, a, tickerHidden = false, target }: { cfg: Vault; a: RowAnim; tickerHidden?: boolean; target?: string }) {
  const keep = cfg.gate.worstHalfApr;
  return (
    <div className={`${ROW_GRID} min-h-[52px] border-b border-hairline py-2`} style={enter(a.show, 10)} data-target={target}>
      <span>
        <span className="block font-semibold" data-target={target ? `${target}-ticker` : undefined} style={{ opacity: tickerHidden ? 0 : 1 }}>{cfg.symbol}</span>
      </span>
      <span className="hidden min-w-0 truncate text-mute sm:block">{cfg.name.replace(" Stock Token", "")}, {cfg.feeTier}</span>
      <span className="col-start-2 h-8 sm:col-start-auto">
        <RowBarTwin keep={keep} grow={a.grow} />
      </span>
      <span className="text-right text-[17px] font-medium"><Kept value={keep} /></span>
    </div>
  );
}

const CARET = "M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z";

/**
 * The page's h1, "Which of your stock tokens can earn, and how much you would keep.", in the pieces the film lands:
 * the question first (it ends "can earn?"), then the "?" becomes the comma and the rest of the sentence arrives.
 * Seven 0..1 values: three line groups, the swap, "and", "how much you", "would keep.".
 */
export type HeadingAnim = readonly [number, number, number, number, number, number, number];

/** Advance widths of "?" and "," in the shipped Literata file, in em (font units / 1000). The slot narrows from one to the other as the swap lands. */
const QUESTION_EM = 0.538;
const COMMA_EM = 0.328;

function Heading({ h }: { h: HeadingAnim }) {
  const piece = (words: string[], u: number, last = false) => (
    <>
      {words.map((w, i) => (
        <span key={w}>
          <span className="inline-block" style={enter(u, 14)}>{w}</span>
          {i < words.length - 1 || !last ? " " : ""}
        </span>
      ))}
    </>
  );
  return (
    <h1 className="serif text-[30px] font-normal leading-[34px] sm:text-[40px] sm:leading-[44px]" data-target="home-h1">
      {piece(["Which", "of", "your"], h[0])}
      {piece(["stock", "tokens"], h[1])}
      <span className="inline-block" style={enter(h[2], 14)}>can</span>{" "}
      <span className="inline-block" style={enter(h[2], 14)}>earn</span>
      <span className="relative inline-block align-baseline" style={{ width: `${QUESTION_EM + (COMMA_EM - QUESTION_EM) * h[3]}em`, height: "1em" }}>
        <span className="absolute left-0 top-0" style={{ opacity: h[2] * (1 - h[3]) }}>?</span>
        <span className="absolute left-0 top-0" style={{ opacity: h[3] }}>,</span>
      </span>{" "}
      {piece(["and"], h[4])}
      {piece(["how", "much", "you"], h[5])}
      {piece(["would", "keep."], h[6], true)}
    </h1>
  );
}

export type HomeAnim = {
  heading: HeadingAnim;
  intro: number;
  header: number;
  open: number;
  reduced: number;
  closed: number;
  rows: Record<string, RowAnim>;
  /** Opacity of every row except the one named in `keepLit` (the zoom into one vault). */
  dim?: number;
  keepLit?: string;
  tickerHidden?: string;
};

const HIDDEN: RowAnim = { show: 0, grow: 0 };

/**
 * Twin of HomeView (components/home-view.tsx): the verdict heading and sentence on the left, the three doors on the right.
 * Left out: the wallet call to action and everything under it (a film never shows wallet state), and the per-door notes.
 * The heading is the page's own h1; useHoldings and next/link are the reasons this is a twin and not an import.
 */
export function HomeTwin({ a }: { a: HomeAnim }) {
  const open = byState("open");
  const reduced = byState("reduced");
  const closed = byState("closed");
  const dim = a.dim ?? 1;
  const dimmed = (id: string) => (a.keepLit && id !== a.keepLit ? { opacity: dim, filter: dim < 1 ? `blur(${(1 - dim) * 3}px)` : undefined } : undefined);
  const groups = [
    { title: "Open", rows: open, anim: a.open },
    { title: "Reduced", rows: reduced, anim: a.reduced },
  ];
  return (
    <section className="mx-auto grid max-w-[1280px] gap-x-16 gap-y-10 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div>
        <Heading h={a.heading} />
        <p className="mt-5 text-mute" style={enter(a.intro, 12)}>
          Every vault sits behind one of three doors, set by {swapsLabel(REPLAYED_SWAPS)} swaps replayed over the {REPLAY_WINDOW.days} days to {isoDay(REPLAY_WINDOW.end)}.{" "}
          {GATE_COUNTS.open} are open, {GATE_COUNTS.reduced} are reduced, {GATE_COUNTS.closed} are closed.
        </p>
      </div>

      <div>
        <div className="mb-4" style={enter(a.header, 8)}>
          <div className={`${ROW_GRID} pb-2 text-[13px] text-mute`}>
            <span className="col-span-2">You keep a year, weaker half</span>
            <span className="hidden sm:block"><RowAxis /></span>
            <span className="text-right" />
          </div>
        </div>
        <div className="space-y-10">
          {groups.map((g) => (
            <div key={g.title}>
              <div style={{ ...enter(g.anim, 8), ...(a.keepLit ? { opacity: g.anim * dim } : undefined) }}>
                <SectionTitle>
                  {g.title} <span className="ml-1 text-[17px] font-normal text-mute">{g.rows.length}</span>
                </SectionTitle>
              </div>
              {g.rows.map((v) => (
                <div key={v.id} style={dimmed(v.id)}>
                  <RowTwin cfg={v} a={a.rows[v.id] ?? HIDDEN} target={v.id} tickerHidden={a.tickerHidden === v.id} />
                </div>
              ))}
            </div>
          ))}
          <div style={a.keepLit ? { opacity: a.closed * dim } : enter(a.closed, 8)}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline pb-3">
              <h2 className="text-2xl font-semibold leading-8 tracking-[-0.2px]">{closed.length} closed</h2>
              <span className="flex items-center gap-2 text-[13px] text-mute">
                The weaker half kept less than the {closed[0].gate.floorApr}% floor
                <span className="inline-flex items-center gap-1 text-fg">
                  Show
                  <svg width={14} height={14} viewBox="0 0 256 256" fill="currentColor" aria-hidden><path d={CARET} /></svg>
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

