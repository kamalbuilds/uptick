import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { FeaturedVaultCard } from "@/components/vault-card";
import { VaultList } from "@/components/vault-list";
import { getVault } from "@/lib/vaults";

const nvda = getVault("nvda")!;

const steps = [
  { title: "Deposit your Stock Token", body: "You send a Stock Token and receive vault shares. The vault keeps your deposit in one pool, inside a price band around the Chainlink price." },
  { title: "Uptick shows what LPs keep", body: "Every swap on every pool for that token is replayed. Each vault page shows fee APR next to what liquidity keeps after informed traders, and deposits open where the kept figure holds in both halves of the replay." },
  { title: "Fees come back to you", body: "Swap fees accrue to your shares. Pools are checked against an on-chain declared fee cap. Uptick only deposits into pools without fee-taking hooks or with a declared on-chain cap." },
];

export default function Home() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.3fr_0.9fr] lg:items-start lg:gap-14 lg:pt-20">
        <div>
          <h1 className="rise display text-[clamp(3rem,12vw,5.5rem)] lg:text-[clamp(3.4rem,5.6vw,5.5rem)]" style={{ ["--i" as string]: 0 }}>
            Put your stock tokens<br />to work.
          </h1>
          <p className="rise mt-6 max-w-md text-xl text-body" style={{ ["--i" as string]: 2 }}>
            Deposit NVDA or GOOGL and earn a share of every trade&rsquo;s fee. Uptick shows what you earn and what you keep after losses to fast traders, and opens a vault only where 5.1 million past trades say it holds up.
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
          <h2 id="how" className="text-[clamp(2rem,5vw,3.5rem)] leading-[0.95] text-primary">How Uptick picks a pool</h2>
          <p className="mt-3 max-w-2xl text-sage">Deposit NVDA or GOOGL and earn a share of every trade&rsquo;s fee. Uptick shows what you earn and what you keep after losses to fast traders, and opens a vault only where 5.1 million past trades say it holds up.</p>
          <ol className="relative mt-10 grid gap-8 border-t border-sage/25 pt-8 md:grid-cols-3 md:gap-10">
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
        <div className="mt-6"><VaultList /></div>
      </section>
    </>
  );
}
