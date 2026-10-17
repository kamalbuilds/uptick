import { EXPLORER, robinhoodChain } from "@/lib/chain";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-sage-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-body sm:px-6 md:flex-row md:items-start md:justify-between">
        <p className="max-w-xl">
          Stock Tokens trade on Robinhood Chain and are not available in the US; other jurisdictions apply their own restrictions. Fee figures are estimates from pool swaps and are not a recommendation.
        </p>
        <p className="figure flex flex-wrap gap-x-4 gap-y-1 text-xs md:text-right">
          <span>Chain {robinhoodChain.id}</span>
          <a className="-my-2 inline-block py-2 underline underline-offset-4" href={EXPLORER} target="_blank" rel="noreferrer">Blockscout</a>
        </p>
      </div>
    </footer>
  );
}
