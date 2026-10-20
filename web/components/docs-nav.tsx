"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS, docHref } from "@/lib/content";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string): boolean {
  return href === "/docs" ? pathname === "/docs" : pathname === href || pathname.startsWith(`${href}/`);
}

function DocList({ pathname }: { pathname: string }) {
  return (
    <div className="space-y-7">
      {DOCS.map((group) => {
        const id = `group-${group.section.replace(/\s+/g, "-").toLowerCase()}`;
        return (
          <section key={group.section} aria-labelledby={id}>
            <h2 id={id} className="text-[13px] font-semibold">{group.section}</h2>
            <ul className="mt-2 border-l border-hairline">
              {group.pages.map((item) => {
                const href = docHref(item.slug);
                const active = isActive(pathname, href);
                return (
                  <li key={item.slug}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "-ml-px block min-h-11 border-l-2 py-2.5 pl-4 text-[14px] leading-5 transition-colors duration-150 lg:min-h-0 lg:py-1.5",
                        active ? "border-fg font-medium text-fg" : "border-transparent text-mute hover:text-fg",
                      )}
                    >
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function DocsNav() {
  const pathname = usePathname();
  const current = DOCS.flatMap((g) => g.pages).find((p) => isActive(pathname, docHref(p.slug)));

  return (
    <>
      <details className="group mb-8 border-b border-hairline pb-4 lg:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[15px] font-medium [&::-webkit-details-marker]:hidden">
          <span><span className="text-mute">Docs · </span>{current?.title ?? "Menu"}</span>
          <span aria-hidden="true" className="text-xl leading-none text-mute transition-transform duration-150 group-open:rotate-45">+</span>
        </summary>
        <div className="mt-4">
          <DocList pathname={pathname} />
        </div>
      </details>

      <nav aria-label="Docs" className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:pb-8 lg:pr-4">
        <DocList pathname={pathname} />
      </nav>
    </>
  );
}
