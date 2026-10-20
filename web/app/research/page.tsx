import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@/components/prose";
import { POSTS, postDate } from "@/lib/content";

export const metadata: Metadata = {
  title: "Research | Uptick",
  description:
    "Notes on the replay behind every Uptick vault: what was measured, which window it used, and what changed in the product.",
};

export default function ResearchPage() {
  const posts = [...POSTS].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <section aria-labelledby="research-title">
      <header className="max-w-[690px]">
        <h1 id="research-title" className="serif text-[34px] font-normal leading-10 sm:text-[44px] sm:leading-[48px]">
          Notes from the replay
        </h1>
        <p className="mt-5 text-[18px] leading-7 text-mute">
          Every vault gate comes from replayed swaps. These notes record what the replay measured,
          which window it used, and what changed in the product as a result.
        </p>
      </header>

      <div className="mt-12 flex items-baseline justify-between border-b border-hairline pb-3 text-[13px] text-mute">
        <p>{posts.length} notes</p>
        <p>Newest first</p>
      </div>

      <ol>
        {posts.map((post) => (
          <li key={post.slug} id={post.slug} className="scroll-mt-24 border-b border-hairline">
            <Link href={`/research/${post.slug}`} className="row grid gap-x-8 gap-y-2 py-8 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
              <time dateTime={post.date} className="figure text-[13px] leading-8 text-mute">
                {postDate(post.date)}
              </time>
              <span className="block">
                <span className="block text-[24px] font-semibold leading-8 tracking-[-0.2px]">{post.title}</span>
                <span className="mt-2 block max-w-[64ch] text-[15px] leading-6 text-mute">{post.summary}</span>
                <span className="mt-3 block text-[13px] text-mute">{post.author}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <div className="mt-12 max-w-[690px]">
        <Callout label="Method">
          Each note starts from the same 30-day swap window. The first 15 days select the pool and
          the second 15 are held out. Vaults are sized to at most 20% of in-range liquidity, within a
          $10,000 floor and a $100,000 ceiling, then replayed at that size. The weaker half decides
          the gate.
        </Callout>
      </div>
    </section>
  );
}
