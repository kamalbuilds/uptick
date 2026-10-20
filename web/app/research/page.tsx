import type { Metadata } from "next";
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
    <section
      aria-labelledby="research-title"
      className="mx-auto max-w-5xl px-4 pb-20 pt-12 sm:px-6 lg:pt-16"
    >
      <header className="max-w-[68ch]">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-body">Research</p>
        <h1
          id="research-title"
          className="mt-3 display text-[clamp(3rem,8vw,6rem)] leading-[0.92]"
        >
          Notes from the replay
        </h1>
        <p className="mt-5 text-lg leading-8 text-body sm:text-xl">
          Every vault gate comes from replayed swaps. These notes record what the replay measured,
          which window it used, and what changed in the product as a result.
        </p>
      </header>

      <div className="mt-12 flex items-baseline justify-between border-b border-ink pb-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-body">
          {posts.length} notes
        </p>
        <p className="text-xs text-body">Newest first</p>
      </div>

      <ol className="divide-y divide-sage-line border-b border-sage-line">
        {posts.map((post) => (
          <li
            key={post.slug}
            id={post.slug}
            className="grid scroll-mt-28 gap-3 py-8 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-8"
          >
            <div className="flex items-center gap-3 sm:block">
              <time dateTime={post.date} className="figure text-sm text-body">
                {postDate(post.date)}
              </time>
              <span className="inline-block rounded-full bg-primary-pale px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink sm:mt-2">
                {post.category}
              </span>
            </div>
            <div>
              <h2 className="text-[clamp(1.45rem,2.6vw,1.95rem)] leading-[1.08] tracking-[-0.01em]">
                {post.title}
              </h2>
              <p className="mt-2 max-w-[64ch] text-[15px] leading-6 text-body">{post.summary}</p>
              <p className="mt-3 text-xs text-body">{post.author}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 max-w-[68ch]">
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
