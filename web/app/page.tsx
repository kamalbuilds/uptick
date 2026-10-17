import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { FeaturedVaultCard, VaultRow } from "@/components/vault-card";
import { VAULTS } from "@/lib/vaults";

const nvda = VAULTS[0];

const steps = [
  { title: "Deposit NVDA", body: "You send NVDA and receive vault shares. The vault holds your NVDA in the NVDA/USDG pool and re-centres its band at each NYSE open." },
  { title: "Uptick pools price the session", body: "The Uptick hook charges 25 bps while NYSE is open, 10 bps on weeknights and 5 bps on weekends. Trades that pull the pool away from the Chainlink price pay a surcharge." },
  { title: "The cap holds", body: "Every Uptick pool declares a maximum fee onchain. No swap through it can pay more, on any router." },
];

export default function Home() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.3fr_0.9fr] lg:items-start lg:gap-14 lg:pt-20">
        <div>
          <h1 className="rise display text-[clamp(3rem,12vw,5.5rem)] lg:text-[clamp(3.4rem,5.6vw,5.5rem)]" style={{ ["--i" as string]: 0 }}>
            Hold NVDA.<br />Collect the fees.
          </h1>
          <p className="rise mt-6 max-w-md text-xl text-body" style={{ ["--i" as string]: 2 }}>
            Deposit NVDA. The vault places it in the NVDA/USDG pool inside a price band and keeps every swap fee.
          </p>
          <div className="rise mt-8" style={{ ["--i" as string]: 3 }}>
            <Button asChild size="lg">
              <Link href="/vault/nvda">See the NVDA vault <ArrowRight size={20} weight="bold" aria-hidden /></Link>
            </Button>
          </div>
        </div>
        <div className="rise" style={{ ["--i" as string]: 4 }}>
          <FeaturedVaultCard cfg={nvda} />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 sm:px-6" aria-labelledby="how">
        <div className="rounded-xl bg-ink p-6 text-sage sm:p-10">
          <h2 id="how" className="text-[clamp(2rem,5vw,3.5rem)] leading-[0.95] text-primary">Fees that know when Wall Street is open</h2>
          <p className="mt-3 max-w-2xl text-sage">We replayed 5.1M swaps on Robinhood Chain. Liquidity providers earn 0.8 to 1.2 dollars of fees for every dollar lost to informed traders while NYSE is open, and 3.8 to 19.5 dollars on weekends. Uptick prices each session.</p>
          <ol className="relative mt-10 grid gap-8 border-t border-sage/25 pt-8 md:grid-cols-[0.9fr_1.35fr_1fr] md:gap-10">
            {steps.map((s, i) => (
              <li key={s.title} className="relative">
                <span className="absolute -top-[37px] left-0 size-3 rounded-full bg-primary" aria-hidden />
                <h3 className="text-2xl leading-none text-canvas">{i + 1}. {s.title}</h3>
                <p className="mt-3 text-sage">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6" aria-labelledby="vaults">
        <h2 id="vaults" className="text-[clamp(2rem,5vw,3.5rem)] leading-[0.95]">Vaults</h2>
        <div className="mt-6 divide-y divide-sage-line border-y border-sage-line">
          {VAULTS.map((v) => <VaultRow key={v.id} cfg={v} />)}
        </div>
      </section>
    </>
  );
}
