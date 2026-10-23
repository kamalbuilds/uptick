import Link from "next/link";
import { EXPLORER, robinhoodChain } from "@/lib/chain";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-hairline">
      <div className="mx-auto grid max-w-[1280px] gap-6 px-6 py-10 text-[13px] leading-5 text-mute md:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-1 text-[15px] text-fg">
            <Link href="/vaults" className="inline-block py-2 hover:underline hover:underline-offset-4">Vaults</Link>
            <Link href="/portfolio" className="inline-block py-2 hover:underline hover:underline-offset-4">Portfolio</Link>
            <Link href="/docs" className="inline-block py-2 hover:underline hover:underline-offset-4">Docs</Link>
            <Link href="/research" className="inline-block py-2 hover:underline hover:underline-offset-4">Research</Link>
            <Link href="/talk" className="inline-block py-2 hover:underline hover:underline-offset-4">Talk to us</Link>
            <a href="/deck/" className="inline-block py-2 hover:underline hover:underline-offset-4">Deck</a>
          </nav>
          <p className="max-w-xl">
            Stock Tokens trade on Robinhood Chain for holders outside the US, under each country's own rules. Fee figures are estimates from pool swaps and are not a recommendation.
          </p>
        </div>
        <p className="figure flex flex-wrap gap-x-6 gap-y-1 md:justify-end md:text-right">
          <span>Robinhood Chain {robinhoodChain.id}</span>
          <a className="-my-2 inline-block py-2 text-fg underline underline-offset-4" href={EXPLORER} target="_blank" rel="noreferrer">Blockscout</a>
        </p>
      </div>
    </footer>
  );
}
