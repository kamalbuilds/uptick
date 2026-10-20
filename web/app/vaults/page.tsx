import type { Metadata } from "next";
import { SummaryRow } from "@/components/summary-row";
import { VaultList } from "@/components/vault-list";

export const metadata: Metadata = {
  title: "Vaults | Uptick",
  description: "Every Stock Token vault on Robinhood Chain, ordered by what a holder keeps in the worst half of the replay, with the deposit panel beside the list.",
};

export default function VaultsPage() {
  return (
    <section className="mx-auto max-w-[1280px] px-6 pb-8 pt-10 lg:pt-14" aria-labelledby="vaults">
      <h1 id="vaults" className="text-[32px] font-medium leading-10 tracking-[-0.33px]">Vaults</h1>
      <p className="mt-2 max-w-xl text-mute">
        Each vault holds one Stock Token in its USDG pool, inside a price band around the Chainlink price. Pick a row and deposit beside the list.
      </p>
      <SummaryRow className="mt-8" />
      <div className="mt-8">
        <VaultList />
      </div>
    </section>
  );
}
