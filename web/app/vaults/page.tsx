import type { Metadata } from "next";
import { VaultList } from "@/components/vault-list";

export const metadata: Metadata = {
  title: "Vaults | Uptick",
  description: "Every Stock Token vault on Robinhood Chain, ordered by what a holder keeps in the weaker half of the replay.",
};

export default function VaultsPage() {
  return (
    <section className="mx-auto max-w-[1280px] px-6 pb-8 pt-10 lg:pt-14" aria-labelledby="vaults">
      <h1 id="vaults" className="text-[32px] font-medium leading-10 tracking-[-0.33px]">Vaults</h1>
      <p className="mt-2 max-w-xl text-mute">
        Each vault holds one Stock Token in its USDG pool, inside a price band around the Chainlink price. The bar is what a holder keeps a year in the weaker half of the replay.
      </p>
      <div className="mt-8">
        <VaultList />
      </div>
    </section>
  );
}
