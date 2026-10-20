import { StateChip, toneClass } from "@/components/ledger";
import { signed } from "@/lib/format";

import { isoDay, REPLAY_WINDOW, type Vault } from "../data";
import { enter, rise } from "../motion";

/** Header rows of web/components/vault-detail.tsx: the title with its gate chip and replay chip, then the pool line. Breadcrumb and nav are left out of the film. */
export function VaultHeaderTwin({ cfg, a }: { cfg: Vault; a: { rest: number; tickerHidden: boolean } }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[32px] font-medium leading-10 tracking-[-0.33px]">
          <span data-target="title-ticker" style={{ opacity: a.tickerHidden ? 0 : 1 }}>{cfg.symbol}</span>
          <span style={{ opacity: a.rest }}> vault</span>
        </h1>
        <div style={enter(a.rest, 8)}><StateChip state={cfg.gate.state} /></div>
        <span
          className="figure inline-flex h-6 items-center rounded-full border border-hairline px-2.5 text-[13px] text-mute"
          style={enter(a.rest, 8)}
        >
          Replay to {isoDay(REPLAY_WINDOW.end)} · {cfg.gate.swaps.toLocaleString("en-US")} swaps
        </span>
      </div>
      <p className="mt-2 text-mute" style={enter(a.rest, 8)}>{cfg.name} in the {cfg.symbol} / USDG pool, {cfg.feeTier} fee tier</p>
    </div>
  );
}

/**
 * The verdict of vault-detail.tsx, word by word, with its door sentence (doorSentence for a vault that is not deployed yet:
 * an open door reads "Its vault is opening."). Every word keeps its slot, so the lines never re-flow while it builds.
 */
export const VERDICT_WORDS = 13;
export function VerdictTwin({ cfg, t, at }: { cfg: Vault; t: number; at: readonly number[] }) {
  const worst = cfg.gate.worstHalfApr;
  const words: { text: string; tone?: string }[] = [
    { text: cfg.symbol },
    { text: "kept" },
    { text: signed(worst), tone: toneClass(worst) },
    { text: "a" },
    { text: "year" },
    { text: "in" },
    { text: "its" },
    { text: "weaker" },
    { text: "half." },
    { text: "Its" },
    { text: "vault" },
    { text: "is" },
    { text: "opening." },
  ];
  return (
    <p className="serif max-w-[900px] text-[30px] font-normal leading-[34px] sm:text-[44px] sm:leading-[48px]" data-target="verdict">
      {words.map((w, i) => {
        const u = rise(t, at[i], 0.34);
        return (
          <span key={i}>
            <span className={`inline-block ${w.tone ?? ""}`} style={enter(u, 22)}>{w.text}</span>
            {i < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </p>
  );
}
