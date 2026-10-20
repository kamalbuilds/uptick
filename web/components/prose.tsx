import Link from "next/link";
import { POSTS } from "@/lib/content";
import type { ReactNode } from "react";

function anchorFor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function Article({
  title,
  eyebrow,
  lede,
  date,
  author,
  children,
}: {
  title: string;
  eyebrow?: string;
  lede?: string;
  date?: string;
  author?: string;
  children: ReactNode;
}) {
  return (
    <article className="min-w-0">
      <header className="max-w-[68ch]">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-body">{eyebrow}</p>
        ) : null}
        <h1 className="mt-3 display text-[clamp(2.6rem,6vw,4.4rem)] leading-[1.02] [overflow-wrap:anywhere] sm:leading-[0.94]">{title}</h1>
        {lede ? <p className="mt-5 text-lg leading-8 text-body sm:text-xl">{lede}</p> : null}
        {date || author ? (
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-mute">
            {date ? <time dateTime={date.split(" ").join("-")}>{date}</time> : null}
            {date && author ? <span aria-hidden="true">/</span> : null}
            {author ? <span>{author}</span> : null}
          </div>
        ) : null}
      </header>
      <div className="mt-9 max-w-[68ch] space-y-6">{children}</div>
    </article>
  );
}

export function H2({ children, id }: { children: string; id?: string }) {
  const anchor = id ?? anchorFor(children);
  return (
    <h2
      id={anchor}
      className="scroll-mt-28 pt-5 text-[clamp(1.6rem,3vw,2.1rem)] leading-[1.05] tracking-[-0.01em]"
    >
      {children}
    </h2>
  );
}

export function H3({ children, id }: { children: string; id?: string }) {
  const anchor = id ?? anchorFor(children);
  return (
    <h3 id={anchor} className="scroll-mt-28 pt-3 text-xl leading-tight">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-[17px] leading-7 text-body">{children}</p>;
}

export function TLDR({ children }: { children: ReactNode }) {
  return (
    <aside className="rounded-xl border border-sage-line bg-canvas p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-body">In short</p>
      <div className="mt-3 text-[15px] leading-6 text-body [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </aside>
  );
}

export function Callout({
  label,
  tone = "note",
  children,
}: {
  label: string;
  tone?: "note" | "key";
  children: ReactNode;
}) {
  if (tone === "key") {
    return (
      <aside className="rounded-xl bg-ink p-5 text-sage">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{label}</p>
        <div className="mt-2 text-[15px] leading-6 text-sage [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2">
          {children}
        </div>
      </aside>
    );
  }
  return (
    <aside className="rounded-xl border border-sage-line bg-canvas p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-body">{label}</p>
      <div className="mt-2 text-[15px] leading-6 text-body [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-2">
        {children}
      </div>
    </aside>
  );
}

export function DataTable({
  columns,
  rows,
  numeric = [],
  caption,
}: {
  columns: string[];
  rows: ReactNode[][];
  numeric?: number[];
  caption?: string;
}) {
  return (
    <figure className="my-7">
      <div className="overflow-x-auto rounded-xl border border-sage-line bg-canvas">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={`border-b border-sage-line px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-body ${
                    numeric.includes(index) ? "text-right" : "text-left"
                  }`}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="transition-colors hover:bg-sage/40">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`border-t border-sage-line/70 px-4 py-3 align-top leading-6 ${
                      numeric.includes(cellIndex) ? "figure whitespace-nowrap text-right" : "text-body"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption ? <figcaption className="mt-2 text-xs leading-5 text-body">{caption}</figcaption> : null}
    </figure>
  );
}

export function Figure({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <figure className="my-7">
      <div className="rounded-xl border border-sage-line bg-canvas p-5">{children}</div>
      <figcaption className="mt-2 text-xs leading-5 text-body">{caption}</figcaption>
    </figure>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-sage px-1.5 py-0.5 figure text-[0.88em] text-ink [overflow-wrap:anywhere]">{children}</code>
  );
}

export function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <figure className="my-7 overflow-hidden rounded-xl bg-ink">
      <figcaption className="border-b border-sage/20 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-primary">
        {label}
      </figcaption>
      <pre className="overflow-x-auto p-4 text-[13px] leading-6 text-sage">
        <code className="figure">{code}</code>
      </pre>
    </figure>
  );
}

export function SourceRef({ path, children }: { path?: string; children: ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs leading-5 text-body">
      {path ? (
        <span className="figure rounded bg-sage px-1.5 py-0.5 text-[11px] text-ink">{path}</span>
      ) : null}
      <span>{children}</span>
    </p>
  );
}

export function Sources({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Sources" className="mt-12 border-t border-sage-line pt-5">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-body">Sources</p>
      <div className="mt-2 space-y-1">{children}</div>
    </section>
  );
}

/** End of a research post: back to the index and on to the next post, so a reader never dead-ends. */
export function PostFooter({ slug }: { slug: string }) {
  const i = POSTS.findIndex((p) => p.slug === slug);
  const next = POSTS[(i + 1) % POSTS.length];
  return (
    <nav aria-label="More research" className="mt-16 flex max-w-[68ch] flex-col gap-3 border-t border-sage-line pt-6 sm:flex-row sm:items-start sm:justify-between">
      <Link href="/research" className="text-sm font-semibold text-ink underline-offset-4 hover:underline">All research</Link>
      {next && next.slug !== slug ? (
        <Link href={`/research/${next.slug}`} className="group max-w-sm sm:text-right">
          <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-body">Next</span>
          <span className="mt-1 block font-semibold text-ink underline-offset-4 group-hover:underline">{next.title}</span>
        </Link>
      ) : null}
    </nav>
  );
}
