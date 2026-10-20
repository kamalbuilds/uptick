import Link from "next/link";
import { Kept, RowAxis, RowBar, StateChip, GATE_LABEL } from "./ledger";
import { PriceCell } from "./price";
import { TokenLogo } from "./token-logo";
import { num, pct, signed } from "@/lib/format";
import type { VaultConfig } from "@/lib/vaults";
import { cn } from "@/lib/utils";

/** Vault, bar and the figure under 640px; the price and the state chip join above it. Shared by the heads and the rows so the axis lines up. */
export const ROW_GRID = "grid items-center gap-x-4 grid-cols-[minmax(0,1fr)_88px_60px] sm:grid-cols-[minmax(0,1fr)_76px_minmax(120px,240px)_60px_72px]";

export function RowHeader() {
  return (
    <div className={`${ROW_GRID} px-3 pb-1 pt-3 text-[13px] leading-5 text-mute`}>
      <span className="col-span-2 sm:col-span-1">Vault</span>
      <span className="hidden text-right sm:block">Price</span>
      <span className="hidden sm:block"><RowAxis /></span>
      <span className="text-right">Kept</span>
      <span className="hidden text-right sm:block">State</span>
    </div>
  );
}

export function VaultRow({ cfg, held }: { cfg: VaultConfig; held?: number }) {
  const keep = cfg.gate.worstHalfApr;
  return (
    <Link href={`/vault/${cfg.id}`} className={`row ${ROW_GRID} min-h-[60px] border-b border-hairline px-3 py-2`}>
      <span className="flex min-w-0 items-center gap-3">
        <TokenLogo symbol={cfg.symbol} size={28} />
        <span className="min-w-0">
          <span className="block font-semibold leading-5">{cfg.symbol}</span>
          <span className={cn("block text-[12px] leading-4 sm:hidden", cfg.gate.state === "open" ? "text-kept" : cfg.gate.state === "reduced" ? "text-caution" : "text-mute")}>
            {held !== undefined ? num(held, 2) : GATE_LABEL[cfg.gate.state]}
          </span>
          <span className="hidden truncate text-[13px] leading-4 text-mute sm:block">
            {cfg.name.replace(" Stock Token", "")}, {cfg.feeTier}
            {held !== undefined ? <span className="text-fg"> · you hold {num(held, 4)}</span> : null}
          </span>
        </span>
      </span>
      <span className="hidden text-right sm:block"><PriceCell id={cfg.id} /></span>
      <span className="col-start-2 h-8 sm:col-start-auto">
        <RowBar keep={keep} label={`${cfg.symbol} keeps ${signed(keep)} a year in its worst half, drawn on a scale from ${pct(-20, 0)} to +5%`} />
      </span>
      <span className="text-right text-[17px] font-medium"><Kept value={keep} /></span>
      <span className="hidden justify-self-end sm:block"><StateChip state={cfg.gate.state} /></span>
    </Link>
  );
}
