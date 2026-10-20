"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Heading = { id: string; text: string };

/** The rail beside a long read: every H2 on the page, the one being read marked. Built from the rendered article, so a page never lists a section it lacks. */
export function OnThisPage() {
  const pathname = usePathname();
  const [heads, setHeads] = useState<Heading[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const found = [...document.querySelectorAll<HTMLElement>("article h2[id]")].map((h) => ({ id: h.id, text: h.textContent ?? "" }));
    setHeads(found);
    setActive(found[0]?.id ?? null);
    if (found.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    found.forEach((h) => { const el = document.getElementById(h.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [pathname]);

  if (heads.length < 2) return <div className="hidden xl:block" aria-hidden />;
  return (
    <nav aria-label="On this page" className="hidden xl:sticky xl:top-24 xl:block xl:self-start">
      <p className="text-[13px] font-semibold">On this page</p>
      <ul className="mt-3 border-l border-hairline">
        {heads.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              aria-current={active === h.id ? "location" : undefined}
              className={cn("-ml-px block border-l-2 py-1.5 pl-3 text-[13px] leading-5 transition-colors duration-150", active === h.id ? "border-fg text-fg" : "border-transparent text-mute hover:text-fg")}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
