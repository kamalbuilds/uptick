import Link from "next/link";
import { GATE_LABEL } from "./lab-data";
import { pct, signed } from "@/lib/format";

type State = keyof typeof GATE_LABEL;

const CHIP: Record<State, string> = {
  open: "bg-(--lab-kept-dim) text-(--lab-kept)",
  reduced: "bg-(--lab-caution-dim) text-(--lab-caution)",
  closed: "bg-(--lab-hairline) text-(--lab-mute)",
};

export function StateChip({ state }: { state: State }) {
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[13px] font-medium ${CHIP[state]}`}>{GATE_LABEL[state]}</span>;
}

/** Colour is semantic: kept money is green, a loss is orange, zero is plain text. */
export const toneClass = (n: number) => (n > 0 ? "text-(--lab-kept)" : n < 0 ? "text-(--lab-loss)" : "text-(--lab-text)");

export function Kept({ value, digits = 1, className = "" }: { value: number; digits?: number; className?: string }) {
  return <span className={`${toneClass(value)} ${className}`}>{signed(value, digits)}</span>;
}

export { pct };

export function Header({ active = "Vaults" }: { active?: string }) {
  const items = ["Vaults", "Portfolio", "Docs"];
  return (
    <header className="border-b border-(--lab-hairline)">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-8 px-6">
        <Link href="/" className="text-[20px] font-semibold tracking-[-0.4px]">Uptick</Link>
        <nav className="hidden gap-6 text-[15px] sm:flex">
          {items.map((i) => (
            <span key={i} className={i === active ? "text-(--lab-text)" : "text-(--lab-mute)"}>{i}</span>
          ))}
        </nav>
        <span className="ml-auto inline-flex h-9 items-center whitespace-nowrap rounded-full border border-(--lab-border) px-4 text-[13px] text-(--lab-text)">Connect wallet</span>
      </div>
    </header>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="border-b border-(--lab-hairline) pb-3 text-[24px] font-semibold leading-8 tracking-[-0.2px]">{children}</h2>;
}

export function PrimaryPill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`btn inline-flex h-12 items-center justify-center rounded-full bg-(--lab-text) px-8 text-[15px] font-semibold text-(--lab-canvas) ${className}`}>{children}</span>
  );
}

/** Label left, figure right, one hairline under. The ledger grammar every mockup shares. */
export function LedgerRow({ label, value, note, strong = false }: { label: React.ReactNode; value: React.ReactNode; note?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-(--lab-hairline) py-3.5">
      <div>
        <div className={strong ? "text-[15px] font-semibold" : "text-[15px] text-(--lab-text)"}>{label}</div>
        {note ? <div className="text-[13px] leading-5 text-(--lab-mute)">{note}</div> : null}
      </div>
      <div className={`shrink-0 text-right text-[20px] leading-6 ${strong ? "font-semibold" : "font-medium"}`}>{value}</div>
    </div>
  );
}
