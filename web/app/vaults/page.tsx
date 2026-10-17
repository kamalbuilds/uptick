import type { Metadata } from "next";
import { VaultList } from "@/components/vault-list";

export const metadata: Metadata = {
  title: "Vaults | Uptick",
  description: "Every Stock Token vault on Robinhood Chain, with its pool, fee tier and 30-day fee APR.",
};

export default function VaultsPage() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6 lg:pt-16" aria-labelledby="vaults">
      <h1 id="vaults" className="rise display text-[clamp(3rem,8vw,6rem)]">Vaults</h1>
      <p className="rise mt-3 max-w-xl text-lg text-body" style={{ ["--i" as string]: 1 }}>
        Each vault holds one Stock Token in its USDG pool, inside a price band around the Chainlink price.
      </p>
      <div className="rise mt-10" style={{ ["--i" as string]: 2 }}>
        <VaultList />
      </div>
    </section>
  );
}
