"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS, docHref } from "@/lib/content";

function isActive(pathname: string, href: string): boolean {
  return href === "/docs" ? pathname === "/docs" : pathname === href || pathname.startsWith(`${href}/`);
}

function DocList({ pathname }: { pathname: string }) {
  return (
    <div className="space-y-6">
      {DOCS.map((group) => (
        <section key={group.section} aria-labelledby={`group-${group.section.replace(/\s+/g, "-").toLowerCase()}`}>
          <h2
            id={`group-${group.section.replace(/\s+/g, "-").toLowerCase()}`}
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-body"
          >
            {group.section}
          </h2>
          <ul className="mt-2 space-y-0.5">
            {group.pages.map((item) => {
              const href = docHref(item.slug);
              const active = isActive(pathname, href);
              return (
                <li key={item.slug}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-lg px-2.5 py-2 text-sm leading-5 transition-colors ${
                      active
                        ? "bg-primary-pale font-semibold text-ink"
                        : "text-body hover:bg-sage hover:text-ink"
                    }`}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function DocsNav() {
  const pathname = usePathname();

  return (
    <>
      <details className="group mb-4 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl border border-sage-line bg-canvas px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          Docs menu
          <span
            aria-hidden="true"
            className="text-lg leading-none text-body transition-transform group-open:rotate-45"
          >
            +
          </span>
        </summary>
        <div className="mt-3 rounded-xl border border-sage-line bg-canvas p-3">
          <DocList pathname={pathname} />
        </div>
      </details>

      <nav
        aria-label="Docs"
        className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:pb-8"
      >
        <p className="mb-4 text-sm font-semibold text-ink">Docs</p>
        <DocList pathname={pathname} />
      </nav>
    </>
  );
}
