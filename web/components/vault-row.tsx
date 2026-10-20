import Link from "next/link";
import { Kept, RowBar } from "./ledger";
import { num, pct, signed } from "@/lib/format";
import type { VaultConfig } from "@/lib/vaults";

/** Ticker, name, the weaker-half bar to scale, and the figure. Columns shared with RowHeader so the axis lines up. */
export const ROW_GRID = "grid grid-cols-[52px_minmax(0,1fr)_68px] items-center gap-x-3 sm:grid-cols-[64px_minmax(0,1fr)_minmax(180px,300px)_72px] sm:gap-x-5";

export function RowHeader({ left, right, axis }: { left: string; right: string; axis: React.ReactNode }) {
  return (
    <div className={`${ROW_GRID} pb-2 text-[13px] text-mute`}>
      <span className="col-span-2">{left}</span>
      <span className="hidden sm:block">{axis}</span>
      <span className="text-right">{right}</span>
    </div>
  );
}

export function VaultRow({ cfg, held, extra }: { cfg: VaultConfig; held?: number; extra?: React.ReactNode }) {
  const keep = cfg.gate.worstHalfApr;
  return (
    <Link href={`/vault/${cfg.id}`} className={`row ${ROW_GRID} min-h-[52px] border-b border-hairline py-2`}>
      <span>
        <span className="block font-semibold">{cfg.symbol}</span>
        {held !== undefined ? <span className="block text-[12px] leading-4 text-mute sm:hidden">{num(held, 2)}</span> : null}
      </span>
      <span className="hidden min-w-0 truncate text-mute sm:block">
        {cfg.name.replace(" Stock Token", "")}, {cfg.feeTier}
        {held !== undefined ? <span className="text-fg"> · you hold {num(held, 4)}</span> : null}
        {extra}
      </span>
      <span className="col-start-2 h-8 sm:col-start-auto">
        <RowBar keep={keep} label={`${cfg.symbol} keeps ${signed(keep)} a year in its weaker half, drawn on a scale from ${pct(-20, 0)} to +5%`} />
      </span>
      <span className="text-right text-[17px] font-medium"><Kept value={keep} /></span>
    </Link>
  );
}
