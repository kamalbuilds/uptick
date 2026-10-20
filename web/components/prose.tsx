import Link from "next/link";
import { POSTS } from "@/lib/content";
import { OnThisPage } from "./on-this-page";
import type { ReactNode } from "react";

function anchorFor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Long-form reading on the dark canvas: a 690px column, the title set once in the serif, an "On this page" rail beside it from xl up. */
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
    <article className="min-w-0 xl:grid xl:grid-cols-[minmax(0,690px)_200px] xl:gap-x-12">
      <div className="min-w-0">
        <header>
          {eyebrow ? <p className="text-[13px] text-mute">{eyebrow}</p> : null}
          <h1 className="serif mt-3 text-[34px] font-normal leading-10 [overflow-wrap:anywhere] sm:text-[44px] sm:leading-[48px]">{title}</h1>
          {lede ? <p className="mt-5 text-[18px] leading-7 text-mute">{lede}</p> : null}
          {date || author ? (
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-mute">
              {date ? <time dateTime={date.split(" ").join("-")}>{date}</time> : null}
              {date && author ? <span aria-hidden="true">·</span> : null}
              {author ? <span>{author}</span> : null}
            </div>
          ) : null}
        </header>
        <div className="mt-10 space-y-6">{children}</div>
      </div>
      <OnThisPage />
    </article>
  );
}

export function H2({ children, id }: { children: string; id?: string }) {
  const anchor = id ?? anchorFor(children);
  return (
    <h2 id={anchor} className="scroll-mt-24 border-t border-hairline pt-8 text-2xl font-semibold leading-8 tracking-[-0.2px]">
      {children}
    </h2>
  );
}

export function H3({ children, id }: { children: string; id?: string }) {
  const anchor = id ?? anchorFor(children);
  return (
    <h3 id={anchor} className="scroll-mt-24 pt-2 text-xl font-semibold leading-7 tracking-[-0.15px]">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-[16px] leading-7 text-fg/85">{children}</p>;
}

/** The summary up front: a left rule and a plain list, no box. */
export function TLDR({ children }: { children: ReactNode }) {
  return (
    <aside className="border-l-2 border-fg py-1 pl-5">
      <p className="text-[15px] font-semibold">In short</p>
      <div className="mt-2 text-[15px] leading-6 text-fg/85 [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
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
  return (
    <aside className={tone === "key" ? "rounded-sm border border-line bg-panel p-5" : "rounded-sm border border-hairline p-5"}>
      <p className="text-[15px] font-semibold">{label}</p>
      <div className="mt-2 text-[15px] leading-6 text-fg/85 [&_a]:text-fg [&_a]:underline [&_a]:underline-offset-4">
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
    <figure className="my-8">
      <div className="overflow-x-auto border-y border-hairline">
        <table className="w-full min-w-[34rem] border-collapse text-[14px]">
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={`border-b border-hairline px-3 py-3 text-[13px] font-medium text-mute first:pl-0 last:pr-0 ${
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
              <tr key={rowIndex} className="row">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`border-t border-hairline px-3 py-3 align-top leading-6 first:pl-0 last:pr-0 ${
                      numeric.includes(cellIndex) ? "figure whitespace-nowrap text-right" : "text-fg/85"
                    } ${cellIndex === 0 ? "font-medium text-fg" : ""}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption ? <figcaption className="mt-3 text-[13px] leading-5 text-mute">{caption}</figcaption> : null}
    </figure>
  );
}

export function Figure({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <figure className="my-8">
      <div className="rounded-lg border border-hairline p-5">{children}</div>
      <figcaption className="mt-3 text-[13px] leading-5 text-mute">{caption}</figcaption>
    </figure>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="figure rounded-sm bg-raised px-1.5 py-0.5 text-[0.9em] text-fg [overflow-wrap:anywhere]">{children}</code>;
}

export function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <figure className="my-8 overflow-hidden rounded-lg border border-hairline bg-panel">
      <figcaption className="border-b border-hairline px-4 py-2.5 text-[13px] text-mute">{label}</figcaption>
      <pre className="overflow-x-auto p-4 text-[13px] leading-6 text-fg/90">
        <code className="font-[ui-monospace,SFMono-Regular,Menlo,monospace]">{code}</code>
      </pre>
    </figure>
  );
}

export function SourceRef({ path, children }: { path?: string; children: ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] leading-5 text-mute">
      {path ? <span className="figure rounded-sm bg-raised px-1.5 py-0.5 text-[12px] text-fg">{path}</span> : null}
      <span>{children}</span>
    </p>
  );
}

export function Sources({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Sources" className="mt-14 border-t border-hairline pt-5">
      <p className="text-[15px] font-semibold">Sources</p>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

/** End of a research post: back to the index and on to the next post, so a reader never dead-ends. */
export function PostFooter({ slug }: { slug: string }) {
  const i = POSTS.findIndex((p) => p.slug === slug);
  const next = POSTS[(i + 1) % POSTS.length];
  return (
    <nav aria-label="More research" className="mt-16 flex flex-col gap-3 border-t border-hairline pt-6 sm:flex-row sm:items-start sm:justify-between">
      <Link href="/research" className="inline-block py-2 font-semibold hover:underline hover:underline-offset-4">All research</Link>
      {next && next.slug !== slug ? (
        <Link href={`/research/${next.slug}`} className="group max-w-sm sm:text-right">
          <span className="block text-[13px] text-mute">Next</span>
          <span className="mt-1 block font-semibold group-hover:underline group-hover:underline-offset-4">{next.title}</span>
        </Link>
      ) : null}
    </nav>
  );
}
