import Link from "next/link";
import { EXPLORER, robinhoodChain } from "@/lib/chain";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-sage-line">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm text-body sm:px-6 md:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2 font-semibold">
            <Link href="/vaults" className="underline-offset-4 hover:underline">Vaults</Link>
            <Link href="/portfolio" className="underline-offset-4 hover:underline">Portfolio</Link>
            <Link href="/docs" className="underline-offset-4 hover:underline">Docs</Link>
            <Link href="/research" className="underline-offset-4 hover:underline">Research</Link>
          </nav>
          <p className="max-w-xl">
            Stock Tokens trade on Robinhood Chain and are not available in the US; other jurisdictions apply their own restrictions. Fee figures are estimates from pool swaps and are not a recommendation.
          </p>
        </div>
        <p className="figure flex flex-wrap gap-x-4 gap-y-1 text-xs md:justify-end md:text-right">
          <span>Chain {robinhoodChain.id}</span>
          <a className="-my-2 inline-block py-2 underline underline-offset-4" href={EXPLORER} target="_blank" rel="noreferrer">Blockscout</a>
        </p>
      </div>
    </footer>
  );
}
